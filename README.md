# Diamond Soul Downloader

A CLI tool and local web UI for installing, managing, and publishing AI skills via IPFS. Skills are markdown files fetched from IPFS gateways, verified by CID, and installed into a local folder where AI agents (Cursor, Claude, VS Code) can read them.

## Features

- **Multi-gateway download**: Downloads files from multiple public IPFS gateways simultaneously
- **File verification**: Compares files from different gateways and verifies hash matches CID
- **File organization**: Tag files for easy organization (tags work like folders)
- **File preview**: View file contents and verify CID
- **Reverification**: Re-verify files at any time
- **File management**: Delete files via right-click menu
- **Skills folder integration**: Activate/deactivate files to copy them to a local skills folder as {CID}.MD files
- **Options panel**: Configure the local skills folder path
- **CLI mode**: Install skills from the terminal by CID or shortname (`dsoul install`)

## Installation

1. Install dependencies:

```bash
npm install
```

## Usage

1. Start the application:

```bash
npm start
```

2. Enter an IPFS CID in the URL bar at the top and click "Load"

3. The app will:
   - Download the file from multiple IPFS gateways
   - Show progress for each gateway
   - Compare files from different gateways
   - Verify the calculated hash matches the CID
   - Save the file if all checks pass

4. Use the sidebar to:
   - View all loaded files organized by tags
   - Click a file to preview it
   - Right-click a file to delete or add tags

5. In the preview pane:
   - View file contents (read-only)
   - See the calculated CID
   - Click "Reverify" to re-run all verification steps

6. Activate/Deactivate files:
   - Right-click any file in the sidebar
   - Select "Activate" to copy the file to your skills folder as {CID}.MD
   - Select "Deactivate" to remove it from the skills folder
   - Active files are marked with a checkmark (✓) in the file tree

7. Configure skills folder:
   - Click "Options" button in the top bar
   - Set your local skills folder path (where AI agents look for skills)
   - Files activated from the file tree will be copied to this folder

## File Storage

Files are stored in the application's user data directory:

- Windows: `%APPDATA%/diamond-soul-downloader/ipfs-files/`
- macOS: `~/Library/Application Support/diamond-soul-downloader/ipfs-files/`
- Linux: `~/.config/diamond-soul-downloader/ipfs-files/`

Each file is stored as a JSON file containing the CID, content, tags, and metadata.

## CLI

You can install skills from the command line using the `dsoul` command. The CLI accepts either a **CID** (e.g. `QmXoypiz...`) or a **shortname** (e.g. `user@project:v1`); shortnames are resolved to CIDs via the configured shortname resolution host.

### Setting up the CLI in PATH

**Option 1: Link the project (development)**

From the project root:

```bash
npm link
```

This registers the `dsoul` binary globally. You can then run `dsoul install ...` from any directory.

To remove the link later:

```bash
npm unlink -g diamond-soul-downloader
```

**Option 2: Install the package globally**

If you publish the package or install from a path:

```bash
npm install -g /path/to/cid-skills
```

**Option 3: Use npx (no global install)**

```bash
npx diamond-soul-downloader install <cid-or-shortname>
```

**Option 4: Run the built exe with arguments**

If you use the packaged app (e.g. **dsoul.exe** on Windows), you can pass CLI arguments directly:

```bash
dsoul.exe install <cid-or-shortname>
```

**Option 5: Add dsoul.exe to PATH (no npm) — Windows**

If you downloaded `dsoul.exe` and don’t use npm, you can make it available globally.

**Quick setup (PowerShell, run as Administrator):**

```powershell
$dir = “C:\Program Files\dsoul”
New-Item -ItemType Directory -Force -Path $dir
Copy-Item .\dsoul.exe “$dir\dsoul.exe”
[Environment]::SetEnvironmentVariable(“Path”, $env:Path + “;$dir”, [System.EnvironmentVariableTarget]::Machine)
```

Open a new terminal and run `dsoul` — it should work from any directory.

**Manual setup (GUI):**

1. Move `dsoul.exe` to a permanent folder (e.g. `C:\Program Files\dsoul\`).
2. Open **Settings** → **System** → **About** → **Advanced system settings** (or search “environment variables”).
3. Click **Environment Variables**.
4. Under **User variables** or **System variables**, select **Path** → **Edit** → **New**, then paste the folder path (e.g. `C:\Program Files\dsoul`).
5. Confirm with **OK**, then open a new terminal and run `dsoul`.

**Option 6: Add dsoul to PATH on macOS/Linux (no npm)**

If you downloaded the pre-built binary and don’t use npm:

```bash
# macOS (place the binary in /usr/local/bin as ‘dsoul’)
sudo cp dsoul-mac-x64 /usr/local/bin/dsoul   # Intel
# or
sudo cp dsoul-mac-arm64 /usr/local/bin/dsoul  # Apple Silicon

chmod +x /usr/local/bin/dsoul

# Linux
sudo cp dsoul /usr/local/bin/dsoul
chmod +x /usr/local/bin/dsoul
```

If `/usr/local/bin` isn’t in your PATH, add `export PATH="/usr/local/bin:$PATH"` to `~/.zshrc` (or `~/.bash_profile`) and open a new terminal.

### Commands

Run **`dsoul help`** (or **`dsoul -h`** / **`dsoul --help`**) to list all commands and options.

**Install a skill**

```text
dsoul install [-g] [-y] <cid-or-shortname>
```

Blocked CIDs (from the provider blocklist) cannot be installed; the CLI will exit with an error.

- **&lt;cid-or-shortname&gt;**
  - A valid IPFS CIDv0 (e.g. `QmXoypiz...`) or `ipfs://Qm...`
  - Or a shortname (e.g. `user@project:v1`) if shortname resolution is configured

- **-g** (global)
  - **Present**: Install into the **configured Skills folder** (set in app Options or via `DSOUL_SKILLS_FOLDER`).
  - **Omitted**: Install into a folder named **`Skills`** in the **current working directory** (created if it doesn’t exist).

- **-y** (yes / non-interactive)
  - **Present**: When the CID has multiple Diamond Soul entries, do not prompt; automatically pick the **oldest** entry (by date).
  - **Omitted**: When there are multiple entries, show a numbered list (title, author, date, tags) and prompt to choose. In non-interactive mode (no TTY), the oldest entry is used.

**Set or view configuration**

```text
dsoul config <key> [value]
```

- **&lt;key&gt;** – One of:
  - **`dsoul-provider`** – Host only (e.g. `https://dsoul.org`). The app appends `/wp-json/diamond-soul/v1` for API calls.
  - **`skills-folder`** – Path where skills are installed when using **`install -g`**.
- **&lt;value&gt;** – If provided, the setting is updated. If omitted, the current value is printed (or `(not set)`).

Examples:

```bash
# Set DSOUL provider (host only; app adds /wp-json/diamond-soul/v1)
dsoul config dsoul-provider https://dsoul.org
dsoul config dsoul-provider https://donotreplace.com

# Set skills install folder (used by install -g)
dsoul config skills-folder /path/to/cursor/skills-cursor

# View current values
dsoul config dsoul-provider
dsoul config skills-folder
```

**Uninstall a skill**

```text
dsoul uninstall <cid-or-shortname>
```

Removes the skill from the app (and deactivates it from the skills folder if it was active). Accepts a CID or a shortname (resolved via the DSOUL API).

Examples:

```bash
dsoul uninstall user@project:v1
dsoul uninstall QmXoypiz...
```

**Update (check for upgrades) and blocklist**

```text
dsoul update [-g] [--local] [--delete-blocked | --no-delete-blocked]
```

Checks for upgrades for installed skills (does not install). Refreshes the **blocklist** from the DSOUL provider; the blocklist is also refreshed when it is older than 6 hours.

- **-g** – Global skills folder only.
- **--local** – Local project skills folder only.
- **--delete-blocked** – If any installed CIDs are on the blocklist, delete them without prompting.
- **--no-delete-blocked** – If any installed CIDs are on the blocklist, do not prompt and do not delete.

On every CLI command, installed skills are checked against the blocklist; if any match, a warning is printed. Blocked CIDs cannot be installed or upgraded to. When you run **update** without flags and there are blocked items installed, the CLI prompts: “Delete all blocked items? [y/N]:”.

**Upgrade (install latest versions)**

```text
dsoul upgrade [-g] [--local] [-y]
```

Uninstalls old versions and installs the latest. Uses the same scope as **update** (-g / --local). Upgrades to a CID that is on the blocklist are skipped. **-y** auto-confirms when multiple entries exist.

**Package a skill folder**

```text
dsoul package <folder>
```

Scans the folder for required files **`license.txt`** and **`skill.md`** (case-insensitive; e.g. `Skill.MD` is accepted). If either is missing, exits with an error. If both are present, creates a zip of the folder named **`<foldername>.zip`** in the parent of the folder (e.g. packaging `./my-skill` creates `./my-skill.zip`). The zip contains the folder’s contents under a single root directory with the folder name. Other files in the folder are included in the zip.

Examples:

```bash
dsoul package my-skill
dsoul package ./path/to/my-skill
```

**Freeze (stamp a file on DSOUL)**

```text
dsoul freeze <file> [--shortname=NAME] [--tags=tag1,tag2] [--version=X.Y.Z] [--license_url=URL]
```

Sends the file to the configured DSOUL server’s **freeze** endpoint to be stamped and receive an IPFS CID. Uses the credentials stored by **`dsoul register`** (Basic Auth). Required: **filename** plus exactly one of **cl_file** (physical file) or **content** (raw text). Supports:

- **File upload** (`.zip`, `.js`, `.css`): sent as `cl_file` multipart. For `.zip`, the bundle must contain `skill.md` and `license.txt` at the root (same as web uploader).
- **Content + filename** (`.md`, `.txt` or other): file contents are sent as `content` with `filename` using `application/x-www-form-urlencoded` (same as curl `-d`). Use this path for markdown and text so the request body reaches the server reliably on Windows/Electron.

Optional:

- **`--shortname=NAME`** – Request shortname registration. The server infers `username@NAME:version`. If the shortname is already taken or invalid, the request fails **before** any stamping or credit use.
- **`--tags=tag1,tag2`** – Comma-separated tags (hashtags).
- **`--version=X.Y.Z`** – Version (default: `1.0.0`). Highly recommended if using shortname.
- **`--license_url=URL`** – URL to a license file.

Examples:

```bash
dsoul freeze ./my-skill.zip
dsoul freeze ./script.js --shortname=my-tool --version=1.1.0 --tags=cli,tool
dsoul freeze manifest.txt --tags=manifest
```

**Check balance**

```text
dsoul balance
```

Uses the credentials stored by **`dsoul register`** to GET the configured DSOUL server’s **balance** endpoint. Prints your stamp/credit balance (`stamps`) and, if present, the full data from the underlying API (e.g. `PMCREDIT`, `last_updated`). Fails if credentials are not stored.

**List your frozen files**

```text
dsoul files [--page=N] [--per_page=N]
```

Uses the credentials stored by **`dsoul register`** to GET the configured DSOUL server’s **files** endpoint. Lists your frozen files with CID, title, date, shortnames, tags, and URL. Optional **`--page`** (default: 1) and **`--per_page`** (default: 100, max 500) for pagination.

**Register WordPress credentials**

```text
dsoul register
```

Stores your **WordPress username** and **application key** in the system’s secure storage (e.g. Windows Credential Manager, macOS Keychain). Other CLI commands use these credentials when needed.

- **Interactive:** If run in a terminal with a TTY, it will prompt for username and application key.
- **No TTY (e.g. Electron has no stdin):** Set **`DSOUL_USER`** and **`DSOUL_TOKEN`** (or **`DSOUL_APPLICATION_KEY`**) in the environment, then run `dsoul register`; it will use those values and not prompt. Example: `set DSOUL_USER=myuser&& set DSOUL_TOKEN=xxxx&& dsoul register` (Windows) or `DSOUL_USER=myuser DSOUL_TOKEN=xxxx dsoul register` (Unix).

**Unregister (clear credentials)**

```text
dsoul unregister
```

Removes the stored WordPress username and application key from secure storage.

**Help**

```text
dsoul help
```

Lists all CLI commands and options. You can also use `dsoul -h` or `dsoul --help`.

### Examples (install)

```bash
# Install by CID into ./Skills in the current directory
dsoul install QmXoypiz...

# Install by shortname into ./Skills
dsoul install user@project:v1

# Install into the configured global Skills folder (Options or DSOUL_SKILLS_FOLDER)
dsoul install -g user@project:v1
dsoul install -g QmXoypiz...

# Auto-pick oldest entry when multiple exist (no prompt)
dsoul install -y user@project:v1
dsoul install -g -y QmXoypiz...
```

### The `dsoul.json` manifest

When you run `dsoul install` in a project folder, dsoul creates (or updates) `skills/dsoul.json` (or `<skills-folder-name>/dsoul.json`). This file tracks the CIDs and shortnames of every skill installed in that project — similar to `package.json` in npm or `Gemfile.lock` in Bundler.

**You should commit `dsoul.json` to version control.** When a teammate clones your repo, they can reproduce the exact set of skills by running:

```bash
dsoul install   # reads dsoul.json and installs all listed skills
```

The file is plain JSON and human-readable:

```json
{
  "skills": [
    { "cid": "QmXoypiz...", "shortname": "user@project:v1" }
  ]
}
```

### Configuration

CLI behavior uses the same settings as the GUI. Configure them in the app (**Options** in the menu) or via environment variables where noted.

| Setting            | Description                                                                                                               | Env / Notes                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Skills folder**  | Where activated skills are deployed when using **-g**.                                                                    | `DSOUL_SKILLS_FOLDER` (overrides Options when set)                                              |
| **DSOUL provider** | Host only (e.g. `https://dsoul.org`). The app appends `/wp-json/diamond-soul/v1` for CID lookup, shortname resolution, and blocklist. | Leave empty to use `.env` or default (`https://dsoul.org`). Example: `https://donotreplace.com` |

**Blocklist:** The CLI fetches a blocklist of CIDs from the provider and caches it (refreshed on **update** or when older than 6 hours). Blocked CIDs cannot be installed or upgraded to; a warning is shown when any installed skill is on the blocklist.

**Notes:**

- Without **-g**, the CLI always uses `./Skills` in the current directory; the “Skills folder” setting is ignored.
- With **-g**, the Skills folder must be set (in Options or `DSOUL_SKILLS_FOLDER`), or the command will fail.

## IPFS Gateways

The app tries the following gateways in parallel:

- ipfs.io
- gateway.pinata.cloud
- cloudflare-ipfs.com
- dweb.link
- gateway.ipfs.io
