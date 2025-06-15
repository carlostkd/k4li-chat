#!/usr/bin/env node
import { Command } from 'commander';
import axios from 'axios';
import chalk from 'chalk';
import { createECDH, createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { request } from 'undici';
import { createParser } from 'eventsource-parser';
import readline from 'readline';

const program = new Command();
program.version('1.3.3');

const AES_ALGO = 'aes-256-cbc';
const decoder = new TextDecoder();
const peerColors = {};
const colorPool = [chalk.cyan, chalk.green, chalk.magenta, chalk.yellow, chalk.blue, chalk.red];

function sha256(data) {
  return createHash('sha256').update(data).digest();
}

function aesEncrypt(plaintext, key) {
  const iv = randomBytes(16);
  const cipher = createCipheriv(AES_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function aesDecrypt(cipherText, key) {
  const [ivHex, dataHex] = cipherText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = createDecipheriv(AES_ALGO, key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

program
  .description('Secure ECDH-encrypted chat over ntfy')
  .action(async () => {
    const inquirer = await import('inquirer');
    const { server, room, username } = await inquirer.default.prompt([
      {
        name: 'server',
        type: 'list',
        message: 'Choose your ntfy server:',
        choices: ['https://ntfy.sh', 'https://server.k4li.ch']
      },
      {
        name: 'room',
        type: 'input',
        message: 'Enter chat room name (ntfy topic):'
      },
      {
        name: 'username',
        type: 'input',
        message: 'Enter your username:'
      }
    ]);

    const topicUrl = `${server.replace(/\/$/, '')}/${room}`;
    const sseUrl = `${topicUrl}/sse`;
    const ecdh = createECDH('secp256k1');
    ecdh.generateKeys();
    const myPublicKey = ecdh.getPublicKey('hex');
    const peers = new Map();

    function getColor(name) {
      if (!peerColors[name]) {
        const color = colorPool.shift() || chalk.white;
        peerColors[name] = color;
        colorPool.push(color);
      }
      return peerColors[name];
    }

    function redraw(msg) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(msg);
      rl.prompt(true);
    }

    console.clear();
    console.log(chalk.green(`✔ Joined '${room}' as ${username}`));
    console.log(chalk.blue(`🔐 Secure chat ready — waiting on peers...\n`));

    async function broadcastPublicKey() {
      const handshake = { type: 'public-key', username, publicKey: myPublicKey };
      await axios.post(topicUrl, JSON.stringify(handshake), {
        headers: { 'Content-Type': 'text/plain' }
      }).catch(() => {});
    }

    await broadcastPublicKey();
    setInterval(() => broadcastPublicKey(), 10000);

    function removePeer(pubKey) {
      const peer = peers.get(pubKey);
      if (peer) {
        peers.delete(pubKey);
        redraw(chalk.bold.yellow(`👋 ${peer.username} left the chat`));
      }
    }

    setInterval(() => {
      const now = Date.now();
      for (const [key, peer] of peers.entries()) {
        if (now - peer.lastSeen > 15000) removePeer(key);
      }
    }, 5000);

    (async () => {
      const { body } = await request(sseUrl, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' }
      });
      const parser = createParser({
        onEvent(event) {
          if (!event.data) return;
          try {
            const raw = JSON.parse(event.data);
            const data = typeof raw.message === 'string' ? JSON.parse(raw.message) : raw;
            if (data.type === 'public-key' && data.publicKey && data.username !== username) {
              if (!peers.has(data.publicKey)) {
                const shared = ecdh.computeSecret(Buffer.from(data.publicKey, 'hex')).toString('hex');
                const aesKey = sha256(shared);
                peers.set(data.publicKey, { key: aesKey, username: data.username, lastSeen: Date.now() });
                getColor(data.username);
                redraw(chalk.yellow(`🔑 Key exchange completed with ${data.username}`));
              } else {
                peers.get(data.publicKey).lastSeen = Date.now();
              }
            }

            if (data.type === 'message' && data.from && data.body) {
              const peer = peers.get(data.from);
              if (!peer) return;
              const plaintext = aesDecrypt(data.body, peer.key);
              const timestamp = new Date(data.timestamp).toLocaleTimeString('en-GB');
              const label = data.to === myPublicKey ? '[DM]' : '';
              const color = getColor(peer.username);
              redraw(color(`[${timestamp}] ${label} ${peer.username}: ${plaintext}`));
            }

            if (data.type === 'typing' && data.from !== myPublicKey) {
              const peer = peers.get(data.from);
              if (peer) redraw(chalk.gray(`[✍] ${peer.username} is typing...`));
            }
          } catch {}
        }
      });

      for await (const chunk of body) {
        parser.feed(decoder.decode(chunk));
      }
    })();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.white(`${username}: `)
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const message = line.trim();
      const timestamp = Date.now();

      if (message === '/who') {
        const online = Array.from(peers.values()).map(p => `• ${p.username}`);
        if (online.length === 0) {
          console.log(chalk.yellow('[⏳] No peers yet. Message will not be sent.'));
        } else {
          console.log(chalk.green('Active users:\n' + online.join('\n')));
        }
        rl.prompt();
        return;
      }

      if (message === '/refresh') {
        await broadcastPublicKey();
        rl.prompt();
        return;
      }

      if (message === '/help') {
        console.log(chalk.blueBright(`
Available Commands:
/who         - Show list of active peers
/msg NAME TEXT - Send a direct message
/refresh     - Re-send your public key
/help        - Show this help menu
        `.trim()));
        rl.prompt();
        return;
      }

      if (message.startsWith('/msg ')) {
        const [, targetUser, ...words] = message.split(' ');
        const peerEntry = Array.from(peers.entries()).find(([, v]) => v.username === targetUser);
        if (!peerEntry) {
          console.log(chalk.red(`[!] No such user: ${targetUser}`));
        } else {
          const [targetKey, peer] = peerEntry;
          const text = words.join(' ');
          const encrypted = aesEncrypt(text, peer.key);
          const payload = {
            type: 'message',
            from: myPublicKey,
            to: targetKey,
            body: encrypted,
            timestamp
          };
          await axios.post(topicUrl, JSON.stringify(payload), {
            headers: { 'Content-Type': 'text/plain' }
          });
          console.log(chalk.green(`✔ DM sent to ${peer.username}`));
        }
        rl.prompt();
        return;
      }

      for (const [pubKey, { key, username: peerName }] of peers.entries()) {
        const encrypted = aesEncrypt(message, key);
        const payload = {
          type: 'message',
          from: myPublicKey,
          body: encrypted,
          timestamp
        };
        await axios.post(topicUrl, JSON.stringify(payload), {
          headers: { 'Content-Type': 'text/plain' }
        }).catch(() => {});
        console.log(chalk.green(`✔ Message sent to ${peerName}`));
      }

      rl.prompt();
    });
  });

program.parse(process.argv);


