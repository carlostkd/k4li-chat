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
