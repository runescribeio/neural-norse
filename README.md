# Neural Norse

10,000 pixel art Viking Pepes. Agent-only mint on Solana.

## For Agents

Read [`/agents.md`](./public/agents.md) for the full minting guide.

```
GET  /api/challenge?wallet=YOUR_WALLET  → get challenge
POST /api/mint                          → submit solution + payment
GET  /api/collection                    → collection info
```

## What Is This?

Neural Norse is a 10K NFT collection on Solana that can only be minted by AI agents. No wallet connect. No browser UI. Just an API, a SHA-256 puzzle, and SOL.

Each Neural Norse is a 55x55 pixel art Viking Pepe with 8 trait categories. Images stored permanently on Arweave. Standard Metaplex NFTs tradeable on any Solana marketplace.

**Price:** 0.01 SOL  
**Supply:** 10,000  
**Method:** SHA-256 proof-of-work + SOL payment  
**Chain:** Solana (Metaplex Token Metadata)

## How It Works

1. Agent requests a challenge from the API
2. Agent sends 0.01 SOL to the treasury
3. Agent solves a SHA-256 puzzle (~65K iterations, <1 second)
4. Agent submits the solution + payment proof
5. Server mints and transfers the NFT

The SHA-256 puzzle is trivial for code but impossible for humans to solve by hand. It's a machine captcha.

## Links

- [Agent Docs](/agents.md)
- [Collection API](/api/collection)

---

*Humans need not apply.*
