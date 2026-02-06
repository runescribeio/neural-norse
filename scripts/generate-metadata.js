/**
 * Generate individual Metaplex-standard JSON metadata files from the master metadata.
 * Run AFTER uploading images to Arweave.
 * 
 * Usage: ARWEAVE_MANIFEST=<manifest-id> node scripts/generate-metadata.js
 */

const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "..", "..", "..", "Desktop/vikings/collection/neural-norse-metadata.json");
const OUTPUT_DIR = path.join(__dirname, "..", "data", "metadata");
const INDEX_FILE = path.join(__dirname, "..", "data", "metadata-index.json");

const ARWEAVE_GATEWAY = "https://arweave.net";

async function main() {
  const manifestId = process.env.ARWEAVE_MANIFEST;
  if (!manifestId) {
    console.error("Set ARWEAVE_MANIFEST to the Arweave manifest ID from the image upload");
    process.exit(1);
  }

  console.log("Reading master metadata...");
  const master = JSON.parse(fs.readFileSync(SOURCE, "utf-8"));
  const items = master.collection;
  console.log(`Found ${items.length} items`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const index = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const imageFilename = item.image; // e.g., "viking-pepe-#1.png"
    const imageUri = `${ARWEAVE_GATEWAY}/${manifestId}/${encodeURIComponent(imageFilename)}`;

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

    const filename = `${i}.json`;
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(metadata, null, 2));

    index.push({
      index: i,
      name: item.name,
      imageUri,
      metadataFile: filename,
      metadataUri: null, // Set after metadata upload
      minted: false,
      mintedTo: null
    });

    if ((i + 1) % 1000 === 0) console.log(`Generated ${i + 1}/${items.length}`);
  }

  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  console.log(`Done. Generated ${items.length} metadata files in ${OUTPUT_DIR}`);
  console.log(`Index written to ${INDEX_FILE}`);
  console.log("\nNext: Upload metadata dir to Arweave, then run update-index.js to set metadataUri values.");
}

main().catch(console.error);
