#!/usr/bin/env node
/**
 * Create a Core Candy Machine for Neural Norse.
 * 
 * Uses mpl-core-candy-machine (NOT the broken legacy mpl-candy-machine).
 * The legacy CM program on mainnet can't mint from v1 accounts created by its own SDK.
 * 
 * Steps:
 *   1. Create a Core Collection
 *   2. Create Core Candy Machine with guards (solPayment, mintLimit, thirdPartySigner)
 *   3. Load 9,750 config lines
 *   4. Verify on-chain
 *
 * Usage:
 *   node scripts/create-core-candy-machine.js
 */

const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
const {
  mplCandyMachine,
  create,
  addConfigLines,
  fetchCandyMachine,
  fetchCandyGuard,
} = require("@metaplex-foundation/mpl-core-candy-machine");
const {
  createCollectionV1,
  mplCore,
} = require("@metaplex-foundation/mpl-core");
const {
  keypairIdentity,
  generateSigner,
  some,
  sol,
  publicKey,
  percentAmount,
} = require("@metaplex-foundation/umi");
const { fromWeb3JsKeypair } = require("@metaplex-foundation/umi-web3js-adapters");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const RPC = process.env.SOLANA_RPC || "https://hollyanne-bcst2m-fast-mainnet.helius-rpc.com";
const TREASURY = "2azuH3ACbZn9yj68WPyczRywbAQHjkNxNMHZLMZB9imv";
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 600;

const PROGRESS_PATH = path.join(__dirname, "../data/core-cm-progress.json");

function loadProgress() {
  if (fs.existsSync(PROGRESS_PATH)) {
    return JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
  }
  return { step: "start" };
}

function saveProgress(data) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(data, null, 2));
}

async function main() {
  const secretKey = (bs58.default || bs58).decode(process.env.SOLANA_PRIVATE_KEY);
  const authority = Keypair.fromSecretKey(secretKey);
  console.log("Authority:", authority.publicKey.toBase58());
  console.log("RPC:", RPC);
  console.log("Treasury:", TREASURY);

  const umi = createUmi(RPC)
    .use(mplCandyMachine())
    .use(mplCore());
  umi.use(keypairIdentity(fromWeb3JsKeypair(authority)));

  // Load items
  const indexPath = path.join(__dirname, "../data/metadata-index.json");
  const allItems = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  const publicItems = allItems.filter(item => !item.reserved);
  console.log(`\nItems: ${publicItems.length} public / ${allItems.length} total`);

  const URI_PREFIX = "https://arweave.net/";
  const NAME_PREFIX = "Neural Norse #";

  for (const item of publicItems) {
    if (!item.metadataUri.startsWith(URI_PREFIX)) throw new Error(`Bad URI prefix: ${item.metadataUri}`);
    if (!item.name.startsWith(NAME_PREFIX)) throw new Error(`Bad name prefix: ${item.name}`);
  }

  const maxUriLen = Math.max(...publicItems.map(i => i.metadataUri.slice(URI_PREFIX.length).length));
  const maxNameLen = Math.max(...publicItems.map(i => i.name.slice(NAME_PREFIX.length).length));
  console.log(`URI suffix max: ${maxUriLen}, Name suffix max: ${maxNameLen}`);

  let progress = loadProgress();

  // ================================================================
  // STEP 1: Create Core Collection
  // ================================================================
  if (!progress.collection) {
    console.log("\n=== STEP 1: Create Core Collection ===");
    const collectionSigner = generateSigner(umi);
    console.log("Collection address:", collectionSigner.publicKey);

    await createCollectionV1(umi, {
      collection: collectionSigner,
      name: "Neural Norse",
      uri: "https://arweave.net/EwzKtbcvNunJSEq-SZ6J-XB6xgSBWvKCaoGF9Hn0ZVo",
      plugins: [],
    }).sendAndConfirm(umi);

    console.log("Core Collection created!");
    progress.collection = collectionSigner.publicKey;
    saveProgress(progress);
  } else {
    console.log("\nCollection already created:", progress.collection);
  }

  // ================================================================
  // STEP 2: Create Core Candy Machine + Guards
  // ================================================================
  if (!progress.candyMachine) {
    console.log("\n=== STEP 2: Create Core Candy Machine ===");
    const candyMachine = generateSigner(umi);
    console.log("Candy Machine address:", candyMachine.publicKey);

    const builder = await create(umi, {
      candyMachine,
      collection: publicKey(progress.collection),
      collectionUpdateAuthority: umi.identity,
      itemsAvailable: publicItems.length,
      isMutable: true,
      configLineSettings: some({
        prefixName: NAME_PREFIX,
        nameLength: maxNameLen,
        prefixUri: URI_PREFIX,
        uriLength: maxUriLen,
        isSequential: false,
      }),
      guards: {
        solPayment: some({
          lamports: sol(0.02),
          destination: publicKey(TREASURY),
        }),
        mintLimit: some({ id: 1, limit: 10 }),
        thirdPartySigner: some({ signerKey: umi.identity.publicKey }),
      },
    });

    await builder.sendAndConfirm(umi);
    console.log("Core Candy Machine created!");

    progress.candyMachine = candyMachine.publicKey;
    progress.itemsInserted = 0;
    saveProgress(progress);
  } else {
    console.log("\nCandy Machine already created:", progress.candyMachine);
  }

  // Verify CM state
  const cm = await fetchCandyMachine(umi, publicKey(progress.candyMachine));
  console.log("  Items available:", Number(cm.data.itemsAvailable));
  console.log("  Items loaded:", cm.itemsLoaded);
  console.log("  Authority:", cm.authority);
  console.log("  Mint authority:", cm.mintAuthority);

  // ================================================================
  // STEP 3: Load config lines
  // ================================================================
  const startFrom = progress.itemsInserted || 0;
  if (startFrom < publicItems.length) {
    console.log(`\n=== STEP 3: Loading config lines (${startFrom}/${publicItems.length}) ===`);
  }

  for (let i = startFrom; i < publicItems.length; i += BATCH_SIZE) {
    const batch = publicItems.slice(i, Math.min(i + BATCH_SIZE, publicItems.length));
    const configLines = batch.map(item => ({
      name: item.name.slice(NAME_PREFIX.length),
      uri: item.metadataUri.slice(URI_PREFIX.length),
    }));

    let success = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const txPromise = addConfigLines(umi, {
          candyMachine: publicKey(progress.candyMachine),
          index: i,
          configLines,
        }).sendAndConfirm(umi);

        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("TX timeout 30s")), 30000));

        await Promise.race([txPromise, timeout]);
        success = true;
        break;
      } catch (err) {
        const msg = err.message || String(err);
        console.error(`  Error at ${i} (attempt ${attempt + 1}/5):`, msg.slice(0, 120));
        if (attempt < 4) {
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
        }
      }
    }

    if (!success) {
      saveProgress(progress);
      console.error(`Failed at index ${i}. Re-run to resume.`);
      process.exit(1);
    }

    progress.itemsInserted = i + batch.length;
    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));

    if (progress.itemsInserted % 100 === 0 || progress.itemsInserted >= publicItems.length) {
      const pct = ((progress.itemsInserted / publicItems.length) * 100).toFixed(1);
      console.log(`  ${progress.itemsInserted}/${publicItems.length} (${pct}%)`);
      saveProgress(progress);
    }
  }

  console.log(`\n=== ALL ${publicItems.length} ITEMS LOADED ===`);

  // Final verification
  const finalCm = await fetchCandyMachine(umi, publicKey(progress.candyMachine));
  const finalGuard = await fetchCandyGuard(umi, finalCm.mintAuthority);
  console.log("\n=== FINAL STATE ===");
  console.log("Candy Machine:", progress.candyMachine);
  console.log("Collection:", progress.collection);
  console.log("Items loaded:", finalCm.itemsLoaded, "/", Number(finalCm.data.itemsAvailable));
  console.log("Authority:", finalCm.authority);
  console.log("Guard:", finalCm.mintAuthority);
  console.log("Guard authority:", finalGuard.authority);

  progress.complete = true;
  saveProgress(progress);

  console.log("\nUpdate Vercel env vars:");
  console.log(`  CANDY_MACHINE=${progress.candyMachine}`);
  console.log(`  COLLECTION_MINT=${progress.collection}`);
}

main().catch(err => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
