#!/usr/bin/env node
/**
 * Neural Norse -- Reference Mint Script (Core Candy Machine)
 *
 * Full mint flow:
 *   1. GET  /api/challenge?wallet=WALLET   -> challenge token
 *   2. Solve SHA-256 proof of work          -> nonce
 *   3. POST /api/mint                       -> partially-signed tx (base64)
 *   4. Deserialize, sign, submit to Solana  -> Core Asset
 *
 * Usage:
 *   node scripts/mint-test.js
 */

const crypto = require("crypto");
const { Connection, Keypair, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const MINT_URL = (process.env.MINT_URL || "https://neural-norse.vercel.app").replace(/\/+$/, "");
const SOLANA_RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const DIFFICULTY = "0000"; // 4 leading hex zeros

function loadKeypair() {
  const secret = process.env.SOLANA_PRIVATE_KEY;
  if (!secret) {
    console.error("SOLANA_PRIVATE_KEY not set. Add it to scripts/.env");
    process.exit(1);
  }
  return Keypair.fromSecretKey((bs58.default || bs58).decode(secret));
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

function solvePoW(challenge, wallet, prefix = DIFFICULTY) {
  let nonce = 0;
  const t0 = Date.now();
  while (true) {
    const input = `${challenge}${wallet}${nonce}`;
    const hash = crypto.createHash("sha256").update(input).digest("hex");
    if (hash.startsWith(prefix)) {
      const ms = Date.now() - t0;
      console.log(`Solved in ${nonce.toLocaleString()} iterations (${ms} ms)`);
      console.log(`   nonce  = ${nonce}`);
      console.log(`   hash   = ${hash}`);
      return String(nonce);
    }
    nonce++;
  }
}

async function main() {
  console.log("=== Neural Norse -- Reference Mint (Core) ===\n");

  const keypair = loadKeypair();
  const wallet = keypair.publicKey.toBase58();
  console.log(`Wallet : ${wallet}`);
  console.log(`Server : ${MINT_URL}\n`);

  // 1. Get challenge
  console.log("Step 1: Requesting challenge...");
  const challengeData = await fetchJSON(`${MINT_URL}/api/challenge?wallet=${wallet}`);
  const { challenge } = challengeData;
  console.log(`  challenge = ${challenge.slice(0, 40)}...`);
  console.log();

  // 2. Solve proof of work
  console.log("Step 2: Solving proof of work...");
  const nonce = solvePoW(challenge, wallet);
  console.log();

  // 3. Submit solution, get mint transaction
  console.log("Step 3: Submitting solution...");
  const mintData = await fetchJSON(`${MINT_URL}/api/mint`, {
    method: "POST",
    body: JSON.stringify({ wallet, challenge, nonce }),
  });

  if (!mintData.transaction) {
    throw new Error("Server did not return a transaction. Response: " + JSON.stringify(mintData));
  }

  console.log(`  message  = ${mintData.message || "OK"}`);
  if (mintData.asset) console.log(`  asset    = ${mintData.asset}`);
  if (mintData.collection) {
    console.log(`  claimed  = ${mintData.collection.claimed}/${mintData.collection.total}`);
  }
  console.log();

  // 4. Deserialize, sign, submit
  console.log("Step 4: Signing and submitting transaction...");
  const txBuffer = Buffer.from(mintData.transaction, "base64");
  const connection = new Connection(SOLANA_RPC, "confirmed");

  const vtx = VersionedTransaction.deserialize(new Uint8Array(txBuffer));
  vtx.sign([keypair]);

  // Simulate first
  try {
    const simResult = await connection.simulateTransaction(vtx, { sigVerify: false });
    if (simResult.value.err) {
      console.error("  Simulation error:", JSON.stringify(simResult.value.err));
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

  const signature = await connection.sendRawTransaction(vtx.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });

  console.log(`  signature = ${signature}`);
  console.log("  Confirming...");

  const confirmation = await connection.confirmTransaction(signature, "confirmed");
  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  console.log();
  console.log("Mint successful!");
  console.log(`   https://solscan.io/tx/${signature}`);
  if (mintData.asset) {
    console.log(`   https://solscan.io/token/${mintData.asset}`);
  }
}

main().catch((err) => {
  console.error("\nMint failed:", err.message || err);
  process.exit(1);
});
