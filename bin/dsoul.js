#!/usr/bin/env node

const path = require('path');
const { getVersion } = require('../lib/config');
const { ensureDataDir, loadSettings } = require('../lib/storage');
const { getBlocklist, getAllInstalledCids, printBlockedCidsWarning } = require('../lib/blocklist');
const { parseCID } = require('../lib/skills');
const log = require('../cli/log');
const { animateFloat, printStatic, animateHelpTitle } = require('../cli/logo');

function getCliArgs() {
  const argv = process.argv;
  const cmdIndex = 2;
  const argIndex = cmdIndex + 1;
  const cmd = argv[cmdIndex];
  if (cmd === 'webstart') {
    const port = argv[argIndex] ? parseInt(argv[argIndex], 10) : null;
    return { command: 'webstart', port: port || null };
  }
  if (cmd === 'install') {
    const rest = argv.slice(argIndex);
    const global = rest.includes('-g');
    const yes = rest.includes('-y');
    const target = rest.find((a) => a !== '-g' && a !== '-y' && !a.startsWith('-'));
    if (target && String(target).trim()) return { command: 'install', target: String(target).trim(), global, yes };
    return { command: 'install', fromList: true, global, yes };
  }
  if (cmd === 'config') {
    const key = argv[argIndex];
    const value = argv[argIndex + 1];
    const validKeys = ['dsoul-provider', 'skills-folder', 'skills-folder-name'];
    if (!key || !validKeys.includes(key)) return null;
    return { command: 'config', key, value: value != null ? String(value).trim() : undefined };
  }
  if (cmd === 'uninstall') {
    const target = (argv[argIndex] || '').trim();
    if (!target) return null;
    return { command: 'uninstall', target };
  }
  if (cmd === 'package') {
    const folder = (argv[argIndex] || '').trim();
    if (!folder) return null;
    return { command: 'package', folder };
  }
  if (cmd === 'register') {
    const rest = argv.slice(argIndex);
    if (rest[0] === '-i') return { command: 'register', statusOnly: true };
    const u = rest[0]; const t = rest[1];
    if (u && t && !String(u).startsWith('-') && !String(t).startsWith('-')) {
      return { command: 'register', username: String(u).trim(), token: String(t).trim() };
    }
    return { command: 'register' };
  }
  if (cmd === 'unregister') return { command: 'unregister' };
  if (cmd === 'help' || cmd === '-h' || cmd === '--help') return { command: 'help' };
  if (cmd === '--version' || cmd === '-V') return { command: 'version' };
  if (cmd === 'update') {
    const rest = argv.slice(argIndex);
    const globalOnly = rest.includes('-g');
    const localOnly = rest.includes('--local');
    let deleteBlocked;
    if (rest.includes('--delete-blocked')) deleteBlocked = true;
    else if (rest.includes('--no-delete-blocked')) deleteBlocked = false;
    return { command: 'update', globalOnly, localOnly, deleteBlocked };
  }
  if (cmd === 'upgrade') {
    const rest = argv.slice(argIndex);
    const globalOnly = rest.includes('-g');
    const localOnly = rest.includes('--local');
    const yes = rest.includes('-y');
    return { command: 'upgrade', globalOnly, localOnly, yes };
  }
  if (cmd === 'balance') return { command: 'balance' };
  if (cmd === 'files') {
    const rest = argv.slice(argIndex);
    const opts = { page: 1, per_page: 100 };
    rest.forEach((a) => {
      if (a.startsWith('--page=')) opts.page = parseInt(a.slice(7), 10) || 1;
      else if (a.startsWith('--per_page=')) opts.per_page = parseInt(a.slice(11), 10) || 100;
    });
    return { command: 'files', ...opts };
  }
  if (cmd === 'freeze') {
    const rest = argv.slice(argIndex);
    const nonFlags = rest.filter((a) => !a.startsWith('--'));
    const file = nonFlags.length ? nonFlags.join(' ').trim() : '';
    if (!file) return null;
    const opts = { file };
    rest.forEach((a) => {
      if (a.startsWith('--shortname=')) opts.shortname = a.slice(12).trim();
      else if (a.startsWith('--tags=')) opts.tags = a.slice(7).trim();
      else if (a.startsWith('--version=')) opts.version = a.slice(10).trim();
      else if (a.startsWith('--license_url=')) opts.license_url = a.slice(14).trim();
    });
    return { command: 'freeze', ...opts };
  }
  if (cmd === 'hash') {
    const sub = argv[argIndex];
    const file = (argv[argIndex + 1] || '').trim();
    if (sub === 'cidv0' && file) return { command: 'hash', subcommand: 'cidv0', file };
    return null;
  }
  if (cmd === 'init') {
    const directory = (argv[argIndex] || '').trim();
    if (!directory) return null;
    return { command: 'init', directory };
  }
  return null;
}

async function main() {
  const cliArgs = getCliArgs();

  if (!cliArgs && process.argv.length <= 2) {
    const { getCliHelpText } = require('../cli/commands/help');
    console.log(getCliHelpText());
    process.exit(0);
    return;
  }

  if (!cliArgs) {
    log.fail('Invalid command. Run ' + log.c.bold + 'dsoul help' + log.c.reset + ' for usage.');
    process.exit(1);
    return;
  }

  if (cliArgs.command === 'help') {
    const { getCliHelpText } = require('../cli/commands/help');
    await animateHelpTitle();
    console.log(getCliHelpText());
    process.exit(0);
    return;
  }
  if (cliArgs.command === 'version') {
    console.log(`${log.c.brightCyan}dsoul${log.c.reset} ${log.c.bold}${getVersion()}${log.c.reset}`);
    process.exit(0);
    return;
  }
  if (cliArgs.command === 'webstart') {
    const { runWebstart } = require('../cli/commands/webstart');
    try {
      await runWebstart(cliArgs.port);
    } catch (_) {
      process.exit(1);
    }
    return;
  }

  if (cliArgs.command === 'register') {
    const { runCliRegister } = require('../cli/commands/register');
    const ok = await runCliRegister(cliArgs);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs.command === 'unregister') {
    const { runCliUnregister } = require('../cli/commands/register');
    const ok = await runCliUnregister();
    process.exit(ok ? 0 : 1);
    return;
  }

  let blocklist = null;
  if (cliArgs.command !== 'help') {
    const forceRefresh = cliArgs.command === 'update';
    blocklist = await getBlocklist(forceRefresh);
    if (process.env.DSOUL_DEBUG) {
      const cids = [...blocklist];
      log.dim(`Blocklist (${cids.length} CIDs): ${cids.join(', ') || '(none)'}`);
    }
    const installed = await getAllInstalledCids();
    const blocked = installed.filter((i) => blocklist.has(i.cid));
    if (blocked.length > 0) {
      printBlockedCidsWarning([...new Set(blocked.map((b) => b.cid))]);
    }
  }

  if (cliArgs.command === 'balance') {
    const { runCliBalance } = require('../cli/commands/balance');
    const ok = await runCliBalance();
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs.command === 'files') {
    const { runCliFiles } = require('../cli/commands/files');
    const ok = await runCliFiles(cliArgs);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs.command === 'config') {
    const { runCliConfig } = require('../cli/commands/config');
    const ok = await runCliConfig(cliArgs.key, cliArgs.value);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs.command === 'uninstall') {
    const { runCliUninstall } = require('../cli/commands/uninstall');
    await ensureDataDir();
    const ok = await runCliUninstall(cliArgs.target);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs.command === 'install') {
    const { runCliInstall, runCliInstallFromList } = require('../cli/commands/install');
    const { resolveShortname } = require('../lib/dsoul-api');
    await ensureDataDir();
    if (cliArgs.fromList) {
      if (cliArgs.global) { log.fail('Global list installs are not available.'); process.exit(1); return; }
      const installBase = (await loadSettings()).skillsFolderName || 'Skills';
      const skillsFolder = path.join(process.cwd(), installBase);
      const ok = await runCliInstallFromList(skillsFolder, { autoPickOldest: cliArgs.yes, blocklist });
      process.exit(ok ? 0 : 1);
      return;
    }
    let cid = parseCID(cliArgs.target);
    let shortnameData = null;
    if (!cid) {
      log.step('Resolving shortname', log.name(cliArgs.target));
      const resolved = await resolveShortname(cliArgs.target);
      if (!resolved.success) { log.fail(resolved.error); process.exit(1); return; }
      cid = resolved.cid;
      shortnameData = resolved.data;
      log.ok(`Resolved to ${log.cid(cid)}`);
    }
    if (shortnameData != null) {
      log.info('Shortname resolution:');
      console.log(JSON.stringify(shortnameData, null, 2));
    }
    if (blocklist && blocklist.has(cid)) { log.fail(`Cannot install: CID ${log.cid(cid)} is on the blocklist.`); process.exit(1); return; }
    const installBase = cliArgs.global ? null : (await loadSettings()).skillsFolderName || 'Skills';
    const installOptions = cliArgs.global ? {} : { skillsFolder: path.join(process.cwd(), installBase) };
    if (cliArgs.yes) installOptions.autoPickOldest = true;
    const ok = await runCliInstall(cid, installOptions, cliArgs.target);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs.command === 'init') {
    const { runCliInit } = require('../cli/commands/init');
    const ok = await runCliInit(cliArgs.directory);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs.command === 'package') {
    const { runCliPackage } = require('../cli/commands/package');
    const ok = await runCliPackage(cliArgs.folder);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs.command === 'update') {
    const { runCliUpdate } = require('../cli/commands/update');
    const ok = await runCliUpdate(cliArgs, blocklist);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs.command === 'upgrade') {
    const { runCliUpgrade } = require('../cli/commands/upgrade');
    const ok = await runCliUpgrade(cliArgs, blocklist);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs.command === 'freeze') {
    const { runCliFreeze } = require('../cli/commands/freeze');
    const ok = await runCliFreeze(cliArgs);
    process.exit(ok ? 0 : 1);
    return;
  }
  if (cliArgs.command === 'hash' && cliArgs.subcommand === 'cidv0') {
    const { runCliHashCidv0 } = require('../cli/commands/hash');
    const ok = await runCliHashCidv0(cliArgs.file);
    process.exit(ok ? 0 : 1);
    return;
  }

  log.fail('Invalid command. Run ' + log.c.bold + 'dsoul help' + log.c.reset + ' for usage.');
  process.exit(1);
}

main().catch((err) => {
  log.fail('Fatal error:', err.message || err);
  process.exit(1);
});
