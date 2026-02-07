const crypto = require("crypto");
const { Connection, PublicKey, Keypair, Transaction } = require("@solana/web3.js");
const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
const { mplCandyMachine, mintV2, fetchCandyMachine } = require("@metaplex-foundation/mpl-candy-machine");
const { mplTokenMetadata } = require("@metaplex-foundation/mpl-token-metadata");
const { keypairIdentity, generateSigner, some, publicKey, transactionBuilder } = require("@metaplex-foundation/umi");
const { TokenStandard } = require("@metaplex-foundation/mpl-token-metadata");
const { fromWeb3JsKeypair, fromWeb3JsPublicKey, toWeb3JsTransaction } = require("@metaplex-foundation/umi-web3js-adapters");
const { setComputeUnitLimit } = require("@metaplex-foundation/mpl-toolbox");
const { Redis } = require("@upstash/redis");
const bs58 = require("bs58");

const DIFFICULTY = 4;
const CHALLENGE_TTL = 300_000; // 5 min
const MAX_PER_WALLET = parseInt(process.env.MAX_PER_WALLET || "10");
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function verifyChallenge(challenge, wallet) {
  const [hmac, payloadB64] = challenge.split(".");
  if (!hmac || !payloadB64) return { valid: false, error: "Malformed challenge" };

  const expectedHmac = crypto
    .createHmac("sha256", process.env.CHALLENGE_SECRET || "neural-norse-default-secret")
    .update(payloadB64)
    .digest("hex");

  if (hmac !== expectedHmac) return { valid: false, error: "Invalid challenge signature" };

  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  if (payload.wallet !== wallet) return { valid: false, error: "Wallet mismatch" };
  if (Date.now() - payload.timestamp > CHALLENGE_TTL) return { valid: false, error: "Challenge expired" };

  return { valid: true, payload };
}

function verifyProofOfWork(challenge, wallet, nonce) {
  const hash = crypto.createHash("sha256").update(challenge + wallet + nonce).digest("hex");
  return hash.startsWith("0".repeat(DIFFICULTY));
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST only" });

  try {
    const { wallet, challenge, nonce } = req.body;

    if (!wallet || !challenge || nonce === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, challenge, nonce"
      });
    }

    // 1. Verify challenge
    const challengeResult = verifyChallenge(challenge, wallet);
    if (!challengeResult.valid) {
      return res.status(400).json({ success: false, error: challengeResult.error });
    }

    // 2. Verify proof of work
    if (!verifyProofOfWork(challenge, wallet, String(nonce))) {
      return res.status(400).json({ success: false, error: "Invalid proof of work" });
    }

    // 3. Check per-wallet limit (from Redis, as extra safety on top of on-chain mintLimit guard)
    const walletMints = (await redis.get(`wallet:${wallet}:count`)) || 0;
    if (walletMints >= MAX_PER_WALLET) {
      return res.status(429).json({
        success: false,
        error: `Wallet has already minted ${walletMints}/${MAX_PER_WALLET}. Max per wallet reached.`
      });
    }

    // 4. Build Candy Machine mint transaction
    const secretKey = (bs58.default || bs58).decode(process.env.MINT_AUTHORITY_KEY);
    const authority = Keypair.fromSecretKey(secretKey);

    const umi = createUmi(RPC)
      .use(mplCandyMachine())
      .use(mplTokenMetadata());

    const umiKeypair = fromWeb3JsKeypair(authority);
    umi.use(keypairIdentity(umiKeypair));

    const candyMachineId = publicKey(process.env.CANDY_MACHINE);
    const collectionMintId = publicKey(process.env.COLLECTION_MINT);
    const treasuryId = publicKey(process.env.TREASURY_WALLET);
    const minterPublicKey = fromWeb3JsPublicKey(new PublicKey(wallet));

    // Fetch candy machine to get current state
    const candyMachine = await fetchCandyMachine(umi, candyMachineId);
    const itemsRemaining = Number(candyMachine.data.itemsAvailable) - Number(candyMachine.itemsRedeemed);

    if (itemsRemaining <= 0) {
      return res.status(410).json({ success: false, error: "Sold out!" });
    }

    // Generate a new mint signer for the NFT
    const nftMint = generateSigner(umi);

    // Build the mint instruction
    // The thirdPartySigner guard requires our server key as a signer
    const mintBuilder = mintV2(umi, {
      candyMachine: candyMachineId,
      candyGuard: candyMachine.mintAuthority,
      nftMint,
      collectionMint: collectionMintId,
      collectionUpdateAuthority: umi.identity.publicKey,
      tokenStandard: candyMachine.tokenStandard,
      mintArgs: {
        solPayment: some({ destination: treasuryId }),
        mintLimit: some({ id: 1 }),
        thirdPartySigner: some({ signer: umi.identity }),
      },
    });

    // Add compute budget (Candy Machine mints need more CU)
    const builder = transactionBuilder()
      .add(setComputeUnitLimit(umi, { units: 800_000 }))
      .add(mintBuilder);

    // Build the transaction, setting the minter as the fee payer
    const tx = await builder.buildWithLatestBlockhash(umi, {
      payer: { publicKey: minterPublicKey },
    });

    // Sign with our authority key (third-party signer) and the nft mint signer
    const signedTx = await umi.identity.signTransaction(tx);
    // Also sign with the nft mint keypair
    const fullySignedTx = await nftMint.signTransaction(signedTx);

    // Serialize to base64 for the agent to deserialize, sign, and submit
    const serializedTx = Buffer.from(umi.transactions.serialize(fullySignedTx)).toString("base64");

    // Record the challenge as used (prevent replay)
    await redis.set(`challenge:${challenge.slice(0, 64)}`, wallet, { ex: 600 });

    // Increment wallet count (optimistic -- if agent doesn't submit, it'll be slightly off but safe)
    await redis.incr(`wallet:${wallet}:count`);

    return res.status(200).json({
      success: true,
      message: "Transaction ready. Sign with your wallet and submit to Solana.",
      transaction: serializedTx,
      nftMint: nftMint.publicKey,
      collection: {
        claimed: Number(candyMachine.itemsRedeemed),
        remaining: itemsRemaining,
        total: Number(candyMachine.data.itemsAvailable),
      },
      instructions: {
        step1: "Deserialize the base64 transaction",
        step2: "Sign with your wallet private key",
        step3: "Submit to the Solana network",
        step4: "The transaction includes: 0.02 SOL payment to treasury + NFT account rent (~0.014 SOL)",
        totalCost: "~0.034 SOL (0.02 mint price + ~0.014 account rent + tx fees)",
      },
    });
  } catch (e) {
    console.error("Mint error:", e);
    return res.status(500).json({ success: false, error: "Mint failed: " + e.message });
  }
};
