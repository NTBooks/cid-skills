#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { getVersion } = require('../lib/config');
const { ensureDataDir, loadSettings } = require('../lib/storage');
const { getBlocklist, getAllInstalledCids, printBlockedCidsWarning } = require('../lib/blocklist');
const { parseCID } = require('../lib/skills');
const log = require('../cli/log');
const { createUi } = require('../cli/ui-adapter');
const { createUiStore } = require('../cli/ui-store');
const { createCliRoot, e } = require('../cli/app');
const { animateHelpTitle } = require('../cli/logo');
const React = require('react');

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
    const local = rest.includes('--local');
    const yes = rest.includes('-y');
    const target = rest.find((a) => a !== '-g' && a !== '-y' && a !== '--local' && !a.startsWith('-'));
    if (target && String(target).trim()) return { command: 'install', target: String(target).trim(), global, local, yes };
    return { command: 'install', fromList: true, global, local, yes };
  }
  if (cmd === 'config') {
    const key = argv[argIndex];
    const value = argv[argIndex + 1];
    const validKeys = ['dsoul-provider', 'skills-folder', 'skills-folder-name'];
    if (!key) return { command: 'config' };
    if (!validKeys.includes(key)) return null;
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
  if (cmd === 'status') return { command: 'status' };
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
    const nonFlags = rest.filter((a) => !a.startsWith('-'));
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
    const directory = (argv[argIndex] || '').trim() || '.';
    return { command: 'init', directory };
  }
  if (cmd === 'rehydrate') {
    const rest = argv.slice(argIndex);
    const nonFlags = rest.filter((a) => !a.startsWith('-'));
    const contractAddress = (nonFlags[0] || '').trim();
    const folder = (nonFlags[1] || 'data').trim();
    const full = rest.includes('--full');
    if (!contractAddress) return null;
    return { command: 'rehydrate', contractAddress, folder, full };
  }
  if (cmd === 'plugin') {
    const sub = argv[argIndex];
    if (sub === 'list') return { command: 'plugin', subcommand: 'list' };
    if (sub === 'install') {
      const target = (argv[argIndex + 1] || '').trim();
      if (!target) return null;
      const rest = argv.slice(argIndex + 2);
      const yes = rest.includes('-y');
      const force = rest.includes('--force');
      return { command: 'plugin', subcommand: 'install', target, yes, force };
    }
    return null;
  }
  if (cmd === 'search') {
    const rest = argv.slice(argIndex);
    let page = 1;
    let limit = null;
    const nonFlags = [];
    for (let j = 0; j < rest.length; j++) {
      const a = rest[j];
      if (a.startsWith('--page=')) { page = parseInt(a.slice(7), 10) || 1; }
      else if (a === '-n' && rest[j + 1]) { limit = parseInt(rest[++j], 10) || null; }
      else if (a.startsWith('--limit=')) { limit = parseInt(a.slice(8), 10) || null; }
      else if (!a.startsWith('-')) { nonFlags.push(a); }
    }
    const query = nonFlags.join(' ').trim();
    return { command: 'search', query: query || null, page, limit };
  }
  return null;
}

function findPlugin(name) {
  const { getPluginsDir } = require('../cli/commands/plugin');
  const pluginsDir = getPluginsDir();
  const pluginDir = path.join(pluginsDir, name);
  const indexPath = path.join(pluginDir, 'index.js');
  const nmPath = path.join(pluginDir, 'node_modules');
  if (fs.existsSync(indexPath) && fs.existsSync(nmPath)) return indexPath;
  return null;
}

async function main(ui, cliArgs) {
  if (!cliArgs) {
    ui.fail('Invalid command. Run dsoul help for usage.');
    return false;
  }

  if (cliArgs.command === 'help') {
    const { getCliHelpText } = require('../cli/commands/help');
    const { getPluginsDir } = require('../cli/commands/plugin');
    await animateHelpTitle();
    const pluginHelps = [];
    try {
      const pluginsDir = getPluginsDir();
      const entries = fs.readdirSync(pluginsDir);
      for (const name of entries) {
        const pluginPath = findPlugin(name);
        if (!pluginPath) continue;
        try {
          const plugin = require(pluginPath);
          if (plugin && plugin.help) pluginHelps.push(plugin.help);
        } catch (_) {}
      }
    } catch (_) {}
    console.log(getCliHelpText(pluginHelps));
    return true;
  }
  if (cliArgs.command === 'version') {
    console.log(`${log.c.brightCyan}dsoul${log.c.reset} ${log.c.bold}${getVersion()}${log.c.reset}`);
    return true;
  }
  if (cliArgs.command === 'webstart') {
    const { runWebstart } = require('../cli/commands/webstart');
    try {
      await runWebstart(cliArgs.port, ui);
      return true;
    } catch (err) {
      ui.fail(err.message || String(err));
      return false;
    }
  }

  if (cliArgs.command === 'register') {
    const { runCliRegister } = require('../cli/commands/register');
    const ok = await runCliRegister(cliArgs, ui);
    return ok;
  }
  if (cliArgs.command === 'unregister') {
    const { runCliUnregister } = require('../cli/commands/register');
    const ok = await runCliUnregister(ui);
    return ok;
  }
  if (cliArgs.command === 'search') {
    const { runCliSearch } = require('../cli/commands/search');
    return await runCliSearch(cliArgs, ui);
  }

  let blocklist = null;
  if (cliArgs.command !== 'help') {
    const forceRefresh = cliArgs.command === 'update';
    blocklist = await getBlocklist(forceRefresh);
    if (process.env.DSOUL_DEBUG) {
      const cids = [...blocklist];
      ui.raw(`Blocklist (${cids.length} CIDs): ${cids.join(', ') || '(none)'}`);
    }
    const installed = await getAllInstalledCids();
    const blocked = installed.filter((i) => blocklist.has(i.cid));
    if (blocked.length > 0) {
      printBlockedCidsWarning([...new Set(blocked.map((b) => b.cid))]);
    }
  }

  if (cliArgs.command === 'status') {
    const { runCliStatus } = require('../cli/commands/status');
    return await runCliStatus(ui);
  }
  if (cliArgs.command === 'balance') {
    const { runCliBalance } = require('../cli/commands/balance');
    const ok = await runCliBalance(ui);
    return ok;
  }
  if (cliArgs.command === 'files') {
    const { runCliFiles } = require('../cli/commands/files');
    const ok = await runCliFiles(cliArgs, ui);
    return ok;
  }
  if (cliArgs.command === 'config') {
    const { runCliConfig } = require('../cli/commands/config');
    const ok = await runCliConfig(cliArgs.key, cliArgs.value, ui);
    return ok;
  }
  if (cliArgs.command === 'uninstall') {
    const { runCliUninstall } = require('../cli/commands/uninstall');
    await ensureDataDir();
    const ok = await runCliUninstall(cliArgs.target, ui);
    return ok;
  }
  if (cliArgs.command === 'install') {
    const { runCliInstall, runCliInstallFromList } = require('../cli/commands/install');
    const { resolveShortname } = require('../lib/dsoul-api');
    await ensureDataDir();
    if (cliArgs.fromList) {
      if (cliArgs.global) {
        ui.fail('Global list installs are not available.');
        return false;
      }
      const installBase = (await loadSettings()).skillsFolderName || 'skills';
      const skillsFolder = path.join(process.cwd(), installBase);
      const ok = await runCliInstallFromList(skillsFolder, { autoPickOldest: cliArgs.yes, blocklist }, ui);
      return ok;
    }
    let cid = parseCID(cliArgs.target);
    let shortnameData = null;
    if (!cid) {
      ui.step('Resolving shortname', ui.name(cliArgs.target));
      const resolved = await resolveShortname(cliArgs.target);
      if (!resolved.success) {
        ui.fail(resolved.error);
        return false;
      }
      cid = resolved.cid;
      shortnameData = resolved.data;
      ui.ok('Resolved to ' + ui.cid(cid));
    }
    if (shortnameData != null) {
      ui.info('Shortname resolution:');
      ui.raw(JSON.stringify(shortnameData, null, 2));
    }
    if (blocklist && blocklist.has(cid)) {
      ui.fail('Cannot install: CID ' + ui.cid(cid) + ' is on the blocklist.');
      return false;
    }
    const installBase = cliArgs.global ? null : (await loadSettings()).skillsFolderName || 'skills';
    const installOptions = cliArgs.global ? {} : { skillsFolder: path.join(process.cwd(), installBase) };
    if (cliArgs.yes) installOptions.autoPickOldest = true;
    const ok = await runCliInstall(cid, installOptions, cliArgs.target, ui);
    return ok;
  }
  if (cliArgs.command === 'init') {
    const { runCliInit } = require('../cli/commands/init');
    const ok = await runCliInit(cliArgs.directory, ui);
    return ok;
  }
  if (cliArgs.command === 'package') {
    const { runCliPackage } = require('../cli/commands/package');
    const ok = await runCliPackage(cliArgs.folder, ui);
    return ok;
  }
  if (cliArgs.command === 'update') {
    const { runCliUpdate } = require('../cli/commands/update');
    const ok = await runCliUpdate(cliArgs, blocklist, ui);
    return ok;
  }
  if (cliArgs.command === 'upgrade') {
    const { runCliUpgrade } = require('../cli/commands/upgrade');
    const ok = await runCliUpgrade(cliArgs, blocklist, ui);
    return ok;
  }
  if (cliArgs.command === 'freeze') {
    const { runCliFreeze } = require('../cli/commands/freeze');
    const ok = await runCliFreeze(cliArgs, ui);
    return ok;
  }
  if (cliArgs.command === 'hash' && cliArgs.subcommand === 'cidv0') {
    const { runCliHashCidv0 } = require('../cli/commands/hash');
    const ok = await runCliHashCidv0(cliArgs.file, ui);
    return ok;
  }
  if (cliArgs.command === 'plugin') {
    const { runCliPlugin } = require('../cli/commands/plugin');
    return runCliPlugin(cliArgs, ui);
  }
  if (cliArgs.command === 'rehydrate') {
    const pluginPath = findPlugin('dsoul-rehydrate');
    if (!pluginPath) {
      ui.fail('The rehydrate command requires the dsoul-rehydrate plugin.');
      ui.info('Activate it with: dsoul plugin install dsoul-rehydrate');
      return false;
    }
    let plugin;
    try {
      plugin = require(pluginPath);
    } catch (err) {
      ui.fail('Failed to load rehydrate plugin: ' + (err.message || err));
      return false;
    }
    // Pre-load settings and populate env so the plugin's lib/rehydrate code
    // (which calls loadDotEnv/loadSettings) works without dsoul's modules.
    const { loadDotEnv } = require('../lib/config');
    const { loadSettings, DEFAULT_RPC_BASE } = require('../lib/storage');
    const env = await loadDotEnv();
    for (const [key, val] of Object.entries(env)) {
      if (val != null && val !== '') process.env[key] = val;
    }
    if (!process.env.RPC_BASE) {
      const settings = await loadSettings();
      const fromSettings = (settings.rpcBase && String(settings.rpcBase).trim()) || '';
      process.env.RPC_BASE = fromSettings || DEFAULT_RPC_BASE;
    }
    const { runCliRehydrate } = require('../cli/commands/rehydrate');
    return plugin.run(cliArgs, ui, { runCliRehydrate });
  }

  ui.fail('Invalid command. Run dsoul help for usage.');
  return false;
}

async function run() {
  let cliArgs = getCliArgs();

  if (!cliArgs && process.argv.length <= 2) {
    cliArgs = { command: 'webstart', port: null };
  }

  // webstart is a long-running server process; Ink exits after rendering a stable
  // component with no pending interactions, which would kill the server. Always
  // use the console UI for webstart so output is printed directly and not lost.
  const isWebstart = cliArgs && cliArgs.command === 'webstart';
  const useInk = !isWebstart && Boolean(process.stdout.isTTY && !process.env.DSOUL_NO_TUI);
  const store = useInk ? createUiStore() : null;
  const ui = useInk ? createUi('ink', (ev) => store.pushEvent(ev)) : createUi('console');

  if (useInk) {
    try {
      const ink = await import('ink');
      const spinnerMod = await import('ink-spinner');
      const Spinner = spinnerMod.default || spinnerMod;
      const CliRoot = createCliRoot(ink, Spinner);
      const element = React.createElement(CliRoot, { store, command: cliArgs.command });
      ink.render(element);
    } catch (err) {
      // If Ink cannot be loaded (e.g. ESM/TLA issues), fall back to console-only UI.
    }
  }

  try {
    const ok = await main(ui, cliArgs);

    // For webstart, keep the process alive and let the HTTP server
    // and signal handlers control shutdown instead of forcing an exit here.
    if (cliArgs && cliArgs.command === 'webstart') {
      if (!ok) {
        // If webstart failed to start, exit with a non-zero code.
        process.exit(1);
      }
      return;
    }

    process.exit(ok ? 0 : 1);
  } catch (err) {
    ui.fail('Fatal error: ' + (err.message || err));
    // For webstart failures we still want a non-zero exit code.
    process.exit(1);
  }
}

run();
