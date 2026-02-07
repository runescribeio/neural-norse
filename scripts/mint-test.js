#!/usr/bin/env node
/**
 * Neural Norse — Reference Mint Script
 *
 * Full mint flow:
 *   1. GET  /api/challenge?wallet=WALLET   → challenge token
 *   2. Solve SHA-256 proof of work          → nonce
 *   3. POST /api/mint                       → partially-signed tx (base64)
 *   4. Deserialize, sign, submit to Solana  → NFT 🎉
 *
 * Environment variables (put them in scripts/.env):
 *   SOLANA_PRIVATE_KEY  — base58-encoded wallet private key (required)
 *   MINT_URL            — base URL, default https://neural-norse.vercel.app
 *
 * Usage:
 *   cd scripts && npm install dotenv    # one-time
 *   node mint-test.js
 */

const crypto = require("crypto");
const { Connection, Keypair, Transaction, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const path = require("path");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Load .env from the same directory as this script
require("dotenv").config({ path: path.join(__dirname, ".env") });

const MINT_URL = (process.env.MINT_URL || "https://neural-norse.vercel.app").replace(/\/+$/, "");
const SOLANA_RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const DIFFICULTY = "0000"; // 4 leading hex zeros

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadKeypair() {
  const secret = process.env.SOLANA_PRIVATE_KEY;
  if (!secret) {
    console.error("❌ SOLANA_PRIVATE_KEY not set. Add it to scripts/.env");
    process.exit(1);
  }
  try {
    return Keypair.fromSecretKey((bs58.default || bs58).decode(secret));
  } catch {
    console.error("❌ Invalid SOLANA_PRIVATE_KEY — must be base58-encoded secret key");
    process.exit(1);
  }
}

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts.headers },
  });
  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(body.error || `HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

/**
 * Brute-force SHA-256 proof of work.
 * Find nonce where SHA256(challenge + wallet + nonce) starts with `prefix`.
 */
function solvePoW(challenge, wallet, prefix = DIFFICULTY) {
  let nonce = 0;
  const t0 = Date.now();
  while (true) {
    const input = `${challenge}${wallet}${nonce}`;
    const hash = crypto.createHash("sha256").update(input).digest("hex");
    if (hash.startsWith(prefix)) {
      const ms = Date.now() - t0;
      console.log(`✅ Solved in ${nonce.toLocaleString()} iterations (${ms} ms)`);
      console.log(`   nonce  = ${nonce}`);
      console.log(`   hash   = ${hash}`);
      return String(nonce);
    }
    nonce++;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Neural Norse — Reference Mint ===\n");

  // 0. Load wallet
  const keypair = loadKeypair();
  const wallet = keypair.publicKey.toBase58();
  console.log(`Wallet : ${wallet}`);
  console.log(`Server : ${MINT_URL}\n`);

  // 1. Get challenge
  console.log("→ Step 1: Requesting challenge...");
  const challengeData = await fetchJSON(`${MINT_URL}/api/challenge?wallet=${wallet}`);
  const { challenge } = challengeData;
  console.log(`  challenge = ${challenge}`);
  if (challengeData.difficulty) console.log(`  difficulty = ${challengeData.difficulty}`);
  console.log();

  // 2. Solve proof of work
  console.log("→ Step 2: Solving proof of work...");
  const nonce = solvePoW(challenge, wallet);
  console.log();

  // 3. Submit solution, get mint transaction
  console.log("→ Step 3: Submitting solution...");
  const mintData = await fetchJSON(`${MINT_URL}/api/mint`, {
    method: "POST",
    body: JSON.stringify({ wallet, challenge, nonce }),
  });

  if (!mintData.transaction) {
    throw new Error("Server did not return a transaction. Response: " + JSON.stringify(mintData));
  }

  console.log(`  message  = ${mintData.message || "OK"}`);
  if (mintData.nftMint) console.log(`  nftMint  = ${mintData.nftMint}`);
  if (mintData.collection) {
    console.log(`  claimed  = ${mintData.collection.claimed}/${mintData.collection.total}`);
  }
  console.log();

  // 4. Deserialize the transaction
  console.log("→ Step 4: Signing and submitting transaction...");
  const txBuffer = Buffer.from(mintData.transaction, "base64");

  let signature;
  const connection = new Connection(SOLANA_RPC, "confirmed");

  // Deserialize as VersionedTransaction
  const vtx = VersionedTransaction.deserialize(new Uint8Array(txBuffer));
  vtx.sign([keypair]);
  
  try {
    // Simulate first to get detailed errors
    const simResult = await connection.simulateTransaction(vtx, { sigVerify: false });
    if (simResult.value.err) {
      console.error("  Simulation error:", JSON.stringify(simResult.value.err));
      console.error("  Logs:");
      for (const log of simResult.value.logs || []) {
        console.error("    ", log);
      }
      throw new Error("Simulation failed: " + JSON.stringify(simResult.value.err));
    }
    console.log("  Simulation OK, submitting...");
  } catch (simErr) {
    if (simErr.message.includes("Simulation failed")) throw simErr;
    console.log("  Simulation check skipped:", simErr.message.slice(0, 60));
  }

  signature = await connection.sendRawTransaction(vtx.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });

  console.log(`  signature = ${signature}`);
  console.log("  Confirming...");

  // 5. Confirm
  const confirmation = await connection.confirmTransaction(signature, "confirmed");
  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  console.log();
  console.log("🎉 Mint successful!");
  console.log(`   https://solscan.io/tx/${signature}`);
  if (mintData.nftMint) {
    console.log(`   https://solscan.io/token/${mintData.nftMint}`);
  }
}

main().catch((err) => {
  console.error("\n❌ Mint failed:", err.message || err);
  process.exit(1);
});
