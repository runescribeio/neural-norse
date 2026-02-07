#!/usr/bin/env node
/**
 * Recreate Candy Machine (v0 account) for Neural Norse.
 * 
 * Step 1: Delete existing CM (recover rent)
 * Step 2: Create new CM using initializeCandyMachine (v0, NOT v2)
 * Step 3: Create candy guard with guards
 * Step 4: Wrap (set guard as mint authority)
 * 
 * IMPORTANT: Uses createCandyMachine (v0) not create() which uses createCandyMachineV2 (v1).
 * The on-chain CndyV3 program cannot deserialize v1 accounts during MintV2.
 */

const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
const {
  mplCandyMachine,
  createCandyMachine,
  createCandyGuard,
  wrap,
  deleteCandyMachine,
  deleteCandyGuard,
  fetchCandyMachine,
  fetchCandyGuard,
  findCandyGuardPda,
  addConfigLines,
} = require("@metaplex-foundation/mpl-candy-machine");
const { mplTokenMetadata } = require("@metaplex-foundation/mpl-token-metadata");
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
const COLLECTION = "ERJkTcEaaEuFm5oXiXMHXfM64bh84B5hhKCo7GoFd9dA";
const TREASURY = "2azuH3ACbZn9yj68WPyczRywbAQHjkNxNMHZLMZB9imv";
const OLD_CM = "ioS4jQmb6aHYbDZN1nQSgxeYYp6aJPYfBtPRwDebqB7";

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 800;

async function main() {
  const secretKey = (bs58.default || bs58).decode(process.env.SOLANA_PRIVATE_KEY);
  const authority = Keypair.fromSecretKey(secretKey);
  console.log("Authority:", authority.publicKey.toBase58());
  console.log("RPC:", RPC);
  console.log("Collection:", COLLECTION);
  console.log("Treasury:", TREASURY);

  const umi = createUmi(RPC)
    .use(mplCandyMachine())
    .use(mplTokenMetadata());
  umi.use(keypairIdentity(fromWeb3JsKeypair(authority)));

  // Load public items from metadata index
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
  console.log(`URI suffix max length: ${maxUriLen}, Name suffix max length: ${maxNameLen}`);

  // ================================================================
  // STEP 1: Delete old candy machine + guard (recover rent)
  // ================================================================
  console.log("\n=== STEP 1: Delete old candy machine ===");
  
  try {
    const oldCm = await fetchCandyMachine(umi, publicKey(OLD_CM));
    console.log(`Old CM found: ${OLD_CM}`);
    console.log(`  Items: ${oldCm.itemsLoaded}/${Number(oldCm.data.itemsAvailable)}, Redeemed: ${Number(oldCm.itemsRedeemed)}`);
    console.log(`  Version: ${oldCm.version}`);

    // First unwrap (remove guard as mint authority) -- needed before deleting guard
    // Actually, let's delete the guard first if it exists
    const oldGuardAddr = oldCm.mintAuthority;
    
    try {
      const oldGuard = await fetchCandyGuard(umi, oldGuardAddr);
      console.log(`Old guard found: ${oldGuardAddr}`);
      console.log(`  Authority: ${oldGuard.authority}`);
      
      // Delete guard
      console.log("Deleting old candy guard...");
      await deleteCandyGuard(umi, {
        candyGuard: oldGuardAddr,
        authority: umi.identity,
      }).sendAndConfirm(umi);
      console.log("Old guard deleted.");
    } catch (e) {
      console.log("No guard to delete or already deleted:", e.message?.slice(0, 80));
    }

    // Delete candy machine
    console.log("Deleting old candy machine...");
    await deleteCandyMachine(umi, {
      candyMachine: publicKey(OLD_CM),
      authority: umi.identity,
    }).sendAndConfirm(umi);
    console.log("Old candy machine deleted. Rent recovered.");
  } catch (e) {
    console.log("Old CM not found or already deleted:", e.message?.slice(0, 80));
  }

  // ================================================================
  // STEP 2: Create new candy machine (VERSION 0)
  // ================================================================
  console.log("\n=== STEP 2: Create new candy machine (v0) ===");
  
  const candyMachine = generateSigner(umi);
  console.log("New CM address:", candyMachine.publicKey);

  // createCandyMachine creates a v0 account (uses initializeCandyMachine, not V2)
  // v0 does NOT take tokenStandard parameter
  const cmBuilder = await createCandyMachine(umi, {
    candyMachine,
    collectionMint: publicKey(COLLECTION),
    collectionUpdateAuthority: umi.identity,
    sellerFeeBasisPoints: percentAmount(5),
    itemsAvailable: publicItems.length,
    creators: [
      { address: umi.identity.publicKey, verified: true, percentageShare: 100 },
    ],
    configLineSettings: some({
      prefixName: NAME_PREFIX,
      nameLength: maxNameLen,
      prefixUri: URI_PREFIX,
      uriLength: maxUriLen,
      isSequential: false,
    }),
  });

  console.log("Sending create transaction...");
  await cmBuilder.sendAndConfirm(umi);
  console.log("Candy machine created (v0)!");

  // Verify version
  const newCm = await fetchCandyMachine(umi, candyMachine.publicKey);
  console.log(`  Version: ${newCm.version} (should be 0)`);
  console.log(`  Items available: ${Number(newCm.data.itemsAvailable)}`);
  
  if (newCm.version !== 0) {
    throw new Error(`UNEXPECTED: Created CM has version ${newCm.version}, expected 0. Aborting.`);
  }

  // ================================================================
  // STEP 3: Create candy guard with guards
  // ================================================================
  console.log("\n=== STEP 3: Create candy guard ===");
  
  const guardBuilder = createCandyGuard(umi, {
    base: candyMachine,
    guards: {
      solPayment: some({
        lamports: sol(0.02),
        destination: publicKey(TREASURY),
      }),
      mintLimit: some({ id: 1, limit: 10 }),
      thirdPartySigner: some({ signerKey: umi.identity.publicKey }),
    },
  });

  console.log("Sending guard creation...");
  await guardBuilder.sendAndConfirm(umi);
  console.log("Candy guard created!");

  // ================================================================
  // STEP 4: Wrap (set guard as mint authority)
  // ================================================================
  console.log("\n=== STEP 4: Wrap candy machine with guard ===");
  
  const candyGuardPda = findCandyGuardPda(umi, { base: candyMachine.publicKey });
  
  const wrapBuilder = wrap(umi, {
    candyMachine: candyMachine.publicKey,
    candyGuard: candyGuardPda,
    authority: umi.identity,
  });

  console.log("Sending wrap transaction...");
  await wrapBuilder.sendAndConfirm(umi);
  console.log("Wrapped!");

  // Verify final state
  const finalCm = await fetchCandyMachine(umi, candyMachine.publicKey);
  const finalGuard = await fetchCandyGuard(umi, finalCm.mintAuthority);
  console.log("\n=== Candy Machine Ready ===");
  console.log("Address:", candyMachine.publicKey);
  console.log("Version:", finalCm.version);
  console.log("Authority:", finalCm.authority);
  console.log("Mint Authority (guard):", finalCm.mintAuthority);
  console.log("Guard authority:", finalGuard.authority);
  console.log("Items available:", Number(finalCm.data.itemsAvailable));
  console.log("Items loaded:", finalCm.itemsLoaded);

  // Save progress for item loading
  const progressPath = path.join(__dirname, "../data/candy-machine-progress.json");
  fs.writeFileSync(progressPath, JSON.stringify({
    candyMachine: candyMachine.publicKey,
    itemsInserted: 0,
    version: 0,
  }, null, 2));
  console.log("\nProgress saved. Now loading items...");

  // ================================================================
  // STEP 5: Load config lines
  // ================================================================
  console.log("\n=== STEP 5: Loading config lines ===");
  
  let itemsInserted = 0;
  const totalItems = publicItems.length;
  
  for (let i = 0; i < totalItems; i += BATCH_SIZE) {
    const batch = publicItems.slice(i, Math.min(i + BATCH_SIZE, totalItems));
    const configLines = batch.map(item => ({
      name: item.name.slice(NAME_PREFIX.length),
      uri: item.metadataUri.slice(URI_PREFIX.length),
    }));

    let success = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const txPromise = addConfigLines(umi, {
          candyMachine: candyMachine.publicKey,
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
      // Save progress so we can resume
      fs.writeFileSync(progressPath, JSON.stringify({
        candyMachine: candyMachine.publicKey,
        itemsInserted,
        version: 0,
      }, null, 2));
      console.error(`Failed at index ${i} after 5 attempts. Run load-items.js to resume.`);
      process.exit(1);
    }

    itemsInserted = i + batch.length;
    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));

    if (itemsInserted % 100 === 0 || itemsInserted >= totalItems) {
      const pct = ((itemsInserted / totalItems) * 100).toFixed(1);
      console.log(`  ${itemsInserted}/${totalItems} (${pct}%)`);
      fs.writeFileSync(progressPath, JSON.stringify({
        candyMachine: candyMachine.publicKey,
        itemsInserted,
        version: 0,
      }, null, 2));
    }
  }

  console.log(`\n=== ALL ${totalItems} ITEMS LOADED ===`);

  // Final verification
  const verifiedCm = await fetchCandyMachine(umi, candyMachine.publicKey);
  console.log("On-chain items loaded:", verifiedCm.itemsLoaded);
  console.log("On-chain items available:", Number(verifiedCm.data.itemsAvailable));

  fs.writeFileSync(progressPath, JSON.stringify({
    candyMachine: candyMachine.publicKey,
    itemsInserted: totalItems,
    version: 0,
    complete: true,
  }, null, 2));

  console.log("\nCANDY_MACHINE=" + candyMachine.publicKey);
  console.log("Update this in Vercel env vars.");
}

main().catch(err => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
