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
