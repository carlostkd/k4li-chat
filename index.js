#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import axios from 'axios';
import chalk from 'chalk';
import CryptoJS from 'crypto-js';

const program = new Command();
program.version('1.0.0');

function decryptMessage(encryptedText, password) {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, password);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return null;
  }
}

program
  .description('Encrypted chat over ntfy')
  .action(async () => {
    const answers = await inquirer.prompt([
      {
        name: 'server',
        type: 'list',
        message: 'Choose your ntfy server:',
        choices: [
          'https://ntfy.sh',
          'https://server.k4li.ch' 
        ]
      },
      {
        name: 'room',
        type: 'input',
        message: 'Enter chat room name (ntfy topic):'
      },
      {
        name: 'password',
        type: 'password',
        message: 'Enter password for encryption:',
        mask: '*'
      }
    ]);

    const { server, room, password } = answers;
    const topicUrl = `${server.replace(/\/$/, '')}/${room}`;

    let lastTime = 0;

    console.log(chalk.green(`\n[+] Joined room "${room}" on ${server}`));
    console.log(chalk.blue(`[🔐] Messages are end-to-end encrypted with AES-256.`));
    console.log(chalk.gray(`[⏳] Polling for new messages every 4 seconds...\n`));

   
    setInterval(async () => {
      try {
        const res = await axios.get(topicUrl, {
          headers: {
            Accept: 'application/json'
          },
          params: {
            since: lastTime || 0
          }
        });

        const messages = res.data;

        for (const msg of messages) {
          if (!msg || !msg.message || !msg.time) continue;

          const decrypted = decryptMessage(msg.message, password);
          if (decrypted) {
            console.log(chalk.cyan(`\n[🔓] ${decrypted}`));
            lastTime = Math.max(lastTime, msg.time);
          }
        }
      } catch (err) {
        if (err.response?.status === 404) {
          console.log(chalk.yellow(`[!] Waiting for topic "${room}" to receive messages...`));
        } else {
          console.log(chalk.red(`[!] Error polling messages: ${err.message}`));
        }
      }
    }, 4000);

    // Message sending 
    while (true) {
      const input = await inquirer.prompt([
        {
          name: 'message',
          type: 'input',
          message: chalk.white('You:')
        }
      ]);

      const encrypted = CryptoJS.AES.encrypt(input.message, password).toString();

      try {
        await axios.post(topicUrl, encrypted);
        console.log(chalk.gray('✔ Message sent'));
      } catch (err) {
        console.log(chalk.red('[!] Failed to send message. Server error.'));
      }
    }
  });


