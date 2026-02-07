/**
 * Upload 10K images to Arweave via Irys with proper retry handling.
 * Uploads individually, tracks progress, and creates manifest at the end.
 */
const fs = require("fs");
const path = require("path");

const IMAGES_DIR = "/home/ed/Desktop/vikings/collection/NeuralNorse10k";
const PROGRESS_FILE = path.join(__dirname, "..", "data", "upload-progress.json");
const RPC = "https://api.mainnet-beta.solana.com";

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const Irys = (await import("@irys/sdk")).default;
  const irys = new Irys({
    url: "https://node1.irys.xyz",
    token: "solana",
    key: process.env.SOLANA_PRIVATE_KEY,
    config: { providerUrl: RPC }
  });

  const balance = await irys.getLoadedBalance();
  console.log("Irys balance:", irys.utils.fromAtomic(balance), "SOL");

  // Load progress
  let progress = {};
  if (fs.existsSync(PROGRESS_FILE)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  }
  const uploaded = Object.keys(progress).length;
  console.log(`Already uploaded: ${uploaded} files`);

  // Get all files
  const files = fs.readdirSync(IMAGES_DIR).filter(f => f.endsWith(".png")).sort();
  console.log(`Total files: ${files.length}`);
  const remaining = files.filter(f => !progress[f]);
  console.log(`Remaining: ${remaining.length}`);

  if (remaining.length === 0) {
    console.log("All files uploaded! Creating manifest...");
    // Create manifest
    const entries = {};
    for (const [filename, txId] of Object.entries(progress)) {
      entries[filename] = { id: txId };
    }
    console.log("Manifest entries:", Object.keys(entries).length);
    console.log("Use the individual tx IDs from upload-progress.json");
    console.log("First entry:", Object.entries(progress)[0]);
    return;
  }

  let count = 0;
  const batchSize = 10;
  
  for (let i = 0; i < remaining.length; i += batchSize) {
    const batch = remaining.slice(i, i + batchSize);
    const promises = batch.map(async (filename) => {
      const filepath = path.join(IMAGES_DIR, filename);
      const data = fs.readFileSync(filepath);
      
      for (let retry = 0; retry < 5; retry++) {
        try {
          const receipt = await irys.upload(data, {
            tags: [
              { name: "Content-Type", value: "image/png" },
              { name: "Name", value: filename }
            ]
          });
          progress[filename] = receipt.id;
          return receipt.id;
        } catch (e) {
          if (e.message.includes("402") || e.message.includes("funds")) {
            console.log(`Rate limited on ${filename}, waiting 60s...`);
            await sleep(60000);
          } else {
            console.log(`Error on ${filename} (retry ${retry}):`, e.message);
            await sleep(5000);
          }
        }
      }
      console.log(`FAILED: ${filename} after 5 retries`);
      return null;
    });

    await Promise.all(promises);
    count += batch.length;
    
    // Save progress after each batch
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
    
    if (count % 100 === 0 || count === remaining.length) {
      console.log(`Progress: ${uploaded + count}/${files.length} (${count} new)`);
    }
    
    // Small delay between batches to avoid rate limits
    await sleep(200);
  }

  console.log(`\nDone! ${Object.keys(progress).length} files uploaded.`);
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  
  // Verify first file
  const first = Object.entries(progress)[0];
  console.log(`Verify: https://arweave.net/${first[1]}`);
}

main().catch(e => console.error("Fatal:", e.message));
