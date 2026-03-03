const { c } = require('../log');
const { getVersion } = require('../../lib/config');

function getCliHelpText(pluginHelps = []) {
  const lines = [
    '',
    `${c.bold}${c.brightCyan}Diamond Soul Downloader${c.reset} ${c.dim}v${getVersion()} — dsoul CLI${c.reset}`,
    '',
    `${c.bold}Usage:${c.reset} dsoul ${c.gray}[command] [options] [args]${c.reset}   ${c.dim}(no args: starts web UI)${c.reset}`,
    '',
    `${c.bold}Commands:${c.reset}`,
    `  ${c.cyan}webstart${c.reset} ${c.gray}[port]${c.reset}            Start the web UI ${c.dim}(default port: 8148)${c.reset}`,
    `  ${c.cyan}config${c.reset} ${c.gray}[<key> [value]]${c.reset}     Set or view dsoul-provider, skills-folder, skills-folder-name`,
    `  ${c.cyan}install${c.reset} ${c.gray}[-g] [-y] [<cid-or-shortname>]${c.reset}  Install by CID/shortname, or from dsoul.json`,
    `  ${c.cyan}uninstall${c.reset} ${c.gray}<cid-or-shortname>${c.reset}  Uninstall a skill`,
    `  ${c.cyan}update${c.reset} ${c.gray}[-g] [--local]${c.reset}       Check for upgrades`,
    `  ${c.cyan}upgrade${c.reset} ${c.gray}[-g] [--local]${c.reset}      Upgrade skills to latest version`,
    `  ${c.cyan}init${c.reset} ${c.gray}<directory>${c.reset}            Create a folder with skill.md template`,
    `  ${c.cyan}package${c.reset} ${c.gray}<folder>${c.reset}            Package a folder as zip`,
    `  ${c.cyan}search${c.reset} ${c.gray}[query] [-n N] [--page=N]${c.reset}  Search the registry (no query: browse homepage)`,
    `  ${c.cyan}hash cidv0${c.reset} ${c.gray}<file>${c.reset}          Print CIDv0 (IPFS) hash of a file`,
    `  ${c.cyan}freeze${c.reset} ${c.gray}<file> [opts]${c.reset}       Stamp a file via DSOUL freeze API`,
    `  ${c.cyan}supercede${c.reset} ${c.gray}<post-id> <cid>${c.reset}  Mark a frozen file as superseded by a CID`,
    `  ${c.cyan}status${c.reset}                     Show current config and credential status`,
    `  ${c.cyan}balance${c.reset}                    Check stamp/credit balance`,
    `  ${c.cyan}files${c.reset} ${c.gray}[opts]${c.reset}               List your frozen files`,
    `  ${c.cyan}register${c.reset} ${c.gray}[-i] [user] [token]${c.reset}  Store WordPress credentials`,
    `  ${c.cyan}unregister${c.reset}                 Clear stored credentials`,
    `  ${c.cyan}plugin${c.reset} ${c.gray}list | install <name> [-y]${c.reset}  Manage plugins`,
    `  ${c.cyan}help${c.reset}                       Show this help`,
  ];

  if (pluginHelps.length > 0) {
    lines.push('');
    lines.push(`${c.bold}Plugin commands:${c.reset}`);
    for (const h of pluginHelps) {
      lines.push(`  ${c.cyan}${h.command}${c.reset} ${c.gray}${h.usage}${c.reset}  ${h.description}`);
    }
  }

  lines.push(
    '',
    `${c.bold}Options for install:${c.reset}`,
    `  ${c.yellow}-g${c.reset}    Install to configured skills folder`,
    `  ${c.yellow}-y${c.reset}    Auto-pick oldest entry when multiple DSOUL entries exist`,
    '',
    `${c.bold}Options for update / upgrade:${c.reset}`,
    `  ${c.yellow}-g${c.reset}        Global skills folder only`,
    `  ${c.yellow}--local${c.reset}   Local project skills folder only`,
    `  ${c.yellow}--delete-blocked${c.reset}     Delete all blocked items without prompting`,
    `  ${c.yellow}--no-delete-blocked${c.reset}  Do not delete blocked items`,
    '',
    `${c.bold}Options for freeze:${c.reset}`,
    `  ${c.yellow}--shortname=NAME${c.reset}    Register shortname ${c.gray}(username@NAME:version)${c.reset}`,
    `  ${c.yellow}--tags=tag1,tag2${c.reset}    Comma-separated tags`,
    `  ${c.yellow}--version=X.Y.Z${c.reset}     Version ${c.gray}(default: 1.0.0)${c.reset}`,
    `  ${c.yellow}--license_url=URL${c.reset}   URL to a license file`,
    `  ${c.yellow}--supercede=CID${c.reset}     CID (or Post ID) of the version this file replaces`,
    '',
    `${c.bold}Options for files:${c.reset}`,
    `  ${c.yellow}--page=N${c.reset}       Page number ${c.gray}(default: 1)${c.reset}`,
    `  ${c.yellow}--per_page=N${c.reset}   Items per page ${c.gray}(default: 100, max: 500)${c.reset}`,
  );

  for (const h of pluginHelps) {
    if (h.options && h.options.length > 0) {
      lines.push('');
      lines.push(`${c.bold}Options for ${h.command}:${c.reset}`);
      for (const opt of h.options) {
        lines.push(`  ${c.yellow}${opt.flag}${c.reset}   ${opt.description}`);
      }
    }
  }

  lines.push(
    '',
    `${c.bold}Environment:${c.reset}`,
    `  ${c.yellow}PORT${c.reset}              Port for webstart ${c.gray}(or use .env)${c.reset}`,
    `  ${c.yellow}DSOUL_SKILLS_FOLDER${c.reset}  Default skills folder`,
    `  ${c.yellow}DSOUL_DEBUG${c.reset}       Enable debug logging`,
    '',
  );

  return lines.join('\n');
}

module.exports = { getCliHelpText };
