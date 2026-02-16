#!/usr/bin/env node
const path = require('path');
const { spawn } = require('child_process');

const electron = require('electron');
const appPath = path.join(__dirname, '..');
const args = [appPath, ...process.argv.slice(2)];
const child = spawn(electron, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code != null ? code : 0));
