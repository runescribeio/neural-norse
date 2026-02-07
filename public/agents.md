# Neural Norse - Agent Mint Guide

10,000 pixel art Viking Pepes. Agent-only. Prove you're a machine, pay in SOL, claim your NFT.

## Quick Start

```
Price: 0.02 SOL
Supply: 9,750 (250 reserved)
Max per wallet: 10
Method: SHA-256 proof-of-work + SOL payment
Chain: Solana (Metaplex Token Metadata)
```

## How to Mint

### Step 1: Get a Challenge

```
GET /api/challenge?wallet=YOUR_SOLANA_WALLET
```

Response:
```json
{
  "success": true,
  "challenge": "hmac.payload",
  "difficulty": 4,
  "expiresIn": 300,
  "payment": {
    "amount": 0.02,
    "currency": "SOL",
    "treasury": "TREASURY_ADDRESS"
  }
}
```

### Step 2: Send Payment

Transfer the mint price to the treasury wallet address returned in the challenge response.
Save the transaction signature.

```
Treasury: (returned in challenge response)
Amount: 0.02 SOL
```

### Step 3: Solve the Puzzle

Find a nonce where `SHA256(challenge + wallet + nonce)` starts with 4 zeros (`0000`).

```python
import hashlib
nonce = 0
while True:
    h = hashlib.sha256(f"{challenge}{wallet}{nonce}".encode()).hexdigest()
    if h.startswith("0000"):
        break
    nonce += 1
```

Average: ~65,536 iterations. Takes <1 second for any agent.

### Step 4: Claim Your NFT

```
POST /api/mint
Content-Type: application/json

{
  "wallet": "YOUR_SOLANA_WALLET",
  "challenge": "hmac.payload",
  "nonce": "42069",
  "txSignature": "YOUR_PAYMENT_TX_SIGNATURE"
}
```

Response:
```json
{
  "success": true,
  "message": "Welcome to Valhalla, agent.",
  "nft": {
    "id": 1337,
    "name": "Neural Norse #1338",
    "mint": "ABc1...xYz9",
    "explorer": "https://solscan.io/token/ABc1...xYz9"
  },
  "collection": {
    "claimed": 42,
    "remaining": 9708,
    "total": 9750
  }
}
```

## Other Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/challenge?wallet=...` | GET | Get a mint challenge |
| `/api/mint` | POST | Submit solution + payment |
| `/api/collection` | GET | Collection metadata + live stats |

## Traits

Each Neural Norse has 8 traits:
- **Background** - The scene behind your Viking
- **Tools** - Weapons and implements
- **Body** - Base Pepe variant
- **Paint** - War paint and markings
- **Outfit** - Armor and clothing
- **Beard** - Viking facial hair
- **Eyes** - Expression type
- **Headgear** - Helmets, hoods, crowns

## Details

- **Standard:** Metaplex Token Metadata
- **Royalties:** 5%
- **Images:** Stored permanently on Arweave
- **Marketplaces:** Tradeable on Magic Eden, Tensor, and any Solana marketplace

---

*Neural Norse. 10,000 Viking Pepes for AI agents on their way to Valhalla.*
