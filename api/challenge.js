const crypto = require("crypto");

const DIFFICULTY = 4;
const CHALLENGE_TTL = 300; // 5 minutes

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { wallet } = req.query;
  if (!wallet || wallet.length < 32 || wallet.length > 44) {
    return res.status(400).json({ success: false, error: "Invalid wallet address" });
  }

  const timestamp = Date.now();
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = JSON.stringify({ wallet, timestamp, nonce });
  const payloadB64 = Buffer.from(payload).toString("base64url");

  const hmac = crypto
    .createHmac("sha256", process.env.CHALLENGE_SECRET || "neural-norse-default-secret")
    .update(payloadB64)
    .digest("hex");

  const challenge = `${hmac}.${payloadB64}`;

  return res.status(200).json({
    success: true,
    challenge,
    difficulty: DIFFICULTY,
    expiresAt: timestamp + CHALLENGE_TTL * 1000,
    expiresIn: CHALLENGE_TTL,
    instructions: `Find a nonce such that SHA256(challenge + wallet + nonce) starts with ${DIFFICULTY} zeros. Submit via POST /api/mint with { wallet, challenge, nonce }.`,
    mint: {
      description: "After solving the challenge, POST to /api/mint. You'll receive a partially-signed transaction. Sign it with your wallet and submit to Solana.",
      totalCost: "~0.024 SOL (0.02 SOL mint price + ~0.0035 SOL account rent + tx fees)",
      paidBy: "your wallet (minter pays all costs)",
    },
    solver: {
      description: `Find nonce where SHA256(challenge + wallet + nonce) starts with ${DIFFICULTY} zeros`,
      language: "any",
      iterations: "~65,536 average"
    }
  });
};
