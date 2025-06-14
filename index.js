#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import axios from 'axios';
import chalk from 'chalk';
import CryptoJS from 'crypto-js';

const program = new Command();
program.version('1.0.0');

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

    console.log(chalk.green(`\n[+] Joined room "${room}" on ${server}`));
    console.log(chalk.blue(`[🔐] Messages will be encrypted with your password.\n`));

    // Start sending loop
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
        await axios.post(`${server}/${room}`, encrypted);
        console.log(chalk.gray('Sent encrypted message.'));
      } catch (err) {
        console.log(chalk.red('[!] Failed to send message. Server error.'));
      }
    }
  });

program.parse(process.argv);
