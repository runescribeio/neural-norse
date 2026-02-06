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

  // HMAC-sign the payload so we can verify it later without storing anything
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
    instructions: `Find a nonce such that SHA256(challenge + wallet + nonce) starts with ${DIFFICULTY} zeros. Submit via POST /api/mint with { wallet, challenge, nonce, txSignature }.`,
    payment: {
      amount: parseFloat(process.env.MINT_PRICE_SOL || "0.01"),
      currency: "SOL",
      treasury: process.env.TREASURY_WALLET,
      instructions: "Send SOL to treasury BEFORE submitting mint request. Include txSignature in your mint payload."
    },
    solver: {
      description: `Find nonce where SHA256(challenge + wallet + nonce) starts with ${DIFFICULTY} zeros`,
      language: "any",
      iterations: "~65,536 average"
    }
  });
};
