const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const IMAGES_DIR = "/home/ed/Desktop/vikings/collection/NeuralNorse10k";
const PROGRESS_FILE = path.join(__dirname, "..", "data", "upload-progress.json");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const Irys = (await import("@irys/sdk")).default;
  const irys = new Irys({
    url: "https://node1.irys.xyz",
    token: "solana",
    key: process.env.SOLANA_PRIVATE_KEY,
    config: { providerUrl: "https://api.mainnet-beta.solana.com" }
  });

  const balance = await irys.getLoadedBalance();
  console.log("Balance:", irys.utils.fromAtomic(balance), "SOL");

  // Load progress (file -> arweave txId)
  fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
  let progress = {};
  if (fs.existsSync(PROGRESS_FILE)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  }

  const files = fs.readdirSync(IMAGES_DIR).filter(f => f.endsWith(".png")).sort();
  const remaining = files.filter(f => !progress[f]);
  console.log(`Total: ${files.length} | Done: ${files.length - remaining.length} | Remaining: ${remaining.length}`);

  if (remaining.length === 0) {
    console.log("All files uploaded! Creating manifest...");
    await createManifest(irys, progress);
    return;
  }

  // Upload remaining files one at a time with retries
  for (let i = 0; i < remaining.length; i++) {
    const filename = remaining[i];
    const filepath = path.join(IMAGES_DIR, filename);
    const data = fs.readFileSync(filepath);

    for (let retry = 0; retry < 10; retry++) {
      try {
        const receipt = await irys.upload(data, {
          tags: [{ name: "Content-Type", value: "image/png" }]
        });
        progress[filename] = receipt.id;
        // Save after each successful upload
        fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));
        if ((Object.keys(progress).length) % 50 === 0) {
          console.log(`Progress: ${Object.keys(progress).length}/${files.length}`);
        }
        break;
      } catch (e) {
        if (retry < 9) {
          const wait = Math.min(60000, (retry + 1) * 10000);
          console.log(`Error on ${filename} (retry ${retry + 1}): ${e.message.substring(0, 60)}... waiting ${wait/1000}s`);
          await sleep(wait);
        } else {
          console.log(`FAILED after 10 retries: ${filename}`);
        }
      }
    }
  }

  const finalRemaining = files.filter(f => !progress[f]);
  console.log(`\nUpload phase done. ${Object.keys(progress).length}/${files.length} uploaded. ${finalRemaining.length} failed.`);
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));

  if (finalRemaining.length === 0) {
    console.log("Creating manifest...");
    await createManifest(irys, progress);
  }
}

async function createManifest(irys, progress) {
  // Build manifest JSON (Arweave path manifest spec)
  const paths = {};
  for (const [filename, txId] of Object.entries(progress)) {
    paths[filename] = { id: txId };
  }

  const manifest = {
    manifest: "arweave/paths",
    version: "0.2.0",
    paths
  };

  const manifestData = JSON.stringify(manifest);
  const receipt = await irys.upload(manifestData, {
    tags: [
      { name: "Content-Type", value: "application/x.arweave-manifest+json" },
      { name: "Type", value: "manifest" }
    ]
  });

  console.log("MANIFEST CREATED!");
  console.log("Manifest ID:", receipt.id);
  console.log("URL: https://arweave.net/" + receipt.id);
  console.log("Example: https://arweave.net/" + receipt.id + "/viking-pepe-%231.png");

  fs.writeFileSync(
    path.join(__dirname, "..", "data", "arweave-manifest.json"),
    JSON.stringify({ manifestId: receipt.id, url: "https://arweave.net/" + receipt.id }, null, 2)
  );
}

main().catch(e => console.error("Fatal:", e.message));
