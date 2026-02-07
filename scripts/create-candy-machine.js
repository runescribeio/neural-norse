/**
 * Create a Candy Machine V3 for Neural Norse.
 * 
 * Guards: solPayment (0.02 SOL), mintLimit (10), thirdPartySigner (our server)
 * Loads 9,750 public items (excluding 250 reserved).
 * Resumable -- saves progress to data/candy-machine-progress.json.
 * 
 * Usage:
 *   SOLANA_PRIVATE_KEY=... TREASURY_WALLET=... COLLECTION_MINT=... node scripts/create-candy-machine.js
 */

const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
const { 
  mplCandyMachine,
  create,
  addConfigLines,
  fetchCandyMachine,
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

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const TREASURY = process.env.TREASURY_WALLET;
const COLLECTION = process.env.COLLECTION_MINT;
const BATCH_SIZE = 8;

async function main() {
  if (!TREASURY) throw new Error("Set TREASURY_WALLET env var");
  if (!COLLECTION) throw new Error("Set COLLECTION_MINT env var");

  const secretKey = (bs58.default || bs58).decode(process.env.SOLANA_PRIVATE_KEY);
  const authority = Keypair.fromSecretKey(secretKey);
  console.log("Authority:", authority.publicKey.toBase58());

  const umi = createUmi(RPC)
    .use(mplCandyMachine())
    .use(mplTokenMetadata());
  umi.use(keypairIdentity(fromWeb3JsKeypair(authority)));

  // Load public items
  const indexPath = path.join(__dirname, "../data/metadata-index.json");
  const allItems = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  const publicItems = allItems.filter(item => !item.reserved);
  console.log(`Total: ${allItems.length}, Public: ${publicItems.length}, Reserved: ${allItems.length - publicItems.length}`);

  // Prefixes for config line compression
  const URI_PREFIX = "https://arweave.net/";
  const NAME_PREFIX = "Neural Norse #";

  for (const item of publicItems) {
    if (!item.metadataUri.startsWith(URI_PREFIX)) throw new Error(`Bad URI prefix: ${item.metadataUri}`);
    if (!item.name.startsWith(NAME_PREFIX)) throw new Error(`Bad name prefix: ${item.name}`);
  }

  const maxUriLen = Math.max(...publicItems.map(i => i.metadataUri.slice(URI_PREFIX.length).length));
  const maxNameLen = Math.max(...publicItems.map(i => i.name.slice(NAME_PREFIX.length).length));
  console.log(`URI prefix: "${URI_PREFIX}", suffix max: ${maxUriLen}`);
  console.log(`Name prefix: "${NAME_PREFIX}", suffix max: ${maxNameLen}`);

  // Resume support
  const progressPath = path.join(__dirname, "../data/candy-machine-progress.json");
  let progress = { candyMachine: null, itemsInserted: 0 };
  if (fs.existsSync(progressPath)) {
    progress = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
    console.log(`Resuming: ${progress.candyMachine}, ${progress.itemsInserted} items done`);
  }

  // Step 1: Create Candy Machine (if not already created)
  if (!progress.candyMachine) {
    const candyMachine = generateSigner(umi);
    console.log("\nCreating Candy Machine:", candyMachine.publicKey);

    // create() is async and returns a TransactionBuilder
    const builder = await create(umi, {
      candyMachine,
      collectionMint: publicKey(COLLECTION),
      collectionUpdateAuthority: umi.identity,
      tokenStandard: 0, // NonFungible
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
    console.log("Candy Machine created!");

    progress.candyMachine = candyMachine.publicKey;
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  }

  const cmAddress = progress.candyMachine;

  // Step 2: Insert config lines in batches
  console.log(`\nInserting items (${progress.itemsInserted}/${publicItems.length})...`);

  for (let i = progress.itemsInserted; i < publicItems.length; i += BATCH_SIZE) {
    const batch = publicItems.slice(i, Math.min(i + BATCH_SIZE, publicItems.length));
    const configLines = batch.map(item => ({
      name: item.name.slice(NAME_PREFIX.length),
      uri: item.metadataUri.slice(URI_PREFIX.length),
    }));

    let success = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        // addConfigLines is sync, returns TransactionBuilder directly
        const txPromise = addConfigLines(umi, {
          candyMachine: publicKey(cmAddress),
          index: i,
          configLines,
        }).sendAndConfirm(umi);

        // Timeout after 30s to avoid hanging forever
        const timeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("TX timeout after 30s")), 30000));
        
        await Promise.race([txPromise, timeout]);
        success = true;
        break;
      } catch (err) {
        const msg = err.message || String(err);
        console.error(`  Error at index ${i} (attempt ${attempt + 1}/5):`, msg.slice(0, 120));
        if (attempt < 4) {
          const delay = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s, 16s
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    // Delay between batches to avoid 429s
    await new Promise(r => setTimeout(r, 1200));

    if (!success) {
      fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
      console.error(`  Failed after 3 attempts at index ${i}. Re-run to resume.`);
      process.exit(1);
    }

    progress.itemsInserted = i + batch.length;

    // Log every batch, save every 50 batches
    if (progress.itemsInserted % 80 === 0 || progress.itemsInserted >= publicItems.length) {
      console.log(`  ${progress.itemsInserted}/${publicItems.length}`);
      fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
    }
  }

  console.log(`\nAll ${publicItems.length} items inserted!`);

  // Verify
  const cm = await fetchCandyMachine(umi, publicKey(cmAddress));
  console.log("\nCandy Machine verified:");
  console.log("  Address:", cmAddress);
  console.log("  Items loaded:", cm.itemsLoaded, "/", Number(cm.data.itemsAvailable));
  console.log("  Items redeemed:", Number(cm.itemsRedeemed));
  console.log("\nAdd to Vercel env vars:");
  console.log(`  CANDY_MACHINE=${cmAddress}`);

  progress.complete = true;
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
