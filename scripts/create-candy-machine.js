/**
 * Create a Candy Machine V3 for Neural Norse.
 * 
 * This creates the Candy Machine with guards:
 *   - solPayment: 0.02 SOL to treasury
 *   - mintLimit: 10 per wallet
 *   - thirdPartySigner: our server must co-sign each mint (PoW gatekeeper)
 * 
 * Then inserts all 9,750 public items (excluding 250 reserved).
 * 
 * Usage:
 *   SOLANA_PRIVATE_KEY=... TREASURY_WALLET=... node scripts/create-candy-machine.js
 * 
 * Environment:
 *   SOLANA_PRIVATE_KEY  - Base58 private key of the authority
 *   TREASURY_WALLET     - Public key of the treasury wallet for SOL payments
 *   COLLECTION_MINT     - Public key of the collection NFT
 *   SOLANA_RPC          - RPC endpoint (default: mainnet)
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
const COLLECTION_MINT = process.env.COLLECTION_MINT;
const BATCH_SIZE = 8; // Config lines per transaction (conservative for long URIs)

async function main() {
  if (!TREASURY) throw new Error("Set TREASURY_WALLET env var");
  if (!COLLECTION_MINT) throw new Error("Set COLLECTION_MINT env var");

  // Load authority keypair
  const secretKey = (bs58.default || bs58).decode(process.env.SOLANA_PRIVATE_KEY);
  const authority = Keypair.fromSecretKey(secretKey);
  console.log("Authority:", authority.publicKey.toBase58());

  // Set up Umi
  const umi = createUmi(RPC)
    .use(mplCandyMachine())
    .use(mplTokenMetadata());
  
  const umiKeypair = fromWeb3JsKeypair(authority);
  umi.use(keypairIdentity(umiKeypair));

  // Load metadata index (only public, non-reserved items)
  const indexPath = path.join(__dirname, "../data/metadata-index.json");
  const allItems = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  const publicItems = allItems.filter(item => !item.reserved);
  console.log(`Total items: ${allItems.length}, Public: ${publicItems.length}, Reserved: ${allItems.length - publicItems.length}`);

  // Check for existing candy machine (resume support)
  const progressPath = path.join(__dirname, "../data/candy-machine-progress.json");
  let progress = { candyMachine: null, itemsInserted: 0 };
  if (fs.existsSync(progressPath)) {
    progress = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
    console.log(`Resuming: Candy Machine ${progress.candyMachine}, ${progress.itemsInserted} items already inserted`);
  }

  // Find the longest URI (without the common prefix)
  // All Arweave URIs look like: https://arweave.net/{txId}
  const URI_PREFIX = "https://arweave.net/";
  const NAME_PREFIX = "Neural Norse #";
  
  // Validate all items use the prefix
  for (const item of publicItems) {
    if (!item.metadataUri.startsWith(URI_PREFIX)) {
      throw new Error(`Item ${item.index} URI doesn't start with expected prefix: ${item.metadataUri}`);
    }
    if (!item.name.startsWith(NAME_PREFIX)) {
      throw new Error(`Item ${item.index} name doesn't start with expected prefix: ${item.name}`);
    }
  }

  const maxUriSuffix = Math.max(...publicItems.map(i => i.metadataUri.slice(URI_PREFIX.length).length));
  const maxNameSuffix = Math.max(...publicItems.map(i => i.name.slice(NAME_PREFIX.length).length));
  console.log(`URI prefix: "${URI_PREFIX}", max suffix length: ${maxUriSuffix}`);
  console.log(`Name prefix: "${NAME_PREFIX}", max suffix length: ${maxNameSuffix}`);

  let candyMachineAddress = progress.candyMachine;

  if (!candyMachineAddress) {
    // Create the Candy Machine
    const candyMachine = generateSigner(umi);
    candyMachineAddress = candyMachine.publicKey;

    console.log("\nCreating Candy Machine...");
    console.log("Address:", candyMachineAddress);

    const createBuilder = create(umi, {
      candyMachine,
      collectionMint: publicKey(COLLECTION_MINT),
      collectionUpdateAuthority: umi.identity,
      tokenStandard: 0, // NonFungible
      sellerFeeBasisPoints: percentAmount(5),
      itemsAvailable: publicItems.length,
      creators: [
        {
          address: umi.identity.publicKey,
          verified: true,
          percentageShare: 100,
        },
      ],
      configLineSettings: some({
        prefixName: NAME_PREFIX,
        nameLength: maxNameSuffix,
        prefixUri: URI_PREFIX,
        uriLength: maxUriSuffix,
        isSequential: false, // Random order
      }),
      guards: {
        solPayment: some({
          lamports: sol(0.02),
          destination: publicKey(TREASURY),
        }),
        mintLimit: some({
          id: 1,
          limit: 10,
        }),
        thirdPartySigner: some({
          signerKey: umi.identity.publicKey, // Our server's key
        }),
      },
    });

    await createBuilder.sendAndConfirm(umi);
    console.log("Candy Machine created!");

    // Save progress
    progress.candyMachine = candyMachineAddress;
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  }

  // Insert items in batches
  console.log(`\nInserting ${publicItems.length} items (starting from ${progress.itemsInserted})...`);

  for (let i = progress.itemsInserted; i < publicItems.length; i += BATCH_SIZE) {
    const batch = publicItems.slice(i, Math.min(i + BATCH_SIZE, publicItems.length));
    const configLines = batch.map(item => ({
      name: item.name.slice(NAME_PREFIX.length),
      uri: item.metadataUri.slice(URI_PREFIX.length),
    }));

    try {
      await addConfigLines(umi, {
        candyMachine: publicKey(candyMachineAddress),
        index: i,
        configLines,
      }).sendAndConfirm(umi);

      progress.itemsInserted = i + batch.length;
      
      // Save progress every batch
      if ((i / BATCH_SIZE) % 10 === 0 || i + batch.length >= publicItems.length) {
        fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
      }

      if ((i / BATCH_SIZE) % 50 === 0) {
        console.log(`  Inserted ${progress.itemsInserted}/${publicItems.length} items...`);
      }
    } catch (err) {
      console.error(`  Error at batch starting at index ${i}:`, err.message);
      fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
      console.log(`  Progress saved. Re-run to resume from ${progress.itemsInserted}.`);
      
      // Wait and retry once
      console.log("  Retrying in 2 seconds...");
      await new Promise(r => setTimeout(r, 2000));
      try {
        await addConfigLines(umi, {
          candyMachine: publicKey(candyMachineAddress),
          index: i,
          configLines,
        }).sendAndConfirm(umi);
        progress.itemsInserted = i + batch.length;
        fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
      } catch (retryErr) {
        console.error(`  Retry failed. Stopping. Re-run to resume.`);
        fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
        process.exit(1);
      }
    }
  }

  console.log(`\nAll ${publicItems.length} items inserted!`);

  // Verify
  const cm = await fetchCandyMachine(umi, publicKey(candyMachineAddress));
  console.log("\nCandy Machine verified:");
  console.log("  Address:", candyMachineAddress);
  console.log("  Items available:", cm.itemsLoaded, "/", Number(cm.data.itemsAvailable));
  console.log("  Items redeemed:", Number(cm.itemsRedeemed));

  console.log("\nSet these environment variables in Vercel:");
  console.log(`  CANDY_MACHINE=${candyMachineAddress}`);

  // Save final state
  progress.complete = true;
  progress.itemsInserted = publicItems.length;
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
