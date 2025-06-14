#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import axios from 'axios';
import chalk from 'chalk';
import CryptoJS from 'crypto-js';
import { request } from 'undici';
import { createParser } from 'eventsource-parser';
import emoji from 'node-emoji';

const program = new Command();
program.version('4.0.0');

function decryptMessage(encryptedText, password) {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, password);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return null;
  }
}

function formatTimestamp(ts = Date.now()) {
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

program
  .description('Encrypted real-time chat over ntfy')
  .action(async () => {
    let username = '';
    let topicUrl = '';
    let password = '';

    const sendSystemMessage = async (text) => {
      const msg = JSON.stringify({ system: true, message: text, timestamp: Date.now() });
      const encrypted = CryptoJS.AES.encrypt(msg, password).toString();
      await axios.post(topicUrl, encrypted, {
        headers: { 'Content-Type': 'text/plain', 'X-Priority': '1' }
      });
    };

    const sendTypingNotice = async () => {
      const msg = JSON.stringify({
        system: true,
        typing: true,
        username,
        timestamp: Date.now()
      });
      const encrypted = CryptoJS.AES.encrypt(msg, password).toString();
      await axios.post(topicUrl, encrypted, {
        headers: { 'Content-Type': 'text/plain', 'X-Priority': '1' }
      });
    };

    try {
      const answers = await inquirer.prompt([
        {
          name: 'server',
          type: 'list',
          message: 'Choose your ntfy server:',
          choices: ['https://ntfy.sh', 'https://server.redacted']
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
        },
        {
          name: 'password',
          type: 'password',
          message: 'Enter password for encryption:',
          mask: '*'
        }
      ]);

      const { server, room } = answers;
      username = answers.username;
      password = answers.password;
      topicUrl = `${server.replace(/\/$/, '')}/${room}`;
      const sseUrl = `${topicUrl}/sse`;

      console.log(chalk.green(`\n[+] Welcome ${username}! You’ve joined "${room}"`));
      console.log(chalk.blue(`[🔐] End-to-end encryption is active\n`));

      await sendSystemMessage(`${username} has joined the room.`);

      // Listen for Ctrl+C to send "left" message
      process.on('SIGINT', async () => {
        await sendSystemMessage(`${username} has left the room.`);
        process.exit(0);
      });

      // Start SSE stream
      (async () => {
        const { body } = await request(sseUrl, {
          method: 'GET',
          headers: { Accept: 'text/event-stream' }
        });

        const parser = createParser({
          onEvent: (event) => {
            if (!event.data) return;
            try {
              const parsed = JSON.parse(event.data);

              if (parsed.event === 'message' && parsed.message) {
                const decrypted = decryptMessage(parsed.message, password);
                if (!decrypted) return;

                let content;
                try {
                  content = JSON.parse(decrypted);
                } catch {
                  content = { username: 'unknown', message: decrypted };
                }

                if (content.system) {
                  if (content.typing && content.username !== username) {
                    const since = Date.now() - content.timestamp;
                    if (since < 3000) {
                      process.stdout.write(chalk.gray(`[✍️] ${content.username} is typing...\r`));
                    }
                  } else if (content.message) {
                    console.log(chalk.yellow(`[📢] ${content.message}`));
                  }
                } else {
                  const time = formatTimestamp(content.timestamp);
                  const msgWithEmoji = emoji.emojify(content.message);
                  console.log(chalk.white(`[${time}] ${content.username}: ${msgWithEmoji}`));
                }
              }
            } catch {}
          }
        });

        const decoder = new TextDecoder('utf-8');
        for await (const chunk of body) {
          parser.feed(decoder.decode(chunk));
        }
      })();

      // Input loop
      while (true) {
        await sendTypingNotice();

        const input = await inquirer.prompt([
          {
            name: 'message',
            type: 'input',
            message: chalk.white(`${username}:`)
          }
        ]);

        const msgObj = {
          username,
          message: input.message,
          timestamp: Date.now()
        };

        const encrypted = CryptoJS.AES.encrypt(JSON.stringify(msgObj), password).toString();

        try {
          await axios.post(topicUrl, encrypted, {
            headers: {
              'Content-Type': 'text/plain',
              'X-Priority': '5'
            }
          });
        } catch {
          console.log(chalk.red('[!] Failed to send message.'));
        }
      }
    } catch (err) {
      console.error(chalk.red(`💥 Fatal error: ${err.message}`));
    }
  });

program.parse(process.argv);


