const crypto = require("crypto");
const { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
const { createNft, mplTokenMetadata } = require("@metaplex-foundation/mpl-token-metadata");
const { keypairIdentity, generateSigner, percentAmount } = require("@metaplex-foundation/umi");
const { fromWeb3JsKeypair, fromWeb3JsPublicKey } = require("@metaplex-foundation/umi-web3js-adapters");
const { Redis } = require("@upstash/redis");
const bs58 = require("bs58");

const DIFFICULTY = 4;
const CHALLENGE_TTL = 300_000; // 5 min in ms
const MAX_PER_WALLET = parseInt(process.env.MAX_PER_WALLET || "10");
const TOTAL_PUBLIC = 9750;
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

// Upstash Redis client (uses KV_REST_API_URL + KV_REST_API_TOKEN env vars)
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Load metadata index (cached across warm invocations)
let metadataIndex = null;
function getMetadataIndex() {
  if (!metadataIndex) {
    metadataIndex = require("../data/metadata-index.json");
  }
  return metadataIndex;
}

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

async function verifyPayment(txSignature, expectedAmount, treasuryWallet) {
  const connection = new Connection(RPC, "confirmed");
  try {
    const tx = await connection.getTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });
    if (!tx) return { valid: false, error: "Transaction not found or not confirmed" };
    if (tx.meta.err) return { valid: false, error: "Transaction failed on-chain" };

    const treasuryPubkey = new PublicKey(treasuryWallet);
    const preBalances = tx.meta.preBalances;
    const postBalances = tx.meta.postBalances;
    const accountKeys = tx.transaction.message.getAccountKeys
      ? tx.transaction.message.getAccountKeys().staticKeys
      : tx.transaction.message.accountKeys;

    let treasuryIdx = -1;
    for (let i = 0; i < accountKeys.length; i++) {
      if (accountKeys[i].toBase58() === treasuryPubkey.toBase58()) {
        treasuryIdx = i;
        break;
      }
    }
    if (treasuryIdx === -1) return { valid: false, error: "Treasury not found in transaction" };

    const received = (postBalances[treasuryIdx] - preBalances[treasuryIdx]) / LAMPORTS_PER_SOL;
    if (received < expectedAmount * 0.99) {
      return { valid: false, error: `Insufficient payment: received ${received} SOL, expected ${expectedAmount} SOL` };
    }

    return { valid: true, received };
  } catch (e) {
    return { valid: false, error: `Payment verification error: ${e.message}` };
  }
}

async function mintNft(wallet, tokenIndex, metadataUri, name) {
  const secretKey = (bs58.default || bs58).decode(process.env.MINT_AUTHORITY_KEY);
  const mintAuthority = Keypair.fromSecretKey(secretKey);

  const umi = createUmi(RPC).use(mplTokenMetadata());
  const umiKeypair = fromWeb3JsKeypair(mintAuthority);
  umi.use(keypairIdentity(umiKeypair));

  const mint = generateSigner(umi);
  const ownerPubkey = fromWeb3JsPublicKey(new PublicKey(wallet));

  const collectionMint = process.env.COLLECTION_MINT
    ? fromWeb3JsPublicKey(new PublicKey(process.env.COLLECTION_MINT))
    : undefined;

  const builder = createNft(umi, {
    mint,
    name,
    uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(5),
    tokenOwner: ownerPubkey,
    collection: collectionMint ? { verified: false, key: collectionMint } : undefined,
  });

  const result = await builder.sendAndConfirm(umi);
  return {
    mint: mint.publicKey,
    signature: Buffer.from(result.signature).toString("base64"),
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST only" });

  try {
    const { wallet, challenge, nonce, txSignature } = req.body;

    if (!wallet || !challenge || nonce === undefined || !txSignature) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: wallet, challenge, nonce, txSignature"
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

    // 3. Check per-wallet limit (from Redis)
    const walletMints = await redis.get(`wallet:${wallet}:count`) || 0;
    if (walletMints >= MAX_PER_WALLET) {
      return res.status(429).json({
        success: false,
        error: `Wallet has already minted ${walletMints}/${MAX_PER_WALLET}. Max per wallet reached.`
      });
    }

    // 4. Check for duplicate tx signature (prevent replay)
    const txUsed = await redis.get(`tx:${txSignature}`);
    if (txUsed) {
      return res.status(400).json({ success: false, error: "Transaction signature already used" });
    }

    // 5. Verify payment
    const mintPrice = parseFloat(process.env.MINT_PRICE_SOL || "0.02");
    const paymentResult = await verifyPayment(txSignature, mintPrice, process.env.TREASURY_WALLET);
    if (!paymentResult.valid) {
      return res.status(400).json({ success: false, error: paymentResult.error });
    }

    // 6. Atomically claim the next NFT index
    const nextIndex = await redis.incr("mint:counter");
    if (nextIndex > TOTAL_PUBLIC) {
      await redis.decr("mint:counter"); // Roll back
      return res.status(410).json({ success: false, error: "Sold out!" });
    }

    // Map counter to metadata index (0-based, skip reserved)
    const nftIndex = nextIndex - 1;
    const index = getMetadataIndex();
    const nft = index[nftIndex];

    if (!nft || nft.reserved) {
      return res.status(500).json({ success: false, error: "NFT assignment error" });
    }

    // 7. Mint NFT on-chain
    const mintResult = await mintNft(wallet, nft.index, nft.metadataUri, nft.name);

    // 8. Record in Redis (all atomic-ish)
    await Promise.all([
      redis.set(`tx:${txSignature}`, wallet),           // Mark tx as used
      redis.incr(`wallet:${wallet}:count`),              // Increment wallet count
      redis.set(`nft:${nftIndex}:mint`, mintResult.mint), // Record mint address
      redis.set(`nft:${nftIndex}:owner`, wallet),         // Record owner
    ]);

    const claimed = nextIndex;

    return res.status(200).json({
      success: true,
      message: "Welcome to Valhalla, agent.",
      nft: {
        id: nft.index,
        name: nft.name,
        mint: mintResult.mint,
        explorer: `https://solscan.io/token/${mintResult.mint}`
      },
      collection: {
        claimed,
        remaining: TOTAL_PUBLIC - claimed,
        total: TOTAL_PUBLIC
      }
    });
  } catch (e) {
    console.error("Mint error:", e);
    return res.status(500).json({ success: false, error: "Mint failed: " + e.message });
  }
};
