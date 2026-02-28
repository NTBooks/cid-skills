#!/usr/bin/env node
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const electron = require('electron');
const appPath = path.join(__dirname, '..');
const args = [appPath, ...process.argv.slice(2)];
const cmd = process.argv[2];

function askLine(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve((answer || '').trim()));
  });
}

async function promptRegisterEnv() {
  if (process.argv[3] === '-i') return process.env;
  let username = (process.env.DSOUL_USER || '').trim();
  let token = (process.env.DSOUL_TOKEN || process.env.DSOUL_APPLICATION_KEY || '').trim();
  const argUser = (process.argv[3] || '').trim();
  const argToken = (process.argv[4] || '').trim();
  if (argUser && argToken) {
    username = argUser;
    token = argToken;
  }
  if (username && token) return { ...process.env, DSOUL_USER: username, DSOUL_TOKEN: token };
  if (!process.stdin.isTTY) return process.env;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const u = await askLine(rl, 'WordPress username: ');
  if (!u) { rl.close(); return process.env; }
  const t = await askLine(rl, 'Application key: ');
  rl.close();
  if (!t) return process.env;
  return { ...process.env, DSOUL_USER: u, DSOUL_TOKEN: t };
}

async function main() {
  let env = process.env;
  if (cmd === 'register') {
    env = await promptRegisterEnv();
  }
  const child = spawn(electron, args, { stdio: 'inherit', env });
  child.on('exit', (code) => process.exit(code != null ? code : 0));
}

main();
