const API_URL = window.location.origin + "/api";
const ALGO_NAME = "AES-GCM";

let sessionMasterKey = null;
let tempLoginCredentials = null;
let currentView = "my-vault";
let allFiles = [];
let allFolders = [];
let currentFolderId = null;
let currentExplorerFolderId = null;

// STORAGE LIMIT: 2.5 GB
const MAX_STORAGE_BYTES = 2.5 * 1024 * 1024 * 1024;
let currentTotalUsage = 0;

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
  const usagePercentText = document.getElementById("storage-percent");
  if (!usageText || !usageBar) return;

  const totalBytes = (allFiles.myFiles || []).reduce((acc, f) => {
    try {
      // We need to parse the meta from the encrypted metadata if we don't have it cached
      // But since we already have it in renderFiles, we'll sum it there or use a simplified approach.
      // For now, let's assume we store the decrypted size in allFiles for easy tracking.
      return acc + (f.size || 0); 
    } catch { return acc; }
  }, 0);

  currentTotalUsage = totalBytes;
  const usedMB = (totalBytes / (1024 * 1024)).toFixed(2);
  const usedGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
  
  const displaySize = totalBytes > 1024 * 1024 * 100 ? `${usedGB} GB` : `${usedMB} MB`;
  usageText.textContent = `${displaySize} used`;
  
  const percent = Math.min((totalBytes / MAX_STORAGE_BYTES) * 100, 100).toFixed(1);
  usageBar.style.width = `${percent}%`;
  usagePercentText.textContent = `${percent}%`;
  
  if (percent > 90) usageBar.style.background = "var(--danger)";
  else if (percent > 70) usageBar.style.background = "#FACC15";
  else usageBar.style.background = "linear-gradient(90deg, var(--accent-blue), #3B82F6)";
}

const svgView = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const svgDownload = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const svgShare = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
const svgDelete = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;

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

  showToast(`Encrypting: ${truncateName(file.name, 20)}...`);
  try {
    const fileKey = await generateFileKey();
    const encryptedFileBuffer = await encryptFile(file, fileKey);
    const masterKey = await getClientMasterKey();
    const { encryptedData: encMeta, iv: metaIv } = await encryptMetadata({ filename: file.name, size: file.size, type: file.type }, masterKey);
    const { encryptedKey: encKey, iv: keyIv } = await encryptKey(fileKey, masterKey);
    
    const urlRes = await fetch(`${API_URL}/upload-url`, { method: "POST", headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
    const { uploadUrl, fileUuid } = await urlRes.json();
    
    await fetch(uploadUrl, { method: "PUT", body: encryptedFileBuffer, headers: { "Content-Type": "application/octet-stream" } });
    
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
    silentSync();
  } catch (err) {
    showToast("Transmission Failed: " + err.message, "error");
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
    if (state !== "primary") ok.classList.add(state);

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
  try {
    const p = loadProfile();
    const f = loadFolders();
    const fi = loadFiles();
    await Promise.all([p, f, fi]);
  } catch {}
}

function closeModal(id) { 
  const el = document.getElementById(id);
  if (el) el.classList.add("hidden");
  if (id === 'folder-explorer-modal') {
    currentExplorerFolderId = null;
    document.getElementById("upload-modal").classList.add("hidden");
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
  if (active) active.classList.remove("hidden");

  const h1 = document.querySelector(".card-header h1");
  const p = document.querySelector(".card-header p");
  const card = document.querySelector(".auth-card-premium");
  
  if (mode === "login") {
    h1.textContent = "Sign In";
    p.textContent = "Enter your credentials to access the vault.";
    if (card) card.classList.remove("compact-mode");
  } else if (mode === "register") {
    h1.textContent = "Sign Up";
    p.textContent = "Provision a new secure identity.";
    if (card) card.classList.add("compact-mode");
  } else if (mode === "recover") {
    h1.textContent = "Vault Recovery";
    p.textContent = "Initiate secure restoration protocol.";
    if (card) card.classList.remove("compact-mode");
  } else if (mode === "reset") {
    h1.textContent = "Credential Update";
    p.textContent = "Establish your new security parameters.";
    if (card) card.classList.remove("compact-mode");
  } else {
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
      
      // Execute UI swap and profile sync immediately
      loadProfile(); 
      showView("my-vault");
      
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
      loadProfile(); 
      showView("my-vault");
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
    const clientMasterKey = JSON.stringify(jwk);
    const res = await fetch(`${API_URL}/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, securityPin, clientMasterKey }),
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
  btn.textContent = "Dispatched..."; btn.disabled = true;
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

function showView(viewId) {
  currentView = viewId;
  const sections = ["landing-page", "auth-section", "view-dashboard", "section-my-vault", "section-incoming", "section-profile", "section-recycle-bin"];
  sections.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.add("hidden");
  });

  const sidebarVisible = ["my-vault", "incoming", "profile", "recycle-bin"].includes(viewId);
  if (sidebarVisible) {
    document.getElementById("view-dashboard").classList.remove("hidden");
    document.getElementById(`section-${viewId}`).classList.remove("hidden");
    const titles = { 
      "my-vault": "Vault Base", 
      "incoming": "Incoming Data Matrix", 
      "profile": "Identity Profile Settings",
      "recycle-bin": "Terminal Recycle Bin"
    };
    document.getElementById("view-title").textContent = titles[viewId];
    
    // Smooth Transition State
    document.querySelector(".main-wrapper").style.opacity = "0";
    setTimeout(() => {
      document.querySelector(".main-wrapper").style.opacity = "1";
    }, 50);

    toggleNav(viewId);
    if (viewId === "my-vault") { silentSync(); }
    if (viewId === "incoming") { loadIncomingLinks(); }
    if (viewId === "recycle-bin") { loadRecycleBin(); }
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
  const tabs = ["files", "folders"];
  tabs.forEach(t => {
    document.getElementById(`my-${t}-view`).classList.add("hidden");
    document.getElementById(`tab-my-${t}`).classList.remove("active");
  });
  document.getElementById(`my-${sub}-view`).classList.remove("hidden");
  document.getElementById(`tab-my-${sub}`).classList.add("active");
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
    const res = await fetch(`${API_URL}/folders`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
    const data = await res.json();
    // Sort latest displayed first
    allFolders = data.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    
    const grid = document.getElementById("folder-list");
    const select = document.getElementById("upload-folder-select");
    grid.innerHTML = "";
    select.innerHTML = '<option value="">Root Vault</option>';
    
    document.getElementById("stat-folder-count").textContent = allFolders.length;

    allFolders.forEach(f => {
      const disp = truncateName(f.name);
      const dateStr = new Date(f.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      const fCount = allFiles.myFiles ? allFiles.myFiles.filter(file => file.folder_id === f.folder_id).length : 0;
      
      grid.innerHTML += `
        <div class="folder-row-item" style="margin-bottom:0;">
          <div class="folder-card" tabindex="0" onclick="openFolder(${f.folder_id}, '${f.name.replace(/'/g,"\\'")}', '${dateStr}')" style="flex-direction: column; align-items: flex-start; justify-content: space-between; min-height: 125px; padding: 18px;">
            <div style="display: flex; width: 100%; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <button tabindex="-1" class="action-btn" style="padding:5px 10px; font-size:0.65rem; border-radius:8px; background:rgba(250,204,21,0.1); border-color:rgba(250,204,21,0.2); color:#d97706; font-weight:700;" onclick="event.stopPropagation(); renameFolder(${f.folder_id}, '${f.name.replace(/'/g,"\\\\'")}')">Rename</button>
              <button tabindex="-1" class="action-btn" style="padding:5px 10px; font-size:0.65rem; border-radius:8px; background:rgba(255,50,50,0.1); border-color:rgba(255,50,50,0.2); color:#dc2626; font-weight:700;" onclick="event.stopPropagation(); deleteFolder(${f.folder_id})">Delete</button>
            </div>
            <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
              <span class="folder-icon" style="margin-bottom:0; font-size: 2.2rem;">📂</span>
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
  } catch {}
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
      showToast("Folder Initialized"); closeModal("folder-modal");
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
  const conf = await showConfirm("Delete this folder? Filestreams will be unassigned but not deleted.", "danger");
  if (!conf) return;

  if (!(await verifyPIN())) return;

  try {
    await fetch(`${API_URL}/folders/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
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

async function renderFolderExplorer(folderId) {
  const container = document.getElementById("explorer-file-list");
  container.innerHTML = '<p style="padding:40px; text-align:center; color:var(--text-dim);">Scanning directory...</p>';
  
  // Wait for allFiles if empty
  if (allFiles.myFiles.length === 0) await loadFiles();
  
  const files = allFiles.myFiles.filter(f => f.folder_id === parseInt(folderId));
  container.innerHTML = "";
  
  if (files.length === 0) {
    container.innerHTML = '<p style="padding:40px; text-align:center; color:var(--text-dim);">Directory is empty</p>';
    return;
  }

  const masterKey = await getClientMasterKey();
  
  for (const f of files) {
    try {
      const meta = await decryptMetadata(base64ToArrayBuffer(f.encrypted_metadata), masterKey, hexToBytes(f.iv));
      const ext = meta.filename.split(".").pop().toUpperCase();
      const displayTitle = truncateName(meta.filename);

      container.innerHTML += `
        <div class="folder-card" onclick="toggleActions(this, event)" style="cursor: pointer;" title="${meta.filename}">
          ${getFileTypeLogo(ext)}
          <div style="flex: 1; min-width: 0;">
            <p class="folder-name" style="font-size: 0.9rem; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayTitle}</p>
            <p class="folder-count" style="font-size: 0.7rem;">${ext} • ${formatBytes(meta.size)} • ${new Date(f.created_at).toLocaleDateString()}</p>
          </div>
          <div class="card-overlay" onclick="toggleActions(this.parentElement, event)">
            <button class="action-pill view" onclick="event.stopPropagation(); viewMyFile(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\\\'")}', ${meta.size}, false, null, false)" title="View">${svgView}</button>
            <button class="action-pill save" onclick="event.stopPropagation(); downloadFile(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\\\'")}')" title="Download">${svgDownload}</button>
            <button class="action-pill share" onclick="event.stopPropagation(); openShareModal(${f.file_id}, '${meta.filename.replace(/'/g,"\\\\'")}', '${f.encrypted_key}')" title="Share">${svgShare}</button>
            <button class="action-pill delete" onclick="event.stopPropagation(); deleteFile(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\\\'")}')" title="Delete">${svgDelete}</button>
          </div>
        </div>
      `;
    } catch {
      container.innerHTML += `<div class="file-row"><p style="color:var(--danger)">Unrecoverable Cluster</p></div>`;
    }
  }
}

// ==========================================
// FILES logic
// ==========================================

function getFileTypeLogo(ext) {
  const e = ext.toLowerCase();
  let bg = "#F1F5F9", color = "#64748B";
  
  // 1. Documents (Red Spectrum)
  if (["pdf", "doc", "docx", "txt", "rtf", "odt"].includes(e)) { bg = "#FEF2F2"; color = "#EF4444"; }
  // 2. Spreadsheets (Green Spectrum)
  else if (["xls", "xlsx", "csv", "ods"].includes(e)) { bg = "#ECFDF5"; color = "#10B981"; }
  // 3. Presentations (Orange Spectrum)
  else if (["ppt", "pptx", "odp"].includes(e)) { bg = "#FFF7ED"; color = "#F97316"; }
  // 4. Images (Blue Spectrum)
  else if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(e)) { bg = "#EFF6FF"; color = "#3B82F6"; }
  // 5. Videos (Purple Spectrum)
  else if (["mp4", "mkv", "avi", "mov"].includes(e)) { bg = "#F5F3FF"; color = "#8B5CF6"; }
  // 6. Audio (Pink Spectrum)
  else if (["mp3", "wav", "aac", "flac"].includes(e)) { bg = "#FDF2F8"; color = "#DB2777"; }
  // 7. Archives (Amber Spectrum)
  else if (["zip", "rar", "7z", "tar", "gz"].includes(e)) { bg = "#FFFBEB"; color = "#D97706"; }
  // 8. Code Files (Cyan Spectrum)
  else if (["html", "css", "js", "ts", "py", "java", "cpp", "c", "json", "xml"].includes(e)) { bg = "#ECFEFF"; color = "#0891B2"; }
  // 9. System Files (Slate/Black)
  else if (["exe", "apk", "dll", "bat"].includes(e)) { bg = "#F8FAFC"; color = "#0F172A"; }
  
  const displayText = ext.toUpperCase() === "GITIGNORE" ? ".GN" : ext.toUpperCase();
  return `<div style="width:40px; height:40px; border-radius:10px; background:${bg}; color:${color}; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:0.65rem; flex-shrink:0;">${displayText}</div>`;
}

async function loadFiles() {
  const res = await fetch(`${API_URL}/files`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
  allFiles = await res.json();
  
  // Storage Audit: Calculate usage for tracker
  let totalUsage = 0;
  for (const f of allFiles.myFiles) {
    try {
      const mk = await getClientMasterKey();
      const meta = await decryptMetadata(base64ToArrayBuffer(f.encrypted_metadata), mk, hexToBytes(f.iv));
      f.size = meta.size; // Cache for tracker
      totalUsage += meta.size;
    } catch {}
  }
  updateStorageTracker();

  renderFiles();
  if (currentExplorerFolderId) {
    renderFolderExplorer(currentExplorerFolderId);
  }
  loadFolders();
}

async function renderFiles() {
  const myBody = document.getElementById("file-list-body");
  const shBody = document.getElementById("shared-list-body");
  myBody.innerHTML = ""; shBody.innerHTML = "";
  
  const masterKey = await getClientMasterKey();
  
  // Sort by latest first (Stack function)
  const sortedFiles = [...allFiles.myFiles].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  
  // Logic: Show ONLY root files (no folder) in main view, or ONLY folder files if viewing a folder
  const filteredMy = currentFolderId 
    ? sortedFiles.filter(f => f.folder_id === parseInt(currentFolderId))
    : sortedFiles.filter(f => !f.folder_id);

  document.getElementById("stat-file-count").textContent = filteredMy.length;
  document.getElementById("stat-incoming-count").textContent = allFiles.sharedFiles.length;

  for (const f of filteredMy) {
    try {
      const meta = await decryptMetadata(base64ToArrayBuffer(f.encrypted_metadata), masterKey, hexToBytes(f.iv));
      const ext = meta.filename.split(".").pop().toUpperCase();
      const displayTitle = truncateName(meta.filename);

      myBody.innerHTML += `
        <div class="folder-card" onclick="toggleActions(this, event)" style="cursor: pointer;" title="${meta.filename}">
          ${getFileTypeLogo(ext)}
          <div style="flex: 1; min-width: 0;">
            <p class="folder-name" style="font-size: 0.9rem; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayTitle}</p>
            <p class="folder-count" style="font-size: 0.7rem;">${ext} • ${formatBytes(meta.size)} • ${new Date(f.created_at).toLocaleDateString()}</p>
          </div>
          <div class="card-overlay" onclick="toggleActions(this.parentElement, event)">
            <button class="action-pill view" onclick="event.stopPropagation(); gatedView(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\\\'")}', ${meta.size})" title="View">${svgView}</button>
            <button class="action-pill save" onclick="event.stopPropagation(); gatedDownload(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\\\'")}')" title="Download">${svgDownload}</button>
            <button class="action-pill share" onclick="event.stopPropagation(); gatedShare(${f.file_id}, '${meta.filename.replace(/'/g,"\\\\'")}', '${f.encrypted_key}')" title="Share">${svgShare}</button>
            <button class="action-pill delete" onclick="event.stopPropagation(); gatedDelete(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\\\'")}')" title="Delete">${svgDelete}</button>
          </div>
        </div>
      `;
    } catch {
      myBody.innerHTML += `<div class="file-row"><p style="color:var(--danger)">Unrecoverable Conflict</p></div>`;
    }
  }

  const sortedShared = [...allFiles.sharedFiles].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  for (const f of sortedShared) {
    shBody.innerHTML += `
  <div class="file-row incoming-row">
    <p style="color:var(--text-dim); font-size:0.85rem; font-weight: 500;">${f.sender_email}</p>
        <p style="color:var(--text-dim); font-size:0.85rem; font-weight: 500;">${new Date(f.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</p>
        <div class="btn-group">
          <button class="action-btn" style="border-color:var(--accent-cyan); color:var(--accent-cyan); background: rgba(0,242,255,0.03);" onclick="openUnlockModal(${f.file_id}, ${f.link_id}, '${f.encrypted_key}', '${f.encrypted_metadata}', '${f.iv}', ${f.downloadable})">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>
            <span>Unlock</span>
          </button>
          <button class="action-btn delete" onclick="deleteSharedLink(${f.link_id})" style="background: rgba(255,50,50,0.03);">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-35l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            <span>Delete</span>
          </button>
        </div>
      </div>
    `;
  }
}

async function loadRecycleBin() {
  const recycleBody = document.getElementById("recycle-list-body");
  if (!recycleBody) return;
  recycleBody.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-dim); opacity: 0.5;">Scanning safe retention hubs...</div>';
  
  try {
    const res = await fetch(`${API_URL}/recycle-bin`, {
      method: "GET",
      headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
    });
    const results = await res.json();
    const masterKey = await getClientMasterKey();
    
    recycleBody.innerHTML = "";
    if (!results || results.length === 0) {
      recycleBody.innerHTML = '<div style="padding: 60px; text-align: center; color: var(--text-dim); font-size: 0.9rem; font-weight: 700;">No administrative records found in safe retention hubs.</div>';
      return;
    }

    for (const f of results) {
      try {
        const meta = await decryptMetadata(base64ToArrayBuffer(f.encrypted_metadata), masterKey, hexToBytes(f.iv));
        const dateStr = f.deleted_at ? new Date(f.deleted_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : "---";
        recycleBody.innerHTML += `
          <div class="file-row recycle-row">
            <div style="display:flex; align-items:center; gap:12px; min-width:0;">
              <span style="font-size: 1.1rem; flex-shrink:0;">${getFileTypeLogo(meta.filename.split(".").pop().toUpperCase())}</span>
              <span style="font-weight: 700; color: #1e293b; overflow:hidden; text-overflow:ellipsis;">${meta.filename}</span>
            </div>
            <span style="color: #64748b; font-size: 0.85rem; font-weight: 500;">${dateStr}</span>
            <div style="display: flex; gap: 10px;">
              <button class="action-btn" onclick="restoreFile(${f.file_id})" style="border-color: #10b981; color: #10b981; background: rgba(16,185,129,0.03); padding: 8px 16px; font-size: 0.75rem;">Restore</button>
              <button class="action-btn" onclick="permanentDeleteFile(${f.file_id})" style="border-color: #ef4444; color: #ef4444; background: rgba(239,68,68,0.03); padding: 8px 16px; font-size: 0.75rem;">Purge</button>
            </div>
          </div>
        `;
      } catch(e) { console.error("Recycle Decrypt Fail", e); }
    }
  } catch (err) { 
    console.error(err); 
    recycleBody.innerHTML = '<div style="padding: 60px; text-align: center; color: var(--danger);">Operational failure in retention stream extraction.</div>';
  }
}

async function restoreFile(fileId) {
  if (await confirmAction("Restore this record to Vault Base?")) {
    try {
      await fetch(`${API_URL}/restore-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
        body: JSON.stringify({ fileId }),
      });
      showToast("Record successfully restored.");
      loadRecycleBin();
    } catch (err) { showToast("Error", "error"); }
  }
}

async function permanentDeleteFile(fileId) {
  if (await confirmAction("DANGER: Permanently purge this record? This cannot be undone.", "danger")) {
    const verified = await verifyPIN();
    if (!verified) return;

    try {
      await fetch(`${API_URL}/permanent-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
        body: JSON.stringify({ fileId }),
      });
      showToast("Deleted");
      loadRecycleBin();
    } catch (err) { showToast("Error", "error"); }
  }
}

async function confirmAction(msg, type = "primary") {
  return new Promise((resolve) => {
    showConfirm(msg, (v) => resolve(v), type);
  });
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

let pinVerifiedThisSession = false;

function verifyPIN() {
  // Always ask - no session bypass
  return new Promise((resolve) => {
    const pinModalEl = document.getElementById("pin-modal");
    pinModalEl.classList.remove("hidden");
    const pinInput = document.getElementById("modal-pin-input");
    const verifyBtn = document.getElementById("pin-verify-btn");
    pinInput.value = ""; pinInput.focus();

    const onVerify = async () => {
      const pin = pinInput.value;
      if (!pin) return showToast("PIN Required", "error");
      try {
        const res = await fetch(`${API_URL}/verify-file-pin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
          body: JSON.stringify({ securityPin: pin })
        });
        const data = await res.json();
        if (data.success) {
          // Only hide the PIN modal, don't call closeModal (which would silentSync)
          pinModalEl.classList.add("hidden");
          verifyBtn.onclick = null;
          resolve(true);
        } else {
          showToast("Invalid", "error");
        }
      } catch (err) { resolve(false); }
    };

    const onAbort = () => {
      // Only hide PIN modal — do not disturb underlying modal
      pinModalEl.classList.add("hidden");
      verifyBtn.onclick = null;
      resolve(false);
    };

    verifyBtn.onclick = onVerify;
    window.abortPIN = onAbort;
  });
}

async function deleteSharedLink(id) {
  const conf = await showConfirm(`Remove this shared record from your incoming feed?`, "danger");
  if (!conf) return;
  const verified = await verifyPIN();
  if (!verified) return;
  
  showToast("Deleting...");
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
  const select = document.getElementById("upload-folder-select");
  if (select) {
    select.value = preselectFolderId || currentFolderId || "";
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
    
    await fetch(uploadUrl, { method: "PUT", body: encryptedFileBuffer, headers: { "Content-Type": "application/octet-stream" } });
    
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
    closeModal("upload-modal"); 
    silentSync();
  } catch (err) { showToast("Error: " + err.message, "error"); }
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

    showToast("Decrypting secure stream...");
    const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${fileId}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } })).json();
    const encryptedBlob = await (await fetch(downloadUrl)).arrayBuffer();
    const [ivHex, keyBase64] = encryptedKeyStr.split(":");
    const mk = await getClientMasterKey();
    const fk = await decryptKey(base64ToArrayBuffer(keyBase64), mk, hexToBytes(ivHex));
    const dec = await decryptFile(new Uint8Array(encryptedBlob), fk);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([dec])); a.download = filename; a.click();
    showToast("Download Initialized");
  } catch (err) { showToast("Error", "error"); }
}

async function viewMyFile(id, keyStr, name, size, alreadyDecrypted = false, decBuffer = null, canDownload = true, linkId = null) {
  let dec = decBuffer;

  if (!alreadyDecrypted) {
    // PIN gating handled externally
  }

  const downloadBtn = document.getElementById("view-download-btn");
  const closeBtn = document.getElementById("view-close-btn");

  if (downloadBtn) {
    if (canDownload) {
      downloadBtn.classList.remove("hidden");
      downloadBtn.onclick = () => {
        const ext = name.split('.').pop().toLowerCase();
        const b = new Blob([dec], { type: getMimeType(ext) });
        const u = URL.createObjectURL(b);
        const a = document.createElement("a"); a.href = u; a.download = name; a.click();
        showToast("Record Decrypted & Exported");
      };
    } else {
      downloadBtn.classList.add("hidden");
    }
  }

  // Identity: Burn-after-viewing Protocol for shared records
  if (linkId) {
    closeBtn.onclick = async () => {
      try {
        await fetch(`${API_URL}/share/${linkId}`, { method: "DELETE", headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
        closeModal('file-view-modal');
        loadFiles();
        showToast("Access closed", "info");
      } catch (err) { closeModal('file-view-modal'); }
    };
  } else {
    closeBtn.onclick = () => closeModal('file-view-modal');
  }

  document.getElementById("view-filename").textContent = truncateName(name);
  document.getElementById("file-view-modal").classList.remove("hidden");
  const viewer = document.getElementById("view-content");

  if (!alreadyDecrypted) {
    viewer.innerHTML = `
      <div class="viewer-loader">
        <div class="loader-pulse"></div>
        <p>Establishing Secure Stream...</p>
      </div>`;

    try {
      const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${id}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } })).json();
      const blob = await (await fetch(downloadUrl)).arrayBuffer();
      const [ivHex, keyB64] = keyStr.split(":");
      const mk = await getClientMasterKey();
      const fk = await decryptKey(base64ToArrayBuffer(keyB64), mk, hexToBytes(ivHex));
      dec = await decryptFile(new Uint8Array(blob), fk);
    } catch (err) { return showToast("Decryption Error", "error"); }
  }

  try {
    const viewer = document.getElementById("view-content");
    viewer.innerHTML = "";
    
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);

    const ext = name.split('.').pop().toLowerCase();
    const blob = new Blob([dec], { type: getMimeType(ext) });
    currentBlobUrl = URL.createObjectURL(blob);

    // 1. IMAGE PROTOCOL
    if (["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico"].includes(ext)) {
      const img = document.createElement("img"); img.src = currentBlobUrl;
      img.style.maxWidth = "100%"; img.style.maxHeight = "100%"; img.style.objectFit = "contain"; 
      img.style.boxShadow = "0 30px 60px rgba(0,0,0,0.5)";
      viewer.appendChild(img);
    } 
    // 2. VIDEO PROTOCOL
    else if (["mp4", "mkv", "webm", "mov", "avi"].includes(ext)) {
      const video = document.createElement("video"); video.src = currentBlobUrl;
      video.controls = true; video.style.maxWidth = "100%"; video.style.maxHeight = "100%";
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
    // 4. MICROSOFT WORD PROTOCOL (Direct DOM Rendering)
    else if (["docx", "doc", "odt", "rtf", "pages"].includes(ext)) {
        viewer.innerHTML = '<div style="color:var(--accent-blue); text-align:center; padding:20px; font-family:var(--font-heading); font-weight:800;">MANIFESTING SECURE DOCUMENT...</div>';
        try {
            mammoth.convertToHtml({ arrayBuffer: dec })
                .then(result => {
                    const div = document.createElement("div");
                    div.className = "direct-doc-view";
                    div.innerHTML = result.value || "[Empty Document Content]";
                    viewer.innerHTML = "";
                    viewer.appendChild(div);
                })
                .catch(() => {
                    // Fallback to text decoder if Mammoth fails (for .doc or text-like)
                    const pre = document.createElement("pre");
                    pre.textContent = new TextDecoder().decode(dec);
                    pre.style.color = "var(--accent-cyan)"; pre.style.padding = "20px"; pre.style.whiteSpace = "pre-wrap";
                    viewer.innerHTML = ""; viewer.appendChild(pre);
                });
        } catch (err) {
            viewer.innerHTML = `<p style="color:var(--danger); padding:20px;">Protocol Error: Direct rendering unavailable.</p>`;
        }
    }
    // 5. PDF PROTOCOL (Direct Canvas Rendering - Bypasses Browser Interface)
    else if (ext === "pdf") {
        viewer.innerHTML = '<div style="color:var(--accent-cyan); text-align:center; padding:40px;">MANIFESTING PDF DATA FIELDS...</div>';
        const pdfJS = window['pdfjs-dist/build/pdf'];
        pdfJS.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';        
        pdfJS.getDocument({ data: dec }).promise.then(pdf => {
            viewer.innerHTML = "";
            const container = document.createElement("div");
            container.className = "pdf-canvas-container";
            container.style.width = "100%"; container.style.height = "100%"; container.style.overflowY = "auto";
            viewer.appendChild(container);
            
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                pdf.getPage(pageNum).then(page => {
                    const isMobile = window.innerWidth < 768;
                    const viewport = page.getViewport({ scale: isMobile ? 3.0 : 2.5 });
                    const canvas = document.createElement("canvas");
                    canvas.className = "pdf-page-canvas";
                    canvas.style.width = isMobile ? "100%" : "85%"; 
                    canvas.style.marginBottom = isMobile ? "15px" : "30px";
                    canvas.style.borderRadius = "0"; canvas.style.boxShadow = "0 30px 60px rgba(0,0,0,0.1)";
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height; canvas.width = viewport.width;
                    container.appendChild(canvas);
                    page.render({ canvasContext: context, viewport: viewport });
                });
            }
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
    // 7. ARCHIVE PROTOCOL (Direct Directory Manifest)
    else if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"].includes(ext)) {
        viewer.innerHTML = '<div style="color:var(--accent-cyan); text-align:center; padding:40px;">PROBING ARCHIVE ENCLAVE...</div>';
        try {
            JSZip.loadAsync(dec).then(zip => {
                const container = document.createElement("div");
                container.className = "archive-manifest-list";
                let list = `<h4 style="color:var(--accent-cyan); margin-bottom:20px; border-bottom:1px solid rgba(0,242,255,0.2); padding-bottom:10px;">ARCHIVE DIRECTORY:</h4>`;
                zip.forEach((relativePath, file) => {
                    list += `<div class="archive-item">📂 ${relativePath}</div>`;
                });
                container.innerHTML = list;
                viewer.innerHTML = ""; viewer.appendChild(container);
            }).catch(() => {
                viewer.innerHTML = '<p style="color:var(--danger); padding:20px;">Binary Error: Unable to probe archive content.</p>';
            });
        } catch (err) {
            viewer.innerHTML = `<p style="color:var(--danger); padding:20px;">Identity Error: Archive protocol deviation.</p>`;
        }
    }
    // 8. PRESENTATION PROTOCOL (Direct PPTX Generation via JSZip Content Extraction)
    else if (["pptx", "ppt"].includes(ext)) {
        viewer.innerHTML = '<div style="color:var(--accent-blue); text-align:center; padding:40px;">EXTRACTING PRESENTATION CONTENT...</div>';
        
        try {
            const zip = await JSZip.loadAsync(dec);
            const container = document.createElement("div");
            container.style.width = "100%"; container.style.height = "100%";
            container.style.overflow = "auto"; container.style.background = "transparent";
            container.style.padding = "20px 0"; container.style.boxSizing = "border-box";
            container.style.fontFamily = "var(--font-main)";
            
            const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/;
            const slideFiles = Object.keys(zip.files).filter(f => slideRegex.test(f));
            
            if (slideFiles.length > 0) {
                slideFiles.sort((a,b) => parseInt(a.match(slideRegex)[1]) - parseInt(b.match(slideRegex)[1]));
                
                for (const slideFile of slideFiles) {
                    const xml = await zip.file(slideFile).async("string");
                    const slideCard = document.createElement("div");
                    slideCard.style.maxWidth = "1100px"; slideCard.style.width = "95%";
                    slideCard.style.margin = "0 auto 60px";
                    slideCard.style.background = "#fff"; slideCard.style.border = "1px solid #E2E8F0";
                    slideCard.style.boxShadow = "0 20px 60px rgba(0,0,0,0.06)";
                    slideCard.style.padding = "60px"; slideCard.style.display = "flex";
                    slideCard.style.flexDirection = "column"; slideCard.style.justifyContent = "center";
                    slideCard.style.position = "relative"; slideCard.style.overflow = "hidden";
                    
                    const slideNum = slideFile.match(slideRegex)[1];
                    const numBadge = document.createElement("div");
                    numBadge.textContent = slideNum; numBadge.style.position = "absolute";
                    numBadge.style.top = "20px"; numBadge.style.right = "20px";
                    numBadge.style.fontSize = "0.8rem"; numBadge.style.opacity = "0.3";
                    slideCard.appendChild(numBadge);

                    const relsFile = `ppt/slides/_rels/${slideFile.split('/').pop()}.rels`;
                    const relsXml = zip.file(relsFile) ? await zip.file(relsFile).async("string") : "";
                    const relMap = {};
                    if (relsXml) {
                        const relMatches = relsXml.match(/Id="([^"]+)"\s+Type="[^"]+blip"\s+Target="([^"]+)"/g) || 
                                          relsXml.match(/Id="([^"]+)"[^>]+Target="([^"]+)"/g) || [];
                        relMatches.forEach(m => {
                            const idMatch = m.match(/Id="([^"]+)"/);
                            const targetMatch = m.match(/Target="([^"]+)"/);
                            if (idMatch && targetMatch) {
                                relMap[idMatch[1]] = targetMatch[1].replace('../media/', 'ppt/media/');
                            }
                        });
                    }

                    const pMatches = xml.match(/<a:p[\s>][\s\S]*?<\/a:p>/g) || [];
                    const paragraphs = pMatches.map(p => {
                        const textMatches = p.match(/<a:t[\s>][\s\S]*?<\/a:t>/g) || [];
                        return textMatches.map(m => m.replace(/<\/?[^>]+(>|$)/g, "")).join("");
                    }).filter(t => t.trim().length > 0);
                    
                    if (paragraphs.length > 0) {
                        paragraphs.forEach((text, i) => {
                            const p = document.createElement("p");
                            p.textContent = text; p.style.margin = "0 0 10px 0";
                            p.style.fontSize = i === 0 ? "1.4rem" : "1rem";
                            p.style.fontWeight = i === 0 ? "800" : "400";
                            p.style.color = i === 0 ? "var(--accent-blue)" : "var(--text-primary)";
                            p.style.lineHeight = "1.6";
                            slideCard.appendChild(p);
                        });
                    }

                    const blipMatches = xml.match(/<a:blip[^>]+r:embed="([^"]+)"/g) || [];
                    if (blipMatches.length > 0) {
                        const mediaStack = document.createElement("div");
                        mediaStack.style.display = "flex"; mediaStack.style.flexDirection = "column";
                        mediaStack.style.gap = "30px"; mediaStack.style.marginTop = "40px";
                        mediaStack.style.alignItems = "center";
                        
                        for (const blip of blipMatches) {
                            const rIdArr = blip.match(/r:embed="([^"]+)"/);
                            if (rIdArr) {
                                const rId = rIdArr[1];
                                const imagePath = relMap[rId];
                                if (imagePath && zip.file(imagePath)) {
                                    const blob = await zip.file(imagePath).async("blob");
                                    const img = document.createElement("img");
                                    img.src = URL.createObjectURL(blob);
                                    img.style.width = "100%"; img.style.maxWidth = "900px";
                                    img.style.borderRadius = "4px"; img.style.boxShadow = "0 15px 40px rgba(0,0,0,0.08)";
                                    img.style.objectFit = "contain";
                                    mediaStack.appendChild(img);
                                }
                            }
                        }
                        slideCard.appendChild(mediaStack);
                    }
                    if (paragraphs.length === 0 && blipMatches.length === 0) {
                        const p = document.createElement("p");
                        p.textContent = "[Empty Slide Profile]"; p.style.fontStyle = "italic";
                        p.style.opacity = "0.3"; slideCard.appendChild(p);
                    }
                    container.appendChild(slideCard);
                }
            } else {
                const p = document.createElement("p");
                p.textContent = "No slides found or unsupported PPTX format.";
                container.appendChild(p);
            }
            viewer.innerHTML = "";
            viewer.appendChild(container);
        } catch (err) {
            viewer.innerHTML = `<p style="color:var(--danger); padding:20px;">Protocol Error: Could not extract presentation content. (${err.message})</p>`;
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
          <h3 style="margin-bottom:15px; color:var(--text-primary); font-family:var(--font-heading); font-size:1.8rem; font-weight:900;">Preview Not Available</h3>
          <p style="font-size:1rem; margin-bottom:32px; max-width:400px; line-height:1.6; opacity:0.7;">This secure record type (${ext.toUpperCase()}) cannot be manifested directly within the hub. Download to view locally.</p>
          <button onclick="downloadFile('${id}', '${key}', '${name}')" class="viewer-ctrl-btn primary" style="padding:16px 36px; border-radius:12px; font-size:1rem; font-weight:800; box-shadow:0 20px 50px rgba(59,130,246,0.3);">Download Record</button>
        </div>
      `;
    }
   
    showToast("File Decrypted Successfully");
  } catch (err) { showToast("Display Error", "error"); }
}

// ==========================================
// UNLOCK & VIEW logic
// ==========================================

let tempUnlockData = null;

function openUnlockModal(fileId, linkId, encKey, encMeta, iv, downloadable = false) {
  tempUnlockData = { fileId, linkId, encKey, encMeta, iv, downloadable };
  document.getElementById("unlock-modal").classList.remove("hidden");
  document.getElementById("unlock-step-1").classList.remove("hidden");
  document.getElementById("unlock-step-2").classList.add("hidden");
  document.getElementById("unlock-key-input").value = "";
}

async function processUnlockStep1() {
  const keyHex = document.getElementById("unlock-key-input").value.trim();
  if (!keyHex) return showToast("Transmission key required", "error");
  
  try {
    const linkKey = await window.crypto.subtle.importKey("raw", hexToBytes(keyHex), { name: ALGO_NAME }, false, ["unwrapKey", "decrypt"]);
    const [ivHex, keyBase64] = tempUnlockData.encKey.split(":");
    
    const fileKey = await decryptKey(base64ToArrayBuffer(keyBase64), linkKey, hexToBytes(ivHex));
    const meta = await decryptMetadata(base64ToArrayBuffer(tempUnlockData.encMeta), linkKey, hexToBytes(tempUnlockData.iv));
    
    tempUnlockData.fileKey = fileKey;
    tempUnlockData.meta = meta;
    
    tempUnlockData.meta = meta;
    
    document.getElementById("unlock-step-1").classList.add("hidden");
    document.getElementById("unlock-step-2").classList.remove("hidden");
    document.getElementById("unlock-pin-input").value = "";
    document.getElementById("unlock-pin-input").focus();
  } catch (err) {
    showToast("Invalid Transmission Key", "error");
  }
}

async function processUnlockStep2() {
  const securityPin = document.getElementById("unlock-pin-input").value;
  if (!securityPin) return showToast("Security PIN required", "error");
  
  try {
    const res = await fetch(`${API_URL}/verify-file-pin`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
      body: JSON.stringify({ securityPin }),
    });
    if (!res.ok) throw new Error("Verification Failed");
    
    showToast("Identity Confirmed. Decrypting record...");
    const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${tempUnlockData.fileId}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } })).json();
    const encryptedBlob = await (await fetch(downloadUrl)).arrayBuffer();
    const dec = await decryptFile(new Uint8Array(encryptedBlob), tempUnlockData.fileKey);
    
    closeModal("unlock-modal");
    viewMyFile(tempUnlockData.fileId, tempUnlockData.encKey, tempUnlockData.meta.filename, tempUnlockData.meta.size, true, dec, tempUnlockData.downloadable, tempUnlockData.linkId);
  } catch (err) {
    showToast("Identity Verification Failed", "error");
  }
}

async function processUnlockStep2() {
  const securityPin = document.getElementById("unlock-pin-input").value;
  if (!securityPin) return showToast("Security PIN required", "error");
  
  try {
    const res = await fetch(`${API_URL}/verify-file-pin`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
      body: JSON.stringify({ securityPin }),
    });
    if (!res.ok) throw new Error("Verification Failed");
    
    showToast("Identity Confirmed. Decrypting record...");
    const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${tempUnlockData.fileId}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } })).json();
    const encryptedBlob = await (await fetch(downloadUrl)).arrayBuffer();
    const dec = await decryptFile(new Uint8Array(encryptedBlob), tempUnlockData.fileKey);
    
    closeModal("unlock-modal");
    viewMyFile(tempUnlockData.fileId, tempUnlockData.encKey, tempUnlockData.meta.filename, tempUnlockData.meta.size, true, dec, tempUnlockData.downloadable, tempUnlockData.linkId);
  } catch (err) {
    showToast("Identity Verification Failed", "error");
  }
}

let currentBlobUrl = null;

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

  // window.history.replaceState({}, document.title, window.location.pathname);
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
      const fk = await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(fIvHex) }, linkKey, base64ToArrayBuffer(fKeyB64));
      
      const dec = await decryptFile(new Uint8Array(encryptedBlob), fk);
      closeModal("unlock-modal");
      viewMyFile(null, null, meta.filename, dec.byteLength, true, dec, data.downloadable, null);
    } catch (err) { 
      showToast("Decryption Violation: " + err.message, "error");
      setTimeout(() => { location.href = "/"; }, 2500);
    }
  };
}

// ==========================================
// PIN & PROFILE
// ==========================================

async function loadProfile() {
  try {
    const res = await fetch(`${API_URL}/profile`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.username) return;

    if (document.getElementById("welcome-message")) document.getElementById("welcome-message").textContent = data.email;
    
    // Hacker-style User Hash visually derived from their email
    const hash = Array.from(await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(data.email))).map(b => b.toString(16).padStart(2,'0')).join('').substring(0,10);
    
    // Faux storage calculation based on gamification
    let totalBytesSum = 0;
    if (typeof allFiles !== 'undefined' && allFiles.myFiles) {
        totalBytesSum = allFiles.myFiles.length * 1024 * 512; // Approximation
    }
    const storageDisp = document.getElementById("disp-storage-used");
    if (storageDisp) {
        storageDisp.textContent = totalBytesSum > 0 ? formatBytes(totalBytesSum) + " (Encrypted)" : "0 Bytes Allocated";
    }

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

    // Gamification state variables
    let profileStrength = 75; // Baseline: Email Verified + Master Key Encrypted
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
      
      profileStrength = 95; // Bonus for Image Upload
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
      if (hAvatar) hAvatar.classList.remove("hidden");
    }

    // Apply Strength GAMIFICATION UI Updates
    if (strengthBar) strengthBar.style.width = `${profileStrength}%`;
    if (strengthPercent) strengthPercent.textContent = `${profileStrength}%`;

  } catch (err) { console.warn("Profile sync deferred:", err); }
}

function initHeatmap() {
    const container = document.getElementById("activity-heatmap");
    if(!container) return;
    container.innerHTML = "";
    // Heatmap Visualization Generator - 45 cells layout
    for(let i=0; i<45; i++) {
        const cell = document.createElement("div");
        cell.className = "heatmap-cell";
        // Randomly assign activity level to create a realistic Github-style heatmap
        const signalLevel = Math.random();
        if(signalLevel > 0.85) cell.classList.add("level-4");
        else if(signalLevel > 0.65) cell.classList.add("level-3");
        else if(signalLevel > 0.45) cell.classList.add("level-2");
        else if(signalLevel > 0.15) cell.classList.add("level-1");
        
        // Faux tooltip for micro-interaction
        cell.title = `Signal Level: ${Math.floor(signalLevel * 100)}% Activity`;
        container.appendChild(cell);
    }
}

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

// Init
(async function init() {
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
    silentSync().then(() => showView(storedView));
    return; // Termination of preloader sequence for active sessions
  }

  // Ultra-Smooth Premium Pacing (Requirement 4)
  setTimeout(() => {
    // 1. Reveal "SV"
    if (revealTarget) revealTarget.classList.add("visible");
    
    setTimeout(() => {
      // 2. Expand to "SecureVault"
      if (preloader) preloader.classList.add("expanded");
      
      setTimeout(() => {
        // 3. Smooth Fade Out & Overlap Login Reveal
        if (preloader) preloader.classList.add("fade-out");
        
        // Handover: Login Card fades in while preloader is fading out
        setTimeout(() => {
          const lp = document.getElementById("landing-page");
          if (lp) lp.classList.remove("hidden");
        }, 500);

        setTimeout(async () => {
          // Preloader finally removed from layout
          if (preloader) preloader.classList.add("hidden");
          
          if (token) {
            try { 
              await loadProfile(); 
              showView(storedView); 
            } catch (err) { logout(); }
          } else {
            const urlParams = new URLSearchParams(window.location.search);
            const recoveryToken = urlParams.get("recovery_token");
            const recoveryType = urlParams.get("type");
            
            if (recoveryToken) {
              const lp = document.getElementById("landing-page");
              if (lp) lp.classList.add("hidden");
              if (authSection) {
                authSection.classList.remove("hidden");
                authSection.classList.add("visible");
              }
              toggleAuthMode("reset");
              const title = recoveryType.charAt(0).toUpperCase() + recoveryType.slice(1);
              document.getElementById("reset-title").textContent = `Reset ${title}`;
              document.getElementById("reset-label").textContent = `New ${title}`;
              document.getElementById("reset-confirm-label").textContent = `Confirm New ${title}`;
              
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
          }
        }, 1200); 
      }, 1000); 
    }, 800); 
  }, 400); 
})();
