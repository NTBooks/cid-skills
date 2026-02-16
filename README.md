# Diamond Soul Downloader

An Electron application for viewing and managing IPFS files by CID (Content Identifier). The app downloads files from multiple IPFS gateways, verifies their integrity, and allows you to organize them with tags.

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

**Option 4: Run the built app with arguments**

If you use the packaged app (e.g. **DSoul.exe** on Windows), you can pass CLI arguments directly:

```bash
DSoul.exe install <cid-or-shortname>
```

**Option 5: Add the Windows .exe to PATH (no npm)**

If you use the built Windows app and don’t use npm, you can run the CLI from any folder by adding the app’s folder to your PATH:

1. Build the app (e.g. run `npm run dist:win` or download a release). The executable is **DSoul.exe**.
2. Note the folder that contains the .exe (e.g. `C:\Program Files\DSoul` if installed via the NSIS installer, or your project’s `dist\win-unpacked` folder if you only unpacked).
3. Add that folder to your PATH:
   - Open **Settings** → **System** → **About** → **Advanced system settings** (or search “environment variables”).
   - Click **Environment Variables**.
   - Under **User variables** or **System variables**, select **Path** → **Edit** → **New**, then paste the folder path (e.g. `C:\Program Files\DSoul`).
   - Confirm with **OK**.
4. Open a **new** Command Prompt or PowerShell and run:

```bash
DSoul.exe install <cid-or-shortname>
```

You can also create a short alias (e.g. `dsoul.cmd` that runs the exe with the same arguments) and put that script in a folder already on your PATH.

**Option 6: Run the built app from Terminal on macOS (no npm)**

If you use the built Mac app (`.app` bundle) and don’t use npm, you can run the CLI from Terminal:

1. Build the app (e.g. run `npm run dist:mac` or download a release). The app is **Diamond Soul Downloader.app**.
2. The executable inside the bundle is at **Diamond Soul Downloader.app/Contents/MacOS/Diamond Soul Downloader**. Run it with a full path, for example if the app is in Applications:

```bash
"/Applications/Diamond Soul Downloader.app/Contents/MacOS/Diamond Soul Downloader" install <cid-or-shortname>
```

3. To run it from any directory without typing the full path, create a symlink (e.g. as `dsoul`) in a folder that’s on your PATH (e.g. `/usr/local/bin`):

```bash
sudo ln -s "/Applications/Diamond Soul Downloader.app/Contents/MacOS/Diamond Soul Downloader" /usr/local/bin/dsoul
```

Then open a new Terminal and run:

```bash
dsoul install <cid-or-shortname>
```

If `/usr/local/bin` doesn’t exist, run `sudo mkdir -p /usr/local/bin`. If it isn’t in your PATH, add `export PATH="/usr/local/bin:$PATH"` to `~/.zshrc` (or `~/.bash_profile` on older Macs) and open a new Terminal.

### Commands

**Install a skill**

```text
dsoul install [-g] <cid-or-shortname>
```

- **&lt;cid-or-shortname&gt;**  
  - A valid IPFS CID (e.g. `QmXoypiz...`, `bafy...`) or `ipfs://Qm...`  
  - Or a shortname (e.g. `user@project:v1`) if shortname resolution is configured  

- **-g** (global)  
  - **Present**: Install into the **configured Skills folder** (set in app Options or via `DSOUL_SKILLS_FOLDER`).  
  - **Omitted**: Install into a folder named **`Skills`** in the **current working directory** (created if it doesn’t exist).

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

### Examples (install)

```bash
# Install by CID into ./Skills in the current directory
dsoul install QmXoypiz...

# Install by shortname into ./Skills
dsoul install user@project:v1

# Install into the configured global Skills folder (Options or DSOUL_SKILLS_FOLDER)
dsoul install -g user@project:v1
dsoul install -g QmXoypiz...
```

### Configuration

CLI behavior uses the same settings as the GUI. Configure them in the app (**Options** in the menu) or via environment variables where noted.

| Setting | Description | Env / Notes |
|--------|-------------|-------------|
| **Skills folder** | Where activated skills are deployed when using **-g**. | `DSOUL_SKILLS_FOLDER` (overrides Options when set) |
| **DSOUL provider** | Host only (e.g. `https://dsoul.org`). The app appends `/wp-json/diamond-soul/v1` for CID lookup and shortname resolution. | Leave empty to use `.env` or default (`https://dsoul.org`). Example: `https://donotreplace.com` |

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
