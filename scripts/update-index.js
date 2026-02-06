/**
 * Update metadata-index.json with Arweave metadata URIs after uploading metadata folder.
 * 
 * Usage: METADATA_MANIFEST=<manifest-id> node scripts/update-index.js
 */

const fs = require("fs");
const path = require("path");

const INDEX_FILE = path.join(__dirname, "..", "data", "metadata-index.json");
const ARWEAVE_GATEWAY = "https://arweave.net";

async function main() {
  const manifestId = process.env.METADATA_MANIFEST;
  if (!manifestId) {
    console.error("Set METADATA_MANIFEST to the Arweave manifest ID from metadata upload");
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
  console.log(`Updating ${index.length} entries with metadata URIs...`);

  for (const item of index) {
    item.metadataUri = `${ARWEAVE_GATEWAY}/${manifestId}/${item.metadataFile}`;
  }

  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  console.log("Done. metadata-index.json updated with Arweave URIs.");
  console.log(`Example: ${index[0].metadataUri}`);
}

main().catch(console.error);
