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
  } catch (err) {
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
    let lastTime = Date.now();

    console.log(chalk.green(`\n[+] Joined room "${room}" on ${server}`));
    console.log(chalk.blue(`[🔐] Messages are encrypted end-to-end.\n`));

    // Start msg in background
    setInterval(async () => {
      try {
        const res = await axios.get(`${topicUrl}.json?since=${lastTime}`);
        const messages = res.data;
        for (const msg of messages) {
          lastTime = Math.max(lastTime, msg.time);
          const decrypted = decryptMessage(msg.message, password);
          if (decrypted) {
            console.log(chalk.cyan(`\n[🔓] ${decrypted}`));
          }
        }
      } catch (err) {
        console.log(chalk.red(`[!] Failed to fetch messages: ${err.message}`));
      }
    }, 4000);

    // Prompt user for messages
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
        console.log(chalk.gray('Sent.'));
      } catch (err) {
        console.log(chalk.red('[!] Failed to send message.'));
      }
    }
  });

program.parse(process.argv);

