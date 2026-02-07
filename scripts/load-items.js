/**
 * Load config lines into existing candy machine.
 * Uses send() instead of sendAndConfirm() to avoid hanging.
 * Verifies on-chain count periodically and retries failed batches.
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
const BATCH_SIZE = 10;
const DELAY_MS = 500;           // delay between sends
const VERIFY_EVERY = 100;       // verify on-chain every N batches
const URI_PREFIX = "https://arweave.net/";
const NAME_PREFIX = "Neural Norse #";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const secretKey = (bs58.default || bs58).decode(process.env.SOLANA_PRIVATE_KEY);
  const authority = Keypair.fromSecretKey(secretKey);
  console.log("Authority:", authority.publicKey.toBase58());
  console.log("RPC:", RPC.replace(/\/\/.*@/, "//***@"));

  const umi = createUmi(RPC).use(mplCandyMachine()).use(mplTokenMetadata());
  umi.use(keypairIdentity(fromWeb3JsKeypair(authority)));

  // Load items
  const indexPath = path.join(__dirname, "../data/metadata-index.json");
  const allItems = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  const publicItems = allItems.filter(item => !item.reserved);
  console.log(`Public items: ${publicItems.length}`);

  // Check current on-chain state
  let cm = await fetchCandyMachine(umi, publicKey(CM_ADDRESS));
  let loaded = cm.itemsLoaded;
  console.log(`On-chain loaded: ${loaded} / ${Number(cm.data.itemsAvailable)}`);

  if (loaded >= publicItems.length) {
    console.log("All items already loaded!");
    return;
  }

  // Start from where we left off
  let sent = 0;
  let errors = 0;
  const startIdx = loaded;
  const totalBatches = Math.ceil((publicItems.length - startIdx) / BATCH_SIZE);
  console.log(`Starting from index ${startIdx}, ${totalBatches} batches to go\n`);

  for (let i = startIdx; i < publicItems.length; i += BATCH_SIZE) {
    const batch = publicItems.slice(i, Math.min(i + BATCH_SIZE, publicItems.length));
    const configLines = batch.map(item => ({
      name: item.name.slice(NAME_PREFIX.length),
      uri: item.metadataUri.slice(URI_PREFIX.length),
    }));

    let success = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await addConfigLines(umi, {
          candyMachine: publicKey(CM_ADDRESS),
          index: i,
          configLines,
        }).send(umi);

        success = true;
        sent++;
        break;
      } catch (err) {
        errors++;
        const msg = (err.message || String(err)).slice(0, 100);
        if (attempt < 3) {
          await sleep(1000 * Math.pow(2, attempt));
        } else {
          console.error(`  FAILED index ${i} after 4 attempts: ${msg}`);
        }
      }
    }

    if (sent % 10 === 0) {
      process.stdout.write(`\r  Sent ${sent} txs (index ${i + batch.length}/${publicItems.length}, ${errors} errors)`);
    }

    await sleep(DELAY_MS);

    // Periodic on-chain verification
    if (sent % VERIFY_EVERY === 0 && sent > 0) {
      await sleep(5000); // wait for txs to land
      try {
        cm = await fetchCandyMachine(umi, publicKey(CM_ADDRESS));
        loaded = cm.itemsLoaded;
        console.log(`\n  Verified on-chain: ${loaded} / ${publicItems.length}`);
      } catch (e) {
        // ignore verify errors
      }
    }
  }

  // Final verification
  console.log(`\n\nAll batches sent (${sent} txs, ${errors} errors). Waiting for confirmation...`);
  await sleep(10000);
  
  cm = await fetchCandyMachine(umi, publicKey(CM_ADDRESS));
  console.log(`\nFinal on-chain count: ${cm.itemsLoaded} / ${Number(cm.data.itemsAvailable)}`);
  
  if (cm.itemsLoaded < publicItems.length) {
    console.log(`Missing ${publicItems.length - cm.itemsLoaded} items. Run again to fill gaps.`);
  } else {
    console.log("All items loaded!");
  }
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
