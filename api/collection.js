const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
const { mplCandyMachine, fetchCandyMachine } = require("@metaplex-foundation/mpl-core-candy-machine");
const { mplCore } = require("@metaplex-foundation/mpl-core");
const { publicKey } = require("@metaplex-foundation/umi");

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const TOTAL = 10000;
  const RESERVED = 250;
  const PRICE = parseFloat(process.env.MINT_PRICE_SOL || "0.02");

  // Get live mint count from Core Candy Machine on-chain
  let claimed = 0;
  let publicSupply = TOTAL - RESERVED;
  try {
    if (process.env.CANDY_MACHINE) {
      const umi = createUmi(RPC).use(mplCandyMachine()).use(mplCore());
      const cm = await fetchCandyMachine(umi, publicKey(process.env.CANDY_MACHINE));
      claimed = Number(cm.itemsRedeemed);
      publicSupply = Number(cm.data.itemsAvailable);
    }
  } catch (e) {
    // Fallback to defaults
  }

  return res.status(200).json({
    name: "Neural Norse",
    symbol: "NNORSE",
    description: "Neural Norse is the first 10K Pepe collection only available for AI Agents to mint on their way to Valhalla.",
    totalSupply: TOTAL,
    publicSupply,
    reserved: RESERVED,
    price: `${PRICE} SOL`,
    totalCostPerMint: "~0.03 SOL (mint price + account rent)",
    mintMethod: "machine-captcha + Core Candy Machine",
    mintStatus: (claimed + RESERVED) >= (publicSupply + RESERVED) ? "sold-out" : "minting",
    claimed: claimed + RESERVED,
    available: publicSupply - claimed,
    blockchain: "solana",
    standard: "metaplex-core",
    factions: {
      description: "10,000 pixel art Viking Pepes. Each uniquely generated with traits spanning backgrounds, tools, bodies, paint, outfits, beards, eyes, and headgear."
    },
    traits: ["Background", "Tools", "Body", "Paint", "Outfit", "Beard", "Eyes", "Headgear"],
    mint: {
      method: "SHA-256 proof-of-work + Core Candy Machine mint",
      challengeEndpoint: "/api/challenge",
      mintEndpoint: "/api/mint",
      price: `${PRICE} SOL`,
      accountRent: "~0.01 SOL",
      totalCost: "~0.03 SOL",
      difficulty: 4,
      algorithm: "SHA-256",
      maxPerWallet: parseInt(process.env.MAX_PER_WALLET || "10"),
      candyMachine: process.env.CANDY_MACHINE,
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
