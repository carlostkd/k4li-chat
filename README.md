# k4li chat

Postquantum encrypted chat over [ntfy](https://ntfy.sh). No accounts, no server, no database.

Every message is protected by ML-KEM-768 key exchange and AES-256-GCM authenticated encryption. 

The ntfy server only ever relays ciphertext.

## Install

```bash
npm install -g k4li-chat-cli
```

Then run:

```bash
k4li-chat
```

## Usage

On first launch you are asked four questions.

* **Server**: `https://ntfy.sh` or `https://server.k4li.ch` (Recomended)
* **Room**: the topic name, like `my-team`
* **Username**: how others see you
* **Room passphrase**: a shared secret, press Enter to skip

Share the passphrase with the people in your room out of band. 

Everyone who enters the same passphrase joins the same authenticated room.

## Commands

| Command | What it does |
| --- | --- |
| `/who` | list peers with an open channel and their key id |
| `/msg NAME TEXT` | send a private message |
| `/send FILE` | send a file to everyone |
| `/send @NAME FILE` | send a file to one peer |
| `/refresh` | re announce and rebuild channels |
| `/clean` | clear the terminal |
| `/help` | show the menu |

Anything else you type is sent to the room as a message.

## Security

### Real postquantum cryptography

Key exchange uses **ML-KEM-768**, the NIST FIPS 203 standard formerly known as CRYSTALS Kyber. 

This is genuine lattice based key encapsulation, not a simulation and not a classical algorithm wearing a postquantum label.

Each session generates a fresh keypair at startup. Keys are never written to disk.

### Authenticated encryption

Message bodies are sealed with **AES-256-GCM** using a random 96 bit IV per message. 

The sender peer id is bound into the authentication tag as additional authenticated data, so a ciphertext cannot be replayed under a different identity.

A separate key is derived for each direction of each conversation, so the key you use to send is never the key you use to receive.

### Secret room keys

Room keys are derived with **HKDF SHA-256** from your passphrase, salted per room. 

Two rooms with the same passphrase produce entirely different keys, and the encryption key and the authentication key are separate values.

There is no hardcoded key anywhere in the source.

### Signed presence

Every announcement carries an **HMAC SHA-256** tag binding the room, peer id, public key, username, and timestamp. 

A peer without the passphrase cannot forge one, and the server cannot rewrite a username or substitute a different key.

Announcements older than 60 seconds are refused, which keeps a captured announcement from being replayed later.

### Impersonation detection

If a second key claims a name that is already in the room, everyone is warned immediately. Names cannot be silently taken over.

### Peer verification

`/who` prints a short key id for every peer. Compare those over another channel to confirm you are talking to the person you think you are.

### Files

Files are encrypted before they leave your machine and split into chunks small enough for ntfy to carry. Only the intended recipients can reconstruct them.

## How it works

1. You join a room and announce your ML-KEM public key.
2. Every peer that sees your key encapsulates a shared secret to it and sends you the ciphertext.
3. You decapsulate it, both sides derive the same directional keys with HKDF, and AES-256-GCM takes over from there.
4. The ntfy server transports opaque ciphertext and never holds a key that can read your messages.

## Development

```bash
npm install
npm start          # run the cli
npm test           # offline protocol and crypto checks
npm run e2e        # live checks against a real ntfy server
```

The e2e suite creates a throwaway topic, exercises discovery, channels, messages, private messages, file transfer, and confirms that a peer with the wrong passphrase is refused.

## Requirements

Node.js 20.18.1 or newer.

## License

MIT
