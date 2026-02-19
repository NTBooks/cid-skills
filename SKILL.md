---
name: dsoul-cli
description: How to use the dsoul CLI (Diamond Soul Downloader) to install, manage, and freeze AI skills from IPFS/DSOUL. Use when the user asks how to use the CLI, run dsoul commands, install skills by CID, freeze files, or manage skills from the terminal.
---

# Using the dsoul CLI

The **dsoul** CLI is the command-line interface for the Diamond Soul Downloader. It installs and manages AI skills (from IPFS/DSOUL) and can stamp/freeze files via the DSOUL API.

## Invocation

From the project (or after `npm link` / global install):

```bash
dsoul <command> [options] [args]
# or: node bin/dsoul.js <command> [options] [args]
```

Help: `dsoul help` or `dsoul -h` or `dsoul --help`.

---

## Commands

### config

Set or view settings. Keys: `dsoul-provider`, `skills-folder`, `skills-folder-name`.

```bash
dsoul config dsoul-provider https://dsoul.org
dsoul config skills-folder /path/to/global/skills
dsoul config skills-folder-name Skills
dsoul config dsoul-provider   # view current value (no second arg)
```

### install

Install a skill by **CID** (e.g. `Qm...`, `b...`, `z...`) or **shortname** (resolved via DSOUL). Blocked CIDs (from the provider blocklist) cannot be installed.

```bash
dsoul install <cid-or-shortname>
dsoul install -g <cid-or-shortname>   # install to global skills folder
dsoul install -y <cid-or-shortname>   # auto-pick oldest when multiple DSOUL entries exist
```

Target can be raw CID, `ipfs://Qm.../...`, or a shortname the provider can resolve.

### uninstall

Remove an installed skill by CID or shortname.

```bash
dsoul uninstall <cid-or-shortname>
```

### update

Check for upgrades (does not install). Refreshes the blocklist from the DSOUL provider. By default checks both global and local skills folders. If any installed CIDs are on the blocklist, the CLI will prompt to delete them (or use flags to skip the prompt).

```bash
dsoul update
dsoul update -g                    # global skills folder only
dsoul update --local               # local project skills folder only
dsoul update --delete-blocked      # delete all blocked items without prompting
dsoul update --no-delete-blocked   # do not delete blocked items, do not prompt
```

### upgrade

Upgrade skills to latest (uninstall old, install latest). Uses same scope flags as `update`. Upgrades to a CID that is on the blocklist are skipped.

```bash
dsoul upgrade
dsoul upgrade -g
dsoul upgrade --local
dsoul upgrade -y          # non-interactive / auto-confirm
```

### init

Create a new skill folder with a blank `skill.md` (header template: name, description, author) and a `license.txt` containing "No License" by default. If you have run `dsoul register` and credentials are stored, the **author** field in `skill.md` is prepopulated with your username. Use this to scaffold a new skill.

```bash
dsoul init <directory>
```

The directory is created under the current working directory. The directory must not already exist, or must be empty.

### package

Package a folder (expects `license.txt` and `skill.md` or `SKILL.md`) as a zip for freezing.

```bash
dsoul package <folder>
```

### hash cidv0

Print the CIDv0 (IPFS) hash of a file to stdout.

```bash
dsoul hash cidv0 <file>
```

### freeze

Stamp a file (zip, js, css, md, txt, etc.) via the DSOUL freeze API. Requires prior `dsoul register`.

```bash
dsoul freeze <file>
dsoul freeze my-skill.zip --shortname=myskill --version=1.0.0 --tags=skill,cursor
```

Freeze options:

| Option | Description |
|--------|-------------|
| `--shortname=NAME` | Register shortname (username@NAME:version); fails if taken |
| `--tags=tag1,tag2` | Comma-separated tags |
| `--version=X.Y.Z` | Version (default: 1.0.0) |
| `--license_url=URL` | URL to a license file |

### balance

Check stamp/credit balance (uses stored credentials from `register`).

```bash
dsoul balance
```

### files

List your frozen files. Uses stored credentials.

```bash
dsoul files
dsoul files --page=2 --per_page=50
```

Options: `--page=N` (default 1), `--per_page=N` (default 100, max 500).

### register / unregister

Store or clear WordPress username and application key (secure storage).

```bash
dsoul register    # prompts for credentials
dsoul unregister  # clear stored credentials
```

---

## Blocklist

The CLI fetches a **blocklist** of CIDs from the DSOUL provider (`/wp-json/diamond-soul/v1/blocklist`). The list is cached locally and refreshed when it is older than 6 hours or when you run **`dsoul update`**.

- **On every command**: Installed skills (global and local) are checked against the blocklist. If any match, a prominent warning is printed to stderr listing those CIDs.
- **Install**: Installing a blocked CID is refused with an error.
- **Upgrade**: Upgrading to a blocked CID is skipped (that upgrade is not offered).
- **Update**: If blocked CIDs are installed, the CLI can prompt to delete them. Use **`--delete-blocked`** to delete without prompting, or **`--no-delete-blocked`** to skip the prompt and not delete.

---

## Flow summary

1. **First-time auth**: `dsoul register` (then use `balance`, `files`, `freeze` as needed).
2. **Config (optional)**: `dsoul config dsoul-provider ...`, `dsoul config skills-folder ...`.
3. **Install skills**: `dsoul install <cid-or-shortname>` (use `-g` for global, `-y` to auto-pick when multiple entries).
4. **Check/upgrade**: `dsoul update` then `dsoul upgrade` (use `-g` or `--local` to limit scope).
5. **Scaffold a skill**: `dsoul init <directory>` then edit `skill.md` and `license.txt`; **package and freeze**: `dsoul package <folder>` then `dsoul freeze <file.zip> [options]`.

---

## Environment

- **DSOUL_SKILLS_FOLDER**: Overrides global skills folder if set (and not overridden by config).
- **DSOUL_DEBUG**: If set, the CLI prints blocklist API URL, raw response, and parsed count to stderr (for debugging only).
- Provider can be set via `dsoul config dsoul-provider` or app settings (GUI).

---

## Notes

- CLI is alpha; disclaimer is printed to stderr.
- Open source: https://github.com/NTBooks/cid-skills
- Invalid or unknown commands print "Invalid command." and exit non-zero; use `dsoul help` for usage.
