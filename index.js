#!/usr/bin/env node

import { Command } from 'commander';
import axios from 'axios';
import chalk from 'chalk';
import { createECDH, createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { request } from 'undici';
import { createParser } from 'eventsource-parser';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import inquirer from 'inquirer';

const program = new Command();
program.version('1.3.3');

const AES_ALGO = 'aes-256-cbc';
const decoder = new TextDecoder();
const peerColors = {};
const colorPool = [chalk.cyan, chalk.green, chalk.magenta, chalk.yellow, chalk.blue, chalk.red];
let promptActive = false;

let rl;
let topicUrl = '', sseUrl = '', myPublicKey = '', peers = new Map();
let broadcastPublicKey;
let username = ''; // global username for prompt

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

function getColor(name) {
  if (!peerColors[name]) {
    const color = colorPool.shift() || chalk.white;
    peerColors[name] = color;
    colorPool.push(color);
  }
  return peerColors[name];
}

function redraw(msg) {
  if (promptActive) return;
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  console.log(msg);
  rl.prompt(true);
}

function resetReadlinePrompt() {
  if (rl) rl.close();
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.white(`${username}: `)
  });
  rl.on('line', handleLine);
  rl.prompt();
}

async function handleIncomingFile(peer, payloadData) {
  const { filename, mimeType, data } = payloadData;
  const size = Buffer.from(data, 'base64').length;

  try {
    promptActive = true;

    const { ok } = await inquirer.prompt({
      name: 'ok',
      type: 'confirm',
      message: `📁 ${peer.username} sent a file "${filename}" (${size} bytes). Save it?`,
      default: true
    });

    if (!ok) return;

    const { dir } = await inquirer.prompt({
      name: 'dir',
      type: 'input',
      message: 'Enter save directory:',
      default: './received'
    });

    const outDir = path.resolve(dir);
    const outPath = path.join(outDir, filename);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
    console.log(chalk.green(`✔ File saved to ${outPath}`));
  } catch (err) {
    console.error(chalk.red('❌ Error handling file:'), err.message);
  } finally {
    promptActive = false;
    resetReadlinePrompt();
  }
}

async function handleLine(line) {
  const message = line.trim();
  const timestamp = Date.now();
  if (promptActive || !message) return rl.prompt();

  if (message === '/clean') {
    console.clear();
    rl.prompt();
    return;
  }

  if (message === '/help') {
    console.log(chalk.blueBright(`Available Commands:
/who         - Show list of active peers
/msg NAME TEXT - Send a direct message
/send FILE   - Send file to all or DM as /send @name FILE
/refresh     - Re-send your public key
/clean       - Clear the terminal
/help        - Show this help menu`));
    rl.prompt();
    return;
  }

  if (message === '/refresh') {
    await broadcastPublicKey();
    rl.prompt();
    return;
  }

  if (message === '/who') {
    const online = Array.from(peers.values()).map(p => `• ${p.username}`);
    console.log(online.length ? chalk.green('Active users:\n' + online.join('\n')) : chalk.yellow('[⏳] No peers yet. Message will not be sent.'));
    rl.prompt();
    return;
  }

  if (message.startsWith('/msg ')) {
    const [, targetUser, ...words] = message.split(' ');
    const peerEntry = Array.from(peers.entries()).find(([, v]) => v.username === targetUser);
    if (!peerEntry) return console.log(chalk.red(`[!] No such user: ${targetUser}`)), rl.prompt();

    const [targetKey, peer] = peerEntry;
    const text = words.join(' ');
    const encrypted = aesEncrypt(text, peer.key);
    const payload = { type: 'message', from: myPublicKey, to: targetKey, body: encrypted, timestamp };
    await axios.post(topicUrl, JSON.stringify(payload), { headers: { 'Content-Type': 'text/plain' } });
    console.log(chalk.green(`✔ DM sent to ${peer.username}`));
    rl.prompt();
    return;
  }

  if (message.startsWith('/send ')) {
    const parts = message.split(' ');
    let target = null;
    let filePath = null;
    if (parts[1].startsWith('@')) {
      target = parts[1].substring(1);
      filePath = parts.slice(2).join(' ');
    } else {
      filePath = parts.slice(1).join(' ');
    }

    if (!fs.existsSync(filePath)) {
      console.log(chalk.red(`File not found: ${filePath}`));
      rl.prompt();
      return;
    }

    const stat = fs.statSync(filePath);
    const size = stat.size;
    const name = path.basename(filePath);
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';

    try {
      promptActive = true;

      const { ok } = await inquirer.prompt({
        name: 'ok',
        type: 'confirm',
        message: `Send file "${name}" (${size} bytes) ${target ? `to ${target}` : 'to all'}?`
      });

      if (!ok) return;

      const fileBuffer = fs.readFileSync(filePath);
      const payloadBody = { filename: name, mimeType, data: fileBuffer.toString('base64') };
      const messagePayload = { type: 'file', from: myPublicKey, timestamp, body: null };

      if (target) {
        const peerEntry = Array.from(peers.entries()).find(([, v]) => v.username === target);
        if (!peerEntry) {
          console.log(chalk.red(`[!] No such user: ${target}`));
          return;
        }
        const [targetKey, peer] = peerEntry;
        messagePayload.to = targetKey;
        messagePayload.body = aesEncrypt(JSON.stringify(payloadBody), peer.key);
        await axios.post(topicUrl, JSON.stringify(messagePayload), { headers: { 'Content-Type': 'text/plain' } });
        console.log(chalk.green(`✔ File sent to ${peer.username}`));
      } else {
        for (const [pubKey, { key, username: peerName }] of peers.entries()) {
          messagePayload.body = aesEncrypt(JSON.stringify(payloadBody), key);
          await axios.post(topicUrl, JSON.stringify(messagePayload), { headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
          console.log(chalk.green(`✔ File sent to ${peerName}`));
        }
      }
    } catch (err) {
      console.error(chalk.red('❌ Failed to send file:'), err.message);
    } finally {
      promptActive = false;
      resetReadlinePrompt();
    }

    return;
  }

  for (const [pubKey, { key, username: peerName }] of peers.entries()) {
    const encrypted = aesEncrypt(message, key);
    const payload = { type: 'message', from: myPublicKey, body: encrypted, timestamp };
    await axios.post(topicUrl, JSON.stringify(payload), { headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    console.log(chalk.green(`✔ Message sent to ${peerName}`));
  }

  rl.prompt();
}

async function init() {
  const input = await inquirer.prompt([
    { name: 'server', type: 'list', message: 'Choose your ntfy server:', choices: ['https://ntfy.sh', 'https://server.k4li.ch'] },
    { name: 'room', type: 'input', message: 'Enter chat room name (ntfy topic):' },
    { name: 'username', type: 'input', message: 'Enter your username:' }
  ]);

  const server = input.server;
  const room = input.room;
  username = input.username;

  topicUrl = `${server.replace(/\/$/, '')}/${room}`;
  sseUrl = `${topicUrl}/sse`;

  const ecdh = createECDH('secp256k1');
  ecdh.generateKeys();
  myPublicKey = ecdh.getPublicKey('hex');
  const announceKey = sha256('k4li-chat-announce-key');

  broadcastPublicKey = async () => {
    const hiddenPayload = aesEncrypt(JSON.stringify({ username, ts: Date.now() }), announceKey);
    const handshake = { type: 'public-key', publicKey: myPublicKey, payload: hiddenPayload };
    await axios.post(topicUrl, JSON.stringify(handshake), { headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  };

  console.clear();
  console.log(chalk.green(`✔ Joined '${room}' as ${username}`));
  console.log(chalk.blue(`🔐 Secure chat ready — waiting on peers...\n`));

  await broadcastPublicKey();
  setInterval(() => broadcastPublicKey(), 10000);

  setInterval(() => {
    const now = Date.now();
    for (const [key, peer] of peers.entries()) {
      if (now - peer.lastSeen > 15000) {
        peers.delete(key);
        redraw(chalk.bold.yellow(`👋 ${peer.username} left the chat`));
      }
    }
  }, 5000);

  (async () => {
    const { body } = await request(sseUrl, { method: 'GET', headers: { Accept: 'text/event-stream' } });
    const parser = createParser({
      onEvent: async (event) => {
        if (!event.data) return;
        try {
          const raw = JSON.parse(event.data);
          const data = typeof raw.message === 'string' ? JSON.parse(raw.message) : raw;

          if (data.type === 'public-key' && data.publicKey !== myPublicKey) {
            if (!peers.has(data.publicKey)) {
              const shared = ecdh.computeSecret(Buffer.from(data.publicKey, 'hex')).toString('hex');
              const aesKey = sha256(shared);
              const userInfo = JSON.parse(aesDecrypt(data.payload, announceKey));
              peers.set(data.publicKey, { key: aesKey, username: userInfo.username || 'unknown', lastSeen: Date.now() });
              getColor(userInfo.username);
              redraw(chalk.yellow(`🔑 Key exchange completed with ${userInfo.username}`));
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

          if (data.type === 'file' && data.from && data.body) {
            const peer = peers.get(data.from);
            if (!peer) return;
            const decrypted = aesDecrypt(data.body, peer.key);
            const filePayload = JSON.parse(decrypted);
            await handleIncomingFile(peer, filePayload);
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

  resetReadlinePrompt();
}

program.action(init);
program.parse(process.argv);




