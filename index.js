#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import inquirer from 'inquirer';
import { Room } from './lib/room.js';
import { Transport } from './lib/transport.js';
import { KEM_NAME } from './lib/pqc.js';

const program = new Command();
program.version('2.0.0');
program.name('k4li-chat');

const peerColors = new Map();
const colorPool = [chalk.cyan, chalk.green, chalk.magenta, chalk.yellow, chalk.blue, chalk.red];

let room;
let rl;
let busy = false;
let lastLine = '';
const buffered = [];

function colorFor(name) {
  if (!peerColors.has(name)) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    peerColors.set(name, colorPool[Math.abs(hash) % colorPool.length]);
  }
  return peerColors.get(name);
}

function emit(message) {
  if (!rl) {
    buffered.push(message);
    return;
  }
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  console.log(message);
  rl.prompt(true);
}

function redraw(message) {
  if (busy) {
    buffered.push(message);
    return;
  }
  emit(message);
}

async function flushOutbound() {
  const messages = room.takeOutbound();
  if (!messages.length) return;
  try {
    await transport.publishAll(messages);
  } catch (err) {
    redraw(chalk.red(`! send failed (${err.message})`));
  }
}

let announcing = false;
let backoff = 0;

async function announce() {
  if (announcing) return;
  announcing = true;
  try {
    await transport.publish(room.announce());
    await flushOutbound();
    backoff = 0;
  } catch (err) {
    if (err.status === 429) {
      backoff = backoff ? Math.min(backoff * 2, 60000) : 5000;
      redraw(chalk.yellow(`! server is rate limiting, retrying in ${backoff / 1000}s`));
      setTimeout(announce, backoff);
    } else {
      redraw(chalk.red(`! announce failed (${err.message})`));
    }
  } finally {
    announcing = false;
  }
}

function onRoomEvent(event) {
  if (event.type === 'join') {
    redraw(chalk.yellow(`+ ${event.username} joined`));
  }
  if (event.type === 'ready') {
    redraw(chalk.green(`* post-quantum channel ready with ${event.username}`));
  }
  if (event.type === 'rejected') {
    redraw(chalk.red(`! blocked ${event.username || 'announce'}: ${event.reason}`));
  }
  if (event.type === 'impersonation') {
    redraw(
      chalk.red.bold(`! "${event.username}" is claimed by more than one key — possible impersonation`)
    );
  }
  if (event.type === 'message') {
    const time = new Date(event.timestamp || Date.now()).toLocaleTimeString('en-GB');
    const tag = event.isDm ? chalk.magenta('[DM] ') : '';
    redraw(colorFor(event.username)(`[${time}] ${tag}${event.username}: ${event.plaintext}`));
  }
  if (event.type === 'file') {
    handleIncomingFile(event.username, event.payload);
  }
}

async function handleIncomingFile(sender, payload) {
  const size = Buffer.from(payload.data, 'base64').length;

  try {
    busy = true;
    const { ok } = await inquirer.prompt({
      name: 'ok',
      type: 'confirm',
      default: true,
      message: `${sender} sent "${payload.filename}" (${size} bytes). Save it?`
    });

    if (!ok) return;

    const { dir } = await inquirer.prompt({
      name: 'dir',
      type: 'input',
      default: './received',
      message: 'Save to directory:'
    });

    const outDir = path.resolve(dir);
    fs.mkdirSync(outDir, { recursive: true });
    const safeName = path.basename(payload.filename);
    const outPath = path.join(outDir, safeName);
    fs.writeFileSync(outPath, Buffer.from(payload.data, 'base64'));
    console.log(chalk.green(`saved ${outPath}`));
  } catch (err) {
    console.error(chalk.red(`file error: ${err.message}`));
  } finally {
    busy = false;
    lastLine = '';
    resetPrompt();
  }
}

async function handleLine(line) {
  const text = line.trim();
  if (busy || !text) return rl.prompt();

  if (text === '/clean') {
    console.clear();
    return rl.prompt();
  }

  if (text === '/help') {
    console.log(
      chalk.blueBright(`Commands:
  /who               list peers with an open channel and their key id
  /msg NAME TEXT     send a private message
  /send FILE         send a file to everyone
  /send @NAME FILE   send a file to one peer
  /refresh           re-announce and rebuild channels
  /clean             clear the terminal
  /help              this menu`)
    );
    return rl.prompt();
  }

  if (text === '/refresh') {
    room.peers.clear();
    await room.sweep(0);
    announce();
    console.log(chalk.green('re-announced'));
    return rl.prompt();
  }

  if (text === '/who') {
    const roster = room.roster();
    if (!roster.length) {
      console.log(chalk.yellow('(no peers yet)'));
    } else {
      console.log(
        roster
          .map((peer) => `* ${peer.username}  ${chalk.dim(`key ${peer.fingerprint}`)}`)
          .join('\n')
      );
      console.log(chalk.dim('  compare key ids over another channel to rule out impostors'));
    }
    return rl.prompt();
  }

  if (text.startsWith('/msg ')) {
    const [, target, ...words] = text.split(' ');
    const result = room.directMessage(target, words.join(' '));
    await flushOutbound();
    console.log(result.ok ? chalk.green(`dm sent to ${target}`) : chalk.red(`! ${result.reason}`));
    return rl.prompt();
  }

  if (text.startsWith('/send ')) {
    const parts = text.split(' ');
    let target = null;
    let filePath;

    if (parts[1].startsWith('@')) {
      target = parts[1].slice(1);
      filePath = parts.slice(2).join(' ');
    } else {
      filePath = parts.slice(1).join(' ');
    }

    if (!fs.existsSync(filePath)) {
      console.log(chalk.red(`! file not found: ${filePath}`));
      return rl.prompt();
    }

    try {
      busy = true;
      const { ok } = await inquirer.prompt({
        name: 'ok',
        type: 'confirm',
        message: `send "${path.basename(filePath)}"${target ? ` to ${target}` : ' to everyone'}?`
      });
      if (!ok) return;

      const buffer = fs.readFileSync(filePath);
      const result = room.sendFile(
        {
          filename: path.basename(filePath),
          mimeType: mime.lookup(filePath) || 'application/octet-stream',
          data: buffer.toString('base64')
        },
        target
      );
      await flushOutbound();

      if (!result.ok) console.log(chalk.red(`! ${result.reason}`));
      else console.log(chalk.green(`sent to ${result.sent.join(', ')}`));
    } catch (err) {
      console.error(chalk.red(`file error: ${err.message}`));
    } finally {
      busy = false;
      resetPrompt();
    }
    return;
  }

  const sent = room.broadcast(text);
  await flushOutbound();
  console.log(sent ? chalk.green(`sent to ${sent} peer(s)`) : chalk.yellow('(no peers yet)'));
}

function resetPrompt() {
  if (rl) rl.close();
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.white(`${room.username}: `)
  });
  rl.on('line', handleLine);
  rl.prompt();

  while (buffered.length) {
    const message = buffered.shift();
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(message);
  }
}

async function init() {
  const answers = await inquirer.prompt([
    {
      name: 'server',
      type: 'list',
      message: 'ntfy server:',
      choices: ['https://ntfy.sh', 'https://server.k4li.ch']
    },
    { name: 'room', type: 'input', message: 'room (topic):' },
    { name: 'username', type: 'input', message: 'username:' },
    {
      name: 'passphrase',
      type: 'password',
      mask: '*',
      message: 'room passphrase (shared secret, press Enter to skip):'
    }
  ]);

  const passphrase = answers.passphrase || '';

  room = new Room({
    username: answers.username,
    room: answers.room,
    passphrase,
    onEvent: onRoomEvent
  });
  transport = new Transport(answers.server, answers.room);

  console.clear();
  console.log(chalk.dim('generating ML-KEM-768 identity...'));

  await room.init();

  transport.onMessage = (message) => {
    room.enqueue(() => room.handle(message)).then(flushOutbound);
  };

  announce();

  transport.subscribe().catch(() => {
    redraw(chalk.red('! lost connection to the server, retrying'));
    setTimeout(() => transport.subscribe().catch(() => {}), 3000);
  });

  try {
    const history = await Promise.race([
      transport.recent(Date.now() - 20000),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 10000))
    ]);
    for (const message of history) await room.handle(message);
    await flushOutbound();
  } catch (err) {
    console.log(chalk.yellow(`could not read recent history (${err.message}); peers will appear within 10s`));
  }

  console.clear();
  console.log(chalk.green(`joined ${answers.room} as ${answers.username}`));
  console.log(chalk.blue(`secure channel: ${KEM_NAME} + AES-256-GCM`));
  console.log(chalk.dim(`your key id: ${room.print}`));

  if (room.authenticated) {
    console.log(chalk.green('identity authenticated by room passphrase'));
  } else {
    console.log(
      chalk.yellow.bold('no passphrase: usernames are visible to the server and anyone can')
    );
    console.log(chalk.yellow.bold('claim any name. Verify key ids out of band before trusting a peer.'));
  }
  console.log(chalk.dim('waiting for peers\n'));

  setInterval(() => {
    if (!busy) announce();
  }, 10000);

  setInterval(() => {
    for (const name of room.sweep()) redraw(chalk.yellow(`- ${name} left`));
  }, 5000);

  resetPrompt();
}

let transport;

program.action(init);
program.parse(process.argv);