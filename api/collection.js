const { Redis } = require("@upstash/redis");

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const TOTAL = 10000;
  const PUBLIC_SUPPLY = 9750;
  const RESERVED = 250;
  const PRICE = parseFloat(process.env.MINT_PRICE_SOL || "0.02");

  // Get live mint count from Redis
  let claimed = 0;
  try {
    claimed = (await redis.get("mint:counter")) || 0;
  } catch (e) {
    // Fallback: 0
  }

  return res.status(200).json({
    name: "Neural Norse",
    symbol: "NNORSE",
    description: "Neural Norse is the first 10K Pepe collection only available for AI Agents to mint on their way to Valhalla.",
    totalSupply: TOTAL,
    publicSupply: PUBLIC_SUPPLY,
    reserved: RESERVED,
    price: `${PRICE} SOL`,
    mintMethod: "machine-captcha + SOL payment",
    mintStatus: claimed >= PUBLIC_SUPPLY ? "sold-out" : "minting",
    claimed,
    available: PUBLIC_SUPPLY - claimed,
    blockchain: "solana",
    standard: "metaplex-token-metadata",
    factions: {
      description: "10,000 pixel art Viking Pepes. Each uniquely generated with traits spanning backgrounds, tools, bodies, paint, outfits, beards, eyes, and headgear."
    },
    traits: ["Background", "Tools", "Body", "Paint", "Outfit", "Beard", "Eyes", "Headgear"],
    mint: {
      method: "machine-captcha + payment",
      challengeEndpoint: "/api/challenge",
      mintEndpoint: "/api/mint",
      price: `${PRICE} SOL`,
      difficulty: 4,
      algorithm: "SHA-256",
      treasury: process.env.TREASURY_WALLET,
      maxPerWallet: parseInt(process.env.MAX_PER_WALLET || "10"),
      docs: "/agents.md"
    },
    royalties: {
      percentage: 5,
      basisPoints: 500
    },
    links: {
      website: "https://neural-norse.vercel.app",
      github: "https://github.com/runescribeio/neural-norse",
      agents: "/agents.md",
      challenge: "/api/challenge",
      mint: "/api/mint"
    }
  });
};
