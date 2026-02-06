/**
 * Upload images (and optionally metadata) to Arweave via Irys.
 * 
 * Usage:
 *   SOLANA_PRIVATE_KEY=... node scripts/upload-arweave.js images
 *   SOLANA_PRIVATE_KEY=... node scripts/upload-arweave.js metadata
 *   SOLANA_PRIVATE_KEY=... node scripts/upload-arweave.js fund <amount-in-lamports>
 */

const path = require("path");

const IMAGES_DIR = path.join(__dirname, "..", "..", "..", "Desktop/vikings/collection/NeuralNorse10k");
const METADATA_DIR = path.join(__dirname, "..", "data", "metadata");
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

async function getIrys() {
  const Irys = (await import("@irys/sdk")).default;
  const irys = new Irys({
    url: "https://node1.irys.xyz", // mainnet
    token: "solana",
    key: process.env.SOLANA_PRIVATE_KEY,
    config: { providerUrl: RPC }
  });
  return irys;
}

async function fund(amount) {
  const irys = await getIrys();
  console.log("Funding Irys account...");
  const response = await irys.fund(parseInt(amount));
  console.log(`Funded ${response.quantity} (${response.target})`);
  const balance = await irys.getLoadedBalance();
  console.log(`Current balance: ${irys.utils.fromAtomic(balance)} SOL`);
}

async function checkPrice(dir) {
  const irys = await getIrys();
  const fs = require("fs");
  const files = fs.readdirSync(dir);
  let totalSize = 0;
  for (const f of files) {
    const stat = fs.statSync(path.join(dir, f));
    totalSize += stat.size;
  }
  console.log(`${files.length} files, ${(totalSize / 1024 / 1024).toFixed(2)} MB total`);
  const price = await irys.getPrice(totalSize);
  console.log(`Estimated cost: ${irys.utils.fromAtomic(price)} SOL`);
  const balance = await irys.getLoadedBalance();
  console.log(`Current balance: ${irys.utils.fromAtomic(balance)} SOL`);
  return { files: files.length, totalSize, price, balance };
}

async function uploadDir(dir, label) {
  const irys = await getIrys();
  console.log(`Uploading ${label} from ${dir}...`);

  const result = await irys.uploadFolder(dir, {
    batchSize: 50,
    keepDeleted: false
  });

  console.log(`Upload complete!`);
  console.log(`Manifest ID: ${result.id}`);
  console.log(`URL: https://arweave.net/${result.id}`);
  return result;
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === "fund") {
    await fund(process.argv[3] || "10000000"); // default 0.01 SOL
  } else if (cmd === "images") {
    console.log("Checking image upload price...");
    await checkPrice(IMAGES_DIR);
    console.log("\nUploading images...");
    const result = await uploadDir(IMAGES_DIR, "images");
    console.log(`\nSave this manifest ID: ${result.id}`);
    console.log(`Run: ARWEAVE_MANIFEST=${result.id} node scripts/generate-metadata.js`);
  } else if (cmd === "metadata") {
    console.log("Checking metadata upload price...");
    await checkPrice(METADATA_DIR);
    console.log("\nUploading metadata...");
    const result = await uploadDir(METADATA_DIR, "metadata");
    console.log(`\nMetadata manifest ID: ${result.id}`);
    console.log(`Run: METADATA_MANIFEST=${result.id} node scripts/update-index.js`);
  } else {
    console.log("Usage:");
    console.log("  node upload-arweave.js fund [amount-lamports]");
    console.log("  node upload-arweave.js images");
    console.log("  node upload-arweave.js metadata");
  }
}

main().catch(console.error);
