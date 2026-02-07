#!/usr/bin/env node
/**
 * Fast loader for Core Candy Machine using paid Helius RPC.
 * Fire-and-forget with minimal delay. Resumable.
 */

const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
const { mplCandyMachine, addConfigLines, fetchCandyMachine } = require("@metaplex-foundation/mpl-core-candy-machine");
const { mplCore } = require("@metaplex-foundation/mpl-core");
const { keypairIdentity, publicKey } = require("@metaplex-foundation/umi");
const { fromWeb3JsKeypair } = require("@metaplex-foundation/umi-web3js-adapters");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const RPC = process.env.SOLANA_RPC || "https://hollyanne-bcst2m-fast-mainnet.helius-rpc.com";
const BATCH_SIZE = 10;
const SEND_DELAY_MS = 50; // 50ms between sends -- fast but not 429-inducing
const PROGRESS_PATH = path.join(__dirname, "../data/core-cm-progress.json");

async function main() {
  const secretKey = (bs58.default || bs58).decode(process.env.SOLANA_PRIVATE_KEY);
  const authority = Keypair.fromSecretKey(secretKey);

  const umi = createUmi(RPC)
    .use(mplCandyMachine())
    .use(mplCore());
  umi.use(keypairIdentity(fromWeb3JsKeypair(authority)));

  const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
  const cmAddr = progress.candyMachine;

  // Load items
  const indexPath = path.join(__dirname, "../data/metadata-index.json");
  const allItems = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  const publicItems = allItems.filter(item => !item.reserved);
  const totalItems = publicItems.length;

  const URI_PREFIX = "https://arweave.net/";
  const NAME_PREFIX = "Neural Norse #";

  // Check on-chain to find where we actually are
  let cm = await fetchCandyMachine(umi, publicKey(cmAddr));
  const onChainLoaded = cm.itemsLoaded;
  console.log(`On-chain: ${onChainLoaded}/${totalItems}`);

  // Start from on-chain count (skip already loaded)
  const startFrom = onChainLoaded;
  const remaining = totalItems - startFrom;
  console.log(`Sending ${remaining} items in batches of ${BATCH_SIZE}, ${SEND_DELAY_MS}ms delay\n`);

  const startTime = Date.now();
  let sent = 0;
  let errors = 0;

  for (let i = startFrom; i < totalItems; i += BATCH_SIZE) {
    const batch = publicItems.slice(i, Math.min(i + BATCH_SIZE, totalItems));
    const configLines = batch.map(item => ({
      name: item.name.slice(NAME_PREFIX.length),
      uri: item.metadataUri.slice(URI_PREFIX.length),
    }));

    try {
      await addConfigLines(umi, {
        candyMachine: publicKey(cmAddr),
        index: i,
        configLines,
      }).send(umi);
      sent += batch.length;
    } catch (err) {
      errors++;
      // Retry once
      try {
        await new Promise(r => setTimeout(r, 1000));
        await addConfigLines(umi, {
          candyMachine: publicKey(cmAddr),
          index: i,
          configLines,
        }).send(umi);
        sent += batch.length;
        errors--;
      } catch {
        // gap-fill later
      }
    }

    await new Promise(r => setTimeout(r, SEND_DELAY_MS));

    if ((startFrom + sent) % 500 === 0 || startFrom + sent >= totalItems) {
      const total = startFrom + sent;
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = sent / elapsed;
      const eta = remaining > sent ? Math.round((remaining - sent) / rate) : 0;
      console.log(`  ${total}/${totalItems} (${rate.toFixed(0)}/s, ETA ${Math.round(eta/60)}m${eta%60}s, ${errors} errors)`);
    }
  }

  console.log("\n\nAll sends complete. Waiting 15s for settlement...");
  await new Promise(r => setTimeout(r, 15000));

  // Verify
  cm = await fetchCandyMachine(umi, publicKey(cmAddr));
  console.log(`\nOn-chain: ${cm.itemsLoaded}/${totalItems}`);

  progress.itemsInserted = cm.itemsLoaded;
  if (cm.itemsLoaded >= totalItems) {
    progress.complete = true;
    console.log("ALL ITEMS LOADED!");
  } else {
    console.log(`${totalItems - cm.itemsLoaded} missing. Run again to fill gaps.`);
  }
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));

  console.log(`\nCANDY_MACHINE=${cmAddr}`);
  console.log(`COLLECTION_MINT=${progress.collection}`);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
