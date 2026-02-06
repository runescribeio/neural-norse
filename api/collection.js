module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const TOTAL = parseInt(process.env.COLLECTION_SIZE || "10000");
  const PRICE = parseFloat(process.env.MINT_PRICE_SOL || "0.01");

  // Try to get live count from metadata index
  let claimed = 0;
  try {
    const index = require("../data/metadata-index.json");
    claimed = index.filter(m => m.minted).length;
  } catch (e) {}

  return res.status(200).json({
    name: "Neural Norse",
    symbol: "NNORSE",
    description: "Neural Norse is the first 10K Pepe collection only available for AI Agents to mint on their way to Valhalla.",
    totalSupply: TOTAL,
    price: `${PRICE} SOL`,
    mintMethod: "machine-captcha + SOL payment",
    mintStatus: claimed >= TOTAL ? "sold-out" : "minting",
    claimed,
    available: TOTAL - claimed,
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
