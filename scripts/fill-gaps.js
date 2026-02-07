/**
 * Fill gaps in candy machine config lines.
 * Reads on-chain data, finds empty slots, re-sends those batches.
 */

const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
const { mplCandyMachine, addConfigLines, fetchCandyMachine } = require("@metaplex-foundation/mpl-candy-machine");
const { mplTokenMetadata } = require("@metaplex-foundation/mpl-token-metadata");
const { keypairIdentity, publicKey } = require("@metaplex-foundation/umi");
const { fromWeb3JsKeypair } = require("@metaplex-foundation/umi-web3js-adapters");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");
const fs = require("fs");
const path = require("path");

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const CM_ADDRESS = "ioS4jQmb6aHYbDZN1nQSgxeYYp6aJPYfBtPRwDebqB7";
const URI_PREFIX = "https://arweave.net/";
const NAME_PREFIX = "Neural Norse #";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const secretKey = (bs58.default || bs58).decode(process.env.SOLANA_PRIVATE_KEY);
  const authority = Keypair.fromSecretKey(secretKey);

  const umi = createUmi(RPC).use(mplCandyMachine()).use(mplTokenMetadata());
  umi.use(keypairIdentity(fromWeb3JsKeypair(authority)));

  // Load items
  const indexPath = path.join(__dirname, "../data/metadata-index.json");
  const allItems = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  const publicItems = allItems.filter(item => !item.reserved);

  // Fetch candy machine with all config lines
  const cm = await fetchCandyMachine(umi, publicKey(CM_ADDRESS));
  console.log(`On-chain: ${cm.itemsLoaded} / ${Number(cm.data.itemsAvailable)}`);

  if (cm.itemsLoaded >= publicItems.length) {
    console.log("All items loaded! No gaps.");
    return;
  }

  // Find empty slots by checking which items have empty uri
  const emptyIndices = [];
  for (let i = 0; i < publicItems.length; i++) {
    const item = cm.items[i];
    if (!item || !item.uri || item.uri.trim() === "") {
      emptyIndices.push(i);
    }
  }

  console.log(`Found ${emptyIndices.length} empty slots`);
  if (emptyIndices.length === 0) return;

  // Send each missing item individually (small enough count)
  let sent = 0;
  let errors = 0;

  for (const idx of emptyIndices) {
    const item = publicItems[idx];
    const configLines = [{
      name: item.name.slice(NAME_PREFIX.length),
      uri: item.metadataUri.slice(URI_PREFIX.length),
    }];

    let success = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await addConfigLines(umi, {
          candyMachine: publicKey(CM_ADDRESS),
          index: idx,
          configLines,
        }).sendAndConfirm(umi);
        success = true;
        sent++;
        break;
      } catch (err) {
        errors++;
        if (attempt < 4) await sleep(2000 * (attempt + 1));
      }
    }

    if (!success) {
      console.error(`Failed to fill index ${idx}`);
    }

    if (sent % 5 === 0) {
      console.log(`  Filled ${sent}/${emptyIndices.length} (${errors} errors)`);
    }

    await sleep(500);
  }

  // Final check
  await sleep(5000);
  const cmFinal = await fetchCandyMachine(umi, publicKey(CM_ADDRESS));
  console.log(`\nFinal: ${cmFinal.itemsLoaded} / ${Number(cmFinal.data.itemsAvailable)}`);

  if (cmFinal.itemsLoaded >= publicItems.length) {
    console.log("All items loaded!");
  } else {
    console.log(`Still missing ${publicItems.length - cmFinal.itemsLoaded}. Run again.`);
  }
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
