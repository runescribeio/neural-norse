#!/usr/bin/env node
/**
 * Load config lines into Core Candy Machine using fire-and-forget sends.
 * Much faster than sendAndConfirm for bulk loading.
 * Periodically verifies on-chain count and fills gaps.
 * 
 * Resumable via core-cm-progress.json
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
const SEND_DELAY_MS = 200; // fast fire-and-forget
const VERIFY_EVERY = 200; // verify on-chain every N items sent

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
  console.log("Candy Machine:", cmAddr);
  console.log("RPC:", RPC);

  // Load items
  const indexPath = path.join(__dirname, "../data/metadata-index.json");
  const allItems = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  const publicItems = allItems.filter(item => !item.reserved);
  const totalItems = publicItems.length;

  const URI_PREFIX = "https://arweave.net/";
  const NAME_PREFIX = "Neural Norse #";

  // Check on-chain state first
  let cm = await fetchCandyMachine(umi, publicKey(cmAddr));
  console.log(`On-chain: ${cm.itemsLoaded}/${Number(cm.data.itemsAvailable)} loaded`);

  let sent = progress.itemsInserted || 0;
  console.log(`Progress file: ${sent} sent. Starting from there.\n`);

  let errors = 0;

  for (let i = sent; i < totalItems; i += BATCH_SIZE) {
    const batch = publicItems.slice(i, Math.min(i + BATCH_SIZE, totalItems));
    const configLines = batch.map(item => ({
      name: item.name.slice(NAME_PREFIX.length),
      uri: item.metadataUri.slice(URI_PREFIX.length),
    }));

    try {
      // Fire and forget - send() instead of sendAndConfirm()
      const tx = addConfigLines(umi, {
        candyMachine: publicKey(cmAddr),
        index: i,
        configLines,
      });
      await tx.send(umi);
    } catch (err) {
      const msg = (err.message || String(err)).slice(0, 100);
      // Retry once
      try {
        await new Promise(r => setTimeout(r, 1000));
        await addConfigLines(umi, {
          candyMachine: publicKey(cmAddr),
          index: i,
          configLines,
        }).send(umi);
      } catch (err2) {
        console.error(`  Error at ${i}:`, msg);
        errors++;
        if (errors > 20) {
          console.error("Too many errors, stopping.");
          break;
        }
      }
    }

    sent = i + batch.length;
    await new Promise(r => setTimeout(r, SEND_DELAY_MS));

    // Log progress
    if (sent % 100 === 0 || sent >= totalItems) {
      const pct = ((sent / totalItems) * 100).toFixed(1);
      process.stdout.write(`\r  Sent: ${sent}/${totalItems} (${pct}%) errors: ${errors}`);
    }

    // Verify on-chain periodically
    if (sent % VERIFY_EVERY === 0) {
      // Wait a bit for transactions to land
      await new Promise(r => setTimeout(r, 2000));
      cm = await fetchCandyMachine(umi, publicKey(cmAddr));
      console.log(`\n  On-chain: ${cm.itemsLoaded}/${totalItems}`);
      
      progress.itemsInserted = sent;
      fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
    }
  }

  // Final wait for transactions to settle
  console.log("\n\nWaiting 10s for final transactions to settle...");
  await new Promise(r => setTimeout(r, 10000));

  // Final verification
  cm = await fetchCandyMachine(umi, publicKey(cmAddr));
  console.log(`\nFinal on-chain: ${cm.itemsLoaded}/${totalItems}`);

  progress.itemsInserted = sent;
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));

  if (cm.itemsLoaded < totalItems) {
    console.log(`\n${totalItems - cm.itemsLoaded} items missing. Run gap-fill next.`);
  } else {
    console.log("\nAll items loaded!");
    progress.complete = true;
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
  }

  console.log(`\nCANDY_MACHINE=${cmAddr}`);
  console.log(`COLLECTION_MINT=${progress.collection}`);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
