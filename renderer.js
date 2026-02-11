// IPFS gateways to try
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.ipfs.io/ipfs/'
];

// Maximum file size for skills files (2MB) - reasonable limit for text files
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB in bytes

// Parse YAML frontmatter from skill file, or infer from markdown
function parseSkillHeader(content) {
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
let currentLoadCid = null;
let isLoading = false;

// Fix CLVerify image URLs to use local images
function fixCLVerifyImages(container) {
  const scope = container || document;
  
  // Fix button icon (CL-Glyph-Icon.png)
  const icons = scope.querySelectorAll('.clv-icon, .clv-inline-icon');
  icons.forEach(img => {
    if (img.src && img.src.includes('CL-Glyph-Icon.png')) {
      img.src = 'do_not_modify/CL-Glyph-Icon.png';
    }
  });
  
  // Fix modal logo (CL-Logo-White-Semitransparent-500.png)
  const logos = scope.querySelectorAll('.clv-logo');
  logos.forEach(img => {
    if (img.src && img.src.includes('CL-Logo-White-Semitransparent-500.png')) {
      img.src = 'do_not_modify/CL-Logo-White-Semitransparent-500.png';
    }
  });
  
  // Also fix images that might be created dynamically
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          if (node.tagName === 'IMG') {
            if (node.src && node.src.includes('CL-Glyph-Icon.png')) {
              node.src = 'do_not_modify/CL-Glyph-Icon.png';
            } else if (node.src && node.src.includes('CL-Logo-White-Semitransparent-500.png')) {
              node.src = 'do_not_modify/CL-Logo-White-Semitransparent-500.png';
            }
          }
          // Check child images
          const childIcons = node.querySelectorAll && node.querySelectorAll('.clv-icon, .clv-inline-icon, .clv-logo');
          if (childIcons) {
            childIcons.forEach(img => {
              if (img.src && img.src.includes('CL-Glyph-Icon.png')) {
                img.src = 'do_not_modify/CL-Glyph-Icon.png';
              } else if (img.src && img.src.includes('CL-Logo-White-Semitransparent-500.png')) {
                img.src = 'do_not_modify/CL-Logo-White-Semitransparent-500.png';
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
              node.src = 'do_not_modify/CL-Glyph-Icon.png';
            } else if (node.src && node.src.includes('CL-Logo-White-Semitransparent-500.png')) {
              node.src = 'do_not_modify/CL-Logo-White-Semitransparent-500.png';
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
    tagModal.classList.remove('hidden');
    tagInput.focus();
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
  const toggleActiveBtn = document.getElementById('toggle-active');

  optionsBtn.addEventListener('click', async () => {
    await loadSettings();
    skillsFolderInput.value = currentSettings?.skillsFolder || '';
    optionsModal.classList.remove('hidden');
  });

  optionsCancel.addEventListener('click', () => {
    optionsModal.classList.add('hidden');
  });

  optionsSave.addEventListener('click', async () => {
    const settings = {
      skillsFolder: skillsFolderInput.value
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

  toggleActiveBtn.addEventListener('click', handleToggleActive);

  // Install button
  const installBtn = document.getElementById('install-btn');
  installBtn.addEventListener('click', handleInstall);
}

// Store verified file content temporarily
let verifiedFileContent = null;

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
    // Parse skill header if present
    const skillMetadata = parseSkillHeader(verifiedFileContent);
    
    // Save file
    const fileData = {
      cid: cid,
      content: verifiedFileContent,
      tags: [],
      active: false,
      skillMetadata: skillMetadata || null,
      createdAt: new Date().toISOString()
    };

    const saveResult = await window.electronAPI.saveFile(fileData);
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
  verifiedFileContent = null; // Reset verified content

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
    await loadAndVerifyFile(cid);
    // On success, keep the panel open for review - don't clear input yet
  } catch (error) {
    // On error, keep the CID in the input and show error in panel
    // Don't clear the input or show alert - let user see the error and try again
    console.error('Error loading file:', error);
    // Hide install section on error
    document.getElementById('install-section').classList.add('hidden');
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
  const loadBtn = document.getElementById('load-btn');
  loadBtn.disabled = false;
}

async function loadAndVerifyFile(cid) {
  const gatewayStatusDiv = document.getElementById('gateway-status');
  gatewayStatusDiv.innerHTML = '<h4>Downloading from gateways...</h4>';

  // Try to download from multiple gateways
  const downloadPromises = IPFS_GATEWAYS.map(async (gateway) => {
    const gatewayName = new URL(gateway).hostname;
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

      // Download the content
      const text = await response.text();
      
      // Check actual downloaded size
      const actualSize = new Blob([text]).size;
      if (actualSize > MAX_FILE_SIZE) {
        throw new Error(`File too large: ${(actualSize / 1024 / 1024).toFixed(2)}MB (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
      }

      gatewayItem.className = 'gateway-item success';
      gatewayItem.querySelector('.gateway-progress').textContent = 'Downloaded successfully';
      
      return { gateway: gatewayName, content: text, success: true };
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

  // Compare files from different gateways
  const verificationDiv = document.getElementById('verification-status');
  verificationDiv.innerHTML = '<h4>Verification Steps</h4>';

  // Step 1: Compare gateway downloads
  const firstContent = successfulDownloads[0].content;
  let allMatch = true;
  
  for (let i = 1; i < successfulDownloads.length; i++) {
    if (successfulDownloads[i].content !== firstContent) {
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

  // Step 2: Validate skill header (if present)
  const skillHeaderStep = document.createElement('div');
  skillHeaderStep.className = 'verification-step';
  const skillMetadata = parseSkillHeader(firstContent);
  skillHeaderStep.innerHTML = `
    <input type="checkbox" ${skillMetadata ? 'checked' : ''} disabled>
    <div class="verification-step-label">
      ${skillMetadata ? 'Valid skill header found' : 'No skill header found (file may not be a skill)'}
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

    // Parse skill header if present for display
    const skillMetadata = parseSkillHeader(firstContent);
    
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
  const files = await window.electronAPI.getFiles();
  const fileTree = document.getElementById('file-tree');
  fileTree.innerHTML = '';

  // Parse skill metadata for files that don't have it (backward compatibility)
  for (const file of files) {
    if (!file.skillMetadata && file.content) {
      file.skillMetadata = parseSkillHeader(file.content);
      // Update file if metadata was found
      if (file.skillMetadata) {
        await window.electronAPI.saveFile(file);
      }
    }
  }

  // Group files by tags
  const tagGroups = {};
  const untaggedFiles = [];

  files.forEach(file => {
    if (file.tags && file.tags.length > 0) {
      file.tags.forEach(tag => {
        if (!tagGroups[tag]) {
          tagGroups[tag] = [];
        }
        tagGroups[tag].push(file);
      });
    } else {
      untaggedFiles.push(file);
    }
  });

  // Render tag groups
  Object.keys(tagGroups).sort().forEach(tag => {
    const tagGroup = document.createElement('div');
    tagGroup.className = 'tag-group';
    
    const tagHeader = document.createElement('div');
    tagHeader.className = 'tag-header';
    tagHeader.textContent = tag;
    tagHeader.addEventListener('click', () => {
      tagHeader.classList.toggle('collapsed');
      tagFiles.classList.toggle('collapsed');
    });

    const tagFiles = document.createElement('div');
    tagFiles.className = 'tag-files';
    
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
  
  // Use skill name if available, otherwise use CID
  const displayName = file.skillMetadata?.name || file.cid.substring(0, 20) + '...';
  const displayTitle = file.skillMetadata 
    ? `${file.skillMetadata.name} (${file.cid})${file.active ? ' - Active' : ''}`
    : file.cid + (file.active ? ' (Active)' : '');
  
  fileItem.textContent = displayName;
  fileItem.title = displayTitle;
  fileItem.dataset.cid = file.cid;

  fileItem.addEventListener('click', async (e) => {
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

  // Parse skill metadata if not already present (for backward compatibility)
  if (!file.skillMetadata && file.content) {
    file.skillMetadata = parseSkillHeader(file.content);
    // Update file if metadata was found
    if (file.skillMetadata) {
      const updateResult = await window.electronAPI.saveFile(file);
      if (!updateResult.success) {
        console.warn('Failed to update file with skill metadata');
      }
    }
  }

  currentFile = file;

  // Show preview panel
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('loading-panel').classList.add('hidden');
  document.getElementById('file-preview').classList.remove('hidden');

  // Set preview title
  const title = file.skillMetadata?.name 
    ? `${file.skillMetadata.name} (CID: ${cid})`
    : `CID: ${cid}`;
  document.getElementById('preview-title').textContent = title;
  
  // Update blockchain verify link with CID and trigger render
  const previewClverify = document.getElementById('preview-clverify');
  const filePreview = document.getElementById('file-preview');
  if (previewClverify) {
    previewClverify.setAttribute('cid', cid);
    // If already rendered by CLVerify, remove and recreate the element
    const previewActions = document.querySelector('.preview-actions');
    const existingLink = previewActions ? previewActions.querySelector('a[cid].clv-inline-link') : null;
    if (existingLink && existingLink.id !== 'preview-clverify') {
      // CLVerify has replaced our <a> tag, recreate it
      const newLink = document.createElement('a');
      newLink.id = 'preview-clverify';
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
      window.CLVerify.scan(filePreview);
      // Fix image URLs after rendering
      setTimeout(() => fixCLVerifyImages(filePreview), 100);
    }
  }

  // Display skill metadata if available
  const skillMetadataDiv = document.getElementById('skill-metadata');
  if (file.skillMetadata) {
    skillMetadataDiv.classList.remove('hidden');
    let metadataHtml = '<div class="skill-metadata-content"><h4>Skill Information</h4>';
    
    if (file.skillMetadata.name) {
      metadataHtml += `<div class="metadata-item"><strong>Name:</strong> ${escapeHtml(file.skillMetadata.name)}</div>`;
    }
    if (file.skillMetadata.version) {
      metadataHtml += `<div class="metadata-item"><strong>Version:</strong> ${escapeHtml(file.skillMetadata.version)}</div>`;
    }
    if (file.skillMetadata.description) {
      metadataHtml += `<div class="metadata-item"><strong>Description:</strong> ${escapeHtml(file.skillMetadata.description)}</div>`;
    }
    if (file.skillMetadata.homepage) {
      metadataHtml += `<div class="metadata-item"><strong>Homepage:</strong> <a href="${escapeHtml(file.skillMetadata.homepage)}" target="_blank">${escapeHtml(file.skillMetadata.homepage)}</a></div>`;
    }
    if (file.skillMetadata.metadata) {
      metadataHtml += `<div class="metadata-item"><strong>Metadata:</strong> <pre>${escapeHtml(JSON.stringify(file.skillMetadata.metadata, null, 2))}</pre></div>`;
    }
    
    metadataHtml += '</div>';
    skillMetadataDiv.innerHTML = metadataHtml;
  } else {
    skillMetadataDiv.classList.add('hidden');
  }

  // Set preview content
  document.getElementById('preview-content').textContent = file.content;

  // Calculate and display CID
  await updateCidDisplay(cid);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function updateCidDisplay(cid) {
  const cidDisplay = document.getElementById('cid-display');
  const file = await window.electronAPI.readFile(cid);
  
  if (!file) return;

  try {
    const hashResult = await window.electronAPI.calculateHash(file.content);
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
    cidDisplay.innerHTML = `
      <div class="cid-display-label">Error calculating CID:</div>
      <div class="cid-display-value" style="color: #f48771">${error.message}</div>
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
  verifiedFileContent = null; // Reset verified content

  // Hide install section if it was shown
  document.getElementById('install-section').classList.add('hidden');

  // Clear verification status to reset checkboxes
  document.getElementById('verification-status').innerHTML = '';
  document.getElementById('gateway-status').innerHTML = '';

  // Show loading panel
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('loading-panel').classList.remove('hidden');

  try {
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
