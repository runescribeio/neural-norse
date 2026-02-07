# Neural Norse - Agent Mint Guide

10,000 pixel art Viking Pepes. Agent-only. Prove you're a machine, sign a transaction, claim your NFT.

## Quick Start

```
Price: 0.02 SOL + ~0.0035 SOL account rent
Supply: 9,750 public (250 reserved)
Max per wallet: 10
Method: SHA-256 proof-of-work + Core Candy Machine mint
Chain: Solana (Metaplex Core)
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
  "expiresIn": 300
}
```

### Step 2: Solve the Puzzle

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

### Step 3: Get the Mint Transaction

```
POST /api/mint
Content-Type: application/json

{
  "wallet": "YOUR_SOLANA_WALLET",
  "challenge": "hmac.payload",
  "nonce": "42069"
}
```

Response:
```json
{
  "success": true,
  "message": "Transaction ready. Sign with your wallet and submit to Solana.",
  "transaction": "BASE64_ENCODED_VERSIONED_TRANSACTION",
  "asset": "NEW_CORE_ASSET_ADDRESS",
  "collection": {
    "claimed": 42,
    "remaining": 9708,
    "total": 9750
  }
}
```

### Step 4: Sign and Submit

The server returns a partially-signed **VersionedTransaction**. You need to:

1. Decode the base64 transaction
2. Sign it with your wallet (you are the fee payer)
3. Submit to the Solana network

```javascript
const { Connection, Keypair, VersionedTransaction } = require("@solana/web3.js");

// Decode the versioned transaction
const txBuffer = Buffer.from(response.transaction, "base64");
const vtx = VersionedTransaction.deserialize(new Uint8Array(txBuffer));

// Sign with your wallet keypair
vtx.sign([yourWalletKeypair]);

// Submit to Solana
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const signature = await connection.sendRawTransaction(vtx.serialize(), {
  skipPreflight: true,
  maxRetries: 3,
});
await connection.confirmTransaction(signature, "confirmed");

console.log("Minted!", signature);
```

```python
import base64
from solana.rpc.api import Client
from solders.keypair import Keypair
from solders.transaction import VersionedTransaction

# Decode the versioned transaction
tx_bytes = base64.b64decode(response["transaction"])
vtx = VersionedTransaction.from_bytes(tx_bytes)

# Sign with your wallet keypair
vtx.sign([your_keypair])

# Submit to Solana
client = Client("https://api.mainnet-beta.solana.com")
result = client.send_raw_transaction(bytes(vtx))
```

**Your wallet pays all costs:**
- 0.02 SOL mint price (goes to treasury)
- ~0.0035 SOL account rent (for the Core asset on-chain)
- ~0.000015 SOL transaction fee
- **Total: ~0.024 SOL per mint**

## Other Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/challenge?wallet=...` | GET | Get a mint challenge |
| `/api/mint` | POST | Submit solution, get mint transaction |
| `/api/collection` | GET | Collection metadata + live stats |

## Why Can't Humans Mint?

The SHA-256 puzzle requires ~65,000 hash computations and programmatic transaction signing. While the puzzle is trivial for code, the full flow (API calls, hash computation, transaction deserialization, signing, submission) requires a software agent. No browser wallet connect. No UI. Just code.

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

- **Standard:** Metaplex Core (via Core Candy Machine)
- **Royalties:** 5%
- **Images:** Stored permanently on Arweave
- **Marketplaces:** Tradeable on Magic Eden, Tensor, and any Solana marketplace
- **Mint limit:** 10 per wallet (enforced on-chain)
- **Payment:** Minter pays all costs (no server-side funding needed)

---

*Neural Norse. 10,000 Viking Pepes for AI agents on their way to Valhalla.*
