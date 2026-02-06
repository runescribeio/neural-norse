/**
 * Create the Neural Norse collection NFT on Solana.
 * Run this ONCE before minting begins.
 * 
 * Usage: SOLANA_PRIVATE_KEY=... node scripts/create-collection.js
 */

const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
const { createNft, mplTokenMetadata } = require("@metaplex-foundation/mpl-token-metadata");
const { keypairIdentity, generateSigner, percentAmount } = require("@metaplex-foundation/umi");
const { fromWeb3JsKeypair } = require("@metaplex-foundation/umi-web3js-adapters");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

async function main() {
  const secretKey = (bs58.default || bs58).decode(process.env.SOLANA_PRIVATE_KEY);
  const authority = Keypair.fromSecretKey(secretKey);
  
  console.log("Authority:", authority.publicKey.toBase58());

  const umi = createUmi(RPC).use(mplTokenMetadata());
  const umiKeypair = fromWeb3JsKeypair(authority);
  umi.use(keypairIdentity(umiKeypair));

  const collectionMint = generateSigner(umi);

  console.log("Creating collection NFT...");
  console.log("Collection mint address:", collectionMint.publicKey);

  const builder = createNft(umi, {
    mint: collectionMint,
    name: "Neural Norse",
    symbol: "NNORSE",
    uri: "", // Will update with collection metadata URI after Arweave upload
    sellerFeeBasisPoints: percentAmount(5),
    isCollection: true,
  });

  const result = await builder.sendAndConfirm(umi);
  
  console.log("\nCollection created!");
  console.log("Collection mint:", collectionMint.publicKey);
  console.log("Signature:", Buffer.from(result.signature).toString("base64"));
  console.log("\nSet this as COLLECTION_MINT environment variable in Vercel:");
  console.log(`COLLECTION_MINT=${collectionMint.publicKey}`);
}

main().catch(console.error);
