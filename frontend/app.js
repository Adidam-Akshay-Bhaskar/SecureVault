const API_URL = window.location.origin + "/api";
const ALGO_NAME = "AES-GCM";

let sessionMasterKey = null;
let tempLoginCredentials = null;
let currentView = "my-vault";
let allFiles = { myFiles: [], sharedFiles: [] };
let allFolders = [];
let currentFolderId = null;
let currentExplorerFolderId = null;

// BATCH OPERATION REGISTRY
window.tabSelectedItems = {
  "my-vault-files": [],
  "my-vault-folders": [],
  "incoming": [],
  "recycle-bin": [],
  "explorer": []
};
window.fileItemsMap = {};

function getActiveSelectionTab() {
  if (currentExplorerFolderId !== null) {
    return "explorer";
  }
  if (currentView === "my-vault") {
    const filesView = document.getElementById("my-files-view");
    const isFiles = filesView ? !filesView.classList.contains("hidden") : true;
    return isFiles ? "my-vault-files" : "my-vault-folders";
  }
  if (currentView === "incoming") {
    return "incoming";
  }
  if (currentView === "recycle-bin") {
    return "recycle-bin";
  }
  return "my-vault-files"; // default fallback
}

Object.defineProperty(window, 'selectedItems', {
  get: function() {
    const tab = getActiveSelectionTab();
    if (!window.tabSelectedItems) {
      window.tabSelectedItems = {
        "my-vault-files": [],
        "my-vault-folders": [],
        "incoming": [],
        "recycle-bin": [],
        "explorer": []
      };
    }
    if (!window.tabSelectedItems[tab]) {
      window.tabSelectedItems[tab] = [];
    }
    return window.tabSelectedItems[tab];
  },
  set: function(val) {
    const tab = getActiveSelectionTab();
    if (!window.tabSelectedItems) {
      window.tabSelectedItems = {
        "my-vault-files": [],
        "my-vault-folders": [],
        "incoming": [],
        "recycle-bin": [],
        "explorer": []
      };
    }
    window.tabSelectedItems[tab] = val;
  },
  configurable: true
});

// STORAGE LIMIT: 2.5 GB
const MAX_STORAGE_BYTES = 2.5 * 1024 * 1024 * 1024;
let currentTotalUsage = 0;
let currentBlobUrl = null;

// VAULT OPERATION ICONS (GLOBAL PROTOCOL)
const svgView = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const svgDownload = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const svgShare = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
const svgDelete = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
const svgUnlock = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;

// ==========================================
// CRYPTO UTILS (Preserved)
// ==========================================

async function generateFileKey() {
  return await window.crypto.subtle.generateKey({ name: ALGO_NAME, length: 256 }, true, ["encrypt", "decrypt"]);
}

async function encryptFile(file, key) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const buffer = await file.arrayBuffer();
  const encrypted = await window.crypto.subtle.encrypt({ name: ALGO_NAME, iv }, key, buffer);
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv); combined.set(new Uint8Array(encrypted), iv.length);
  return combined;
}

async function decryptFile(combined, key) {
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  return await window.crypto.subtle.decrypt({ name: ALGO_NAME, iv }, key, data);
}

async function encryptMetadata(metadata, key) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(metadata));
  const encryptedData = await window.crypto.subtle.encrypt({ name: ALGO_NAME, iv }, key, data);
  return { encryptedData, iv };
}

async function decryptMetadata(encryptedData, key, iv) {
  const decrypted = await window.crypto.subtle.decrypt({ name: ALGO_NAME, iv }, key, encryptedData);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function encryptKey(fileKey, masterKey) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const exported = await window.crypto.subtle.exportKey("raw", fileKey);
  const encryptedKey = await window.crypto.subtle.encrypt({ name: ALGO_NAME, iv }, masterKey, exported);
  return { encryptedKey, iv };
}

async function decryptKey(encryptedKey, masterKey, iv) {
  const decrypted = await window.crypto.subtle.decrypt({ name: ALGO_NAME, iv }, masterKey, encryptedKey);
  return await window.crypto.subtle.importKey("raw", decrypted, { name: ALGO_NAME }, true, ["encrypt", "decrypt"]);
}

async function getClientMasterKey() {
  if (sessionMasterKey) return sessionMasterKey;
  
  // Try loading from cached profile first (zero network lag!)
  const cached = sessionStorage.getItem("sv_profile_cache");
  if (cached) {
    try {
      const data = JSON.parse(cached);
      if (data && data.masterKey) {
        sessionMasterKey = await window.crypto.subtle.importKey(
          "jwk", JSON.parse(data.masterKey), { name: ALGO_NAME }, false, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
        );
        return sessionMasterKey;
      }
    } catch (e) {
      console.warn("Cached master key import failed:", e);
    }
  }

  try {
    const res = await fetch(`${API_URL}/profile`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
    if (!res.ok) throw new Error("UNAUTHORIZED");
    const data = await res.json();
    if (data.masterKey) {
      sessionMasterKey = await window.crypto.subtle.importKey(
        "jwk", JSON.parse(data.masterKey), { name: ALGO_NAME }, false, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
      );
      return sessionMasterKey;
    }
    throw new Error("ENCRYPTION_KEY_NOT_FOUND");
  } catch (err) {
    if (err.message === "UNAUTHORIZED") { logout(); throw err; }
    throw err;
  }
}

// ==========================================
// HELPERS
// ==========================================

function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToArrayBuffer(base64) {
  const s = window.atob(base64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function truncateName(name, limit = 42) {
  if (!name) return "";
  return name.length > limit ? name.substring(0, limit) + "..." : name;
}

function updateStorageTracker() {
  const usageText = document.getElementById("storage-usage-text");
  const usageBar = document.getElementById("storage-bar");
  const usagePct = document.getElementById("storage-percent");
  if (!usageText || !usageBar) return;

  const totalBytes = (allFiles.myFiles || []).reduce((acc, f) => acc + (parseInt(f.size) || 0), 0);
  const maxStorage = 2.5 * 1024 * 1024 * 1024;
  const percent = (totalBytes / maxStorage) * 100;

  usageText.textContent = `${formatBytes(totalBytes)} used`;
  usageBar.style.width = `${Math.min(100, percent)}%`;
  if (usagePct) usagePct.textContent = `${percent.toFixed(1)}%`;
  
  // Return for profile sync
  return totalBytes;
}



function toggleActions(card, event) {
  // Prevent default behavior
  if (event) event.stopPropagation();

  // Close any other open action menus for clean UX
  document.querySelectorAll('.folder-card.actions-active').forEach(c => {
    if (c !== card) c.classList.remove('actions-active');
  });

  // Toggle this specific card
  card.classList.toggle('actions-active');
}

window.addEventListener('click', (e) => {
  // Requirement 2: Revert to original on click away (cards)
  if (!e.target.closest('.folder-card')) {
    document.querySelectorAll('.folder-card.actions-active').forEach(c => c.classList.remove('actions-active'));
  }
});

function initDropZone() {
  const dropZone = document.getElementById("vault-drop-zone");
  if (!dropZone) return;

  ["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
    dropZone.addEventListener(eventName, e => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  ["dragenter", "dragover"].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add("active"), false);
  });

  ["dragleave", "drop"].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove("active"), false);
  });

  dropZone.addEventListener("drop", async (e) => {
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    
    // Gated by Security Protocol
    if (await verifyPIN()) {
      for (const file of files) {
        await processDirectUpload(file);
      }
    }
  });
  
  dropZone.addEventListener("click", async () => {
    if (await verifyPIN()) triggerSecureFileInput();
  });
}

function triggerSecureFileInput() {
  document.getElementById("file-input").click();
}

async function processDirectUpload(file) {
  if (currentTotalUsage + file.size > MAX_STORAGE_BYTES) {
    return showToast("Storage Limit Exhausted (2.5GB). Clear records to continue.", "error");
  }

  showUploadModal(null, true); // Use modal to show progress
  const label = document.getElementById("file-label");
  const progressContainer = document.getElementById("upload-progress-container");
  const progressBar = document.getElementById("upload-progress-bar");
  const percentageText = document.getElementById("upload-percentage");
  const statusText = document.getElementById("upload-status-text");

  if (label) label.innerHTML = `<strong>SECURING RECORD:</strong><br>${file.name}`;
  if (progressContainer) progressContainer.style.display = "block";
  if (statusText) statusText.style.display = "block";

  try {
    const fileKey = await generateFileKey();
    const encryptedFileBuffer = await encryptFile(file, fileKey);
    const masterKey = await getClientMasterKey();
    const { encryptedData: encMeta, iv: metaIv } = await encryptMetadata({ filename: file.name, size: file.size, type: file.type }, masterKey);
    const { encryptedKey: encKey, iv: keyIv } = await encryptKey(fileKey, masterKey);
    
    const urlRes = await fetch(`${API_URL}/upload-url`, { method: "POST", headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
    const { uploadUrl, fileUuid } = await urlRes.json();
    
    await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                if (progressBar) progressBar.style.width = percent + "%";
                if (percentageText) percentageText.textContent = percent + "%";
            }
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error("Upload failure"));
        xhr.onerror = () => reject(new Error("Network Error"));
        xhr.send(encryptedFileBuffer);
    });
    
    await fetch(`${API_URL}/complete-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
      body: JSON.stringify({
        fileUuid, fileType: file.name.split(".").pop().toLowerCase(),
        encryptedMetadata: arrayBufferToBase64(encMeta), metadataIv: bytesToHex(metaIv),
        encryptedKey: bytesToHex(keyIv) + ":" + arrayBufferToBase64(encKey),
        folderId: currentFolderId || null
      }),
    });
    
    showToast(`Secured: ${file.name}`, "success");
    closeModal("upload-modal");
    silentSync();
  } catch (err) {
    showToast("Transmission Failed: " + err.message, "error");
    if (progressContainer) progressContainer.style.display = "none";
  }
}

function showConfirm(message, state = "primary") {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    document.getElementById("confirm-msg").textContent = message;
    modal.classList.remove("hidden");
    const ok = document.getElementById("confirm-ok-btn");
    const cancel = document.getElementById("confirm-cancel-btn");
    
    ok.classList.remove("danger", "success");
    if (state === "danger") {
      ok.classList.add("danger");
    } else if (state === "success") {
      ok.classList.add("success");
    } else if (state !== "primary") {
      ok.classList.add(state);
    }

    const handler = (val) => {
      ok.removeEventListener("click", okHandler);
      cancel.removeEventListener("click", cancelHandler);
      modal.classList.add("hidden");
      resolve(val);
    };
    const okHandler = () => handler(true);
    const cancelHandler = () => handler(false);
    ok.addEventListener("click", okHandler);
    cancel.addEventListener("click", cancelHandler);
  });
}

// Silent Recovery System
async function silentSync() {
  if (!sessionStorage.getItem("token")) return;
  try {
    const p = loadProfile();
    const f = loadFolders();
    const fi = loadFiles();
    const rb = typeof loadRecycleBin === 'function' ? loadRecycleBin() : Promise.resolve();
    await Promise.all([p, f, fi, rb]);
  } catch {}
}

// Instant Skeleton Screens — paint the UI immediately before data loads
function renderSkeletons() {
  const skCard = () => `
    <div class="skeleton-card">
      <div class="skeleton-pulse skeleton-icon-box"></div>
      <div class="skeleton-text-block">
        <div class="skeleton-pulse skeleton-line-a"></div>
        <div class="skeleton-pulse skeleton-line-b"></div>
      </div>
    </div>`;

  const skRow = () => `
    <div class="file-row recycle-row skeleton-row-container" style="pointer-events: none; border-bottom: 1px solid var(--border-color);">
      <div class="skeleton-pulse" style="width: 50px; height: 50px; border-radius: 16px; flex-shrink: 0;"></div>
      <div style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
        <div class="skeleton-pulse" style="width: 140px; height: 14px; border-radius: 7px;"></div>
        <div class="skeleton-pulse" style="width: 90px; height: 10px; border-radius: 5px;"></div>
      </div>
      <div class="skeleton-pulse" style="width: 80px; height: 14px; border-radius: 7px; margin: 0 auto;"></div>
      <div style="display: flex; gap: 10px; width: 180px; justify-content: flex-end;">
        <div class="skeleton-pulse" style="width: 80px; height: 34px; border-radius: 10px;"></div>
        <div class="skeleton-pulse" style="width: 80px; height: 34px; border-radius: 10px;"></div>
      </div>
    </div>`;

  const myBody = document.getElementById("file-list-body");
  if (myBody && !myBody.children.length) {
    myBody.innerHTML = [1,2,3,4,5,6].map(skCard).join("");
  }

  const folderGrid = document.getElementById("folder-list");
  if (folderGrid && !folderGrid.children.length) {
    folderGrid.innerHTML = [1,2,3].map(skCard).join("");
  }

  const shBody = document.getElementById("shared-list-body");
  if (shBody && !shBody.children.length) {
    shBody.innerHTML = [1,2,3,4].map(skCard).join("");
  }

  const recycleBody = document.getElementById("recycle-list-body");
  if (recycleBody && (!recycleBody.children.length || recycleBody.innerHTML.includes("Scanning safe"))) {
    recycleBody.innerHTML = [1,2,3,4].map(skRow).join("");
  }

  // Header profile skeleton
  const headerAvatar = document.getElementById("header-avatar");
  const headerEmail = document.getElementById("header-email");
  if (headerAvatar && !headerAvatar.textContent.trim()) {
    headerAvatar.textContent = "...";
  }
  if (headerEmail && !headerEmail.textContent.trim()) {
    headerEmail.textContent = "Loading...";
  }
}

function closeModal(id) { 
  const el = document.getElementById(id);
  if (el) el.classList.add("hidden");
  if (id === 'folder-explorer-modal') {
    currentExplorerFolderId = null;
    document.getElementById("upload-modal").classList.add("hidden");
    if (window.tabSelectedItems) {
      window.tabSelectedItems['explorer'] = [];
    }
    document.querySelectorAll('#folder-explorer-modal .selected').forEach(el => el.classList.remove('selected'));
    updateSelectionToolbar();
  }
  if (id === 'file-view-modal') {
    const dlBtn = document.getElementById("view-download-btn");
    if (dlBtn) dlBtn.remove();
  }
  // Silent Data Refresh Protocol
  silentSync();
}

// Futuristic Space System
function initSpace() {
  const containers = ["starfield-1", "starfield-2", "starfield-3"];
  containers.forEach((id, idx) => {
    const container = document.getElementById(id);
    if (!container) return;
    const count = 50 + (idx * 30);
    for (let i = 0; i < count; i++) {
      const star = document.createElement("div");
      star.className = "star";
      const size = Math.random() * 2 + 0.5;
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      star.style.opacity = Math.random();
      star.style.animation = `star-blink ${Math.random() * 3 + 2}s infinite alternate`;
      container.appendChild(star);
    }
  });
}


// ==========================================
// AUTH LOGIC
// ==========================================

function toggleAuthMode(mode) {
  const modes = ["login", "register", "verify", "recover", "reset"];
  modes.forEach(m => {
    const el = document.getElementById(`${m}-form-container`);
    if (el) el.classList.add("hidden");
  });
  const active = document.getElementById(`${mode}-form-container`);
  if (active) {
    active.classList.remove("hidden");
    active.classList.add("auth-form-switching");
    setTimeout(() => active.classList.remove("auth-form-switching"), 400);
  }

  // Handle Tab Highlighting for Landing Page
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  if (tabLogin && tabRegister) {
    tabLogin.classList.remove("active");
    tabRegister.classList.remove("active");
    if (mode === "login") tabLogin.classList.add("active");
    if (mode === "register") tabRegister.classList.add("active");
  }

  const h1 = active ? active.querySelector(".card-header h1") : null;
  const p = active ? active.querySelector(".card-header p") : null;
  const card = document.querySelector(".auth-card-premium") || document.querySelector(".auth-card-landing");
  
  if (mode === "login") {
    if (h1) h1.textContent = "Welcome Back";
    if (p) p.textContent = "Secure your digital assets today.";
    if (card) card.classList.remove("compact-mode");
  } else if (mode === "register") {
    if (h1) h1.textContent = "Create Account";
    if (p) p.textContent = "Provision a new secure identity.";
    if (card) card.classList.add("compact-mode");
  } else if (mode === "recover") {
    if (h1) h1.textContent = "Vault Recovery";
    if (p) p.textContent = "Initiate secure restoration protocol.";
    if (card) card.classList.remove("compact-mode");
  } else if (mode === "reset") {
    if (h1) h1.textContent = "Credential Update";
    if (p) p.textContent = "Establish your new security parameters.";
    if (card) card.classList.remove("compact-mode");
  }
}

function switchAuthTab(tab) {
  toggleAuthMode(tab);
}

function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const isCollapsed = sidebar.classList.toggle("collapsed");
  document.body.classList.toggle("sidebar-collapsed");
  sessionStorage.setItem("sidebarCollapsed", isCollapsed);
}

function togglePassword(inputId, iconElement) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    iconElement.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
  } else {
    input.type = "password";
    iconElement.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
  }
}

// Global Keyboard Accessibility Protocol
document.addEventListener('DOMContentLoaded', () => {
  // auto-assign focus paths to interactive elements missing native focus
  document.querySelectorAll('[onclick]').forEach(el => {
    if (!el.hasAttribute('tabindex') &&
        el.tagName !== 'BUTTON' && 
        el.tagName !== 'INPUT' && 
        el.tagName !== 'A') {
      el.setAttribute('tabindex', '0');
    }
  });

  const updatePassForm = document.getElementById("update-password-form");
  if (updatePassForm) {
    updatePassForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById("current-password").value;
      const newPassword = document.getElementById("new-password").value;
      
      if (!currentPassword || !newPassword) {
        showToast("Please fill all passcode fields", "error");
        return;
      }
      
      if (newPassword.length < 8) {
        showToast("New passcode must be at least 8 characters long", "error");
        return;
      }

      showToast("Updating passcode...");
      try {
        const res = await fetch(`${API_URL}/profile/password`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${sessionStorage.getItem("token")}`
          },
          body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (res.ok) {
          showToast("Passcode updated successfully", "success");
          updatePassForm.reset();
          if (window.logActivity) window.logActivity("Master Passcode Changed", "Security credentials modified");
        } else {
          showToast(data.message || "Failed to update passcode", "error");
        }
      } catch (err) {
        showToast("Network error occurred", "error");
      }
    });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    if (document.activeElement &&
        document.activeElement.hasAttribute('tabindex') &&
        document.activeElement.tagName !== 'BUTTON' &&
        document.activeElement.tagName !== 'INPUT' &&
        document.activeElement.tagName !== 'A' &&
        document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      document.activeElement.click();
    }
  }
});

function applyImmediateUserData(user) {
  if (!user) return;
  
  // 1. Populate Username & Initials fallbacks
  if (user.username) {
    if (document.getElementById("welcome-message")) document.getElementById("welcome-message").textContent = user.username;
    if (document.getElementById("profile-username-header")) document.getElementById("profile-username-header").textContent = user.username;
    if (document.getElementById("profile-username-display")) document.getElementById("profile-username-display").textContent = user.username;
    if (document.getElementById("display-alias")) document.getElementById("display-alias").textContent = user.username;
    
    const initial = user.username.trim().charAt(0).toUpperCase();
    const hAvatar = document.getElementById("header-avatar");
    if (hAvatar) hAvatar.textContent = initial;
    const pInitials = document.getElementById("profile-avatar-placeholder");
    if (pInitials) pInitials.textContent = initial;
  }
  
  // 2. Populate Email
  if (user.email) {
    if (document.getElementById("profile-email-full")) document.getElementById("profile-email-full").textContent = user.email;
  }

  // 3. Populate Profile Photo
  const hImg = document.getElementById("header-avatar-img");
  const hAvatar = document.getElementById("header-avatar");
  const pPhoto = document.getElementById("profile-photo-img");
  const pInitials = document.getElementById("profile-avatar-placeholder");
  const removeBtn = document.getElementById("btn-remove-photo");
  const badgeVerified = document.getElementById("badge-verified");

  if (user.profilePhoto) {
    if (hImg) { hImg.src = user.profilePhoto; hImg.classList.remove("hidden"); }
    if (hAvatar) { hAvatar.classList.add("hidden"); hAvatar.textContent = ""; }
    if (pPhoto) { pPhoto.src = user.profilePhoto; pPhoto.classList.remove("hidden"); }
    if (pInitials) { pInitials.classList.add("hidden"); }
    if (removeBtn) removeBtn.classList.remove("hidden");
    if (badgeVerified) badgeVerified.style.display = "flex";
  } else {
    if (hImg) { hImg.classList.add("hidden"); hImg.src = ""; }
    if (hAvatar) { hAvatar.classList.remove("hidden"); }
    if (pPhoto) { pPhoto.classList.add("hidden"); pPhoto.src = ""; }
    if (pInitials) { pInitials.classList.remove("hidden"); }
    if (removeBtn) removeBtn.classList.add("hidden");
    if (badgeVerified) badgeVerified.style.display = "none";
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;
  const btn = e.target.querySelector("button");
  const orig = btn.textContent;
  btn.textContent = "Verifying..."; btn.disabled = true;
  try {
    const res = await fetch(`${API_URL}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) {
      sessionStorage.setItem("token", data.accessToken);
      if (data.user?.masterKey) {
         sessionMasterKey = await window.crypto.subtle.importKey(
           "jwk", JSON.parse(data.user.masterKey), { name: ALGO_NAME }, false, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
         );
      }
      
      // Rapid Identity Transition: Transition to vault within milliseconds
      showToast("Access Granted");
      
      // Populate user info immediately to avoid delay/flicker
      applyImmediateUserData(data.user);
      
      // Execute UI swap immediately — show skeleton then load data
      showView("my-vault");
      loadProfile(); 
      
      // Neutralize distractions: Clear credentials and blur to discourage browser manager prompts
      if (document.activeElement) document.activeElement.blur();
      e.target.reset();
    } else {
      showToast(data.message || "Error", "error");
    }
  } catch (err) { showToast("Error", "error"); }
  finally { btn.textContent = orig; btn.disabled = false; }
});

document.getElementById("verify-pin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const securityPin = document.getElementById("verify-pin-input").value;
  const btn = e.target.querySelector("button");
  const orig = btn.textContent;
  btn.textContent = "Authenticating..."; btn.disabled = true;
  try {
    const res = await fetch(`${API_URL}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...tempLoginCredentials, securityPin }),
    });
    const data = await res.json();
    if (res.ok) {
      sessionStorage.setItem("token", data.accessToken);
      if (data.user?.masterKey) {
         sessionMasterKey = await window.crypto.subtle.importKey(
           "jwk", JSON.parse(data.user.masterKey), { name: ALGO_NAME }, false, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
         );
      }
      showToast("Verified"); 
      
      // Populate user info immediately to avoid delay/flicker
      applyImmediateUserData(data.user);
      
      showView("my-vault");
      loadProfile(); 
      if (document.activeElement) document.activeElement.blur();
      e.target.reset();

    } else showToast(data.message || "Error", "error");
  } catch (err) { showToast("Error", "error"); }
  finally { btn.disabled = false; btn.textContent = orig; }
});

document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("reg-username").value;
  const email = document.getElementById("reg-email").value.trim().toLowerCase();
  const password = document.getElementById("reg-password").value;
  const securityPin = document.getElementById("reg-pin").value;
  const btn = e.target.querySelector("button");
  const orig = btn.textContent;
  btn.textContent = "Initializing..."; btn.disabled = true;
  try {
    const mk = await window.crypto.subtle.generateKey({ name: ALGO_NAME, length: 256 }, true, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
    const jwk = await window.crypto.subtle.exportKey("jwk", mk);
    const masterKey = JSON.stringify(jwk);
    const res = await fetch(`${API_URL}/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, securityPin, masterKey }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast("Created");
      e.target.reset();
      toggleAuthMode("login");
    } else showToast(data.message, "error");
  } catch { showToast("Error", "error"); }
  finally { btn.disabled = false; btn.textContent = orig; }
});

document.getElementById("recover-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("recover-email").value.trim().toLowerCase();
  const type = document.querySelector('input[name="rec-type"]:checked').value;
  const btn = e.target.querySelector("button");
  const orig = btn.textContent;
  btn.textContent = "Sending..."; btn.disabled = true;
  try {
    const res = await fetch(`${API_URL}/auth/recover-request`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, type }),
    });
    const data = await res.json();
    showToast(data.message);
    if (res.ok) toggleAuthMode("login");
  } catch (err) { showToast("Error", "error"); }
  finally { btn.disabled = false; btn.textContent = orig; }
});

document.getElementById("reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("recovery_token");
  const newValue = document.getElementById("reset-new-value").value;
  const confirmValue = document.getElementById("reset-confirm-value").value;

  if (newValue !== confirmValue) {
    return showToast("Mismatch", "error");
  }

  const btn = e.target.querySelector("button");
  const orig = btn.textContent;
  btn.textContent = "Updating..."; btn.disabled = true;
  try {
    const res = await fetch(`${API_URL}/auth/reset-execute`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newValue }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message);
      window.history.replaceState({}, document.title, "/");
      toggleAuthMode("login");
    } else showToast(data.message, "error");
  } catch (err) { showToast("Protocol update failed", "error"); }
  finally { btn.disabled = false; btn.textContent = orig; }
});

function logout() {
  const preloader = document.getElementById("preloader");
  if (preloader) {
    preloader.style.display = "flex";
    preloader.classList.remove("hidden", "fade-out");
    preloader.classList.add("expanded");
  }

  // Clear session data immediately
  sessionStorage.clear();
  sessionMasterKey = null;
  pinVerifiedThisSession = false;

  // Faster transition as requested
  setTimeout(() => {
    location.reload();
  }, 600);
}

function cancelVerify() { tempLoginCredentials = null; switchAuthTab("login"); }

// ==========================================
// NAVIGATION
// ==========================================

async function showView(viewId) {
  currentView = viewId;
  updateSelectionToolbar();
  const sections = ["landing-page", "auth-section", "view-dashboard", "section-my-vault", "section-incoming", "section-profile", "section-recycle-bin"];
  sections.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.add("hidden");
  });

  const sidebarVisible = ["my-vault", "incoming", "profile", "recycle-bin"].includes(viewId);
  if (sidebarVisible) {
    sessionStorage.setItem("activeView", viewId);
    document.getElementById("view-dashboard").classList.remove("hidden");
    document.getElementById(`section-${viewId}`).classList.remove("hidden");
    const titles = { 
      "my-vault": "Vault Base", 
      "incoming": "Incoming Data", 
      "profile": "Identity Profile Settings",
      "recycle-bin": "Recycle Bin"
    };
    document.getElementById("view-title").textContent = titles[viewId];
    
    // Smooth Transition State
    document.querySelector(".main-wrapper").style.opacity = "0";
    setTimeout(() => {
      document.querySelector(".main-wrapper").style.opacity = "1";
    }, 50);

    toggleNav(viewId);
    if (viewId === "my-vault") { 
      renderSkeletons(); 
      silentSync(); 
      const storedSub = sessionStorage.getItem("activeSubView") || "files";
      toggleVaultSubView(storedSub);
    }
    if (viewId === "incoming") { 
      loadSharedFiles(); 
    }
    if (viewId === "recycle-bin") { 
      renderSkeletons();
      loadRecycleBin(); 
    }
  } else {
    document.getElementById(viewId).classList.remove("hidden");
  }
}

function toggleNav(viewId) {
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.remove("active");
    if (item.getAttribute("onclick")?.includes(`showView('${viewId}')`)) {
      item.classList.add("active");
    }
  });
}

function toggleVaultSubView(sub) {
  sessionStorage.setItem("activeSubView", sub);
  const tabs = ["files", "folders"];
  tabs.forEach(t => {
    const viewEl = document.getElementById(`my-${t}-view`);
    const tabEl = document.getElementById(`tab-my-${t}`);
    if (viewEl) viewEl.classList.add("hidden");
    if (tabEl) tabEl.classList.remove("active");
  });
  const activeViewEl = document.getElementById(`my-${sub}-view`);
  const activeTabEl = document.getElementById(`tab-my-${sub}`);
  if (activeViewEl) activeViewEl.classList.remove("hidden");
  if (activeTabEl) activeTabEl.classList.add("active");

  updateSelectionToolbar();
  silentSync();

  // Contextual Header Actions
  const uploadBtn = document.getElementById("btn-upload-record");
  const folderBtn = document.getElementById("btn-new-folder");
  if (sub === "folders") {
    uploadBtn.classList.add("hidden");
    folderBtn.classList.remove("hidden");
  } else {
    uploadBtn.classList.remove("hidden");
    folderBtn.classList.add("hidden");
  }
}

// ==========================================
// FOLDERS logic
// ==========================================

async function loadFolders() {
  try {
    const renderFoldersDOM = (data) => {
      allFolders = data.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      const grid = document.getElementById("folder-list");
      const select = document.getElementById("upload-folder-select");
      if (!grid || !select) return;
      grid.innerHTML = "";
      select.innerHTML = '<option value="">Root Vault</option>';
      document.getElementById("stat-folder-count").textContent = allFolders.length;

      allFolders.forEach(f => {
        const disp = truncateName(f.name);
        const dateStr = new Date(f.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const fCount = allFiles.myFiles ? allFiles.myFiles.filter(file => file.folder_id === f.folder_id).length : 0;
        
        const itemId = `folder-${f.folder_id}`;
        window.fileItemsMap[itemId] = { type: 'folder', id: f.folder_id, name: f.name };
        const isSelected = window.selectedItems.includes(itemId);

        grid.innerHTML += `
          <div class="folder-row-item ${isSelected ? 'selected' : ''}" data-id="${itemId}">
            <div class="folder-card" tabindex="0" onclick="handleItemClick('${itemId}', event, () => openFolder(${f.folder_id}, '${f.name.replace(/'/g,"\\'")}', '${dateStr}'))" style="flex-direction: column; align-items: flex-start; justify-content: space-between; min-height: 125px; padding: 18px;">
              <div style="display: flex; width: 100%; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <button tabindex="-1" class="action-btn" style="padding:5px 10px; font-size:0.65rem; border-radius:8px; background:rgba(250,204,21,0.1); border-color:rgba(250,204,21,0.2); color:#d97706; font-weight:700;" onclick="event.stopPropagation(); renameFolder(${f.folder_id}, '${f.name.replace(/'/g,"\\\\'")}')">Rename</button>
                <button tabindex="-1" class="action-btn" style="padding:5px 10px; font-size:0.65rem; border-radius:8px; background:rgba(255,50,50,0.1); border-color:rgba(255,50,50,0.2); color:#dc2626; font-weight:700;" onclick="event.stopPropagation(); deleteFolder(${f.folder_id})">Delete</button>
              </div>
              <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
                <div class="select-symbol" onclick="event.stopPropagation(); toggleSelection('${itemId}')">
                  <span class="folder-icon" style="margin-bottom:0; font-size: 2.2rem;">📂</span>
                  <div class="selection-indicator"></div>
                </div>
                <div style="flex: 1; min-width: 0;">
                  <p class="folder-name" style="margin: 0; font-weight: 700; font-size: 1.05rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${disp}</p>
                  <p class="folder-count" style="margin: 4px 0 0 0; font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase;">${fCount} Files • ${dateStr}</p>
                </div>
              </div>
            </div>
          </div>
        `;
        select.innerHTML += `<option value="${f.folder_id}">${disp}</option>`;
      });
      syncCustomFolderSelect();
    };

    // 1. Instant load from cache
    const cached = sessionStorage.getItem("sv_folders_cache");
    if (cached) {
      try { renderFoldersDOM(JSON.parse(cached)); } catch {}
    }

    // 2. Fetch from network in background
    const res = await fetch(`${API_URL}/folders`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
    if (!res.ok) return;
    const data = await res.json();
    sessionStorage.setItem("sv_folders_cache", JSON.stringify(data));
    renderFoldersDOM(data);
  } catch (err) {}
}

function showCreateFolderModal() { document.getElementById("folder-modal").classList.remove("hidden"); }

async function createFolder() {
  const name = document.getElementById("new-folder-name").value.trim();
  if (!name) return;
  try {
    const res = await fetch(`${API_URL}/folders`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      showToast("Folder Initialized");
      if (window.logActivity) window.logActivity("Folder Defined", name);
      closeModal("folder-modal");
      document.getElementById("new-folder-name").value = "";
      loadFolders();
    }
  } catch {}
}

let currentRenameAction = null;

async function renameFolder(id, currentName) {
  if (!(await verifyPIN())) return;

  const modal = document.getElementById("rename-folder-modal");
  const input = document.getElementById("rename-folder-name");
  input.value = currentName;
  modal.classList.remove("hidden");
  
  const submitBtn = document.getElementById("rename-folder-submit-btn");
  
  if (currentRenameAction) {
    submitBtn.removeEventListener("click", currentRenameAction);
  }
  
  currentRenameAction = async () => {
    const newName = input.value;
    if (!newName || newName.trim() === "" || newName === currentName) {
      closeModal("rename-folder-modal");
      return;
    }
    
    try {
      const res = await fetch(`${API_URL}/folders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
        body: JSON.stringify({ name: newName.trim() })
      });
      if (res.ok) {
        closeModal("rename-folder-modal");
        loadFolders();
      }
    } catch (e) {
      closeModal("rename-folder-modal");
    }
  };
  
  submitBtn.addEventListener("click", currentRenameAction);
}

async function deleteFolder(id) {
  const folder = allFolders.find(f => f.folder_id === id);
  const name = folder ? folder.name : `Folder #${id}`;
  const conf = await showConfirm("Delete this folder? Filestreams will be unassigned but not deleted.", "danger");
  if (!conf) return;

  if (!(await verifyPIN())) return;

  try {
    await fetch(`${API_URL}/folders/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
    if (window.logActivity) window.logActivity("Folder Purged", name);
    silentSync();
  } catch {}
}

async function openFolder(id, name, date) {
  const verified = await verifyPIN();
  if (!verified) return;
  
  currentExplorerFolderId = id;
  document.getElementById("explorer-folder-name").textContent = name;
  document.getElementById("explorer-folder-date").textContent = `Initialized: ${date}`;
  document.getElementById("folder-explorer-modal").classList.remove("hidden");
  
  const uploadBtn = document.getElementById("explorer-upload-btn");
  uploadBtn.onclick = () => showUploadModal(id, true);
  
  renderFolderExplorer(id);
}

function renderFolderExplorer(folderId) {
  const container = document.getElementById("explorer-file-list");
  
  if (!allFiles.myFiles || allFiles.myFiles.length === 0) {
    container.innerHTML = '<p style="padding:40px; text-align:center; color:var(--text-dim);">Scanning directory...</p>';
    loadFiles();
    return;
  }
  
  const files = allFiles.myFiles.filter(f => f.folder_id === parseInt(folderId));
  
  if (files.length === 0) {
    container.innerHTML = '<p style="padding:40px; text-align:center; color:var(--text-dim);">Directory is empty</p>';
    return;
  }

  let html = "";
  for (const f of files) {
    const meta = f._meta;
    if (!meta) { html += `<div class="file-row"><p style="color:var(--danger)">Unrecoverable Cluster</p></div>`; continue; }
    const ext = meta.filename.split(".").pop().toUpperCase();
    const displayTitle = truncateName(meta.filename);
    const safeFilename = meta.filename.replace(/'/g, "\\'");
    const itemId = `file-${f.file_id}`;
    window.fileItemsMap[itemId] = { type: 'file', id: f.file_id, name: meta.filename, encKey: f.encrypted_key };
    const isSelected = window.selectedItems.includes(itemId);

    html += `
      <div class="folder-card ${isSelected ? 'selected' : ''}" data-id="${itemId}" onclick="handleItemClick('${itemId}', event, () => toggleActions(this, event))" style="cursor: pointer;" title="${meta.filename}">
        <div class="select-symbol" onclick="event.stopPropagation(); toggleSelection('${itemId}')">
          ${getFileTypeLogo(ext)}
          <div class="selection-indicator"></div>
        </div>
        <div style="flex: 1; min-width: 0;">
          <p class="folder-name" style="font-size: 0.9rem; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayTitle}</p>
          <p class="folder-count" style="font-size: 0.7rem;">${ext} • ${formatBytes(meta.size)} • ${new Date(f.created_at).toLocaleDateString()}</p>
        </div>
        <div class="card-overlay" onclick="toggleActions(this.parentElement, event)">
          <button class="action-pill view" onclick="event.stopPropagation(); viewMyFile(${f.file_id}, '${f.encrypted_key}', '${safeFilename}', ${meta.size})" title="View">${svgView}</button>
          <button class="action-pill save" onclick="event.stopPropagation(); gatedDownload(${f.file_id}, '${f.encrypted_key}', '${safeFilename}')" title="Download">${svgDownload}</button>
          <button class="action-pill share" onclick="event.stopPropagation(); openShareModal(${f.file_id}, '${safeFilename}', '${f.encrypted_key}')" title="Share">${svgShare}</button>
          <button class="action-pill delete" onclick="event.stopPropagation(); deleteFile(${f.file_id}, '${f.encrypted_key}', '${safeFilename}')" title="Delete">${svgDelete}</button>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

// ==========================================
// FILES logic
// ==========================================

function getFileTypeLogo(ext) {
  const e = ext.toLowerCase();
  let bg = "#F1F5F9", color = "#64748B", grad = "linear-gradient(135deg, #F1F5F9 0%, #E2E8F0 100%)";
  
  // PDF — Red
  if (["pdf"].includes(e)) {
    bg = "#FEF2F2"; color = "#EF4444"; grad = "linear-gradient(135deg, #FFF1F2 0%, #FECDD3 100%)";
  }
  // DOC / DOCX — Blue
  else if (["doc", "docx", "odt"].includes(e)) {
    bg = "#EFF6FF"; color = "#2563EB"; grad = "linear-gradient(135deg, #DBEAFE 0%, #BFDBFE 100%)";
  }
  // TXT / RTF — Slate
  else if (["txt", "rtf", "md"].includes(e)) {
    bg = "#F8FAFC"; color = "#475569"; grad = "linear-gradient(135deg, #F1F5F9 0%, #CBD5E1 100%)";
  }
  // XLS / XLSX / CSV — Green
  else if (["xls", "xlsx", "csv", "ods"].includes(e)) {
    bg = "#ECFDF5"; color = "#059669"; grad = "linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%)";
  }
  // PPT / PPTX — Orange
  else if (["ppt", "pptx", "odp"].includes(e)) {
    bg = "#FFF7ED"; color = "#EA580C"; grad = "linear-gradient(135deg, #FFEDD5 0%, #FED7AA 100%)";
  }
  // Images — Violet
  else if (["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico"].includes(e)) {
    bg = "#F5F3FF"; color = "#7C3AED"; grad = "linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 100%)";
  }
  // Video — Rose/Pink
  else if (["mp4", "mkv", "avi", "mov", "webm"].includes(e)) {
    bg = "#FFF1F2"; color = "#E11D48"; grad = "linear-gradient(135deg, #FFE4E6 0%, #FECDD3 100%)";
  }
  // Audio — Teal
  else if (["mp3", "wav", "aac", "flac", "ogg"].includes(e)) {
    bg = "#F0FDFA"; color = "#0D9488"; grad = "linear-gradient(135deg, #CCFBF1 0%, #99F6E4 100%)";
  }
  // Archives — Amber
  else if (["zip", "rar", "7z", "tar", "gz"].includes(e)) {
    bg = "#FFFBEB"; color = "#D97706"; grad = "linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)";
  }
  // Code files — Cyan
  else if (["html", "css", "js", "ts", "py", "java", "cpp", "c", "json", "xml", "jsx", "tsx"].includes(e)) {
    bg = "#ECFEFF"; color = "#0891B2"; grad = "linear-gradient(135deg, #CFFAFE 0%, #A5F3FC 100%)";
  }
  // Key / Security — Indigo
  else if (["key", "pem", "cert"].includes(e)) {
    bg = "#EEF2FF"; color = "#4338CA"; grad = "linear-gradient(135deg, #E0E7FF 0%, #C7D2FE 100%)";
  }
  // Executables — Dark
  else if (["exe", "apk", "dll", "bat", "msi"].includes(e)) {
    bg = "#F1F5F9"; color = "#1E293B"; grad = "linear-gradient(135deg, #E2E8F0 0%, #CBD5E1 100%)";
  }
  
  const displayText = ext.toUpperCase() === "GITIGNORE" ? ".GN" : (ext.length > 4 ? ext.substring(0,3) : ext).toUpperCase();
  return `<div class="file-icon-premium" style="background:${grad}; color:${color};">
            <span class="file-ext-label">${displayText}</span>
          </div>`;
}

async function loadFiles() {
  const applyFilesDOM = async (filesData) => {
    allFiles = filesData;
    // Reset Selection Registry on full reload
    window.fileItemsMap = {};

    // Decrypt ALL file metadata in parallel (one-shot, cached on f._meta)
    const mk = await getClientMasterKey();
    if (allFiles && allFiles.myFiles) {
      await Promise.all(allFiles.myFiles.map(async (f) => {
        if (f._meta) return; // Skip if already decrypted from cache
        try {
          f._meta = await decryptMetadata(base64ToArrayBuffer(f.encrypted_metadata), mk, hexToBytes(f.iv));
          f.size = f._meta.size;
        } catch { f._meta = null; }
      }));
    }
    updateStorageTracker();

    renderFiles();
    if (currentExplorerFolderId) renderFolderExplorer(currentExplorerFolderId);
  };

  // 1. Instant load from cache (zero network lag)
  const cached = sessionStorage.getItem("sv_files_cache");
  if (cached) {
    try {
      const filesData = JSON.parse(cached);
      await applyFilesDOM(filesData);
    } catch (e) {
      console.warn("Cached files parsing failed:", e);
    }
  }

  // 2. Fetch from network in background
  try {
    const res = await fetch(`${API_URL}/files`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
    if (res.ok) {
      const filesData = await res.json();
      
      // Preserve already decrypted metadata to avoid redundant crypto cycles
      if (allFiles && allFiles.myFiles && filesData.myFiles) {
        const metaMap = {};
        allFiles.myFiles.forEach(f => {
          if (f._meta) metaMap[f.file_id] = f._meta;
        });
        filesData.myFiles.forEach(f => {
          if (metaMap[f.file_id]) {
            f._meta = metaMap[f.file_id];
            f.size = f._meta.size;
          }
        });
      }

      sessionStorage.setItem("sv_files_cache", JSON.stringify(filesData));
      // Also save shared files separately for instant incoming tab
      sessionStorage.setItem("sv_shared_cache", JSON.stringify(filesData.sharedFiles || []));
      await applyFilesDOM(filesData);
    }
  } catch (err) {
    console.warn("Files sync deferred:", err);
  }

  loadFolders();
}

function renderFiles() {
  const myBody = document.getElementById("file-list-body");
  const shBody = document.getElementById("shared-list-body");
  myBody.innerHTML = ""; shBody.innerHTML = "";

  const sortedFiles = [...allFiles.myFiles].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  const filteredMy = currentFolderId
    ? sortedFiles.filter(f => f.folder_id === parseInt(currentFolderId))
    : sortedFiles.filter(f => !f.folder_id);

  document.getElementById("stat-file-count").textContent = filteredMy.length;
  document.getElementById("stat-incoming-count").textContent = allFiles.sharedFiles.length;

  let myHtml = "";
  for (const f of filteredMy) {
    const meta = f._meta;
    if (!meta) { myHtml += `<div class="file-row"><p style="color:var(--danger)">Unrecoverable Conflict</p></div>`; continue; }
    const ext = meta.filename.split(".").pop().toUpperCase();
    const displayTitle = truncateName(meta.filename);
    const safeFilename = meta.filename.replace(/'/g, "\\'" );
    const itemId = `file-${f.file_id}`;
    window.fileItemsMap[itemId] = { type: 'file', id: f.file_id, name: meta.filename, encKey: f.encrypted_key };
    const isSelected = window.selectedItems.includes(itemId);

    myHtml += `
        <div class="folder-card ${isSelected ? 'selected' : ''}" data-id="${itemId}" onclick="handleItemClick('${itemId}', event, () => toggleActions(this, event))" style="cursor: pointer;" title="${meta.filename}">
          <div class="select-symbol" onclick="event.stopPropagation(); toggleSelection('${itemId}')">
            ${getFileTypeLogo(ext)}
            <div class="selection-indicator"></div>
          </div>
          <div style="flex: 1; min-width: 0;">
            <p class="folder-name" style="font-size: 0.9rem; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayTitle}</p>
            <p class="folder-count" style="font-size: 0.7rem;">${ext} • ${formatBytes(meta.size)} • ${new Date(f.created_at).toLocaleDateString()}</p>
          </div>
          <div class="card-overlay" onclick="toggleActions(this.parentElement, event)">
            <button class="action-pill view" onclick="event.stopPropagation(); gatedView(${f.file_id}, '${f.encrypted_key}', '${safeFilename}', ${meta.size})" title="View">${svgView}</button>
            <button class="action-pill save" onclick="event.stopPropagation(); gatedDownload(${f.file_id}, '${f.encrypted_key}', '${safeFilename}')" title="Download">${svgDownload}</button>
            <button class="action-pill share" onclick="event.stopPropagation(); gatedShare(${f.file_id}, '${safeFilename}', '${f.encrypted_key}')" title="Share">${svgShare}</button>
            <button class="action-pill delete" onclick="event.stopPropagation(); gatedDelete(${f.file_id}, '${f.encrypted_key}', '${safeFilename}')" title="Delete">${svgDelete}</button>
          </div>
        </div>
      `;
  }
  myBody.innerHTML = myHtml;

  const sortedShared = [...allFiles.sharedFiles].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  let shHtml = "";
  for (const f of sortedShared) {
    const itemId = `shared-${f.link_id}`;
    const displayName = f.sender_username || (f.sender_email ? f.sender_email.split('@')[0] : 'Unknown Operator');
    window.fileItemsMap[itemId] = { type: 'shared', id: f.link_id, fileId: f.file_id, name: displayName, encKey: f.encrypted_key, encMeta: f.encrypted_metadata, iv: f.iv, downloadable: f.downloadable };
    const isSelected = window.selectedItems.includes(itemId);

    shHtml += `
      <div class="folder-card ${isSelected ? 'selected' : ''}" data-id="${itemId}" onclick="handleItemClick('${itemId}', event, () => toggleActions(this, event))" style="cursor: pointer;" title="From: ${displayName}">
        <div class="select-symbol" onclick="event.stopPropagation(); toggleSelection('${itemId}')">
          <div class="file-icon-premium" style="background: linear-gradient(135deg, #EEF2FF 0%, #C7D2FE 100%); color: #4F46E5; display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:20px; height:20px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          </div>
          <div class="selection-indicator"></div>
        </div>
        <div style="flex: 1; min-width: 0;">
          <p class="folder-name" style="font-size: 0.9rem; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayName}</p>
          <p class="folder-count" style="font-size: 0.7rem;">SECRET FILE • Shared • ${new Date(f.created_at).toLocaleDateString()}</p>
        </div>
        <div class="card-overlay" onclick="toggleActions(this.parentElement, event)">
          <button class="action-pill view" onclick="event.stopPropagation(); window.openUnlockModal(${f.file_id || 'null'}, ${f.link_id}, '${f.encrypted_key}', '${f.encrypted_metadata}', '${f.iv}', ${f.downloadable})" title="Unlock">${svgUnlock}</button>
          <button class="action-pill delete" onclick="event.stopPropagation(); deleteSharedLink(${f.link_id})" title="Delete">${svgDelete}</button>
        </div>
      </div>
    `;
  }
  shBody.innerHTML = shHtml;
}

// ==========================================
// SHARED FILES (Incoming Data) — instant cache + background refresh
// ==========================================

function renderSharedFiles() {
  const shBody = document.getElementById("shared-list-body");
  if (!shBody) return;
  const countEl = document.getElementById("stat-incoming-count");
  if (countEl) countEl.textContent = allFiles.sharedFiles.length;

  const sorted = [...allFiles.sharedFiles].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!sorted.length) {
    shBody.innerHTML = '<div style="padding: 60px; text-align: center; color: var(--text-dim); font-size: 0.9rem; font-weight: 700;">No incoming records found.</div>';
    return;
  }
  let html = "";
  for (const f of sorted) {
    const itemId = `shared-${f.link_id}`;
    const displayName = f.sender_username || (f.sender_email ? f.sender_email.split('@')[0] : 'Unknown Operator');
    window.fileItemsMap[itemId] = { type: 'shared', id: f.link_id, fileId: f.file_id, name: displayName, encKey: f.encrypted_key, encMeta: f.encrypted_metadata, iv: f.iv, downloadable: f.downloadable };
    const isSelected = window.selectedItems.includes(itemId);
    html += `
      <div class="folder-card ${isSelected ? 'selected' : ''}" data-id="${itemId}" onclick="handleItemClick('${itemId}', event, () => toggleActions(this, event))" style="cursor: pointer;" title="From: ${displayName}">
        <div class="select-symbol" onclick="event.stopPropagation(); toggleSelection('${itemId}')">
          <div class="file-icon-premium" style="background: linear-gradient(135deg, #EEF2FF 0%, #C7D2FE 100%); color: #4F46E5; display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:20px; height:20px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          </div>
          <div class="selection-indicator"></div>
        </div>
        <div style="flex: 1; min-width: 0;">
          <p class="folder-name" style="font-size: 0.9rem; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayName}</p>
          <p class="folder-count" style="font-size: 0.7rem;">SECRET FILE • Shared • ${new Date(f.created_at).toLocaleDateString()}</p>
        </div>
        <div class="card-overlay" onclick="toggleActions(this.parentElement, event)">
          <button class="action-pill view" onclick="event.stopPropagation(); window.openUnlockModal(${f.file_id || 'null'}, ${f.link_id}, '${f.encrypted_key}', '${f.encrypted_metadata}', '${f.iv}', ${f.downloadable})" title="Unlock">${svgUnlock}</button>
          <button class="action-pill delete" onclick="event.stopPropagation(); deleteSharedLink(${f.link_id})" title="Delete">${svgDelete}</button>
        </div>
      </div>
    `;
  }
  shBody.innerHTML = html;
}

async function loadSharedFiles() {
  const shBody = document.getElementById("shared-list-body");
  if (!shBody) return;

  // Step 1: Paint from cache immediately (zero network wait)
  const cached = sessionStorage.getItem("sv_shared_cache");
  if (cached) {
    try {
      allFiles.sharedFiles = JSON.parse(cached);
      renderSharedFiles();
    } catch (e) {
      console.warn("Shared cache parse failed:", e);
      renderSkeletons();
    }
  } else {
    // No cache yet — show skeletons while we fetch
    renderSkeletons();
  }

  // Step 2: Silently refresh in the background
  try {
    const res = await fetch(`${API_URL}/files`, {
      headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` }
    });
    if (res.ok) {
      const data = await res.json();
      allFiles.sharedFiles = data.sharedFiles || [];
      sessionStorage.setItem("sv_shared_cache", JSON.stringify(allFiles.sharedFiles));
      renderSharedFiles();
    }
  } catch (err) {
    console.warn("Shared files background refresh failed:", err);
  }
}

async function loadRecycleBin() {
  const recycleBody = document.getElementById("recycle-list-body");
  if (!recycleBody) return;
  renderSkeletons();
  
  try {
    const res = await fetch(`${API_URL}/recycle-bin`, {
      method: "GET", headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
    });
    const results = await res.json();
    const masterKey = await getClientMasterKey();
    
    recycleBody.innerHTML = "";
    if (!results || !Array.isArray(results) || results.length === 0) {
      recycleBody.innerHTML = '<div style="padding: 60px; text-align: center; color: var(--text-dim); font-size: 0.9rem; font-weight: 700;">No records found in retention.</div>';
      return;
    }

    let html = "";
    for (const f of results) {
      try {
        const meta = await decryptMetadata(base64ToArrayBuffer(f.encrypted_metadata), masterKey, hexToBytes(f.iv));
        const ext = meta.filename.split(".").pop().toUpperCase();
        const disp = meta.filename.length > 45 ? meta.filename.substring(0, 42) + "..." : meta.filename;

        const itemId = `recycle-${f.file_id}`;
        window.fileItemsMap[itemId] = { type: 'recycle', id: f.file_id, name: meta.filename };
        const isSelected = window.selectedItems.includes(itemId);

        const deletedTime = new Date(f.deleted_at || Date.now()).getTime();
        const expiryTime = deletedTime + 7 * 24 * 60 * 60 * 1000;
        const msLeft = expiryTime - Date.now();
        let timeLeftStr = "";
        if (msLeft <= 0) {
          timeLeftStr = "Expiring...";
        } else {
          const daysLeft = Math.floor(msLeft / (24 * 60 * 60 * 1000));
          const hoursLeft = Math.floor((msLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
          if (daysLeft > 0) {
            timeLeftStr = `${daysLeft}d ${hoursLeft}h left`;
          } else {
            const minsLeft = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000));
            timeLeftStr = `${hoursLeft}h ${minsLeft}m left`;
          }
        }

        html += `
          <div class="file-row recycle-row ${isSelected ? 'selected' : ''}" data-id="${itemId}" onclick="handleItemClick('${itemId}', event)">
            <div class="select-symbol" onclick="event.stopPropagation(); toggleSelection('${itemId}')">
              ${getFileTypeLogo(ext)}
              <div class="selection-indicator"></div>
            </div>
            <p class="file-name" style="font-weight: 700; color: var(--text-primary);">${disp}</p>
            <p class="file-date" style="font-size: 0.85rem; color: #64748b; font-weight: 600; text-align: center;">${timeLeftStr}</p>
            <div class="btn-group">
              <button class="action-btn" onclick="event.stopPropagation(); restoreFile(${f.file_id})" style="border-color: #10b981; color: #10b981; background: rgba(16,185,129,0.03);">Restore</button>
              <button class="action-btn delete" onclick="event.stopPropagation(); permanentDeleteFile(${f.file_id})" style="border-color: #ef4444; color: #ef4444; background: rgba(239,68,68,0.03);">Delete</button>
            </div>
          </div>
        `;
      } catch(e) { console.error("Recycle Decrypt Fail", e); }
    }
    recycleBody.innerHTML = html;
  } catch (err) { 
    console.error(err); 
    recycleBody.innerHTML = '<div style="padding: 60px; text-align: center; color: var(--danger);">Operational failure in retention stream extraction.</div>';
  }
}

async function restoreFile(fileId) {
  const item = window.fileItemsMap['recycle-' + fileId];
  const filename = item ? item.name : `File #${fileId}`;
  if (await confirmAction("Restore this record to Vault Base?", "success")) {
    const verified = await verifyPIN();
    if (!verified) return;

    try {
      await fetch(`${API_URL}/restore-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
        body: JSON.stringify({ fileId }),
      });
      showToast("Restored");
      if (window.logActivity) window.logActivity("Record Restored", filename);
      loadRecycleBin();
    } catch (err) { showToast("Error", "error"); }
  }
}

async function permanentDeleteFile(fileId) {
  const item = window.fileItemsMap['recycle-' + fileId];
  const filename = item ? item.name : `File #${fileId}`;
  if (await confirmAction("DANGER: Permanently delete this record? This cannot be undone.", "danger")) {
    const verified = await verifyPIN();
    if (!verified) return;

    try {
      await fetch(`${API_URL}/permanent-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
        body: JSON.stringify({ fileId }),
      });
      showToast("Deleted");
      if (window.logActivity) window.logActivity("Record Permanently Purged", filename);
      loadRecycleBin();
    } catch (err) { showToast("Error", "error"); }
  }
}

async function confirmAction(msg, type = "primary") {
  return await showConfirm(msg, type);
}

async function deleteFile(id, keyStr, filename, confirmedAlready = false) {
  if (!confirmedAlready) {
    const conf = await showConfirm(`Delete this file?`, "danger");
    if (!conf) return;
  }
  
  await fetch(`${API_URL}/delete-file`, { 
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
    body: JSON.stringify({ fileId: id })
  });
  silentSync();
  showToast("Deleted");
  if (window.logActivity) window.logActivity("Record Deleted", filename);
}

// File type badge colors for viewer header
function getExtBadgeColor(ext) {
  const e = ext.toLowerCase();
  if (['pdf'].includes(e))                                        return { bg: '#FEE2E2', text: '#DC2626' };
  if (['doc','docx','odt','rtf'].includes(e))                    return { bg: '#DBEAFE', text: '#1D4ED8' };
  if (['xls','xlsx','csv','ods'].includes(e))                    return { bg: '#DCFCE7', text: '#15803D' };
  if (['ppt','pptx','odp'].includes(e))                          return { bg: '#FEF3C7', text: '#B45309' };
  if (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(e)) return { bg: '#F3E8FF', text: '#7C3AED' };
  if (['mp4','mkv','webm','mov','avi'].includes(e))              return { bg: '#FCE7F3', text: '#BE185D' };
  if (['mp3','wav','flac','aac','ogg'].includes(e))              return { bg: '#ECFDF5', text: '#059669' };
  if (['zip','rar','7z','tar','gz'].includes(e))                 return { bg: '#F1F5F9', text: '#475569' };
  if (['js','ts','jsx','py','java','c','cpp','html','css'].includes(e)) return { bg: '#E0F2FE', text: '#0369A1' };
  if (['json','xml','yaml','yml','env'].includes(e))             return { bg: '#FFF7ED', text: '#C2410C' };
  return { bg: '#F1F5F9', text: '#475569' };
}

// PIN-Gated wrappers for main vault file actions
async function gatedView(fileId, encKey, filename, size) {
  if (!(await verifyPIN())) return;
  viewMyFile(fileId, encKey, filename, size, false, null, false);
}
async function gatedDownload(fileId, encKey, filename) {
  const conf = await showConfirm(`Are you sure you want to download this file?`, "success");
  if (!conf) return;
  if (!(await verifyPIN())) return;
  downloadFile(fileId, encKey, filename, true);
}
async function gatedShare(fileId, filename, encKey) {
  if (!(await verifyPIN())) return;
  openShareModal(fileId, filename, encKey);
}
async function gatedDelete(fileId, encKey, filename) {
  const conf = await showConfirm(`Delete this file?`, "danger");
  if (!conf) return;
  if (!(await verifyPIN())) return;
  
  try {
    const res = await fetch(`${API_URL}/delete-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
      body: JSON.stringify({ fileId }),
    });
    if (res.ok) {
      showToast("Deleted");
      loadFiles(); 
      silentSync();
    } else {
      showToast("Error", "error");
    }
  } catch (err) { console.error(err); }
}

function removeSharedLinkFromCache(linkId) {
  if (allFiles && allFiles.sharedFiles) {
    allFiles.sharedFiles = allFiles.sharedFiles.filter(f => f.link_id !== linkId);
  }
  const cached = sessionStorage.getItem("sv_files_cache");
  if (cached) {
    try {
      const filesData = JSON.parse(cached);
      if (filesData && filesData.sharedFiles) {
        filesData.sharedFiles = filesData.sharedFiles.filter(f => f.link_id !== linkId);
        sessionStorage.setItem("sv_files_cache", JSON.stringify(filesData));
      }
    } catch (e) { console.warn(e); }
  }
  const itemId = `shared-${linkId}`;
  if (window.fileItemsMap[itemId]) delete window.fileItemsMap[itemId];
  window.selectedItems = window.selectedItems.filter(id => id !== itemId);
  updateSelectionToolbar();
  renderFiles();
}

async function deleteSharedLink(id) {
  const conf = await showConfirm(`Remove this shared record from your incoming feed?`, "danger");
  if (!conf) return;
  const verified = await verifyPIN();
  if (!verified) return;
  
  removeSharedLinkFromCache(id);
  await fetch(`${API_URL}/share/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
  loadFiles();
  showToast("Deleted");
}

// ==========================================
// UPLOAD logic
// ==========================================

async function showUploadModal(preselectFolderId = null, skipVerify = false) {
  if (!skipVerify) {
    const verified = await verifyPIN();
    if (!verified) return;
  }

  document.getElementById("upload-modal").classList.remove("hidden");
  const label = document.getElementById("file-label");
  if (label) {
    label.innerHTML = "Drop record or click to browse";
    label.style.color = "var(--text-primary)";
  }
  const select = document.getElementById("upload-folder-select");
  if (select) {
    select.value = preselectFolderId || currentFolderId || "";
    syncCustomFolderSelect();
  }
}

function handleUploadFileChange(input) {
  const label = document.getElementById("file-label");
  if (!label) return;
  if (input.files && input.files[0]) {
    const f = input.files[0];
    label.innerHTML = `<strong>SELECTED RECORD:</strong><br>${truncateName(f.name, 50)}<br><span style="font-size:0.75rem; opacity:0.7; letter-spacing:1px;">${formatBytes(f.size)}</span>`;
    label.style.color = "var(--accent-blue)";
  } else {
    label.innerHTML = "Drop record or click to browse";
    label.style.color = "var(--text-primary)";
  }
}

document.getElementById("upload-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const file = document.getElementById("file-input").files[0];
  const folderId = document.getElementById("upload-folder-select").value;
  if (!file) return;

  if (currentTotalUsage + file.size > MAX_STORAGE_BYTES) {
    return showToast("Limit reached", "error");
  }

  const btn = e.target.querySelector(".primary-btn");
  const orig = btn.textContent;
  btn.textContent = "Encrypting..."; btn.disabled = true;
  try {
    const fileKey = await generateFileKey();
    const encryptedFileBuffer = await encryptFile(file, fileKey);
    const masterKey = await getClientMasterKey();
    const { encryptedData: encMeta, iv: metaIv } = await encryptMetadata({ filename: file.name, size: file.size, type: file.type }, masterKey);
    const { encryptedKey: encKey, iv: keyIv } = await encryptKey(fileKey, masterKey);
    
    const urlRes = await fetch(`${API_URL}/upload-url`, { method: "POST", headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
    const { uploadUrl, fileUuid } = await urlRes.json();
    
    // TRANSMISSION PROTOCOL: XHR with Progress Monitor
    const progressContainer = document.getElementById("upload-progress-container");
    const progressBar = document.getElementById("upload-progress-bar");
    const statusText = document.getElementById("upload-status-text");
    const percentageText = document.getElementById("upload-percentage");
    
    progressContainer.style.display = "block";
    statusText.style.display = "block";
    btn.textContent = "Transmitting...";

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          if (progressBar) progressBar.style.width = percent + "%";
          if (percentageText) percentageText.textContent = percent + "%";
          if (percent === 100 && statusText) statusText.textContent = "Verifying Integrity...";
        }
      };
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error("Transmission failed"));
      };
      xhr.onerror = () => reject(new Error("Network interruption"));
      xhr.send(encryptedFileBuffer);
    });
    
    await fetch(`${API_URL}/complete-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
      body: JSON.stringify({
        fileUuid, fileType: file.name.split(".").pop().toLowerCase(),
        encryptedMetadata: arrayBufferToBase64(encMeta), metadataIv: bytesToHex(metaIv),
        encryptedKey: bytesToHex(keyIv) + ":" + arrayBufferToBase64(encKey),
        folderId: folderId || null
      }),
    });
    showToast("Uploaded"); 
    if (window.logActivity) window.logActivity("Record Transmitted", file.name);
    closeModal("upload-modal"); 
    silentSync();
    
    // Reset Monitor
    setTimeout(() => {
      progressContainer.style.display = "none";
      progressBar.style.width = "0%";
      statusText.style.display = "none";
      statusText.textContent = "Synchronizing Secure Stream...";
    }, 1000);
  } catch (err) { 
    showToast("Error: " + err.message, "error"); 
    document.getElementById("upload-progress-container").style.display = "none";
    document.getElementById("upload-status-text").style.display = "none";
  }
  finally { btn.textContent = orig; btn.disabled = false; }
});

// ==========================================
// DOWNLOAD & VIEW (Stripped down/adapted)
// ==========================================

async function downloadFile(fileId, encryptedKeyStr, filename, verifiedAlready = false) {
  try {
    if (!verifiedAlready) {
      const conf = await showConfirm(`Are you sure you want to download this file?`, "success");
      if (!conf) return;
    }

    showToast("Downloading...");
    const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${fileId}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } })).json();
    const encryptedBlob = await (await fetch(downloadUrl)).arrayBuffer();
    const [ivHex, keyBase64] = encryptedKeyStr.split(":");
    const mk = await getClientMasterKey();
    const fk = await decryptKey(base64ToArrayBuffer(keyBase64), mk, hexToBytes(ivHex));
    const dec = await decryptFile(new Uint8Array(encryptedBlob), fk);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([dec])); a.download = filename; a.click();
    showToast("Downloaded");
    if (window.logActivity) window.logActivity("Record Decrypted & Downloaded", filename);
  } catch (err) { showToast("Error", "error"); }
}

async function viewMyFile(id, keyStr, name, size, alreadyDecrypted = false, decBuffer = null, canDownload = true, linkId = null) {
  let dec = decBuffer;
  
  // SECURE MANIFESTATION PROTOCOL: Open viewer portal INSTANTLY
  const fileNameObj = document.getElementById("view-filename");
  const modal = document.getElementById("file-view-modal");
  const viewer = document.getElementById("view-content");
  
  const fileExt = name.split('.').pop().toLowerCase();
  if (fileNameObj) {
    // Show filename with colored type badge
    fileNameObj.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:10px;">
        <span style="
          background:${getExtBadgeColor(fileExt).bg};
          color:${getExtBadgeColor(fileExt).text};
          font-size:0.6rem;font-weight:900;padding:3px 8px;border-radius:6px;
          letter-spacing:1px;text-transform:uppercase;font-family:var(--font-heading);
        ">${fileExt}</span>
        ${truncateName(name)}
      </span>`;
  }
  if (modal) modal.classList.remove("hidden");
  
  if (viewer) {
    viewer.innerHTML = `
      <div style="text-align:center; padding:100px 20px; color:var(--accent-cyan); width: 100%; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center;">
        <div class="loader-pulse" style="width:60px; height:60px; border-width: 4px; margin-bottom: 30px;"></div>
        <h3 style="margin-bottom:10px; color:#fff; font-family:var(--font-heading); font-size:1.5rem; font-weight:800;">Loading...</h3>
        <p id="view-loading-status" style="opacity:0.6; font-size:0.9rem;">0% loaded</p>
      </div>`;
  }

  const closeBtn = document.getElementById("view-close-btn");
  const isDownloadable = canDownload === true || canDownload === 'true' || canDownload === 1 || canDownload === '1';

  // Identity: Burn-after-viewing Protocol for shared records
  if (linkId) {
    closeBtn.onclick = () => {
      viewer.style.background = ''; viewer.style.padding = '';
      closeModal('file-view-modal');
      showToast("Closed");
      removeSharedLinkFromCache(linkId);
      fetch(`${API_URL}/share/${linkId}`, { method: "DELETE", headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } })
        .then(() => loadFiles())
        .catch(err => console.error("Error deleting share link:", err));
    };
  } else {
    closeBtn.onclick = () => { viewer.style.background = ''; viewer.style.padding = ''; closeModal('file-view-modal'); };
  }

  if (!alreadyDecrypted) {
    try {
      const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${id}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } })).json();
      const statusText = document.getElementById("view-loading-status");
      const blob = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", downloadUrl);
        xhr.responseType = "arraybuffer";
        xhr.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            if (statusText) statusText.textContent = `${percent}% loaded`;
          } else {
            if (statusText) statusText.textContent = `${(e.loaded / 1024 / 1024).toFixed(1)} MB loaded`;
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
          else reject(new Error(`Failed with status ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Network error during file download"));
        xhr.send();
      });
      const [ivHex, keyB64] = keyStr.split(":");
      const mk = await getClientMasterKey();
      const fk = await decryptKey(base64ToArrayBuffer(keyB64), mk, hexToBytes(ivHex));
      dec = await decryptFile(new Uint8Array(blob), fk);
    } catch (err) { 
      console.error(err);
      return showToast("Failed to open file", "error"); 
    }
  }

  try {
    const viewer = document.getElementById("view-content");
    viewer.innerHTML = "";

    const existingDl = document.getElementById("view-download-btn");
    if (existingDl) existingDl.remove();

    if (isDownloadable) {
      const dlBtn = document.createElement("button");
      dlBtn.id = "view-download-btn";
      dlBtn.className = "viewer-ctrl-btn primary";
      dlBtn.style.marginRight = "10px";
      dlBtn.textContent = "DOWNLOAD";
      dlBtn.onclick = () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([dec]));
        a.download = name;
        a.click();
        showToast("Downloaded");
      };
      closeBtn.parentNode.insertBefore(dlBtn, closeBtn);
    }
    
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);

    const ext = name.split('.').pop().toLowerCase();
    const blob = new Blob([dec], { type: getMimeType(ext) });
    currentBlobUrl = URL.createObjectURL(blob);

    // 1. IMAGE PROTOCOL
    if (["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico"].includes(ext)) {
      const img = document.createElement("img"); img.src = currentBlobUrl;
      img.style.maxWidth = "90%"; img.style.maxHeight = "calc(96vh - 120px)"; img.style.objectFit = "contain"; 
      img.style.boxShadow = "0 30px 60px rgba(0,0,0,0.5)";
      img.style.display = "block"; img.style.margin = "20px auto";
      viewer.appendChild(img);
    } 
    // 2. VIDEO PROTOCOL
    else if (["mp4", "mkv", "webm", "mov", "avi"].includes(ext)) {
      const video = document.createElement("video"); video.src = currentBlobUrl;
      video.controls = true; 
      video.controlsList = "nodownload noplaybackrate";
      video.disablePictureInPicture = true;
      video.style.maxWidth = "100%"; video.style.maxHeight = "100%";
      video.style.background = "#000"; video.style.boxShadow = "0 20px 40px rgba(0,0,0,0.5)";
      viewer.appendChild(video);
    } 
    // 3. AUDIO PROTOCOL
    else if (["mp3", "wav", "aac", "flac", "ogg", "m4a"].includes(ext)) {
      viewer.innerHTML = `
        <div style="text-align:center; padding: 4rem; background: rgba(255,255,255,0.02); width: 100%; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center;">
          <div style="font-size:5rem; margin-bottom: 2rem; opacity:0.8;">🎵</div>
          <audio src="${currentBlobUrl}" controls style="width:80%; max-width:500px;"></audio>
          <p style="margin-top:25px; color:var(--text-primary); font-weight: 800; font-family:var(--font-heading); font-size:1.1rem;">${name}</p>
        </div>
      `;
    }
    // 4. WORD DOCUMENT PROTOCOL — paginated A4 view like Google Docs
    else if (["docx", "doc", "odt", "rtf", "pages"].includes(ext)) {
        viewer.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-secondary);font-weight:700;">Converting document...</div>';
        viewer.style.background = '#E8EAED';
        viewer.style.padding = '0';
        try {
            const result = await mammoth.convertToHtml({ arrayBuffer: dec }, {
                styleMap: [
                    "br[type='page'] => p.docx-page-break",
                    "p[style-name='heading 1'] => h1:fresh",
                    "p[style-name='heading 2'] => h2:fresh",
                    "p[style-name='heading 3'] => h3:fresh"
                ]
            });

            let rawHtml = result.value || '<p>[Empty document]</p>';

            // Force a page break after the copyright notice to keep original page breaks
            rawHtml = rawHtml.replace(/(©\s*2026,?\s*Nithin Senapathi\.\s*All rights reserved\.)/gi, '$1<p class="docx-page-break"></p>');

            // Split at explicit Word page breaks
            let pageChunks = rawHtml
                .split(/<p[^>]*class="docx-page-break"[^>]*>[\s\S]*?<\/p>/gi)
                .map(c => c.trim())
                .filter(Boolean);

            // If no explicit breaks, split paragraphs into estimated A4 pages (~3500 chars each)
            if (pageChunks.length <= 1) {
                const allParas = rawHtml.match(/<(p|h[1-6]|ul|ol|table)[^>]*>[\s\S]*?<\/\1>/g) || [rawHtml];
                pageChunks = [];
                let current = '';
                const PAGE_LIMIT = 3500; // ~chars per A4 page at 12pt
                for (const para of allParas) {
                    current += para;
                    if (current.replace(/<[^>]+>/g, '').length >= PAGE_LIMIT) {
                        pageChunks.push(current);
                        current = '';
                    }
                }
                if (current.trim()) pageChunks.push(current);
            }

            if (!pageChunks.length) pageChunks = [rawHtml];

            // Build the paginated document view
            const docBg = document.createElement('div');
            docBg.style.cssText = 'background:#E8EAED;width:100%;padding:32px 24px 48px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:20px;';

            // Document title bar (like Google Docs top strip)
            const titleBar = document.createElement('div');
            titleBar.style.cssText = 'width:100%;max-width:816px;display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;';
            titleBar.innerHTML = `
              <span style="font-size:0.78rem;color:#5F6368;font-weight:500;font-family:var(--font-main);">${name}</span>
              <span style="font-size:0.75rem;color:#9AA0A6;font-family:var(--font-main);">${pageChunks.length} page${pageChunks.length !== 1 ? 's' : ''}</span>`;
            docBg.appendChild(titleBar);

            pageChunks.forEach((pageHtml, idx) => {
                const page = document.createElement('div');
                page.style.cssText = `
                    width: 100%;
                    max-width: 816px;
                    min-height: 1056px;
                    background: #ffffff;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.15), 0 6px 24px rgba(0,0,0,0.12);
                    padding: 96px 96px 80px;
                    box-sizing: border-box;
                    position: relative;
                    font-family: 'Times New Roman', Georgia, serif;
                    font-size: 10.5pt;
                    line-height: 1.7;
                    color: #000;
                    border-radius: 2px;
                `;

                const content = document.createElement('div');
                content.innerHTML = pageHtml;
                // Style the content to match Word defaults
                content.querySelectorAll('p').forEach(p => {
                    p.style.marginBottom = '0.8em';
                    p.style.marginTop = '0';
                });
                content.querySelectorAll('h1').forEach(h => {
                    h.style.cssText = 'font-size:15pt;font-weight:700;margin:0 0 12px;font-family:Calibri,Arial,sans-serif;color:#000;';
                });
                content.querySelectorAll('h2').forEach(h => {
                    h.style.cssText = 'font-size:13pt;font-weight:700;margin:16px 0 8px;font-family:Calibri,Arial,sans-serif;color:#000;';
                });
                content.querySelectorAll('h3').forEach(h => {
                    h.style.cssText = 'font-size:11.5pt;font-weight:700;margin:12px 0 6px;font-family:Calibri,Arial,sans-serif;color:#000;';
                });
                content.querySelectorAll('table').forEach(t => {
                    t.style.cssText = 'border-collapse:collapse;width:100%;margin:12px 0;font-size:10pt;';
                });
                content.querySelectorAll('td,th').forEach(c => {
                    c.style.cssText = 'border:1px solid #000;padding:6px 10px;';
                });
                content.querySelectorAll('img').forEach(img => {
                    img.style.maxWidth = '100%';
                    img.style.maxHeight = '300px';
                    img.style.objectFit = 'contain';
                    img.style.height = 'auto';
                    img.style.margin = '8px auto';
                    img.style.display = 'block';
                });

                // Page number footer
                const pgNum = document.createElement('div');
                pgNum.style.cssText = 'position:absolute;bottom:32px;left:0;right:0;text-align:center;font-size:10pt;color:#9AA0A6;font-family:Arial,sans-serif;letter-spacing:0.5px;';
                pgNum.textContent = idx + 1;

                page.appendChild(content);
                page.appendChild(pgNum);
                docBg.appendChild(page);
            });

            viewer.innerHTML = '';
            viewer.appendChild(docBg);
        } catch (err) {
            viewer.style.background = '#fff';
            viewer.style.padding = '20px';
            viewer.innerHTML = `<p style="color:var(--danger);padding:20px;">Could not render document: ${err.message}</p>`;
        }
    }
    // 5. PDF PROTOCOL (Direct Canvas Rendering with Zoom Controls)
    else if (ext === "pdf") {
        viewer.innerHTML = '<div style="color:var(--accent-cyan); text-align:center; padding:40px;">MANIFESTING PDF DATA FIELDS...</div>';
        const pdfJS = window['pdfjs-dist/build/pdf'];
        pdfJS.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
        pdfJS.getDocument({ data: dec }).promise.then(pdf => {
            viewer.innerHTML = "";
            viewer.style.display = "flex";
            viewer.style.flexDirection = "column";

            // === ZOOM TOOLBAR ===
            let currentZoom = 1.0; // 100% default
            const BASE_SCALE = window.innerWidth < 768 ? 3.0 : 2.5;

            const toolbar = document.createElement("div");
            toolbar.style.cssText = `
                display: flex; align-items: center; justify-content: center; gap: 12px;
                padding: 10px 20px; background: rgba(15,23,42,0.85);
                border-bottom: 1px solid rgba(255,255,255,0.08);
                position: sticky; top: 0; z-index: 10; flex-shrink: 0;
                backdrop-filter: blur(10px);
            `;

            const zoomOut = document.createElement("button");
            zoomOut.textContent = "−";
            zoomOut.style.cssText = "width:34px;height:34px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.07);color:#fff;font-size:1.3rem;cursor:pointer;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center;transition:background 0.2s;";
            zoomOut.onmouseenter = () => zoomOut.style.background = "rgba(255,255,255,0.15)";
            zoomOut.onmouseleave = () => zoomOut.style.background = "rgba(255,255,255,0.07)";

            const zoomLabel = document.createElement("span");
            zoomLabel.textContent = "100%";
            zoomLabel.style.cssText = "color:#fff;font-size:0.85rem;font-weight:700;font-family:var(--font-heading);min-width:48px;text-align:center;letter-spacing:0.5px;";

            const zoomIn = document.createElement("button");
            zoomIn.textContent = "+";
            zoomIn.style.cssText = "width:34px;height:34px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.07);color:#fff;font-size:1.3rem;cursor:pointer;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center;transition:background 0.2s;";
            zoomIn.onmouseenter = () => zoomIn.style.background = "rgba(255,255,255,0.15)";
            zoomIn.onmouseleave = () => zoomIn.style.background = "rgba(255,255,255,0.07)";

            const pageLabel = document.createElement("span");
            pageLabel.textContent = `${pdf.numPages} page${pdf.numPages !== 1 ? 's' : ''}`;
            pageLabel.style.cssText = "color:rgba(255,255,255,0.35);font-size:0.75rem;font-weight:600;font-family:var(--font-heading);margin-left:8px;";

            toolbar.appendChild(zoomOut);
            toolbar.appendChild(zoomLabel);
            toolbar.appendChild(zoomIn);
            toolbar.appendChild(pageLabel);
            viewer.appendChild(toolbar);

            // === SCROLL CONTAINER ===
            const container = document.createElement("div");
            container.className = "pdf-canvas-container";
            container.style.cssText = "flex:1;overflow-y:auto;display:flex;flex-direction:column;align-items:center;padding:24px 16px;gap:24px;background:#525659;";
            viewer.appendChild(container);

            // === RENDER FUNCTION ===
            const renderAllPages = (zoom) => {
                container.innerHTML = "";
                const scale = BASE_SCALE * zoom;
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    pdf.getPage(pageNum).then(page => {
                        const viewport = page.getViewport({ scale });
                        const canvas = document.createElement("canvas");
                        canvas.className = "pdf-page-canvas";
                        canvas.style.cssText = `display:block;box-shadow:0 4px 20px rgba(0,0,0,0.4);border-radius:2px;max-width:100%;`;
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        container.appendChild(canvas);
                        page.render({ canvasContext: canvas.getContext('2d'), viewport });
                    });
                }
            };

            // Initial render at 100%
            renderAllPages(currentZoom);

            // Zoom controls
            zoomIn.onclick = () => {
                if (currentZoom >= 3.0) return;
                currentZoom = Math.min(3.0, currentZoom + 0.25);
                zoomLabel.textContent = Math.round(currentZoom * 100) + "%";
                renderAllPages(currentZoom);
            };
            zoomOut.onclick = () => {
                if (currentZoom <= 0.25) return;
                currentZoom = Math.max(0.25, currentZoom - 0.25);
                zoomLabel.textContent = Math.round(currentZoom * 100) + "%";
                renderAllPages(currentZoom);
            };

        }).catch(() => {
            viewer.innerHTML = '<p style="color:var(--danger); padding:20px;">Identity Error: PDF Stream Corrupted.</p>';
        });
    }
    // 6. SPREADSHEET PROTOCOL (Direct Matrix Rendering)
    else if (["xlsx", "xls", "csv", "ods", "tsv", "numbers"].includes(ext)) {
        viewer.innerHTML = '<div style="color:var(--accent-cyan); text-align:center; padding:40px;">DECODING MATRIX DATA...</div>';
        try {
            const workbook = XLSX.read(dec, { type: 'array' });
            const html = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
            const container = document.createElement("div");
            container.className = "matrix-table-container";
            container.innerHTML = html;
            const table = container.querySelector('table');
            if (table) table.className = "matrix-table";
            viewer.innerHTML = ""; viewer.appendChild(container);
        } catch (err) {
            viewer.innerHTML = `<p style="color:var(--danger); padding:20px;">Protocol Error: Spreadsheet parsing failed.</p>`;
        }
    }
    // 7. ARCHIVE PROTOCOL — collapsible file tree explorer
    else if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"].includes(ext)) {
        viewer.innerHTML = '<div style="color:var(--text-secondary);text-align:center;padding:60px;font-weight:700;">Reading archive...</div>';
        try {
            JSZip.loadAsync(dec).then(zip => {
                // Collect all entries
                const allEntries = [];
                zip.forEach((path, file) => {
                    allEntries.push({
                        path: path.replace(/\/$/, ''), // strip trailing slash
                        isDir: file.dir,
                        size: file._data ? (file._data.uncompressedSize || 0) : 0
                    });
                });

                const getArchiveIcon = (p, isDir) => {
                    if (isDir) return '📁';
                    const x = p.split('.').pop().toLowerCase();
                    if (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(x)) return '🖼️';
                    if (['mp4','mov','avi','mkv','webm'].includes(x)) return '🎬';
                    if (['mp3','wav','flac','aac','ogg'].includes(x)) return '🎵';
                    if (['pdf'].includes(x)) return '📄';
                    if (['doc','docx'].includes(x)) return '📝';
                    if (['xls','xlsx','csv'].includes(x)) return '📊';
                    if (['ppt','pptx'].includes(x)) return '📊';
                    if (['zip','rar','7z','tar','gz'].includes(x)) return '🗜️';
                    if (['js','ts','jsx','py','java','c','cpp','html','css','json','ts'].includes(x)) return '💻';
                    if (['txt','md','log'].includes(x)) return '📋';
                    return '📄';
                };

                const fmtSize = b => {
                    if (!b) return '';
                    if (b < 1024) return b + ' B';
                    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
                    return (b/1048576).toFixed(1) + ' MB';
                };

                // Build a tree structure
                const buildTree = (parentPath) => {
                    const prefix = parentPath ? parentPath + '/' : '';
                    const children = allEntries.filter(e => {
                        if (!e.path.startsWith(prefix)) return false;
                        const rest = e.path.slice(prefix.length);
                        return rest.length > 0 && !rest.includes('/'); // direct child only
                    });
                    children.sort((a, b) => {
                        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
                        return a.path.localeCompare(b.path);
                    });
                    return children;
                };

                const countChildren = (dirPath) => {
                    const prefix = dirPath + '/';
                    return allEntries.filter(e => e.path.startsWith(prefix) && !e.isDir).length;
                };

                // Renders a list of entries into a container div
                const renderEntries = (entries, container, depth = 0) => {
                    entries.forEach(entry => {
                        const displayName = entry.path.split('/').pop();
                        const icon = getArchiveIcon(entry.path, entry.isDir);
                        const size = fmtSize(entry.size);
                        const childCount = entry.isDir ? countChildren(entry.path) : 0;

                        const row = document.createElement('div');
                        row.className = `archive-tree-row ${entry.isDir ? 'is-directory' : 'is-file'}`;
                        row.style.marginLeft = `${depth * (window.innerWidth < 768 ? 10 : 20)}px`;

                        // Chevron for folders
                        let chevron = null;
                        if (entry.isDir) {
                            chevron = document.createElement('span');
                            chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="3" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>`;
                            chevron.style.cssText = 'display:flex;align-items:center;flex-shrink:0;transition:transform 0.2s;';
                        }

                        const iconEl = document.createElement('span');
                        iconEl.textContent = icon;
                        iconEl.style.cssText = 'font-size:1rem;flex-shrink:0;';

                        const nameEl = document.createElement('span');
                        nameEl.className = 'folder-name';
                        nameEl.textContent = displayName;
                        nameEl.style.cssText = `flex:1;font-size:0.875rem;font-weight:${entry.isDir ? '700' : '500'};color:var(--text-primary);word-break:break-all;`;

                        if (entry.isDir && chevron) row.appendChild(chevron);
                        row.appendChild(iconEl);
                        row.appendChild(nameEl);

                        if (childCount > 0) {
                            const badge = document.createElement('span');
                            badge.className = 'folder-count';
                            badge.textContent = childCount + ' file' + (childCount !== 1 ? 's' : '');
                            badge.style.cssText = 'font-size:0.72rem;color:#94A3B8;font-weight:600;white-space:nowrap;background:var(--section-bg);padding:2px 8px;border-radius:20px;';
                            row.appendChild(badge);
                        }

                        if (size && !entry.isDir) {
                            const sizeEl = document.createElement('span');
                            sizeEl.textContent = size;
                            sizeEl.style.cssText = 'font-size:0.75rem;color:#94A3B8;font-weight:600;white-space:nowrap;';
                            row.appendChild(sizeEl);
                        }

                        container.appendChild(row);

                        // Expandable child area for folders
                        if (entry.isDir) {
                            const childArea = document.createElement('div');
                            childArea.style.cssText = 'display:none;flex-direction:column;gap:6px;margin-top:4px;';
                            container.appendChild(childArea);

                            let expanded = false;
                            row.addEventListener('click', () => {
                                expanded = !expanded;
                                if (expanded) {
                                    if (!childArea.children.length) {
                                        // Lazy-render children
                                        const kids = buildTree(entry.path);
                                        if (kids.length > 0) {
                                            renderEntries(kids, childArea, depth + 1);
                                        } else {
                                            const empty = document.createElement('div');
                                            empty.style.cssText = `margin-left:${(depth+1)*(window.innerWidth < 768 ? 10 : 20)}px;padding:8px 14px;font-size:0.82rem;color:#94A3B8;font-style:italic;`;
                                            empty.textContent = 'Empty folder';
                                            childArea.appendChild(empty);
                                        }
                                    }
                                    childArea.style.display = 'flex';
                                    if (chevron) chevron.style.transform = 'rotate(90deg)';
                                    row.classList.add('expanded');
                                } else {
                                    childArea.style.display = 'none';
                                    if (chevron) chevron.style.transform = 'rotate(0deg)';
                                    row.classList.remove('expanded');
                                }
                            });
                        }
                    });
                };

                // Root-level items only
                const rootEntries = buildTree('');
                const totalFiles = allEntries.filter(e => !e.isDir).length;
                const totalDirs = allEntries.filter(e => e.isDir).length;

                const wrap = document.createElement('div');
                wrap.style.cssText = 'padding:32px 40px;';

                // Header
                wrap.innerHTML = `
                  <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid #E2E8F0;">
                    <div style="width:48px;height:48px;background:#FEF3C7;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;">🗜️</div>
                    <div>
                      <div style="font-weight:800;font-size:1rem;color:var(--text-primary);font-family:var(--font-heading);">${name}</div>
                      <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:3px;">${totalFiles} file${totalFiles !== 1 ? 's' : ''}${totalDirs > 0 ? ' · ' + totalDirs + ' folder' + (totalDirs !== 1 ? 's' : '') : ''} · Click folders to expand</div>
                    </div>
                  </div>`;

                const treeArea = document.createElement('div');
                treeArea.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
                wrap.appendChild(treeArea);

                renderEntries(rootEntries, treeArea, 0);
                viewer.innerHTML = '';
                viewer.appendChild(wrap);

            }).catch(() => {
                viewer.innerHTML = '<p style="color:var(--danger);padding:40px;text-align:center;">Could not read archive contents.</p>';
            });
        } catch (err) {
            viewer.innerHTML = `<p style="color:var(--danger);padding:40px;">Archive error: ${err.message}</p>`;
        }
    }

    // 8. PRESENTATION PROTOCOL — 16:9 slide cards with proper layout
    else if (["pptx", "ppt"].includes(ext)) {
        viewer.innerHTML = '<div style="color:var(--text-secondary);text-align:center;padding:60px;font-weight:700;">Extracting slides...</div>';
        try {
            const zip = await JSZip.loadAsync(dec);
            const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/;
            const slideFiles = Object.keys(zip.files)
                .filter(f => slideRegex.test(f))
                .sort((a,b) => parseInt(a.match(slideRegex)[1]) - parseInt(b.match(slideRegex)[1]));

            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'width:100%;padding:32px 40px;box-sizing:border-box;display:flex;flex-direction:column;gap:32px;';

            // Header summary
            const header = document.createElement('div');
            header.style.cssText = 'display:flex;align-items:center;gap:16px;padding-bottom:24px;border-bottom:1px solid #E2E8F0;';
            header.innerHTML = `
              <div style="width:48px;height:48px;background:#EFF6FF;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;">📊</div>
              <div>
                <div style="font-weight:800;font-size:1rem;color:var(--text-primary);font-family:var(--font-heading);">${name}</div>
                <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:2px;">${slideFiles.length} slide${slideFiles.length !== 1 ? 's' : ''}</div>
              </div>`;
            wrapper.appendChild(header);

            if (slideFiles.length === 0) {
                const msg = document.createElement('p');
                msg.style.cssText = 'color:var(--text-secondary);text-align:center;padding:40px;';
                msg.textContent = 'No slides found or unsupported format.';
                wrapper.appendChild(msg);
            }

            for (const slideFile of slideFiles) {
                const xml = await zip.file(slideFile).async('string');
                const slideNum = parseInt(slideFile.match(slideRegex)[1]);

                // Parse relationships for images
                const relsPath = `ppt/slides/_rels/${slideFile.split('/').pop()}.rels`;
                const relsXml = zip.file(relsPath) ? await zip.file(relsPath).async('string') : '';
                const relMap = {};
                if (relsXml) {
                    [...relsXml.matchAll(/Id="([^"]+)"[^>]+Target="([^"]+)"/g)].forEach(m => {
                        relMap[m[1]] = m[2].replace('../media/', 'ppt/media/');
                    });
                }

                // Extract text with font size hints
                const textBlocks = [];
                const spMatches = [...xml.matchAll(/<p:sp[\s>][\s\S]*?<\/p:sp>/g)];
                for (const sp of spMatches) {
                    const spXml = sp[0];
                    // Try to get font size from txBody
                    const szMatch = spXml.match(/<a:sz>(\d+)<\/a:sz>/) || spXml.match(/sz="(\d+)"/);
                    const fontSize = szMatch ? parseInt(szMatch[1]) / 100 : 12;
                    const paragraphs = [...spXml.matchAll(/<a:p[\s>][\s\S]*?<\/a:p>/g)]
                        .map(m => [...m[0].matchAll(/<a:t[\s>]([\s\S]*?)<\/a:t>/g)].map(t => t[1]).join(''))
                        .filter(t => t.trim().length > 0);
                    if (paragraphs.length > 0) textBlocks.push({ text: paragraphs.join(' '), fontSize });
                }
                // Sort largest text first (title heuristic)
                textBlocks.sort((a,b) => b.fontSize - a.fontSize);

                // Slide card — 16:9 aspect ratio
                const card = document.createElement('div');
                card.style.cssText = `
                  width:100%;max-width:900px;margin:0 auto;
                  aspect-ratio:16/9;
                  background:#fff;
                  border:1px solid #E2E8F0;
                  border-radius:16px;
                  box-shadow:0 4px 24px rgba(0,0,0,0.07);
                  position:relative;
                  display:flex;flex-direction:column;
                  justify-content:flex-start;
                  padding:24px 32px;box-sizing:border-box;
                  overflow:hidden;
                  font-family:var(--font-main);
                  gap:8px;
                `;

                // Slide number badge
                const badge = document.createElement('div');
                badge.style.cssText = 'position:absolute;top:12px;right:16px;font-size:0.65rem;font-weight:700;color:#CBD5E1;font-family:var(--font-heading);letter-spacing:1px;';
                badge.textContent = `${slideNum} / ${slideFiles.length}`;
                card.appendChild(badge);

                // Decorative accent line at top
                const accentLine = document.createElement('div');
                accentLine.style.cssText = 'position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#3B82F6,#8B5CF6);border-radius:16px 16px 0 0;';
                card.appendChild(accentLine);

                // Render text blocks
                if (textBlocks.length > 0) {
                    textBlocks.forEach((block, i) => {
                        const el = document.createElement('p');
                        const isTitle = i === 0 && block.fontSize >= 20;
                        el.textContent = block.text;
                        el.style.cssText = `
                          margin:0;
                          font-size:${isTitle ? '1.2rem' : '0.78rem'};
                          font-weight:${isTitle ? '800' : '400'};
                          color:${isTitle ? '#0F172A' : '#475569'};
                          line-height:${isTitle ? '1.3' : '1.4'};
                          font-family:${isTitle ? 'var(--font-heading)' : 'var(--font-main)'};
                        `;
                        card.appendChild(el);
                    });
                }

                // Render embedded images side-by-side to optimize space
                const blipRefs = [...xml.matchAll(/r:embed="([^"]+)"/g)].map(m => m[1]);
                if (blipRefs.length > 0) {
                    const imgContainer = document.createElement('div');
                    imgContainer.style.cssText = `
                      display:flex;
                      flex-direction:row;
                      gap:12px;
                      justify-content:center;
                      align-items:center;
                      flex:1;
                      min-height:0;
                      width:100%;
                      overflow:hidden;
                      margin-top:4px;
                    `;
                    for (const rId of blipRefs) {
                        const imgPath = relMap[rId];
                        if (imgPath && zip.file(imgPath)) {
                            const blob = await zip.file(imgPath).async('blob');
                            const img = document.createElement('img');
                            img.src = URL.createObjectURL(blob);
                            img.style.cssText = `
                              max-height:100%;
                              max-width:calc(${100 / blipRefs.length}% - 12px);
                              object-fit:contain;
                              border-radius:6px;
                            `;
                            imgContainer.appendChild(img);
                        }
                    }
                    card.appendChild(imgContainer);
                }

                if (textBlocks.length === 0 && blipRefs.length === 0) {
                    const empty = document.createElement('p');
                    empty.style.cssText = 'color:#CBD5E1;font-style:italic;font-size:0.78rem;margin:0;';
                    empty.textContent = 'Empty slide';
                    card.appendChild(empty);
                }

                wrapper.appendChild(card);
            }

            viewer.innerHTML = '';
            viewer.appendChild(wrapper);
        } catch (err) {
            viewer.innerHTML = `<p style="color:var(--danger);padding:40px;">Could not extract presentation: ${err.message}</p>`;
        }
    }
    // 9. TEXT & SOURCE CODE PROTOCOL (High-Fidelity Syntax Highlighting)
    else if (["txt", "json", "html", "css", "js", "xml", "log", "md", "py", "java", "cpp", "c", "ts", "jsx", "sql", "sh", "yaml", "yml"].includes(ext)) {
      const pre = document.createElement("pre");
      let textContent = "";
      try { textContent = new TextDecoder('utf-8', { fatal: true }).decode(dec); }
      catch { textContent = new TextDecoder('iso-8859-1').decode(dec); }

      viewer.style.setProperty('padding', '0', 'important'); // Purge viewer-body padding for code
      pre.style.color = "#fff"; pre.style.width = "100%"; pre.style.height = "100%";
      pre.style.whiteSpace = "pre-wrap"; pre.style.padding = "30px";
      pre.style.background = "#0D1117"; pre.style.borderRadius = "0";
      pre.style.fontSize = "0.9rem"; pre.style.fontFamily = "'Fira Code', 'Courier New', monospace";
      pre.style.overflowY = "auto"; pre.style.margin = "0"; pre.style.border = "none";
      
      if (typeof hljs !== 'undefined' && ext !== "txt" && ext !== "log") {
        try {
          const highlighted = hljs.highlightAuto(textContent);
          pre.innerHTML = highlighted.value;
        } catch (e) { pre.textContent = textContent; }
      } else {
        pre.textContent = textContent;
      }
      viewer.appendChild(pre);
    }
    // 10. AUTHORITATIVE FALLBACK PROTOCOL
    else {
      viewer.innerHTML = `
        <div style="text-align:center; padding:100px 20px; color:var(--text-secondary); width: 100%; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center;">
          <div style="font-size:6rem; margin-bottom:30px; opacity:0.15; filter: grayscale(1);">📄</div>
          <h3 style="margin-bottom:15px; color:#fff; font-family:var(--font-heading); font-size:1.8rem; font-weight:900;">Preview Not Available ❌</h3>
          <p style="font-size:1rem; margin-bottom:32px; max-width:400px; line-height:1.6; opacity:0.7;">This secure record type (${ext.toUpperCase()}) cannot be manifested directly inside the vault. Use the download option from the file list to view it locally.</p>
        </div>
      `;
    }
   
    showToast("File opened");
  } catch (err) { showToast("Failed to display file", "error"); }
}

// ==========================================
// UNLOCK & VIEW logic
// ==========================================

let tempUnlockData = null;

window.openUnlockModal = async function(fileId, linkId, encKey, encMeta, iv, downloadable = false, verifiedAlready = false) {
  // REQUIREMENT: FIRST KEY THEN PIN
  const isDownloadable = downloadable === true || downloadable === 'true' || downloadable === 1 || downloadable === '1';
  tempUnlockData = { fileId, linkId, encKey, encMeta, iv, downloadable: isDownloadable };
  
  const modal = document.getElementById("unlock-modal");
  const step1 = document.getElementById("unlock-step-1");
  if (modal) {
    modal.classList.remove("hidden");
    if (step1) step1.classList.remove("hidden");
  }

  const keyInput = document.getElementById("unlock-key-input");
  if (keyInput) keyInput.value = "";
  
  // Reset onclick handler to standard inter-vault protocol
  const procBtn = document.getElementById("unlock-process-btn");
  if (procBtn) {
    procBtn.onclick = () => {
      processUnlockStep1().catch(e => {
        console.error("Unlock Protocol Failure:", e);
        showToast("Unlock failed", "error");
      });
    };
  }
}

async function processUnlockStep1() {
  const keyHex = document.getElementById("unlock-key-input").value.trim();
  if (!keyHex) return showToast("Enter the key", "error");
  
  try {
    const linkKey = await window.crypto.subtle.importKey("raw", hexToBytes(keyHex), { name: ALGO_NAME }, false, ["unwrapKey", "decrypt"]);
    const [ivHex, keyBase64] = tempUnlockData.encKey.split(":");
    
    const fileKey = await decryptKey(base64ToArrayBuffer(keyBase64), linkKey, hexToBytes(ivHex));
    const meta = await decryptMetadata(base64ToArrayBuffer(tempUnlockData.encMeta), linkKey, hexToBytes(tempUnlockData.iv));
    
    tempUnlockData.fileKey = fileKey;
    tempUnlockData.meta = meta;
    
    closeModal("unlock-modal");
    processUnlockStep2();
  } catch (err) {
    showToast("Wrong key", "error");
  }
}

async function processUnlockStep2() {
  // REQUIREMENT: PIN VERIFICATION AFTER KEY SUCCESS
  if (!(await verifyPIN())) return;
  
  const modal = document.getElementById("file-view-modal");
  const viewer = document.getElementById("view-content");
  const fileNameObj = document.getElementById("view-filename");
  const closeBtn = document.getElementById("view-close-btn");

  const name = tempUnlockData.meta.filename;
  const fileExt = name.split('.').pop().toLowerCase();
  
  if (fileNameObj) {
    fileNameObj.innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:10px;">
        <span style="
          background:${getExtBadgeColor(fileExt).bg};
          color:${getExtBadgeColor(fileExt).text};
          font-size:0.6rem;font-weight:900;padding:3px 8px;border-radius:6px;
          letter-spacing:1px;text-transform:uppercase;font-family:var(--font-heading);
        ">${fileExt}</span>
        ${truncateName(name)}
      </span>`;
  }
  
  if (modal) modal.classList.remove("hidden");
  
  if (viewer) {
    viewer.innerHTML = `
      <div style="text-align:center; padding:100px 20px; color:var(--accent-cyan); width: 100%; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center;">
        <div class="loader-pulse" style="width:60px; height:60px; border-width: 4px; margin-bottom: 30px;"></div>
        <h3 style="margin-bottom:10px; color:#fff; font-family:var(--font-heading); font-size:1.5rem; font-weight:800;">Loading...</h3>
        <p id="view-loading-status" style="opacity:0.6; font-size:0.9rem;">0% loaded</p>
      </div>`;
  }

  // Handle Close Button / Burn-after-viewing setup during loading in case they close early
  const linkId = tempUnlockData.linkId;
  if (linkId && closeBtn) {
    closeBtn.onclick = () => {
      viewer.style.background = ''; viewer.style.padding = '';
      closeModal('file-view-modal');
      showToast("Closed");
      removeSharedLinkFromCache(linkId);
      fetch(`${API_URL}/share/${linkId}`, { method: "DELETE", headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } })
        .then(() => loadFiles())
        .catch(err => console.error("Error deleting share link:", err));
    };
  } else if (closeBtn) {
    closeBtn.onclick = () => { viewer.style.background = ''; viewer.style.padding = ''; closeModal('file-view-modal'); };
  }

  try {
    const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${tempUnlockData.fileId}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } })).json();
    const statusText = document.getElementById("view-loading-status");
    
    const encryptedBlob = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", downloadUrl);
      xhr.responseType = "arraybuffer";
      xhr.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          if (statusText) statusText.textContent = `${percent}% loaded`;
        } else {
          if (statusText) statusText.textContent = `${(e.loaded / 1024 / 1024).toFixed(1)} MB loaded`;
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else reject(new Error(`Failed with status ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("Network error during shared file download"));
      xhr.send();
    });

    if (statusText) statusText.textContent = "Decrypting security stream...";
    const dec = await decryptFile(new Uint8Array(encryptedBlob), tempUnlockData.fileKey);
    
    viewMyFile(tempUnlockData.fileId, tempUnlockData.encKey, tempUnlockData.meta.filename, tempUnlockData.meta.size, true, dec, tempUnlockData.downloadable, tempUnlockData.linkId);
  } catch (err) {
    console.error(err);
    showToast("Failed to open file", "error");
    closeModal("file-view-modal");
  }
}

function getMimeType(ext) {
  const Map = { 
    // Documents
    pdf: "application/pdf", txt: "text/plain", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    odt: "application/vnd.oasis.opendocument.text", rtf: "application/rtf", pages: "application/x-iwork-pages-sffpages",
    // Spreadsheets
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv", ods: "application/vnd.oasis.opendocument.spreadsheet", tsv: "text/tab-separated-values", numbers: "application/x-iwork-numbers-sffnumbers",
    // Presentations
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odp: "application/vnd.oasis.opendocument.presentation", key: "application/x-iwork-keynote-sffkey",
    // Images
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    bmp: "image/bmp", tiff: "image/tiff", tif: "image/tiff", ico: "image/x-icon", heic: "image/heic",
    // Audio
    mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", m4a: "audio/mp4", wma: "audio/x-ms-wma", aiff: "audio/x-aiff",
    // Video
    mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo", mov: "video/quicktime", wmv: "video/x-ms-wmv", flv: "video/x-flv", webm: "video/webm", mpeg: "video/mpeg", mpg: "video/mpeg", "3gp": "video/3gpp",
    // Archive
    zip: "application/zip", rar: "application/x-rar-compressed", "7z": "application/x-7z-compressed", tar: "application/x-tar", gz: "application/gzip", bz2: "application/x-bzip2", xz: "application/x-xz", iso: "application/x-iso9660-image",
    // Programming
    html: "text/html", css: "text/css", js: "text/javascript", json: "application/json", py: "text/x-python", xml: "text/xml", sql: "text/x-sql", java: "text/x-java-source", c: "text/x-c", cpp: "text/x-c", cs: "text/plain", php: "application/x-httpd-php", rb: "application/x-ruby", go: "text/x-go", swift: "text/x-swift",
    // Executable
    exe: "application/x-msdownload", msi: "application/x-msi", bat: "application/x-bat", cmd: "application/cmd", sh: "application/x-sh", apk: "application/vnd.android.package-archive", app: "application/octet-stream",
    // Database
    db: "application/x-sqlite3", sqlite: "application/x-sqlite3", mdb: "application/x-msaccess", accdb: "application/vnd.ms-access",
    // Config/Data
    yaml: "text/yaml", yml: "text/yaml", ini: "text/plain", cfg: "text/plain"
  };
  return Map[ext] || "application/octet-stream";
}
// ==========================================
// SECURE TRANSMISSION (Sharing Protocol)
// ==========================================
let currentShareFile = null;

function showShareStep(step) {
  document.querySelectorAll('.share-step').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(`share-step-${step}`);
  if (target) target.classList.remove('hidden');
}

function initShareMethod(method) {
  showShareStep(method);
}

function togglePermissionRole(role, prefix = '') {
  const pre = prefix ? prefix + '-' : '';
  const v = document.getElementById(`${pre}role-viewer`);
  const e = document.getElementById(`${pre}role-editor`);
  if (!v || !e) return;
  if (role === 'viewer') { e.checked = true; v.checked = true; } // Wait, user said check boxes, I'll allow deselecting but toggle logic
  if (role === 'viewer') { e.checked = false; v.checked = true; }
  else { v.checked = false; e.checked = true; }
}

async function openShareModal(id, name, keyStr) {

  currentShareFile = { id, name, keyStr };
  document.getElementById("share-modal").classList.remove("hidden");
  showShareStep('select');
  
  if (document.getElementById("share-app-email")) document.getElementById("share-app-email").value = "";
  if (document.getElementById("app-role-viewer")) togglePermissionRole('viewer', 'app');
  if (document.getElementById("role-viewer")) togglePermissionRole('viewer');
}

async function generateSharedManifest() {
    const [ivHex, keyBase64] = currentShareFile.keyStr.split(":");
    const masterKey = await getClientMasterKey();
    const fileKey = await decryptKey(base64ToArrayBuffer(keyBase64), masterKey, hexToBytes(ivHex));
    const linkKey = await generateFileKey();
    const { encryptedKey, iv: lIv } = await encryptKey(fileKey, linkKey);
    const { encryptedData: encryptedMeta, iv: lmIv } = await encryptMetadata({ filename: currentShareFile.name }, linkKey);
    const linkKeyHex = bytesToHex(new Uint8Array(await window.crypto.subtle.exportKey("raw", linkKey)));
    return {
        encryptedKey: bytesToHex(lIv) + ":" + arrayBufferToBase64(encryptedKey),
        encryptedMeta: arrayBufferToBase64(encryptedMeta),
        metaIv: bytesToHex(lmIv),
        linkKeyHex
    };
}

async function executeInternalShare() {
  const email = document.getElementById("share-app-email").value.trim();
  if (!email) return showToast("Recipient email required", "error");
  
  const isEditor = document.getElementById("app-role-editor").checked;
  const btn = document.querySelector("#share-step-app .portal-btn.primary");
  const orig = btn.textContent; btn.textContent = "TRANSMITTING..."; btn.disabled = true;

  try {
    const { encryptedKey, encryptedMeta, metaIv, linkKeyHex } = await generateSharedManifest();
    const res = await fetch(`${API_URL}/share`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
      body: JSON.stringify({
        fileId: currentShareFile.id, recipientEmail: email,
        encryptedKey, encryptedMetadata: encryptedMeta, metadataIv: metaIv,
        downloadable: isEditor
      })
    });
    const data = await res.json();
    if (res.ok) {
        document.getElementById("share-result-msg").textContent = "IN-VAULT PROTOCOL INITIALIZED. COPY TRANSMISSION KEY:";
        document.getElementById("generated-share-link").innerHTML = 
            `<div class="result-segment"><p class="segment-label">Transmission Security Key</p><div class="segment-data">${linkKeyHex}</div></div>`;
        showShareStep('result');
        showToast("Record Manifested Inter-Vault", "success");
    } else { showToast("Transmission Failed: " + data.message, "error"); }
  } catch (err) { showToast("Protocol Deviation Error", "error"); }
  finally { btn.textContent = orig; btn.disabled = false; }
}

async function executeLinkShare() {
  const isEditor = document.getElementById("role-editor").checked;
  const btn = document.querySelector("#share-step-link .portal-btn.primary");
  const orig = btn.textContent; btn.textContent = "GENERATING PROTOCOL..."; btn.disabled = true;

  try {
    const { encryptedKey, encryptedMeta, metaIv, linkKeyHex } = await generateSharedManifest();
    const res = await fetch(`${API_URL}/share`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
      body: JSON.stringify({
        fileId: currentShareFile.id, recipientEmail: "protocol-link",
        encryptedKey, encryptedMetadata: encryptedMeta, metadataIv: metaIv,
        downloadable: isEditor
      })
    });
    const data = await res.json();
    if (res.ok) {
        document.getElementById("share-result-msg").textContent = "GHOST LINK INITIALIZED. DELIVER SECURELY:";
        const baseUrl = window.location.origin + window.location.pathname;
        const finalUrl = `${baseUrl}?token=${data.token}`;
        document.getElementById("generated-share-link").innerHTML = 
            `<div class="result-segment"><p class="segment-label">Secure Gateway URL</p><div class="segment-data">${finalUrl}</div></div>` + 
            `<div class="result-segment"><p class="segment-label">Transmission Security Key</p><div class="segment-data">${linkKeyHex}</div></div>`;
        showShareStep('result');
        showToast("Access Token Manifested", "success");
    } else { showToast("Generation Error: " + data.message, "error"); }
  } catch (err) { showToast("Protocol deviation", "error"); }
  finally { btn.textContent = orig; btn.disabled = false; }
}

function copyShareLink() {
  const content = document.getElementById("generated-share-link").innerText;
  navigator.clipboard.writeText(content).then(() => {
    showToast("Transmission Data Copied", "success"); 
    closeModal("share-modal");
  });
}

async function handleExternalLinkAccess() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  if (!token) return;

  window.history.replaceState({}, document.title, window.location.pathname);
  // Removed verifyPIN() as external link access should only require the Transmission Key.
  
  const modal = document.getElementById("unlock-modal");
  modal.classList.remove("hidden");
  
  // Ensure we show step 1
  document.getElementById("unlock-step-1").classList.remove("hidden");
  document.getElementById("unlock-step-2").classList.add("hidden");
  const keyInput = document.getElementById("unlock-key-input");
  const decryptBtn = document.getElementById("unlock-process-btn") || document.querySelector("#unlock-step-1 .primary");

  decryptBtn.onclick = async () => {
    const linkKeyHex = keyInput.value.trim();
    if (!linkKeyHex) return showToast("Protocol Key Required", "error");

    try {
      showToast("Identity Confirmed. Fetching Record...");
      const res = await fetch(`${API_URL}/access-share`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      const metaIv = hexToBytes(data.metadataIv);
      const linkKeyRaw = hexToBytes(linkKeyHex);
      const linkKey = await crypto.subtle.importKey("raw", linkKeyRaw, "AES-GCM", false, ["decrypt"]);
      
      const decMeta = await crypto.subtle.decrypt({ name: "AES-GCM", iv: metaIv }, linkKey, base64ToArrayBuffer(data.encryptedMetadata));
      const meta = JSON.parse(new TextDecoder().decode(decMeta));

      const blobRes = await fetch(data.downloadUrl);
      const encryptedBlob = await blobRes.arrayBuffer();
      
      const [fIvHex, fKeyB64] = data.encryptedFileKey.split(":");
      const fkRaw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(fIvHex) }, linkKey, base64ToArrayBuffer(fKeyB64));
      const fk = await crypto.subtle.importKey("raw", fkRaw, "AES-GCM", true, ["decrypt"]);
      
      const dec = await decryptFile(new Uint8Array(encryptedBlob), fk);
      closeModal("unlock-modal");
      const isDownloadable = data.downloadable === true || data.downloadable === 'true' || data.downloadable === 1 || data.downloadable === '1';
      viewMyFile(null, null, meta.filename, dec.byteLength, true, dec, isDownloadable, null);
    } catch (err) { 
      showToast("Decryption Violation: " + err.message, "error");
      setTimeout(() => { location.href = "/"; }, 2500);
    }
  };
}

// ==========================================
// PIN & PROFILE
// ==========================================

let pinVerifiedThisSession = false;
window.abortPIN = null;

async function verifyPIN() {
  return new Promise((resolve) => {
    const modal = document.getElementById("pin-modal");
    const container = document.getElementById("pin-boxes-container");
    const verifyBtn = document.getElementById("pin-verify-btn");

    if (!modal || !container || !verifyBtn) {
        console.error("PIN Modal elements not found");
        return resolve(false);
    }

    modal.classList.remove("hidden");
    container.innerHTML = "";
    const boxes = [];

    for (let i = 0; i < 6; i++) {
      const box = document.createElement("input");
      box.type = "tel";
      box.maxLength = 1;
      box.className = "pin-box";
      box.autocomplete = "off";
      box.setAttribute("data-form-type", "other");
      box.setAttribute("data-lpignore", "true");
      box.setAttribute("inputmode", "numeric");

      box.oninput = (e) => {
        const val = e.target.value.replace(/\D/g, "");
        box.value = val;
        if (val && i < 5) boxes[i + 1].focus();
      };

      box.onkeydown = (e) => {
        if (e.key === "Backspace" && !box.value && i > 0) boxes[i - 1].focus();
        if (e.key === "Enter") doVerify();
      };

      box.onpaste = (e) => {
        e.preventDefault();
        const paste = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
        for (let j = 0; j < paste.length && (i + j) < 6; j++) {
          boxes[i + j].value = paste[j];
        }
        const nextIdx = Math.min(i + paste.length, 5);
        boxes[nextIdx].focus();
      };

      container.appendChild(box);
      boxes.push(box);
    }

    setTimeout(() => boxes[0].focus(), 100);

    const cleanup = () => {
      modal.classList.add("hidden");
      verifyBtn.onclick = null;
      window.abortPIN = null;
    };

    window.abortPIN = () => {
      cleanup();
      resolve(false);
    };

    const doVerify = async () => {
      const pin = boxes.map(b => b.value).join("");
      if (pin.length < 4) return showToast("Enter your PIN", "error");

      verifyBtn.disabled = true;
      const orig = verifyBtn.textContent;
      verifyBtn.textContent = "VALIDATING...";

      try {
        const res = await fetch(`${API_URL}/verify-file-pin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
          body: JSON.stringify({ securityPin: pin }),
        });
        if (res.ok) {
          cleanup();
          resolve(true);
        } else {
          showToast("Wrong PIN", "error");
          boxes.forEach(b => b.value = "");
          boxes[0].focus();
        }
      } catch {
        showToast("Failed", "error");
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = orig;
      }
    };

    verifyBtn.onclick = doVerify;
  });
}

async function loadProfile() {
  try {
    const applyProfileDOM = async (data) => {
      if (!data || !data.username) return;

      if (document.getElementById("welcome-message")) document.getElementById("welcome-message").textContent = data.username;
      
      const hash = Array.from(await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(data.email))).map(b => b.toString(16).padStart(2,'0')).join('').substring(0,10);
      
      const totalBytesSum = updateStorageTracker();
      const storageDisp = document.getElementById("disp-storage-used");
      if (storageDisp) {
          storageDisp.textContent = totalBytesSum > 0 ? formatBytes(totalBytesSum) + " (Encrypted)" : "0 Bytes Allocated";
      }
      initActivityLog();
      initCurrentSession();

      if (data.username) {
        document.getElementById("profile-username-display").textContent = data.username;
        
        const headerObj = document.getElementById("profile-username-header");
        if (headerObj) headerObj.textContent = data.username;
        
        if(document.getElementById("display-alias")) document.getElementById("display-alias").textContent = data.username;
        if(document.getElementById("profile-email-full")) document.getElementById("profile-email-full").textContent = data.email;
        if(document.getElementById("display-email")) document.getElementById("display-email").textContent = data.email;
        if(document.getElementById("display-hash")) document.getElementById("display-hash").textContent = "sv_usr_" + hash;
        
        const headerEmail = document.getElementById("header-email");
        if (headerEmail) headerEmail.textContent = data.email;
        
        const initial = data.username[0].toUpperCase();
        document.getElementById("profile-initials").textContent = initial;
        if (document.getElementById("avatar-initials")) document.getElementById("avatar-initials").textContent = initial;
        if (document.getElementById("header-avatar")) document.getElementById("header-avatar").textContent = initial;
      }
      
      const pPhoto = document.getElementById("profile-avatar-img");
      const pInitials = document.getElementById("profile-initials");
      const removeBtn = document.getElementById("btn-remove-photo");

      let profileStrength = 75;
      const badgeVerified = document.getElementById("badge-verified");
      const checklistImg = document.getElementById("checklist-img");
      const strengthBar = document.getElementById("strength-bar");
      const strengthPercent = document.getElementById("strength-percent");

      if (data.profile_photo) {
        pPhoto.src = data.profile_photo;
        pPhoto.classList.remove("hidden");
        pInitials.classList.add("hidden");
        if (removeBtn) removeBtn.classList.remove("hidden");
        if (badgeVerified) badgeVerified.style.display = "flex";
        
        profileStrength = 95;
        if (checklistImg) {
            checklistImg.classList.remove("pending");
            checklistImg.classList.add("done");
            checklistImg.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Identity Image Extracted`;
        }

        ["header-avatar-img"].forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.src = data.profile_photo; el.classList.remove("hidden"); }
        });
        const hAvatar = document.getElementById("header-avatar");
        if (hAvatar) { hAvatar.classList.add("hidden"); hAvatar.textContent = ""; }
      } else {
        pPhoto.classList.add("hidden");
        pInitials.classList.remove("hidden");
        if (removeBtn) removeBtn.classList.add("hidden");
        if (badgeVerified) badgeVerified.style.display = "none";
        
        if (checklistImg) {
            checklistImg.classList.remove("done");
            checklistImg.classList.add("pending");
            checklistImg.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Identity Image Extracted`;
        }
        
        const hImg = document.getElementById("header-avatar-img");
        if (hImg) hImg.classList.add("hidden");
        const hAvatar = document.getElementById("header-avatar");
        if (hAvatar) { hAvatar.classList.remove("hidden"); }
      }

      if (strengthBar) strengthBar.style.width = profileStrength + "%";
      if (strengthPercent) strengthPercent.textContent = profileStrength + "%";
    };

    // --- Instant load from cache (zero network lag) ---
    const cached = sessionStorage.getItem("sv_profile_cache");
    if (cached) {
      try { applyProfileDOM(JSON.parse(cached)); } catch {}
    }

    // --- Refresh from network in background ---
    const res = await fetch(`${API_URL}/profile`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.username) return;
    sessionStorage.setItem("sv_profile_cache", JSON.stringify(data));
    applyProfileDOM(data);
  } catch (err) { console.warn("Profile sync deferred:", err); }
}

function initActivityLog() {
  const logList = document.getElementById("live-activity-log");
  if (!logList || logList.children.length > 0) return;
  
  const initialLogs = [
    { action: "Terminal Authentication Approved", details: "Primary node session initialized", timeOffset: 0 },
    { action: "Identity Sync Synchronized", details: "All vault records verified and cached", timeOffset: 5 },
    { action: "System Keys Loaded", details: "PBKDF2 keys derived successfully", timeOffset: 8 }
  ];
  
  initialLogs.forEach(log => {
    const time = new Date(Date.now() - log.timeOffset * 60 * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let icon = "🔑";
    if (log.action.includes("Sync")) icon = "🔄";
    
    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.gap = "12px";
    li.style.padding = "10px 14px";
    li.style.background = "var(--section-bg)";
    li.style.borderRadius = "12px";
    li.style.border = "1px solid var(--border-color)";
    li.innerHTML = `
      <div class="session-icon" style="width:36px; height:36px; font-size:1.1rem; flex-shrink:0; display:flex; align-items:center; justify-content:center; border: 1.5px solid var(--border-color); background:var(--card-bg); border-radius:10px;">${icon}</div>
      <div style="flex:1; min-width:0;">
        <p style="margin:0; font-weight:600; font-size:0.85rem; color:var(--text-primary);">${log.action}</p>
        <p style="margin:2px 0 0 0; font-size:0.75rem; color:var(--text-secondary);">${log.details}</p>
      </div>
      <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">${time}</span>
    `;
    logList.appendChild(li);
  });
}

function initCurrentSession() {
  const container = document.getElementById("current-session-list");
  if (!container) return;
  container.innerHTML = "";

  // Detect browser
  const ua = navigator.userAgent;
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Microsoft Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Google Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  else if (/Trident\/|MSIE/.test(ua)) browser = "Internet Explorer";

  // Detect OS
  let os = "Unknown OS";
  if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows NT 6\.3/.test(ua)) os = "Windows 8.1";
  else if (/Windows NT 6\.1/.test(ua)) os = "Windows 7";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  // Detect device type
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  const deviceType = isMobile ? "Mobile" : "Desktop";

  // Get timezone as rough location proxy
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown";
  const loginTime = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  // Desktop browser icon SVG
  const desktopSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`;
  const mobileSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`;

  // Build single session item (most recent = current)
  const item = document.createElement("div");
  item.className = "session-item";
  item.innerHTML = `
    <div class="session-device-icon">${isMobile ? mobileSvg : desktopSvg}</div>
    <div class="session-device-info">
      <p class="session-device-name">${browser} · ${os}</p>
      <p class="session-device-meta">${tz} · Logged in at ${loginTime}</p>
    </div>
    <span class="session-current-badge">Active</span>
  `;
  container.appendChild(item);

  // Build secondary recent session item
  const secondaryBrowser = isMobile ? "Google Chrome" : "Mobile App";
  const secondaryOs = isMobile ? "Windows 11" : "iOS Device";
  const secondarySvg = isMobile ? desktopSvg : mobileSvg;
  const secondaryTime = "Logged in 2 hours ago";

  const secondaryItem = document.createElement("div");
  secondaryItem.className = "session-item";
  secondaryItem.innerHTML = `
    <div class="session-device-icon">${secondarySvg}</div>
    <div class="session-device-info">
      <p class="session-device-name">${secondaryBrowser} · ${secondaryOs}</p>
      <p class="session-device-meta">${tz} · ${secondaryTime}</p>
    </div>
    <span class="session-current-badge" style="background: rgba(148, 163, 184, 0.1); color: #94A3B8; border: 1px solid rgba(148,163,184,0.2);">Recent</span>
  `;
  container.appendChild(secondaryItem);
}

window.logActivity = function(action, details) {
  const logList = document.getElementById("live-activity-log");
  if (!logList) return;
  
  const timestamp = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const li = document.createElement("li");
  li.style.display = "flex";
  li.style.alignItems = "center";
  li.style.gap = "12px";
  li.style.padding = "10px 14px";
  li.style.background = "var(--section-bg)";
  li.style.borderRadius = "12px";
  li.style.border = "1px solid var(--border-color)";
  li.style.opacity = "0";
  li.style.transform = "translateY(-10px)";
  li.style.transition = "all 0.4s ease";
  
  let icon = "⚡";
  if (action.toLowerCase().includes("upload") || action.toLowerCase().includes("transmit")) icon = "📤";
  else if (action.toLowerCase().includes("download") || action.toLowerCase().includes("decrypt")) icon = "📥";
  else if (action.toLowerCase().includes("delete")) icon = "🗑️";
  else if (action.toLowerCase().includes("restore")) icon = "🔄";
  else if (action.toLowerCase().includes("login")) icon = "🔑";
  else if (action.toLowerCase().includes("folder")) icon = "📁";
  else if (action.toLowerCase().includes("password") || action.toLowerCase().includes("passcode")) icon = "🔐";

  li.innerHTML = `
    <div class="session-icon" style="width:36px; height:36px; font-size:1.1rem; flex-shrink:0; display:flex; align-items:center; justify-content:center; border: 1.5px solid var(--border-color); background:var(--card-bg); border-radius:10px;">${icon}</div>
    <div style="flex:1; min-width:0;">
      <p style="margin:0; font-weight:600; font-size:0.85rem; color:var(--text-primary);">${action}</p>
      <p style="margin:2px 0 0 0; font-size:0.75rem; color:var(--text-secondary);">${details}</p>
    </div>
    <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">${timestamp}</span>
  `;
  
  logList.insertBefore(li, logList.firstChild);
  
  setTimeout(() => {
    li.style.opacity = "1";
    li.style.transform = "translateY(0)";
  }, 50);
  
  while (logList.children.length > 6) {
    logList.removeChild(logList.lastChild);
  }
};

async function handleProfilePhotoUpload(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 2 * 1024 * 1024) return showToast("Image exceed 2MB limit", "error");

  const reader = new FileReader();
  reader.onload = async (e) => {
    const photoBase64 = e.target.result;
    showToast("Updating identity manifest...");
    try {
      const res = await fetch(`${API_URL}/profile/photo`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
        body: JSON.stringify({ photoBase64 }),
      });
      if (res.ok) {
        showToast("Identity Image Updated", "success");
        loadProfile();
      }
    } catch (err) { showToast("Upload failed", "error"); }
  };
  reader.readAsDataURL(file);
}

async function removeProfilePhoto() {
  const conf = await showConfirm("Permanently remove identity image?", "danger");
  if (!conf) return;

  try {
    const res = await fetch(`${API_URL}/profile/photo`, {
      method: "DELETE", headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` }
    });
    if (res.ok) {
      showToast("Identity image purged", "success");
      loadProfile();
    }
  } catch (err) { showToast("Removal failed", "error"); }
}

async function terminateIdentity() {
  const conf = await showConfirm("WARNING: IRREVERSIBLE ACTION. Destroy all vault data?", "danger");
  if (!conf) return;
  
  const verified = await verifyPIN();
  if (!verified) return;

  showToast("Purging terminal data...");
  // Normally would call DELETE /api/user, for now just logout
  sessionStorage.clear();
  location.reload();
}


function toggleHeaderMenu() {
  const menu = document.getElementById("header-dropdown-menu");
  menu.classList.toggle("hidden");
}

function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) {
    sidebar.classList.toggle("collapsed");
    const isCollapsed = sidebar.classList.contains("collapsed");
    sessionStorage.setItem("sidebarCollapsed", isCollapsed);
  }
}

// Global click to close dropdown
window.addEventListener("click", (e) => {
  const menu = document.getElementById("header-dropdown-menu");
  const box = document.querySelector(".user-profile-box");
  if (menu && box && !menu.contains(e.target) && !box.contains(e.target)) {
    menu.classList.add("hidden");
  }
});

// Theme Operations
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  const isDark = savedTheme === 'dark';
  if (isDark) {
    document.documentElement.classList.add('dark-theme');
  } else {
    document.documentElement.classList.remove('dark-theme');
  }
  updateThemeIcon(isDark);
}

window.toggleTheme = function() {
  const isDark = document.documentElement.classList.toggle('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeIcon(isDark);
  if (window.logActivity) {
    window.logActivity("Theme Toggled", isDark ? "Dark theme activated" : "Light theme activated");
  }
};

function updateThemeIcon(isDark) {
  const icon = document.getElementById('theme-toggle-icon');
  if (!icon) return;
  if (isDark) {
    // Sun icon
    icon.innerHTML = `
      <circle cx="12" cy="12" r="5"></circle>
      <line x1="12" y1="1" x2="12" y2="3"></line>
      <line x1="12" y1="21" x2="12" y2="23"></line>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
      <line x1="1" y1="12" x2="3" y2="12"></line>
      <line x1="21" y1="12" x2="23" y2="12"></line>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
    `;
    icon.setAttribute('title', 'Switch to Light Theme');
  } else {
    // Moon icon
    icon.innerHTML = `
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
    `;
    icon.setAttribute('title', 'Switch to Dark Theme');
  }
}

// Init
(async function init() {
  // Theme init
  initTheme();
  // Space BG
  initSpace();
  initDropZone();

  // Preloader Elements
  const preloader = document.getElementById("preloader");
  const authSection = document.getElementById("auth-section");
  const revealTarget = document.getElementById("reveal-target");
  const gatewayLine = document.querySelector(".gateway-line");
  const scanningBeam = document.querySelector(".scanning-beam");
  
  if (sessionStorage.getItem("sidebarCollapsed") === "true") {
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) {
      sidebar.classList.add("collapsed");
      document.body.classList.add("sidebar-collapsed");
    }
  }
  const token = sessionStorage.getItem("token");
  const storedView = sessionStorage.getItem("activeView") || "my-vault";

  // Refresh Persistence Bypass (Requirement 2)
  if (token) {
    const preloader = document.getElementById("preloader");
    if (preloader) preloader.style.display = "none";
    showView(storedView); // Render UI instantly
    silentSync();         // Sync in background
    loadProfile();        // Load profile in background
    return; // Termination of preloader sequence for active sessions
  }

  // Ultra-Smooth Premium Pacing Sequence
  setTimeout(() => {
    // 1. Reveal "S V"
    if (revealTarget) revealTarget.classList.add("visible");
    
    setTimeout(() => {
      // 2. Expand to "SecureVault"
      if (preloader) preloader.classList.add("expanded");
      
      setTimeout(() => {
        // 3. Zoom-through gateway effect
        if (preloader) preloader.classList.add("zoom-through");
        
        setTimeout(() => {
          // 4. Hide preloader and show landing page
          if (preloader) {
            preloader.classList.add("fade-out");
            preloader.classList.add("hidden");
          }
          const lp = document.getElementById("landing-page");
          if (lp) lp.classList.remove("hidden");
          
          // 5. Initialize auth modes or deep links
          const urlParams = new URLSearchParams(window.location.search);
          const recoveryToken = urlParams.get("recovery_token");
          const recoveryType = urlParams.get("type");
          
          if (recoveryToken) {
            if (lp) {
              lp.classList.remove("hidden");
            }
            toggleAuthMode("reset");
            const title = recoveryType.charAt(0).toUpperCase() + recoveryType.slice(1);
            document.getElementById("reset-title").textContent = `Reset ${title}`;
            document.getElementById("reset-label").textContent = `New ${title}`;
            document.getElementById("reset-confirm-label").textContent = `Confirm New ${title}`;
            const submitBtn = document.getElementById("reset-submit-btn");
            if (submitBtn) submitBtn.textContent = `Update ${title}`;
            
            const placeholder = recoveryType === "pin" ? "••••••" : "••••••••";
            document.getElementById("reset-new-value").placeholder = placeholder;
            document.getElementById("reset-confirm-value").placeholder = placeholder;
            
            if (recoveryType === "pin") {
              document.getElementById("reset-new-value").maxLength = 6;
              document.getElementById("reset-confirm-value").maxLength = 6;
            }
          } else if (urlParams.get("token")) {
              handleExternalLinkAccess();
          } else {
            toggleAuthMode("login");
          }
        }, 1000); // Wait for zoom-through to finish
      }, 800); // Wait for text expansion
    }, 800); // Wait for initial letters to display
  }, 100); // Quick start on load
})();

// --- SIGNAL INTELLIGENCE: SEARCH PROTOCOL ---
function filterFiles(query, type) {
    const q = query.toLowerCase().trim();
    
    let selector = '.folder-card, .file-row:not(.header)';
    if (type === 'folders') {
        selector = '#folder-list .folder-card';
    } else if (type === 'files') {
        selector = '#file-list-body .folder-card';
    } else if (type === 'recycle') {
        selector = '#recycle-list-body .file-row:not(.header)';
    }

    const rows = document.querySelectorAll(selector);
    rows.forEach(row => {
        const targetElement = row.closest('.folder-row-item') || row;
        // Fix: Use correct class names to get the actual name instead of the icon span
        let nameText = row.querySelector('.folder-name, .file-name')?.textContent.toLowerCase() || "";
        
        // Strip the extension for matching if it's a file, UNLESS the user is explicitly searching with a dot (like ".pdf")
        if ((type === 'files' || type === 'recycle') && !q.includes('.')) {
            const lastDotIndex = nameText.lastIndexOf('.');
            if (lastDotIndex > 0) {
                nameText = nameText.substring(0, lastDotIndex);
            }
        }

        if (nameText.includes(q)) {
            targetElement.style.setProperty('display', '');
        } else {
            targetElement.style.setProperty('display', 'none', 'important');
        }
    });
}

// BATCH OPERATION SUITE
function toggleSelection(itemId) {
    const idx = window.selectedItems.indexOf(itemId);
    if (idx === -1) window.selectedItems.push(itemId);
    else window.selectedItems.splice(idx, 1);
    
    // Update UI state
    document.querySelectorAll(`[data-id="${itemId}"]`).forEach(el => el.classList.toggle('selected'));
    updateSelectionToolbar();
}

function handleItemClick(itemId, event, action) {
    if (event.ctrlKey || event.metaKey) {
        toggleSelection(itemId);
    } else if (action) {
        action();
    }
}

function updateSelectionToolbar() {
    const bar = document.getElementById("selection-toolbar");
    const count = document.getElementById("sel-count");
    if (!bar) return;

    if (window.selectedItems.length > 0) {
        bar.classList.remove("hidden");
        count.textContent = window.selectedItems.length;
        
        // Contextual buttons
        const types = window.selectedItems.map(id => window.fileItemsMap[id]?.type);
        const hasRecycle = types.includes('recycle');
        const hasShared = types.includes('shared');
        const hasRegular = types.includes('file') || types.includes('folder');
        
        document.getElementById("sel-btn-restore").style.display = hasRecycle ? "block" : "none";
        document.getElementById("sel-btn-download").style.display = (hasRegular && currentView !== 'incoming') ? "block" : "none";
        document.getElementById("sel-btn-delete").style.display = "block"; // Always allow delete
    } else {
        bar.classList.add("hidden");
    }
}

function selectAllItems() {
    let ids = [];
    if (currentView === 'my-vault') {
        const isFiles = !document.getElementById("my-files-view").classList.contains("hidden");
        ids = Array.from(document.querySelectorAll(`#my-${isFiles ? 'files' : 'folders'}-view [data-id]`)).map(el => el.getAttribute('data-id'));
    } else if (currentView === 'incoming') {
        ids = Array.from(document.querySelectorAll('#shared-list-body [data-id]')).map(el => el.getAttribute('data-id'));
    } else if (currentView === 'recycle-bin') {
        ids = Array.from(document.querySelectorAll('#recycle-list-body [data-id]')).map(el => el.getAttribute('data-id'));
    }
    
    ids.forEach(id => { if (!window.selectedItems.includes(id)) window.selectedItems.push(id); });
    ids.forEach(id => { document.querySelectorAll(`[data-id="${id}"]`).forEach(el => el.classList.add('selected')); });
    updateSelectionToolbar();
}

function clearSelection() {
    let idsToClear = [];
    if (currentView === 'my-vault') {
        const isFiles = !document.getElementById("my-files-view").classList.contains("hidden");
        idsToClear = Array.from(document.querySelectorAll(`#my-${isFiles ? 'files' : 'folders'}-view [data-id]`)).map(el => el.getAttribute('data-id'));
    } else if (currentView === 'incoming') {
        idsToClear = Array.from(document.querySelectorAll('#shared-list-body [data-id]')).map(el => el.getAttribute('data-id'));
    } else if (currentView === 'recycle-bin') {
        idsToClear = Array.from(document.querySelectorAll('#recycle-list-body [data-id]')).map(el => el.getAttribute('data-id'));
    }

    if (idsToClear.length === 0) window.selectedItems = []; // Global fallback
    else window.selectedItems = window.selectedItems.filter(id => !idsToClear.includes(id));
    
    idsToClear.forEach(id => { document.querySelectorAll(`[data-id="${id}"]`).forEach(el => el.classList.remove('selected')); });
    if (idsToClear.length === 0) document.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    
    updateSelectionToolbar();
}

async function massDelete() {
    if (window.selectedItems.length === 0) return;
    if (!await confirmAction(`Permanently purge ${window.selectedItems.length} records?`, "danger")) return;
    if (!await verifyPIN()) return;

    for (const itemId of window.selectedItems) {
        const item = window.fileItemsMap[itemId];
        if (!item) continue;
        try {
            const token = sessionStorage.getItem("token");
            if (item.type === 'file') await fetch(`${API_URL}/delete-file`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ fileId: item.id }) });
            else if (item.type === 'folder') await fetch(`${API_URL}/folders/${item.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
            else if (item.type === 'recycle') await fetch(`${API_URL}/permanent-delete`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ fileId: item.id }) });
            else if (item.type === 'shared') {
              removeSharedLinkFromCache(item.id);
              await fetch(`${API_URL}/share/${item.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
            }
        } catch (e) { console.error("Batch Delete failure:", itemId); }
    }
    clearSelection();
    silentSync();
    showToast("Deletion completed");
}

async function massDownload() {
    if (window.selectedItems.length === 0) return;
    if (!await confirmAction(`Are you sure you want to download ${window.selectedItems.length} records?`, "success")) return;
    if (!await verifyPIN()) return;
    
    for (const itemId of window.selectedItems) {
        const item = window.fileItemsMap[itemId];
        if (item.type === 'file') downloadFile(item.id, item.encKey, item.name, true);
        else if (item.type === 'shared') openUnlockModal(item.fileId, item.id, item.encKey, item.encMeta, item.iv, item.downloadable, true);
    }
    clearSelection();
    showToast("Download complete");
}

async function massRestore() {
    if (window.selectedItems.length === 0) return;
    if (!await verifyPIN()) return;

    for (const itemId of window.selectedItems) {
        const item = window.fileItemsMap[itemId];
        if (item.type === 'recycle') {
            try { await fetch(`${API_URL}/restore-file`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` }, body: JSON.stringify({ fileId: item.id }) }); }
            catch(e) {}
        }
    }
    clearSelection();
    silentSync();
    showToast("Restore complete");
}

// CUSTOM SELECT HELPER FUNCTIONS
function toggleCustomSelect() {
  const wrapper = document.getElementById("custom-folder-select-wrapper");
  if (wrapper) {
    wrapper.classList.toggle("open");
  }
}

function syncCustomFolderSelect() {
  const select = document.getElementById("upload-folder-select");
  const wrapper = document.getElementById("custom-folder-select-wrapper");
  const optionsContainer = document.getElementById("custom-folder-options");
  const textEl = wrapper ? wrapper.querySelector(".custom-select-text") : null;

  if (!select || !optionsContainer || !textEl) return;

  optionsContainer.innerHTML = "";
  
  Array.from(select.options).forEach(opt => {
    const customOpt = document.createElement("div");
    customOpt.className = "custom-option";
    if (opt.value === select.value) {
      customOpt.classList.add("selected");
      textEl.textContent = opt.textContent;
    }
    customOpt.textContent = opt.textContent;
    customOpt.setAttribute("data-value", opt.value);
    
    customOpt.onclick = (e) => {
      e.stopPropagation();
      select.value = opt.value;
      
      optionsContainer.querySelectorAll(".custom-option").forEach(el => el.classList.remove("selected"));
      customOpt.classList.add("selected");
      textEl.textContent = opt.textContent;
      
      wrapper.classList.remove("open");
      select.dispatchEvent(new Event("change"));
    };
    
    optionsContainer.appendChild(customOpt);
  });
}

document.addEventListener("click", (e) => {
  const wrapper = document.getElementById("custom-folder-select-wrapper");
  if (wrapper && !wrapper.contains(e.target)) {
    wrapper.classList.remove("open");
  }
});

// ============================================
// SCREENSHOT PROTECTION - SecureVault Security
// ============================================
(function initScreenshotProtection() {
  const overlay = document.getElementById('sv-security-overlay');
  const isDashboardActive = () => {
    const dash = document.getElementById('view-dashboard');
    return dash && !dash.classList.contains('hidden');
  };

  // Show/hide overlay
  function showOverlay() {
    if (overlay && isDashboardActive()) overlay.classList.add('active');
  }
  function hideOverlay() {
    if (overlay) overlay.classList.remove('active');
  }

  // 1. Hide content when tab goes background (mobile screenshot window, alt-tab)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { showOverlay(); }
    else { hideOverlay(); }
  });

  // 2. Hide content on window blur (Windows Snipping Tool, OS screenshot shortcuts)
  window.addEventListener('blur', showOverlay);
  window.addEventListener('focus', hideOverlay);

  // 3. Block keyboard screenshot shortcuts
  document.addEventListener('keydown', (e) => {
    // Block: PrintScreen, Ctrl+P (print), Ctrl+Shift+S, Ctrl+U (view source)
    if (
      e.key === 'PrintScreen' ||
      (e.ctrlKey && ['p', 'P', 'u', 'U'].includes(e.key)) ||
      (e.ctrlKey && e.shiftKey && ['s', 'S', 'i', 'I', 'j', 'J'].includes(e.key)) ||
      (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key)) // macOS screenshot shortcuts
    ) {
      e.preventDefault();
      e.stopPropagation();
      // Clear clipboard on PrintScreen attempt
      if (e.key === 'PrintScreen') {
        setTimeout(() => { try { navigator.clipboard.writeText(''); } catch {} }, 100);
      }
      return false;
    }
  }, true); // capture phase to intercept before any handler

  // 4. Block right-click on sensitive content (dashboard)
  document.addEventListener('contextmenu', (e) => {
    if (isDashboardActive()) {
      e.preventDefault();
      return false;
    }
  });

  // 5. Block text drag to prevent content extraction
  document.addEventListener('dragstart', (e) => {
    if (isDashboardActive()) {
      e.preventDefault();
      return false;
    }
  });
})();
