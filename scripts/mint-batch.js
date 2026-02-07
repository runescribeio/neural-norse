#!/usr/bin/env node
/**
 * Mint N Neural Norse NFTs in sequence.
 * Usage: MINT_COUNT=10 node scripts/mint-batch.js
 */
const crypto = require("crypto");
const { Connection, Keypair, Transaction, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const MINT_URL = (process.env.MINT_URL || "https://neural-norse.vercel.app").replace(/\/+$/, "");
const SOLANA_RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const DIFFICULTY = "0000";
const MINT_COUNT = parseInt(process.env.MINT_COUNT || "10");

function loadKeypair() {
  const secret = process.env.SOLANA_PRIVATE_KEY;
  if (!secret) { console.error("Set SOLANA_PRIVATE_KEY in scripts/.env"); process.exit(1); }
  return Keypair.fromSecretKey((bs58.default || bs58).decode(secret));
}

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts.headers },
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function solvePoW(challenge, wallet) {
  let nonce = 0;
  const t0 = Date.now();
  while (true) {
    const hash = crypto.createHash("sha256").update(`${challenge}${wallet}${nonce}`).digest("hex");
    if (hash.startsWith(DIFFICULTY)) {
      console.log(`  PoW solved: nonce=${nonce} (${Date.now() - t0}ms)`);
      return String(nonce);
    }
    nonce++;
  }
}

async function mintOne(keypair, connection, index) {
  const wallet = keypair.publicKey.toBase58();
  console.log(`\n--- Mint ${index + 1}/${MINT_COUNT} ---`);

  // 1. Challenge
  const { challenge } = await fetchJSON(`${MINT_URL}/api/challenge?wallet=${wallet}`);

  // 2. Solve
  const nonce = solvePoW(challenge, wallet);

  // 3. Get tx
  const mintData = await fetchJSON(`${MINT_URL}/api/mint`, {
    method: "POST",
    body: JSON.stringify({ wallet, challenge, nonce }),
  });
  console.log(`  nftMint: ${mintData.nftMint}`);
  console.log(`  claimed: ${mintData.collection?.claimed}/${mintData.collection?.total}`);

  // 4. Sign & submit
  const txBuffer = Buffer.from(mintData.transaction, "base64");
  let signature;
  // UMI serializes as VersionedTransaction
  const vtx = VersionedTransaction.deserialize(new Uint8Array(txBuffer));
  vtx.sign([keypair]);
  signature = await connection.sendRawTransaction(vtx.serialize(), { skipPreflight: false, maxRetries: 3 });

  console.log(`  tx: ${signature}`);
  console.log(`  confirming...`);
  const conf = await connection.confirmTransaction(signature, "confirmed");
  if (conf.value.err) throw new Error(`TX failed: ${JSON.stringify(conf.value.err)}`);
  console.log(`  MINTED! https://solscan.io/tx/${signature}`);
  return { signature, nftMint: mintData.nftMint };
}

async function main() {
  const keypair = loadKeypair();
  const connection = new Connection(SOLANA_RPC, "confirmed");
  console.log(`Wallet: ${keypair.publicKey.toBase58()}`);
  console.log(`Minting ${MINT_COUNT} NFTs from ${MINT_URL}\n`);

  // Check balance
  const balance = await connection.getBalance(keypair.publicKey);
  const needed = MINT_COUNT * 0.035;
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL (need ~${needed.toFixed(3)} SOL for ${MINT_COUNT} mints)`);
  if (balance / 1e9 < needed) {
    console.error(`Insufficient balance! Need ~${needed} SOL`);
    process.exit(1);
  }

  const results = [];
  for (let i = 0; i < MINT_COUNT; i++) {
    try {
      const r = await mintOne(keypair, connection, i);
      results.push(r);
      // Small delay between mints to avoid rate limits
      if (i < MINT_COUNT - 1) await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
      results.push({ error: e.message });
    }
  }

  console.log("\n=== Results ===");
  results.forEach((r, i) => {
    if (r.error) console.log(`  ${i + 1}. FAILED: ${r.error}`);
    else console.log(`  ${i + 1}. ${r.nftMint} (tx: ${r.signature})`);
  });
  const ok = results.filter(r => !r.error).length;
  console.log(`\n${ok}/${MINT_COUNT} minted successfully.`);
}

main().catch(e => { console.error(e); process.exit(1); });
