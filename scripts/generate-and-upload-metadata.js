/**
 * Generate Metaplex metadata JSONs using individual Arweave tx IDs, 
 * upload them to Arweave, and create the final metadata-index.json.
 * 
 * Run AFTER upload-robust.js completes image uploads.
 */
const fs = require("fs");
const path = require("path");

const SOURCE = "/home/ed/Desktop/vikings/collection/neural-norse-metadata.json";
const PROGRESS_FILE = path.join(__dirname, "..", "data", "upload-progress.json");
const META_PROGRESS_FILE = path.join(__dirname, "..", "data", "metadata-upload-progress.json");
const INDEX_FILE = path.join(__dirname, "..", "data", "metadata-index.json");
const META_DIR = path.join(__dirname, "..", "data", "metadata");

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
  console.log("Irys balance:", irys.utils.fromAtomic(balance), "SOL");

  // Load image upload progress
  const imageProgress = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  console.log("Images uploaded:", Object.keys(imageProgress).length);

  // Load master metadata
  const master = JSON.parse(fs.readFileSync(SOURCE, "utf-8"));
  const items = master.collection;
  console.log("Metadata items:", items.length);

  // Load metadata upload progress
  let metaProgress = {};
  if (fs.existsSync(META_PROGRESS_FILE)) {
    metaProgress = JSON.parse(fs.readFileSync(META_PROGRESS_FILE, "utf-8"));
  }

  fs.mkdirSync(META_DIR, { recursive: true });

  const index = [];
  let uploaded = 0;
  let skipped = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const imageFilename = item.image;
    const imageTxId = imageProgress[imageFilename];

    if (!imageTxId) {
      console.log(`WARNING: No image tx for ${imageFilename}, skipping`);
      continue;
    }

    const imageUri = `https://arweave.net/${imageTxId}`;
    const metaKey = `${i}.json`;

    // Check if already uploaded
    if (metaProgress[metaKey]) {
      index.push({
        index: i,
        name: item.name,
        imageUri,
        metadataUri: `https://arweave.net/${metaProgress[metaKey]}`,
        minted: false,
        mintedTo: null
      });
      skipped++;
      continue;
    }

    const metadata = {
      name: item.name,
      symbol: "NNORSE",
      description: item.description,
      image: imageUri,
      external_url: "https://github.com/runescribeio/neural-norse",
      attributes: item.attributes,
      properties: {
        files: [{ uri: imageUri, type: "image/png" }],
        category: "image",
        creators: []
      }
    };

    // Upload metadata JSON to Arweave
    for (let retry = 0; retry < 10; retry++) {
      try {
        const receipt = await irys.upload(JSON.stringify(metadata), {
          tags: [{ name: "Content-Type", value: "application/json" }]
        });
        metaProgress[metaKey] = receipt.id;
        fs.writeFileSync(META_PROGRESS_FILE, JSON.stringify(metaProgress));

        index.push({
          index: i,
          name: item.name,
          imageUri,
          metadataUri: `https://arweave.net/${receipt.id}`,
          minted: false,
          mintedTo: null
        });
        uploaded++;
        break;
      } catch (e) {
        const wait = Math.min(60000, (retry + 1) * 10000);
        console.log(`Error on ${metaKey} (retry ${retry + 1}): ${e.message.substring(0, 60)}... waiting ${wait/1000}s`);
        await sleep(wait);
      }
    }

    if ((uploaded + skipped) % 500 === 0) {
      console.log(`Metadata progress: ${uploaded + skipped}/${items.length} (${uploaded} new, ${skipped} cached)`);
    }
  }

  // Write final index
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  console.log(`\nDone! ${index.length} metadata entries.`);
  console.log(`Index written to ${INDEX_FILE}`);
  console.log(`Example URI: ${index[0]?.metadataUri}`);
}

main().catch(e => console.error("Fatal:", e.message));
