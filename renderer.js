// Default IPFS gateways when none configured in options
const DEFAULT_IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.ipfs.io/ipfs/'
];

// Maximum file size for skills files (2MB) - reasonable limit for text files
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB in bytes

/** True if content looks like binary (e.g. image) rather than text. Used to avoid treating binary as a skill. */
function isLikelyBinaryContent(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) return false;
  const bytes = new Uint8Array(arrayBuffer);
  const len = Math.min(bytes.length, 8192);
  for (let i = 0; i < len; i++) {
    if (bytes[i] === 0) return true;
  }
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
  const replacementCount = (decoded.match(/\uFFFD/g) || []).length;
  if (replacementCount > decoded.length * 0.05) return true;
  return false;
}

// Parse YAML frontmatter from skill file, or infer from markdown
function parseSkillHeader(content) {
  if (typeof content !== 'string') return null;
  // First, try to parse YAML frontmatter
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = content.match(frontmatterRegex);
  
  if (match) {
    // Has frontmatter, parse it
    const frontmatter = match[1];
    const metadata = {};
    
    // Parse key-value pairs
    const lines = frontmatter.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      
      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();
      
      // Try to parse JSON for metadata field first (before removing quotes)
      if (key === 'metadata' && (value.startsWith('{') || value.startsWith('['))) {
        try {
          // Remove outer quotes if present before parsing
          let jsonValue = value;
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            jsonValue = value.slice(1, -1);
          }
          value = JSON.parse(jsonValue);
        } catch (e) {
          // Keep as string if JSON parse fails
        }
      } else {
        // Remove quotes if present for other fields
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
      }
      
      metadata[key] = value;
    }
    
    // Validate it's a skill (must have name)
    if (!metadata.name) {
      return null;
    }
    
    return metadata;
  }
  
  // No frontmatter found, try to infer from markdown structure
  return inferMetadataFromMarkdown(content);
}

// Infer skill metadata from markdown structure
function inferMetadataFromMarkdown(content) {
  const metadata = {};
  
  // Extract name from first H1 heading
  // Patterns: "# Name", "# Persona: Name", "# Skill: Name", etc.
  const h1Match = content.match(/^#+\s*(?:Persona|Skill|Agent|Assistant)?:?\s*(.+?)(?:\s*\([^)]+\))?\s*$/m);
  if (h1Match) {
    let name = h1Match[1].trim();
    // Remove parentheticals like "(M'lady Edition)" for the name
    name = name.replace(/\s*\([^)]+\)\s*$/, '').trim();
    metadata.name = name;
  } else {
    // Try simpler H1 pattern
    const simpleH1Match = content.match(/^#\s+(.+)$/m);
    if (simpleH1Match) {
      let name = simpleH1Match[1].trim();
      // Remove parentheticals
      name = name.replace(/\s*\([^)]+\)\s*$/, '').trim();
      metadata.name = name;
    }
  }
  
  // Extract description from first paragraph or first H2 section
  // Look for text after the first heading and before the next heading
  const firstHeadingEnd = content.indexOf('\n', content.indexOf('#'));
  if (firstHeadingEnd !== -1) {
    const afterFirstHeading = content.substring(firstHeadingEnd + 1);
    // Find the next heading or section break
    const nextHeading = afterFirstHeading.search(/^#{1,2}\s+/m);
    const firstSection = nextHeading !== -1 
      ? afterFirstHeading.substring(0, nextHeading)
      : afterFirstHeading.substring(0, 500); // Limit to first 500 chars
    
    // Extract first meaningful paragraph
    const paragraphs = firstSection.split('\n\n').filter(p => {
      const trimmed = p.trim();
      return trimmed.length > 20 && !trimmed.startsWith('#') && !trimmed.startsWith('*') && !trimmed.startsWith('-');
    });
    
    if (paragraphs.length > 0) {
      let description = paragraphs[0].trim();
      // Clean up markdown formatting
      description = description.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '');
      // Limit description length
      if (description.length > 200) {
        description = description.substring(0, 197) + '...';
      }
      metadata.description = description;
    }
  }
  
  // Try to extract version if mentioned
  const versionMatch = content.match(/version[:\s]+([\d.]+)/i);
  if (versionMatch) {
    metadata.version = versionMatch[1];
  }
  
  // Only return metadata if we found a name
  if (metadata.name) {
    return metadata;
  }
  
  return null;
}

let currentFile = null;
let fileContextMenuCid = null;
let currentSettings = null;

function normalizePathForCompare(p) {
  return (p || '').replace(/\\/g, '/').trim().toLowerCase();
}

function isLocalInstall(file) {
  if (!file || !file.activatedSkillsFolder) return false;
  const configured = (currentSettings && currentSettings.skillsFolder) || '';
  if (!configured) return true;
  return normalizePathForCompare(file.activatedSkillsFolder) !== normalizePathForCompare(configured);
}

function isPathTag(tag) {
  return typeof tag === 'string' && (tag.includes('/') || tag.includes('\\'));
}
let currentLoadCid = null;
let isLoading = false;
/** Map of local file CID -> next_cid from API when scan finds an update */
let nextCidsByCid = new Map();
/** Map of CID -> raw DSOUL API response (for "View full JSON") */
let dsoulApiResponseByCid = new Map();

// Fix CLVerify image URLs to use local images
function fixCLVerifyImages(container) {
  const scope = container || document;
  
  // Fix button icon (CL-Glyph-Icon.png)
  const icons = scope.querySelectorAll('.clv-icon, .clv-inline-icon');
  icons.forEach(img => {
    if (img.src && img.src.includes('CL-Glyph-Icon.png')) {
      img.src = 'Skills/clverify-2025-02-09-1/clverify/CL-Glyph-Icon.png';
    }
  });
  
  // Fix modal logo (CL-Logo-White-Semitransparent-500.png)
  const logos = scope.querySelectorAll('.clv-logo');
  logos.forEach(img => {
    if (img.src && img.src.includes('CL-Logo-White-Semitransparent-500.png')) {
      img.src = 'Skills/clverify-2025-02-09-1/clverify/CL-Logo-White-Semitransparent-500.png';
    }
  });
  
  // Also fix images that might be created dynamically
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          if (node.tagName === 'IMG') {
            if (node.src && node.src.includes('CL-Glyph-Icon.png')) {
              node.src = 'Skills/clverify-2025-02-09-1/clverify/CL-Glyph-Icon.png';
            } else if (node.src && node.src.includes('CL-Logo-White-Semitransparent-500.png')) {
              node.src = 'Skills/clverify-2025-02-09-1/clverify/CL-Logo-White-Semitransparent-500.png';
            }
          }
          // Check child images
          const childIcons = node.querySelectorAll && node.querySelectorAll('.clv-icon, .clv-inline-icon, .clv-logo');
          if (childIcons) {
            childIcons.forEach(img => {
              if (img.src && img.src.includes('CL-Glyph-Icon.png')) {
                img.src = 'Skills/clverify-2025-02-09-1/clverify/CL-Glyph-Icon.png';
              } else if (img.src && img.src.includes('CL-Logo-White-Semitransparent-500.png')) {
                img.src = 'Skills/clverify-2025-02-09-1/clverify/CL-Logo-White-Semitransparent-500.png';
              }
            });
          }
        }
      });
    });
  });
  
  observer.observe(scope, { childList: true, subtree: true });
  
  // Clean up observer after a delay (images should be loaded by then)
  setTimeout(() => observer.disconnect(), 5000);
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadFileTree();
  setupEventListeners();
  
  // Set up global observer to fix CLVerify images as they're added to the DOM
  const globalObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          // Fix images directly added
          if (node.tagName === 'IMG') {
            if (node.src && node.src.includes('CL-Glyph-Icon.png')) {
              node.src = 'Skills/clverify-2025-02-09-1/clverify/CL-Glyph-Icon.png';
            } else if (node.src && node.src.includes('CL-Logo-White-Semitransparent-500.png')) {
              node.src = 'Skills/clverify-2025-02-09-1/clverify/CL-Logo-White-Semitransparent-500.png';
            }
          }
          // Fix images in CLVerify elements (including inline links)
          if (node.classList && (node.classList.contains('clv-modal') || node.classList.contains('clv-btn') || node.classList.contains('clv-header') || node.classList.contains('clv-inline-link'))) {
            setTimeout(() => fixCLVerifyImages(node), 50);
          }
          // Check for CLVerify classes in children
          const clvElements = node.querySelectorAll && node.querySelectorAll('.clv-icon, .clv-inline-icon, .clv-logo, .clv-modal, .clv-btn, .clv-inline-link');
          if (clvElements && clvElements.length > 0) {
            setTimeout(() => fixCLVerifyImages(node), 50);
          }
        }
      });
    });
  });
  
  globalObserver.observe(document.body, { childList: true, subtree: true });
  
  // Also fix any existing images immediately
  setTimeout(() => fixCLVerifyImages(document), 500);
});

function setupEventListeners() {
  const loadBtn = document.getElementById('load-btn');
  const cidInput = document.getElementById('cid-input');
  const reverifyBtn = document.getElementById('reverify-btn');
  const contextMenu = document.getElementById('context-menu');
  const deleteFileBtn = document.getElementById('delete-file');
  const addTagBtn = document.getElementById('add-tag');
  const tagModal = document.getElementById('tag-modal');
  const tagSubmit = document.getElementById('tag-submit');
  const tagCancel = document.getElementById('tag-cancel');
  const tagInput = document.getElementById('tag-input');

  loadBtn.addEventListener('click', handleLoad);
  cidInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleLoad();
    }
  });

  reverifyBtn.addEventListener('click', handleReverify);

  // Cancel load button
  const cancelLoadBtn = document.getElementById('cancel-load-btn');
  cancelLoadBtn.addEventListener('click', handleCancelLoad);

  // Context menu
  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
      contextMenu.classList.add('hidden');
    }
  });

  deleteFileBtn.addEventListener('click', handleDeleteFile);
  addTagBtn.addEventListener('click', () => {
    contextMenu.classList.add('hidden');
    tagModal.classList.remove('hidden');
    tagInput.value = '';
    setTimeout(() => tagInput.focus(), 0);
  });

  tagSubmit.addEventListener('click', handleAddTag);
  tagCancel.addEventListener('click', () => {
    tagModal.classList.add('hidden');
    tagInput.value = '';
  });

  tagInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAddTag();
    }
  });

  // Options panel
  const optionsBtn = document.getElementById('options-btn');
  const optionsModal = document.getElementById('options-modal');
  const optionsSave = document.getElementById('options-save');
  const optionsCancel = document.getElementById('options-cancel');
  const browseFolderBtn = document.getElementById('browse-folder-btn');
  const skillsFolderInput = document.getElementById('skills-folder-input');
  const skillsFolderNameInput = document.getElementById('skills-folder-name-input');
  const dsoulProviderInput = document.getElementById('dsoul-provider-input');
  const toggleActiveBtn = document.getElementById('toggle-active');

  const ipfsGatewaysList = document.getElementById('ipfs-gateways-list');
  const addIpfsGatewayBtn = document.getElementById('add-ipfs-gateway-btn');

  function renderIpfsGateways(urls) {
    if (!ipfsGatewaysList) return;
    ipfsGatewaysList.innerHTML = '';
    const list = Array.isArray(urls) && urls.length > 0 ? urls : DEFAULT_IPFS_GATEWAYS.slice();
    list.forEach((url) => {
      const row = document.createElement('div');
      row.className = 'ipfs-gateway-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'https://ipfs.io/ipfs/';
      input.value = url;
      input.classList.add('ipfs-gateway-url');
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-gateway-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        row.remove();
      });
      row.appendChild(input);
      row.appendChild(removeBtn);
      ipfsGatewaysList.appendChild(row);
    });
  }

  addIpfsGatewayBtn.addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'ipfs-gateway-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'https://ipfs.io/ipfs/';
    input.classList.add('ipfs-gateway-url');
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-gateway-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => row.remove());
    row.appendChild(input);
    row.appendChild(removeBtn);
    ipfsGatewaysList.appendChild(row);
  });

  optionsBtn.addEventListener('click', async () => {
    await loadSettings();
    skillsFolderInput.value = currentSettings?.skillsFolder || '';
    skillsFolderNameInput.value = currentSettings?.skillsFolderName ?? 'Skills';
    dsoulProviderInput.value = currentSettings?.dsoulProviderUrl || '';
    renderIpfsGateways(currentSettings?.ipfsGateways);
    optionsModal.classList.remove('hidden');
  });

  optionsCancel.addEventListener('click', () => {
    optionsModal.classList.add('hidden');
  });

  optionsSave.addEventListener('click', async () => {
    const gatewayInputs = ipfsGatewaysList ? ipfsGatewaysList.querySelectorAll('.ipfs-gateway-url') : [];
    const ipfsGateways = Array.from(gatewayInputs)
      .map((el) => (el.value || '').trim())
      .filter((s) => s.length > 0);
    if (ipfsGateways.length === 0) {
      alert('At least one IPFS gateway is required.');
      return;
    }
    const folderName = (skillsFolderNameInput.value || '').trim();
    const settings = {
      skillsFolder: skillsFolderInput.value,
      skillsFolderName: folderName || 'Skills',
      dsoulProviderUrl: (dsoulProviderInput.value || '').trim(),
      ipfsGateways
    };
    const result = await window.electronAPI.saveSettings(settings);
    if (result.success) {
      currentSettings = settings;
      optionsModal.classList.add('hidden');
    } else {
      alert('Error saving settings: ' + result.error);
    }
  });

  browseFolderBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.selectFolder();
    if (result.success) {
      skillsFolderInput.value = result.path;
    }
  });

  const openSkillsFolderBtn = document.getElementById('open-skills-folder-btn');
  openSkillsFolderBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.openSkillsFolder();
    if (!result.success) {
      alert(result.error || 'Could not open skills folder.');
    }
  });

  toggleActiveBtn.addEventListener('click', handleToggleActive);

  // Install button
  const installBtn = document.getElementById('install-btn');
  installBtn.addEventListener('click', handleInstall);

  // Version buttons (prev/next)
  const downloadPrevBtn = document.getElementById('download-prev-btn');
  const updateAvailableBtn = document.getElementById('update-available-btn');
  if (downloadPrevBtn) downloadPrevBtn.addEventListener('click', handleDownloadPreviousVersion);
  if (updateAvailableBtn) updateAvailableBtn.addEventListener('click', handleUpdateAvailable);

  // Scan for updates in sidebar
  const scanUpdatesBtn = document.getElementById('scan-updates-btn');
  if (scanUpdatesBtn) scanUpdatesBtn.addEventListener('click', handleScanForUpdates);

  const viewFullJsonBtn = document.getElementById('view-full-json-btn');
  const refreshJsonBtn = document.getElementById('refresh-json-btn');
  if (viewFullJsonBtn) viewFullJsonBtn.addEventListener('click', handleViewFullJson);
  if (refreshJsonBtn) refreshJsonBtn.addEventListener('click', handleRefreshJson);

  // License modal (bundle License.MD popup)
  const licenseModal = document.getElementById('license-modal');
  const licenseModalContent = document.getElementById('license-modal-content');
  const licenseModalClose = document.getElementById('license-modal-close');
  if (licenseModalClose) {
    licenseModalClose.addEventListener('click', () => {
      if (licenseModal) licenseModal.classList.add('hidden');
    });
  }
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.license-popup-btn');
    if (!btn || !licenseModal || !licenseModalContent) return;
    const cid = btn.getAttribute('data-cid');
    if (!cid) return;
    licenseModalContent.textContent = 'Loading…';
    licenseModal.classList.remove('hidden');
    const result = await window.electronAPI.getBundleLicenseContent(cid);
    licenseModalContent.textContent = result.success && result.content ? result.content : (result.error || 'Could not load license.');
  });
}

// Store verified file content temporarily (string for skills, ArrayBuffer for bundles)
let verifiedFileContent = null;
/** True when verified content is a bundle (zip); content is ArrayBuffer. */
let verifiedFileIsBundle = false;
// Chosen DSOUL entry from disambiguation (used when saving file on Load or Reverify)
let pendingDsoulEntry = null;

async function handleInstall() {
  if (!currentLoadCid) return;

  const cid = currentLoadCid;
  
  if (!verifiedFileContent) {
    alert('Error: File content not available. Please try loading again.');
    return;
  }

  const loadBtn = document.getElementById('load-btn');
  loadBtn.disabled = true;

  try {
    const isBundle = verifiedFileIsBundle;
    const contentStr = typeof verifiedFileContent === 'string' ? verifiedFileContent : new TextDecoder().decode(verifiedFileContent);
    const skillMetadata = isBundle ? null : parseSkillHeader(contentStr);
    
    // Preserve existing file fields (tags, active, dsoulEntry) when updating
    const existing = await window.electronAPI.readFile(cid);
    const fileData = {
      cid,
      content: isBundle ? undefined : contentStr,
      is_skill_bundle: isBundle || undefined,
      tags: existing?.tags ?? [],
      active: existing?.active ?? false,
      skillMetadata: skillMetadata || null,
      dsoulEntry: pendingDsoulEntry ?? existing?.dsoulEntry ?? null,
      createdAt: existing?.createdAt ?? new Date().toISOString()
    };

    const saveResult = await window.electronAPI.saveFile(fileData, isBundle ? verifiedFileContent : undefined);
    if (!saveResult.success) {
      alert('Error saving file: ' + saveResult.error);
      return;
    }

    // Clear input and hide loading panel
    document.getElementById('cid-input').value = '';
    document.getElementById('loading-panel').classList.add('hidden');
    document.getElementById('install-section').classList.add('hidden');
    
    // Reload file tree and show file preview
    await loadFileTree();
    await showFilePreview(cid);
    
    // Reset state
    currentLoadCid = null;
    verifiedFileContent = null;
    verifiedFileIsBundle = false;
    pendingDsoulEntry = null;
  } catch (error) {
    alert('Error installing file: ' + error.message);
  } finally {
    loadBtn.disabled = false;
    isLoading = false;
  }
}

async function loadSettings() {
  currentSettings = await window.electronAPI.getSettings();
}

function arrayBuffersEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const ua = new Uint8Array(a);
  const ub = new Uint8Array(b);
  for (let i = 0; i < ua.length; i++) {
    if (ua[i] !== ub[i]) return false;
  }
  return true;
}

// Extract CID from IPFS path or validate CID format
function parseIPFSPath(input) {
  const trimmed = input.trim();
  
  // Check for ipfs:// protocol
  if (trimmed.startsWith('ipfs://')) {
    // Extract CID after ipfs://
    const cid = trimmed.substring(7).split('/')[0]; // Remove protocol and any path after CID
    return cid.trim();
  }
  
  // Check if it's a valid CID (CIDv0 or CIDv1)
  // CIDv0: Qm... (46 chars starting with Qm)
  // CIDv1: bafy..., bafkrei..., etc. (base32/base58 encoded, various lengths)
  // Also support other CID formats like z... (base58btc)
  const cidPattern = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z0-9]{58,}|z[a-z0-9]+)$/i;
  
  if (cidPattern.test(trimmed)) {
    return trimmed;
  }
  
  // If it doesn't match IPFS path or CID format, return null
  return null;
}

/**
 * Start the load panel for a given CID (used by "Download previous version" and "Update available").
 */
function loadCidInPanel(cid) {
  const cidInput = document.getElementById('cid-input');
  if (!cid || !cidInput) return;
  cidInput.value = cid;
  handleLoad();
}

async function handleDownloadPreviousVersion() {
  const prevCid = currentFile?.dsoulEntry?.prev_cid;
  if (!prevCid) return;
  loadCidInPanel(prevCid);
}

async function handleUpdateAvailable() {
  const nextCid = currentFile?.dsoulEntry?.next_cid;
  if (!nextCid) return;
  loadCidInPanel(nextCid);
}

async function handleScanForUpdates() {
  const scanBtn = document.getElementById('scan-updates-btn');
  if (scanBtn) scanBtn.disabled = true;
  nextCidsByCid = new Map();
  const files = await window.electronAPI.getFiles();
  for (const file of files) {
    const cid = file.cid;
    if (!cid) continue;
    try {
      const result = await window.electronAPI.fetchDsoulByCid(cid);
      const data = result.success && Array.isArray(result.data) ? result.data : [];
      const entry = data.length === 1 ? data[0] : data.find((e) => e.cid === cid) || data[0];
      if (entry && entry.next_cid && entry.next_cid !== cid) {
        nextCidsByCid.set(cid, entry.next_cid);
      }
    } catch (_) {
      // Skip on error
    }
  }
  await loadFileTree();
  if (scanBtn) scanBtn.disabled = false;
}

async function handleViewFullJson() {
  const pre = document.getElementById('full-json-content');
  const btn = document.getElementById('view-full-json-btn');
  if (!pre || !btn) return;
  if (!currentFile) return;
  const cid = currentFile.cid;
  if (pre.classList.contains('hidden')) {
    const result = await window.electronAPI.fetchDsoulByCid(cid);
    dsoulApiResponseByCid.set(cid, result);
    pre.textContent = JSON.stringify(result, null, 2);
    pre.classList.remove('hidden');
    btn.textContent = 'Hide full JSON';
  } else {
    pre.classList.add('hidden');
    btn.textContent = 'View full JSON';
  }
}

async function handleRefreshJson() {
  if (!currentFile) return;
  const cid = currentFile.cid;
  const refreshBtn = document.getElementById('refresh-json-btn');
  if (refreshBtn) refreshBtn.disabled = true;
  try {
    const result = await window.electronAPI.fetchDsoulByCid(cid);
    dsoulApiResponseByCid.set(cid, result);
    const entries = result.success && Array.isArray(result.data) ? result.data : [];
    if (entries.length === 0) {
      currentFile.dsoulEntry = null;
    } else {
      let chosen = await showDsoulDisambiguationModal(entries, currentFile.dsoulEntry || null);
      if (chosen) chosen = await ensureDsoulEntryLink(chosen);
      currentFile.dsoulEntry = chosen;
    }
    await window.electronAPI.saveFile(currentFile);
    await renderPreviewHeaderAndMetadata(currentFile, cid);
    const pre = document.getElementById('full-json-content');
    if (pre && !pre.classList.contains('hidden')) {
      pre.textContent = JSON.stringify(result, null, 2);
    }
  } catch (err) {
    console.warn('Refresh JSON failed:', err);
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

async function handleLoad() {
  const cidInput = document.getElementById('cid-input');
  const input = cidInput.value.trim();
  
  if (!input) {
    alert('Please enter an IPFS path (ipfs://...) or CID');
    return;
  }

  // Parse IPFS path or validate CID
  const cid = parseIPFSPath(input);
  
  if (!cid) {
    alert('Invalid input. Please enter an IPFS path (ipfs://...) or a valid CID (e.g., Qm... or bafy...)');
    return;
  }

  const loadBtn = document.getElementById('load-btn');
  loadBtn.disabled = true;
  isLoading = true;
  currentLoadCid = cid;
  verifiedFileContent = null;
  pendingDsoulEntry = null;

  // Hide install section if it was shown
  document.getElementById('install-section').classList.add('hidden');

  // Clear verification status to reset checkboxes
  document.getElementById('verification-status').innerHTML = '';
  document.getElementById('gateway-status').innerHTML = '';

  // Show loading panel
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('loading-panel').classList.remove('hidden');

  try {
    // Fetch DSOUL list and have user pick one (or none) before verifying
    const dsoulResult = await window.electronAPI.fetchDsoulByCid(cid);
    const entries = dsoulResult.success && Array.isArray(dsoulResult.data) ? dsoulResult.data : [];
    const chosen = await showDsoulDisambiguationModal(entries, null);
    pendingDsoulEntry = chosen ? await ensureDsoulEntryLink(chosen) : null;

    await loadAndVerifyFile(cid);
    // On success, keep the panel open for review - don't clear input yet
  } catch (error) {
    // Show error in verification panel so user sees what went wrong
    console.error('Error loading file:', error);
    document.getElementById('install-section').classList.add('hidden');
    const verificationDiv = document.getElementById('verification-status');
    if (verificationDiv) {
      const errEl = document.createElement('div');
      errEl.className = 'verification-step';
      errEl.style.borderLeft = '4px solid #f48771';
      errEl.innerHTML = `<div class="verification-step-label" style="color: #f48771;">Load failed: ${escapeHtml(error.message || String(error))}</div>`;
      verificationDiv.appendChild(errEl);
    }
  } finally {
    loadBtn.disabled = false;
    isLoading = false;
  }
}

function handleCancelLoad() {
  // Hide loading panel and show empty state
  document.getElementById('loading-panel').classList.add('hidden');
  document.getElementById('install-section').classList.add('hidden');
  document.getElementById('empty-state').classList.remove('hidden');
  
  // Keep CID in input for retry
  // currentLoadCid is already set in the input field
  
  // Reset state
  isLoading = false;
  verifiedFileContent = null;
  verifiedFileIsBundle = false;
  const loadBtn = document.getElementById('load-btn');
  loadBtn.disabled = false;
}

function getIpfsGateways() {
  const list = Array.isArray(currentSettings?.ipfsGateways) && currentSettings.ipfsGateways.length > 0
    ? currentSettings.ipfsGateways
    : DEFAULT_IPFS_GATEWAYS.slice();
  return list.map((url) => {
    const u = (url || '').trim();
    return u.endsWith('/') ? u : u + '/';
  });
}

async function loadAndVerifyFile(cid) {
  if (!currentSettings) await loadSettings();
  const gateways = getIpfsGateways();

  const gatewayStatusDiv = document.getElementById('gateway-status');
  gatewayStatusDiv.innerHTML = '<h4>Downloading from gateways...</h4>';

  const downloadPromises = gateways.map(async (gateway) => {
    let gatewayName;
    try {
      gatewayName = new URL(gateway).hostname;
    } catch (_) {
      gatewayName = gateway;
    }
    const gatewayItem = document.createElement('div');
    gatewayItem.className = 'gateway-item loading';
    gatewayItem.innerHTML = `
      <div class="gateway-name">${gatewayName}</div>
      <div class="gateway-progress">Downloading...</div>
    `;
    gatewayStatusDiv.appendChild(gatewayItem);

  try {
    const url = gateway + cid;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Check Content-Length header if available
      const contentLength = response.headers.get('Content-Length');
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > MAX_FILE_SIZE) {
          throw new Error(`File too large: ${(size / 1024 / 1024).toFixed(2)}MB (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
        }
      }

      // Download as arrayBuffer so binary (e.g. zip) bytes are preserved; UTF-8 decoding would corrupt hash
      const arrayBuffer = await response.arrayBuffer();
      
      if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
        throw new Error(`File too large: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)}MB (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
      }

      gatewayItem.className = 'gateway-item success';
      gatewayItem.querySelector('.gateway-progress').textContent = 'Downloaded successfully';
      
      return { gateway: gatewayName, content: arrayBuffer, success: true };
    } catch (error) {
      gatewayItem.className = 'gateway-item error';
      gatewayItem.querySelector('.gateway-progress').textContent = `Error: ${error.message}`;
      return { gateway: gatewayName, content: null, success: false, error: error.message };
    }
  });

  const results = await Promise.all(downloadPromises);
  const successfulDownloads = results.filter(r => r.success);

  if (successfulDownloads.length === 0) {
    throw new Error('Failed to download from all gateways');
  }

  const verificationDiv = document.getElementById('verification-status');
  verificationDiv.innerHTML = '<h4>Verification Steps</h4>';

  const firstContent = successfulDownloads[0].content;
  const isBundleFromDsoul = !!(pendingDsoulEntry?.is_skill_bundle ?? pendingDsoulEntry?.is_bundle);
  const isZip = firstContent.byteLength >= 2 &&
    new Uint8Array(firstContent)[0] === 0x50 &&
    new Uint8Array(firstContent)[1] === 0x4B;

  let isBundle = isBundleFromDsoul;
  let validatedBundleSkillContent = null;
  if (isZip && !isBundleFromDsoul) {
    const validateResult = await window.electronAPI.validateZipSkillBundle(firstContent);
    if (!validateResult.success) {
      throw new Error(validateResult.error || 'Could not validate zip');
    }
    if (!validateResult.valid) {
      throw new Error('Zip file does not contain Skill.MD (not a skill bundle)');
    }
    isBundle = true;
    validatedBundleSkillContent = validateResult.skillContent || null;
  }

  const singleGateway = successfulDownloads.length === 1;

  if (!singleGateway) {
    // Step 1: Compare gateway downloads (skip when only one gateway)
    let allMatch = true;
    for (let i = 1; i < successfulDownloads.length; i++) {
      const a = firstContent;
      const b = successfulDownloads[i].content;
      if (a.byteLength !== b.byteLength || !arrayBuffersEqual(a, b)) {
        allMatch = false;
        break;
      }
    }

    const compareStep = document.createElement('div');
    compareStep.className = 'verification-step';
    compareStep.innerHTML = `
      <input type="checkbox" ${allMatch ? 'checked' : ''} disabled>
      <div class="verification-step-label">
        Files from ${successfulDownloads.length} gateway(s) match
      </div>
    `;
    verificationDiv.appendChild(compareStep);

    if (!allMatch) {
      throw new Error('Files from different gateways do not match');
    }
  }

  // Step 2 (or Step 1 when single gateway): Validate skill header (or bundle)
  const skillHeaderStep = document.createElement('div');
  skillHeaderStep.className = 'verification-step';
  let skillMetadata = null;
  if (isBundle) {
    skillMetadata = validatedBundleSkillContent ? parseSkillHeader(validatedBundleSkillContent) : null;
  } else {
    if (isLikelyBinaryContent(firstContent)) {
      throw new Error('Binary file (e.g. image) – not a text skill. Use a .MD skill file or a zip bundle with Skill.MD.');
    }
    skillMetadata = parseSkillHeader(new TextDecoder().decode(firstContent));
  }
  const bundleLabel = isBundleFromDsoul
    ? 'Bundle (zip) – no skill header check'
    : (validatedBundleSkillContent ? 'Valid skill bundle (Skill.MD found) – from IPFS directly' : 'Bundle (zip)');
  skillHeaderStep.innerHTML = `
    <input type="checkbox" ${(isBundle || skillMetadata) ? 'checked' : ''} disabled>
    <div class="verification-step-label">
      ${isBundle ? bundleLabel : (skillMetadata ? 'Valid skill header found' : 'No skill header found (file may not be a skill)')}
    </div>
  `;
  verificationDiv.appendChild(skillHeaderStep);

  // Step 3: Calculate hash and compare with CID
  const hashStep = document.createElement('div');
  hashStep.className = 'verification-step';
  hashStep.innerHTML = `
    <input type="checkbox" disabled>
    <div class="verification-step-label">Calculating hash...</div>
  `;
  verificationDiv.appendChild(hashStep);

  try {
    const hashResult = await window.electronAPI.calculateHash(firstContent);
    if (!hashResult.success) {
      throw new Error(hashResult.error);
    }
    
    const calculatedHash = hashResult.hash;
    const hashMatches = calculatedHash === cid;

    hashStep.innerHTML = `
      <input type="checkbox" ${hashMatches ? 'checked' : ''} disabled>
      <div class="verification-step-label">
        Calculated hash matches CID: ${hashMatches ? 'Yes' : 'No'}
        ${hashMatches ? '' : ` (Expected: ${cid}, Got: ${calculatedHash})`}
      </div>
    `;

    if (!hashMatches) {
      throw new Error('Calculated hash does not match CID');
    }

    // Store verified content for installation
    verifiedFileContent = firstContent;
    verifiedFileIsBundle = isBundle;

    // skillMetadata already set in step 2 (includes bundle Skill.MD when validated from zip)

    // Show install section
    const installSection = document.getElementById('install-section');
    installSection.classList.remove('hidden');
    
    // Update install message with skill info if available
    const installMessage = installSection.querySelector('.install-message');
    if (skillMetadata && skillMetadata.name) {
      installMessage.textContent = `All verification steps passed. Ready to install "${skillMetadata.name}".`;
    } else {
      installMessage.textContent = 'All verification steps passed. Ready to install.';
    }
    
    // Update blockchain verify link with CID and trigger render
    const installClverify = document.getElementById('install-clverify');
    if (installClverify) {
      installClverify.setAttribute('cid', cid);
      // If already rendered by CLVerify, remove and recreate the element
      const existingLink = installSection.querySelector('a[cid].clv-inline-link');
      if (existingLink && existingLink.id !== 'install-clverify') {
        // CLVerify has replaced our <a> tag, recreate it
        const newLink = document.createElement('a');
        newLink.id = 'install-clverify';
        newLink.setAttribute('cid', cid);
        newLink.setAttribute('mode', 'dark');
        newLink.setAttribute('global', 'true');
        // Use base gateway URL (remove any CID that might be in the gateway)
        const gatewayUrl = 'https://chainletter.mypinata.cloud/ipfs/QmUEsNroVsNT6ZfJKS7hosYBWt2CYhvyTf2KwfFhKULgJb';
        const baseGateway = gatewayUrl.replace(/\/[Qmb][a-zA-Z0-9]{40,}$/, '/') || 'https://chainletter.mypinata.cloud/ipfs/';
        newLink.setAttribute('gateway', baseGateway);
        newLink.setAttribute('api', 'staging-verify.clstamp.com');
        newLink.setAttribute('logo', 'true');
        newLink.className = 'blockchain-verify-btn';
        newLink.textContent = 'Blockchain Verify';
        existingLink.replaceWith(newLink);
      }
      // Trigger scan to render the blockchain verify button
      if (window.CLVerify && window.CLVerify.scan) {
        window.CLVerify.scan(installSection);
        // Fix image URLs after rendering
        setTimeout(() => fixCLVerifyImages(installSection), 100);
      }
    }
  } catch (error) {
    hashStep.innerHTML = `
      <input type="checkbox" disabled>
      <div class="verification-step-label" style="color: #f48771;">
        Error: ${error.message}
      </div>
    `;
    // Don't throw - let the error be displayed in the panel
    // The user can then cancel and try again
    const errorStep = document.createElement('div');
    errorStep.className = 'verification-step';
    errorStep.style.borderLeft = '4px solid #f48771';
    errorStep.innerHTML = `
      <div class="verification-step-label" style="color: #f48771; font-weight: 600;">
        Verification failed. Click Cancel to close and try again.
      </div>
    `;
    verificationDiv.appendChild(errorStep);
    throw error;
  }
}

async function loadFileTree() {
  if (!currentSettings) await loadSettings();
  const files = await window.electronAPI.getFiles();
  const fileTree = document.getElementById('file-tree');
  fileTree.innerHTML = '';

  // Parse skill metadata for files that don't have it (backward compatibility; bundles: read from zip)
  for (const file of files) {
    if (file.skillMetadata) continue;
    if (file.is_skill_bundle ?? file.is_bundle) {
      const result = await window.electronAPI.getBundleSkillContent(file.cid);
      if (result.success && result.content) {
        file.skillMetadata = parseSkillHeader(result.content);
        if (file.skillMetadata) {
          await window.electronAPI.saveFile(file);
        }
      }
    } else if (typeof file.content === 'string') {
      file.skillMetadata = parseSkillHeader(file.content);
      if (file.skillMetadata) {
        await window.electronAPI.saveFile(file);
      }
    }
  }
  // Normalize: ensure is_skill_bundle is set for legacy is_bundle
  for (const file of files) {
    if (file.is_bundle && file.is_skill_bundle === undefined) {
      file.is_skill_bundle = true;
    }
  }

  // Group files by tags (including install path as virtual tag for local installs)
  const tagGroups = {};
  const untaggedFiles = [];

  files.forEach(file => {
    const tags = [...(file.tags || [])];
    if (isLocalInstall(file) && file.activatedSkillsFolder) {
      tags.push(file.activatedSkillsFolder);
    }
    if (tags.length === 0) {
      untaggedFiles.push(file);
    } else {
      tags.forEach(tag => {
        if (!tagGroups[tag]) tagGroups[tag] = [];
        if (!tagGroups[tag].includes(file)) tagGroups[tag].push(file);
      });
    }
  });

  // Render tag groups
  Object.keys(tagGroups).sort().forEach(tag => {
    const tagGroup = document.createElement('div');
    tagGroup.className = 'tag-group' + (isPathTag(tag) ? ' tag-group-location' : '');

    const tagHeader = document.createElement('div');
    tagHeader.className = 'tag-header';
    tagHeader.dataset.tag = tag;
    tagHeader.textContent = isPathTag(tag) ? 'Location: ' + tag : tag;
    tagHeader.title = isPathTag(tag) ? tag : tag;
    tagHeader.addEventListener('click', () => {
      tagHeader.classList.toggle('collapsed');
      tagFiles.classList.toggle('collapsed');
    });

    tagHeader.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    tagHeader.addEventListener('dragenter', (e) => {
      e.preventDefault();
      tagHeader.classList.add('drag-over');
    });
    tagHeader.addEventListener('dragleave', (e) => {
      if (!tagHeader.contains(e.relatedTarget)) {
        tagHeader.classList.remove('drag-over');
      }
    });
    tagHeader.addEventListener('drop', async (e) => {
      e.preventDefault();
      tagHeader.classList.remove('drag-over');
      if (isPathTag(tag)) return;
      const cid = e.dataTransfer.getData('text/plain');
      if (!cid) return;
      const file = await window.electronAPI.readFile(cid);
      if (!file) return;
      const tags = file.tags || [];
      if (tags.includes(tag)) return;
      tags.push(tag);
      await window.electronAPI.updateFileTags(cid, tags);
      await loadFileTree();
      if (currentFile && currentFile.cid === cid) {
        currentFile.tags = tags;
      }
    });

    const tagFiles = document.createElement('div');
    tagFiles.className = 'tag-files';
    tagFiles.dataset.tag = tag;

    tagFiles.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    tagFiles.addEventListener('dragenter', (e) => {
      e.preventDefault();
      tagHeader.classList.add('drag-over');
    });
    tagFiles.addEventListener('dragleave', (e) => {
      if (!tagGroup.contains(e.relatedTarget)) {
        tagHeader.classList.remove('drag-over');
      }
    });
    tagFiles.addEventListener('drop', async (e) => {
      e.preventDefault();
      tagHeader.classList.remove('drag-over');
      if (isPathTag(tag)) return;
      const cid = e.dataTransfer.getData('text/plain');
      if (!cid) return;
      const file = await window.electronAPI.readFile(cid);
      if (!file) return;
      const tags = file.tags || [];
      if (tags.includes(tag)) return;
      tags.push(tag);
      await window.electronAPI.updateFileTags(cid, tags);
      await loadFileTree();
      if (currentFile && currentFile.cid === cid) {
        currentFile.tags = tags;
      }
    });

    tagGroups[tag].forEach(file => {
      const fileItem = createFileItem(file);
      tagFiles.appendChild(fileItem);
    });

    tagGroup.appendChild(tagHeader);
    tagGroup.appendChild(tagFiles);
    fileTree.appendChild(tagGroup);
  });

  // Render untagged files
  if (untaggedFiles.length > 0) {
    untaggedFiles.forEach(file => {
      const fileItem = createFileItem(file);
      fileItem.classList.add('untagged');
      fileTree.appendChild(fileItem);
    });
  }

  if (files.length === 0) {
    fileTree.innerHTML = '<div style="padding: 16px; color: #858585; text-align: center;">No files loaded yet</div>';
  }
}

function createFileItem(file) {
  const fileItem = document.createElement('div');
  fileItem.className = 'file-item';
  if (file.active) {
    fileItem.classList.add('active');
  }
  const localInstall = isLocalInstall(file);
  if (localInstall) fileItem.classList.add('file-item-local');
  else if (file.activatedSkillsFolder) fileItem.classList.add('file-item-global');
  fileItem.draggable = true;

  // Use skill name if available, otherwise use CID
  const displayName = file.skillMetadata?.name || file.cid.substring(0, 20) + '...';
  const displayTitle = file.skillMetadata 
    ? `${file.skillMetadata.name} (${file.cid})${file.active ? ' - Active' : ''}`
    : file.cid + (file.active ? ' (Active)' : '');
  
  const hasUpdate = nextCidsByCid.has(file.cid);
  const nextCid = nextCidsByCid.get(file.cid);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'file-item-label';
  labelSpan.textContent = displayName;
  labelSpan.title = displayTitle;
  labelSpan.dataset.cid = file.cid;
  fileItem.appendChild(labelSpan);

  const installBadge = document.createElement('span');
  installBadge.className = 'file-item-install-badge' + (localInstall ? ' file-item-install-local' : ' file-item-install-global');
  installBadge.textContent = localInstall ? 'Local' : (file.activatedSkillsFolder ? 'Global' : '');
  installBadge.title = localInstall && file.activatedSkillsFolder ? file.activatedSkillsFolder : (file.activatedSkillsFolder ? 'Installed to configured skills folder' : '');
  if (installBadge.textContent) fileItem.appendChild(installBadge);

  if (hasUpdate && nextCid) {
    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.className = 'file-item-update-btn';
    updateBtn.textContent = 'Update';
    updateBtn.title = 'Download newer version';
    updateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadCidInPanel(nextCid);
    });
    fileItem.appendChild(updateBtn);
  }

  fileItem.title = displayTitle;
  fileItem.dataset.cid = file.cid;

  fileItem.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', file.cid);
    e.dataTransfer.effectAllowed = 'copy';
  });

  fileItem.addEventListener('click', async (e) => {
    // Don't select when clicking the Update button
    if (e.target.classList.contains('file-item-update-btn')) return;
    // Remove previous selection
    document.querySelectorAll('.file-item').forEach(item => {
      item.classList.remove('selected');
    });
    fileItem.classList.add('selected');
    await showFilePreview(file.cid);
  });

  fileItem.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    fileContextMenuCid = file.cid;
    const contextMenu = document.getElementById('context-menu');
    const toggleActiveBtn = document.getElementById('toggle-active');
    
    // Update toggle button text based on current state
    const fileData = await window.electronAPI.readFile(file.cid);
    toggleActiveBtn.textContent = fileData?.active ? 'Deactivate' : 'Activate';
    
    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';
    contextMenu.classList.remove('hidden');
  });

  return fileItem;
}

async function showFilePreview(cid) {
  const file = await window.electronAPI.readFile(cid);
  if (!file) {
    alert('File not found');
    return;
  }

  let bundleSkillContent = null;
  // Parse skill metadata if not already present (bundles: read Skill.MD from zip)
  if (!file.skillMetadata) {
    if (file.is_skill_bundle ?? file.is_bundle) {
      const result = await window.electronAPI.getBundleSkillContent(cid);
      if (result.success && result.content) {
        bundleSkillContent = result.content;
        file.skillMetadata = parseSkillHeader(result.content);
        if (file.skillMetadata) {
          await window.electronAPI.saveFile(file);
        }
      }
    } else if (typeof file.content === 'string') {
      file.skillMetadata = parseSkillHeader(file.content);
      if (file.skillMetadata) {
        const updateResult = await window.electronAPI.saveFile(file);
        if (!updateResult.success) {
          console.warn('Failed to update file with skill metadata');
        }
      }
    }
  }
  if ((file.is_skill_bundle ?? file.is_bundle) && !bundleSkillContent) {
    const result = await window.electronAPI.getBundleSkillContent(cid);
    if (result.success && result.content) bundleSkillContent = result.content;
  }

  currentFile = file;

  // Show preview panel
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('loading-panel').classList.add('hidden');
  document.getElementById('file-preview').classList.remove('hidden');

  // Reset full JSON section when switching file
  const fullJsonPre = document.getElementById('full-json-content');
  const viewFullJsonBtn = document.getElementById('view-full-json-btn');
  if (fullJsonPre) fullJsonPre.classList.add('hidden');
  if (viewFullJsonBtn) viewFullJsonBtn.textContent = 'View full JSON';

  await renderPreviewHeaderAndMetadata(file, cid);

  // Show/hide previous/next version buttons based on dsoulEntry
  const downloadPrevBtn = document.getElementById('download-prev-btn');
  const updateAvailableBtn = document.getElementById('update-available-btn');
  if (downloadPrevBtn) {
    if (file.dsoulEntry?.prev_cid) {
      downloadPrevBtn.classList.remove('hidden');
    } else {
      downloadPrevBtn.classList.add('hidden');
    }
  }
  if (updateAvailableBtn) {
    if (file.dsoulEntry?.next_cid) {
      updateAvailableBtn.classList.remove('hidden');
    } else {
      updateAvailableBtn.classList.add('hidden');
    }
  }

  // Update blockchain verify link with CID and trigger render
  const previewClverify = document.getElementById('preview-clverify');
  const filePreview = document.getElementById('file-preview');
  if (previewClverify) {
    previewClverify.setAttribute('cid', cid);
    const previewActions = document.querySelector('.preview-actions');
    const existingLink = previewActions ? previewActions.querySelector('a[cid].clv-inline-link') : null;
    if (existingLink && existingLink.id !== 'preview-clverify') {
      const newLink = document.createElement('a');
      newLink.id = 'preview-clverify';
      newLink.setAttribute('cid', cid);
      newLink.setAttribute('mode', 'dark');
      newLink.setAttribute('global', 'true');
      const gatewayUrl = 'https://chainletter.mypinata.cloud/ipfs/QmUEsNroVsNT6ZfJKS7hosYBWt2CYhvyTf2KwfFhKULgJb';
      const baseGateway = gatewayUrl.replace(/\/[Qmb][a-zA-Z0-9]{40,}$/, '/') || 'https://chainletter.mypinata.cloud/ipfs/';
      newLink.setAttribute('gateway', baseGateway);
      newLink.setAttribute('api', 'staging-verify.clstamp.com');
      newLink.setAttribute('logo', 'true');
      newLink.className = 'blockchain-verify-btn';
      newLink.textContent = 'Blockchain Verify';
      existingLink.replaceWith(newLink);
    }
    if (window.CLVerify && window.CLVerify.scan) {
      window.CLVerify.scan(filePreview);
      setTimeout(() => fixCLVerifyImages(filePreview), 100);
    }
  }

  // Set preview content (bundles: show Skill.MD content like normal skills)
  document.getElementById('preview-content').textContent = (file.is_skill_bundle ?? file.is_bundle)
    ? (bundleSkillContent || '')
    : (file.content || '');

  await updateCidDisplay(cid);

  // If no DSOUL data, auto-fetch (single result auto-picked; multiple = modal)
  if (!file.dsoulEntry) {
    ensureDsoulEntry(cid, file);
  }
}

/**
 * Render preview header (title + tags) and skill metadata (including DSOUL download, license, author).
 */
async function renderPreviewHeaderAndMetadata(file, cid) {
  const title = file.skillMetadata?.name
    ? `${file.skillMetadata.name} (CID: ${cid})`
    : `CID: ${cid}`;
  document.getElementById('preview-title').textContent = title;

  const tagsEl = document.getElementById('preview-tags');
  const tags = file.tags && file.tags.length ? file.tags : [];
  const localInstall = isLocalInstall(file);
  const installPath = file.activatedSkillsFolder;
  const parts = [];
  if (localInstall && installPath) {
    parts.push(`<span class="preview-tag preview-tag-location" title="${escapeHtml(installPath)}">Location: ${escapeHtml(installPath)}</span>`);
  }
  if (tags.length > 0) {
    parts.push(tags.map((t) => `<span class="preview-tag">${escapeHtml(t)}</span>`).join(''));
  }
  if (parts.length > 0) {
    tagsEl.innerHTML = parts.join('');
    tagsEl.classList.remove('hidden');
  } else {
    tagsEl.innerHTML = '';
    tagsEl.classList.add('hidden');
  }

  const skillMetadataDiv = document.getElementById('skill-metadata');
  let hasAny = false;
  let metadataHtml = '<div class="skill-metadata-content"><h4>Skill Information</h4>';

  if (file.activatedSkillsFolder) {
    const installType = isLocalInstall(file) ? 'Local' : 'Global';
    metadataHtml += `<div class="metadata-item"><strong>Install:</strong> ${escapeHtml(installType)}${localInstall ? ` – <span class="metadata-install-path" title="${escapeHtml(installPath)}">${escapeHtml(installPath)}</span>` : ''}</div>`;
    hasAny = true;
  }

  if (file.skillMetadata) {
    if (file.skillMetadata.name) {
      metadataHtml += `<div class="metadata-item"><strong>Name:</strong> ${escapeHtml(file.skillMetadata.name)}</div>`;
      hasAny = true;
    }
    if (file.skillMetadata.version) {
      metadataHtml += `<div class="metadata-item"><strong>Version:</strong> ${escapeHtml(file.skillMetadata.version)}</div>`;
      hasAny = true;
    }
    if (file.skillMetadata.description) {
      metadataHtml += `<div class="metadata-item"><strong>Description:</strong> ${escapeHtml(file.skillMetadata.description)}</div>`;
      hasAny = true;
    }
    if (file.skillMetadata.homepage) {
      metadataHtml += `<div class="metadata-item"><strong>Homepage:</strong> <a href="${escapeHtml(file.skillMetadata.homepage)}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.skillMetadata.homepage)}</a></div>`;
      hasAny = true;
    }
    if (file.skillMetadata.metadata) {
      metadataHtml += `<div class="metadata-item"><strong>Metadata:</strong> <pre>${escapeHtml(JSON.stringify(file.skillMetadata.metadata, null, 2))}</pre></div>`;
      hasAny = true;
    }
  }

  if (file.dsoulEntry) {
    const e = file.dsoulEntry;
    const providerPageUrl = e.wordpress_url || e.link || (await window.electronAPI.getSettings()).dsoulProviderUrl?.trim() || 'https://dsoul.org';
    if (providerPageUrl) {
      try {
        const providerHost = new URL(providerPageUrl).hostname || 'provider';
        metadataHtml += `<div class="metadata-item"><strong>Provider:</strong> <a href="${escapeHtml(providerPageUrl)}" target="_blank" rel="noopener noreferrer" class="dsoul-provider-link">View skill on ${escapeHtml(providerHost)}</a></div>`;
        hasAny = true;
      } catch (_) {
        metadataHtml += `<div class="metadata-item"><strong>Provider:</strong> <a href="${escapeHtml(providerPageUrl)}" target="_blank" rel="noopener noreferrer" class="dsoul-provider-link">View on DSOUL provider</a></div>`;
        hasAny = true;
      }
    }
    if (e.author_name || e.author_url) {
      const authorLink = e.author_url
        ? `<a href="${escapeHtml(e.author_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.author_name || '')}</a>`
        : escapeHtml(e.author_name || '');
      metadataHtml += `<div class="metadata-item"><strong>Author:</strong> ${authorLink}</div>`;
      hasAny = true;
    }
    if (e.tags && e.tags.length > 0) {
      metadataHtml += `<div class="metadata-item"><strong>Tags:</strong> ${e.tags.map((t) => escapeHtml(t)).join(', ')}</div>`;
      hasAny = true;
    }
    if (e.download_url) {
      metadataHtml += `<div class="metadata-item"><strong>Download:</strong> <a href="${escapeHtml(e.download_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.download_url)}</a></div>`;
      hasAny = true;
    }
    if (file.is_skill_bundle ?? file.is_bundle) {
      metadataHtml += `<div class="metadata-item"><strong>License:</strong> <button type="button" class="license-popup-btn" data-cid="${escapeHtml(cid)}">View License</button></div>`;
      hasAny = true;
    } else if (e.license_url) {
      metadataHtml += `<div class="metadata-item"><strong>License:</strong> <a href="${escapeHtml(e.license_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.license_url)}</a></div>`;
      hasAny = true;
    }
  }
  if ((file.is_skill_bundle ?? file.is_bundle) && !file.dsoulEntry) {
    metadataHtml += `<div class="metadata-item"><strong>License:</strong> <button type="button" class="license-popup-btn" data-cid="${escapeHtml(cid)}">View License</button></div>`;
    hasAny = true;
  }

  metadataHtml += '</div>';
  skillMetadataDiv.innerHTML = metadataHtml;
  if (hasAny) {
    skillMetadataDiv.classList.remove('hidden');
  } else {
    skillMetadataDiv.classList.add('hidden');
  }
}

/**
 * If file has no dsoulEntry, fetch DSOUL API. Single result is auto-picked and saved; multiple opens modal.
 */
async function ensureDsoulEntry(cid, file) {
  try {
    const result = await window.electronAPI.fetchDsoulByCid(cid);
    dsoulApiResponseByCid.set(cid, result);
    const entries = result.success && Array.isArray(result.data) ? result.data : [];
    if (entries.length === 0) return;
    let chosen = await showDsoulDisambiguationModal(entries, null);
    if (chosen) {
      chosen = await ensureDsoulEntryLink(chosen);
      file.dsoulEntry = chosen;
      await window.electronAPI.saveFile(file);
      if (currentFile && currentFile.cid === cid) {
        currentFile.dsoulEntry = chosen;
      }
      await renderPreviewHeaderAndMetadata(currentFile && currentFile.cid === cid ? currentFile : file, cid);
    }
  } catch (err) {
    console.warn('DSOUL fetch failed:', err);
  }
}

function escapeHtml(text) {
  if (text == null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Ensure the chosen DSOUL entry has a link for the provider page. Prefer wordpress_url from API, then link, else provider base URL.
 */
async function ensureDsoulEntryLink(entry) {
  if (!entry) return entry;
  const link = entry.wordpress_url || entry.link;
  if (link) return entry;
  const settings = await window.electronAPI.getSettings();
  const base = (settings.dsoulProviderUrl || '').trim().replace(/\/+$/, '') || 'https://dsoul.org';
  return { ...entry, link: base };
}

/**
 * Show modal to pick one DSOUL entry. Returns Promise<entry | null>.
 * If entries is empty, resolves with null without showing modal.
 * If exactly one entry, returns it without showing modal.
 * currentEntry: optional saved entry to pre-select (matched by download_url).
 */
function showDsoulDisambiguationModal(entries, currentEntry) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return Promise.resolve(null);
  }
  if (entries.length === 1) {
    return Promise.resolve(entries[0]);
  }
  const modal = document.getElementById('dsoul-modal');
  const listEl = document.getElementById('dsoul-entries-list');
  const confirmBtn = document.getElementById('dsoul-confirm-btn');
  const cancelBtn = document.getElementById('dsoul-cancel-btn');
  const preSelected = currentEntry
    ? entries.find((e) => e.download_url === currentEntry.download_url)
    : null;
  let selectedEntry = preSelected || entries[0];

  listEl.innerHTML = '';
  entries.forEach((entry) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dsoul-entry-option' + (entry === selectedEntry ? ' selected' : '');
    btn.innerHTML = `
      <span class="entry-name">${escapeHtml(entry.name || 'Unnamed')}</span>
      <span class="entry-author">${escapeHtml(entry.author_name || '')}</span>
      <span class="entry-tags">${(entry.tags || []).map((t) => escapeHtml(t)).join(', ')}</span>
    `;
    btn.addEventListener('click', () => {
      selectedEntry = entry;
      listEl.querySelectorAll('.dsoul-entry-option').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    listEl.appendChild(btn);
  });

  return new Promise((resolve) => {
    const finish = (value) => {
      modal.classList.add('hidden');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(value);
    };
    const onConfirm = () => finish(selectedEntry);
    const onCancel = () => finish(null);
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    modal.classList.remove('hidden');
  });
}

async function updateCidDisplay(cid) {
  const cidDisplay = document.getElementById('cid-display');
  const file = await window.electronAPI.readFile(cid);
  
  if (!file) return;

  try {
    const hashResult = (file.is_skill_bundle ?? file.is_bundle)
      ? await window.electronAPI.hashFileFromPath(cid)
      : await window.electronAPI.calculateHash(file.content);
    if (!hashResult.success) {
      throw new Error(hashResult.error);
    }
    
    const calculatedHash = hashResult.hash;
    const matches = calculatedHash === cid;

    cidDisplay.innerHTML = `
      <div class="cid-display-label">Calculated CID:</div>
      <div class="cid-display-value" style="color: ${matches ? '#4ec9b0' : '#f48771'}">
        ${calculatedHash} ${matches ? '✓' : '✗'}
      </div>
    `;
  } catch (error) {
    const msg = (error && (error.message || String(error))) || 'Unknown error';
    cidDisplay.innerHTML = `
      <div class="cid-display-label">Error calculating CID:</div>
      <div class="cid-display-value" style="color: #f48771">${escapeHtml(msg)}</div>
    `;
  }
}

async function handleReverify() {
  if (!currentFile) return;

  const cid = currentFile.cid;
  const loadBtn = document.getElementById('load-btn');
  loadBtn.disabled = true;
  isLoading = true;
  currentLoadCid = cid;
  verifiedFileContent = null;
  verifiedFileIsBundle = false;

  // Hide install section if it was shown
  document.getElementById('install-section').classList.add('hidden');

  // Clear verification status to reset checkboxes
  document.getElementById('verification-status').innerHTML = '';
  document.getElementById('gateway-status').innerHTML = '';

  // Show loading panel
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('loading-panel').classList.remove('hidden');

  try {
    // Fetch DSOUL list again and let user pick (pre-select current choice)
    const dsoulResult = await window.electronAPI.fetchDsoulByCid(cid);
    dsoulApiResponseByCid.set(cid, dsoulResult);
    const entries = dsoulResult.success && Array.isArray(dsoulResult.data) ? dsoulResult.data : [];
    let chosen = await showDsoulDisambiguationModal(entries, currentFile.dsoulEntry || null);
    pendingDsoulEntry = chosen ? await ensureDsoulEntryLink(chosen) : null;

    await loadAndVerifyFile(cid);
    // On success, keep panel open for review
    // User can click Cancel to go back to preview
  } catch (error) {
    // On error, show error in panel but don't hide it - let user see what went wrong
    console.error('Reverification failed:', error);
    // Hide install section on error
    document.getElementById('install-section').classList.add('hidden');
  } finally {
    loadBtn.disabled = false;
    isLoading = false;
  }
}

async function handleDeleteFile() {
  if (!fileContextMenuCid) return;

  if (!confirm(`Are you sure you want to delete file ${fileContextMenuCid}?`)) {
    return;
  }

  // Check if file is active and deactivate it first
  const file = await window.electronAPI.readFile(fileContextMenuCid);
  if (file && file.active) {
    await window.electronAPI.deactivateFile(fileContextMenuCid);
  }

  const result = await window.electronAPI.deleteFile(fileContextMenuCid);
  if (result.success) {
    document.getElementById('context-menu').classList.add('hidden');
    await loadFileTree();
    
    // Clear preview if deleted file was shown
    if (currentFile && currentFile.cid === fileContextMenuCid) {
      document.getElementById('file-preview').classList.add('hidden');
      document.getElementById('empty-state').classList.remove('hidden');
      currentFile = null;
    }
  } else {
    alert('Error deleting file: ' + result.error);
  }
}

async function handleAddTag() {
  const tagInput = document.getElementById('tag-input');
  const tag = tagInput.value.trim();
  
  if (!tag || !fileContextMenuCid) {
    return;
  }

  const file = await window.electronAPI.readFile(fileContextMenuCid);
  if (!file) {
    alert('File not found');
    return;
  }

  const tags = file.tags || [];
  if (!tags.includes(tag)) {
    tags.push(tag);
    await window.electronAPI.updateFileTags(fileContextMenuCid, tags);
    await loadFileTree();
    
    // Update preview if this file is currently shown
    if (currentFile && currentFile.cid === fileContextMenuCid) {
      currentFile.tags = tags;
    }
  }

  document.getElementById('tag-modal').classList.add('hidden');
  document.getElementById('context-menu').classList.add('hidden');
  tagInput.value = '';
}

async function handleToggleActive() {
  if (!fileContextMenuCid) return;

  const file = await window.electronAPI.readFile(fileContextMenuCid);
  if (!file) {
    alert('File not found');
    return;
  }

  try {
    if (file.active) {
      // Deactivate
      const result = await window.electronAPI.deactivateFile(fileContextMenuCid);
      if (result.success) {
        await loadFileTree();
        // Update preview if this file is currently shown
        if (currentFile && currentFile.cid === fileContextMenuCid) {
          currentFile.active = false;
        }
      } else {
        alert('Error deactivating file: ' + result.error);
      }
    } else {
      // Activate
      const result = await window.electronAPI.activateFile(fileContextMenuCid);
      if (result.success) {
        await loadFileTree();
        // Update preview if this file is currently shown
        if (currentFile && currentFile.cid === fileContextMenuCid) {
          currentFile.active = true;
        }
      } else {
        alert('Error activating file: ' + result.error);
      }
    }
  } catch (error) {
    alert('Error: ' + error.message);
  }

  document.getElementById('context-menu').classList.add('hidden');
}
