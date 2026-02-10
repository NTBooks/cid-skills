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

## IPFS Gateways

The app tries the following gateways in parallel:
- ipfs.io
- gateway.pinata.cloud
- cloudflare-ipfs.com
- dweb.link
- gateway.ipfs.io
