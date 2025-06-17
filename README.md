# 🔐 k4li-chat-cli

A secure, end-to-end encrypted command-line chat client built on top of [ntfy](https://ntfy.sh)
with real-time messaging ECDH-based encryption DM support and zero server trust.

---

## ✨ Features

- 🔐 **End-to-End Encryption (E2EE)** using AES-256 + ECDH key exchange
- 📡 **Real-time messaging** via ntfy's public or self-hosted server
- 🧩 **Cross-platform** and terminal-friendly
- 🌐 **Server-agnostic** — the server never sees plaintext messages
- 🧑‍🤝‍🧑 **Public room chat + private DMs**
- 🕵️ **Anonymous** — no accounts, emails, or logins
- ✨ **Typing indicators**, colored usernames, join/leave notifications
- ✅ **Simple CLI commands** like `/msg`, `/who`, `/refresh`, `/help`

---

# 🛡️ Use Cases for k4li-chat-cli

`k4li-chat-cli` is more than a simple command-line chat 

— it's a privacy-first tool designed for real-world scenarios where mainstream messaging fails or can't be trusted.

---

## 🌐 When to Use

### 🔓 On Untrusted Networks
Whether you're in a public coffee shop, a hotel, or a remote co-working space, 

`k4li-chat-cli` encrypts messages end-to-end using ECDH and AES-256, meaning **no one — not even the server — can read your messages**.

**Perfect for:**
- Traveling developers and digital nomads
- Hackerspaces and CTFs
- Public Wi-Fi use

---

### 🕵️ When You Can't Use Your Default Messenger
Sometimes your default apps aren't accessible — due to firewalls, platform restrictions, or simply unavailability.

**Ideal for:**
- Censorship circumvention
- Messaging without an account
- Quick communications without app installs

---

### 👥 When Interlocutors Use Different Platforms
You use Signal, they use Telegram. You prefer Matrix, they only use WhatsApp.

Skip the compatibility drama. `k4li-chat-cli` works for everyone with:
- A terminal
- Internet access

**No accounts, no installs, no gatekeeping.**

---

## ✍️ For Journalists, Activists & Whistleblowers

- **Anonymous, encrypted by design**
- **Peer discovery via public or private ntfy servers**
- **Nothing stored on disk or visible in chat history**
- **Command-line interface leaves minimal forensic footprint**

---

## 🧑‍💻 For Developers

- Integrate into scripting workflows
- Use in automation
- Perfect for ad-hoc coordination across secure tunnels (like Tailscale, VPNs, Tor)

---

## 🚀 TL;DR

`k4li-chat-cli` is the secure, disposable, encrypted chat tool you've always needed 
— for when security, interoperability, and simplicity matter most.

> No logins. No metadata. Just E2EE messages between peers.


### 👻 Username Metadata Obfuscation

- Usernames are not visible in message metadata for passive observers (like browsers or sysadmins).
- All user-related data (name, message, intent) is embedded in the encrypted message body.
- You can test this by open the browser on the same chat room while users are talking in that chat room ex: server.k4li.ch/test/sse

you will only see :


data: {"id":"F1VXGiSMJtYz","time":1750008683,"expires":1750051883,"event":"message","topic":"new","message":"{\"type\":\"public-key\",\"publicKey\":\"043dfdb7af67043e3e12fb0e7214253ab9bfc78946f0b5b4b61d3f2b90b008314f6c0f4d28f97c729d7a82f616d8e33d90d5b43392756fe610d5813524c0ab039b\",\"payload\":\"c7d8d9182320708205c5c458a8a08476:495f188311190a7edb6c7eb9f6a97a725a4ecf4cfbac15a990036e198e3a95405f4f1696423e3424c233c149f1012e8a\"}"}

No usernames or other metadata are leaked!!


# 📁 Secure File Sharing in `k4li-chat-cli`

`k4li-chat-cli` extended to support **encrypted file sharing** while preserving end-to-end encryption.

---

## 🔐 How it Works

The system uses `ntfy`'s built-in support for attachments combined with symmetric AES encryption between peers.

1. The file is encrypted with a shared key.
2. Peers can download and decrypt the file locally.

---

## 🛠 CLI Usage Example

### Sending a File
```
/sendfile path/to/document.pdf
```

- Encrypts the file with AES (shared secret with peer)


### Receiving and Decrypting


- Downloads the encrypted file
- Decrypts it using the shared AES key
- Saves it as the original filename

---

## 🔒 Security Notes

- Files are encrypted **client-side** using the same AES-256 key used for messages.
- The ntfy server only stores **ciphertext**, with no knowledge of the contents.
- Metadata (like the original filename) is encrypted as well.

---



## ✅ Ideal For

- Sharing notes, photos, PDFs between trusted peers
- Secure collaboration while traveling or on untrusted networks
- Anonymous dropboxes (when combined with anonymous usernames)


## 🚀 Installation

### 🔧 Global (from source)

```bash
git clone https://github.com/carlostkd/k4li-chat.git
cd k4li-chat-cli
npm install
npm link
```

This will globally install `k4li-chat` as a command-line tool.

---

## 🧪 Try it instantly

No need to install globally:

```bash
npx k4li-chat-cli


## 🛠 Usage

To start chatting securely:

```bash
k4li-chat
```

You’ll be prompted for:

- **ntfy server** (e.g. `https://ntfy.sh` or your private instance we recommend to use our server.)
- **room name** (this becomes the ntfy topic share that name and server with who you need to talk.)
- **username** (shown to others in the chat)

Once connected, your device will:

- Generate an ECDH keypair
- Broadcast your public key to the room
- Derive AES keys with each peer securely
- Begin encrypted communication

---

## 💬 Chat Commands

Inside the chat interface, you can use:

| Command          | Description                                      |
|------------------|--------------------------------------------------|
| `/who`           | List all connected users in the room             |
| `/msg NAME TEXT` | Send a private (DM) message to user `NAME`       |
| `/refresh`       | Re-broadcast your public key in case of issues   |
| `/help`          | Show this list of commands                       |

---

## 🔐 Security Model

- Uses **ECDH (secp256k1)** for key exchange between peers
- AES-256-CBC with SHA-256 derived keys for message encryption
- All encryption and decryption happen **client-side only**
- Messages and keys are never stored or processed by the server in plaintext
- Supports **DM encryption** on a per-peer basis

---

## ✅ Example

```
✔ Joined 'test' as alice
🔐 Secure chat ready — waiting on peers...

alice: hello world
[12:42:55] bob: hi alice 👋
[12:43:01] [DM] charlie: hey can we talk?
```

---

## 🧪 Development

To test locally:

```bash
npm run dev
```

To publish (once ready):

```bash
npm publish --access public
```

---


## ❤️ Credits

- Built with 💻 by `Carlostkd`
- Uses [ntfy](https://ntfy.sh) as backend transport
- Open source, MIT licensed

---

## 📎 License

[MIT](./LICENSE)
