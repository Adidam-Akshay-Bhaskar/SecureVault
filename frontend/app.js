const API_URL = window.location.origin + "/api";
const ALGO_NAME = "AES-GCM";

let sessionMasterKey = null;
let tempLoginCredentials = null;
let currentView = "my-vault";
let allFiles = [];
let allFolders = [];
let currentFolderId = null;
let currentExplorerFolderId = null;

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
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === "error" ? "⚠️" : "✨"}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function truncateName(name, limit = 42) {
  if (!name) return "";
  return name.length > limit ? name.substring(0, limit) + "..." : name;
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
      
      // Browser Heuristic: Wait for toast and identity capture before view swap
      showToast("Access Granted - Synchronizing Credentials");
      
      setTimeout(async () => {
        await loadProfile();
        showView("my-vault");
        // Reset only after transition to let manager capture data
        setTimeout(() => e.target.reset(), 200);
      }, 500);
    } else {
      showToast(data.message || "Failed to authenticate", "error");
    }
  } catch (err) { showToast("Connection Failed", "error"); }
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
      showToast("Identity Verified"); await loadProfile(); showView("my-vault");
    } else showToast(data.message || "Verification failed", "error");
  } catch (err) { showToast("Security link broken", "error"); }
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
      showToast("Account Initialized");
      e.target.reset();
      toggleAuthMode("login");
    } else showToast(data.message, "error");
  } catch { showToast("Registration failure", "error"); }
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
  } catch (err) { showToast("Transmission failure", "error"); }
  finally { btn.disabled = false; btn.textContent = orig; }
});

document.getElementById("reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("recovery_token");
  const newValue = document.getElementById("reset-new-value").value;
  const confirmValue = document.getElementById("reset-confirm-value").value;

  if (newValue !== confirmValue) {
    return showToast("Protocol Discrepancy: Values do not match", "error");
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

  // Faster transition as requested
  setTimeout(() => {
    location.reload();
  }, 600);
}

function cancelVerify() { tempLoginCredentials = null; switchAuthTab("login"); }

// ==========================================
// NAVIGATION
// ==========================================

function showView(view) {
  currentView = view;
  sessionStorage.setItem("activeView", view);
  const sections = ["my-vault", "incoming", "profile"];
  sections.forEach(v => document.getElementById(`section-${v}`).classList.add("hidden"));
  document.getElementById(`section-${view}`).classList.remove("hidden");
  
  document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
  const activeItem = document.querySelector(`.nav-item[onclick="showView('${view}')"]`);
  if (activeItem) activeItem.classList.add("active");

  const title = document.getElementById("view-title");
  if (view === "my-vault") title.textContent = "My Data Vault";
  if (view === "incoming") title.textContent = "Incoming Data";
  if (view === "profile") title.textContent = "Profile Settings";

  document.getElementById("auth-section").classList.add("hidden");
  document.getElementById("view-dashboard").classList.remove("hidden");

  if (view === "my-vault") { 
    loadFolders(); 
    loadFiles();
    toggleVaultSubView('files');
  }
  if (view === "incoming") loadFiles();
}

function toggleVaultSubView(sub) {
  const tabs = ["files", "folders"];
  tabs.forEach(t => {
    document.getElementById(`my-${t}-view`).classList.add("hidden");
    document.getElementById(`tab-my-${t}`).classList.remove("active");
  });
  document.getElementById(`my-${sub}-view`).classList.remove("hidden");
  document.getElementById(`tab-my-${sub}`).classList.add("active");

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
          <div class="folder-card" tabindex="0" onclick="openFolder(${f.folder_id}, '${f.name.replace(/'/g,"\\'")}', '${dateStr}')">
            <span class="folder-icon">📂</span>
            <p class="folder-name">${disp}</p>
            <p class="folder-count">${fCount} Files • ${dateStr}</p>
            <button tabindex="-1" class="action-btn" style="position:absolute; top:12px; right:12px; padding:6px 10px; font-size:10px; border-radius:8px; background:rgba(255,50,50,0.1); border-color:rgba(255,50,50,0.2); color:#ff5555;" onclick="event.stopPropagation(); deleteFolder(${f.folder_id})">Delete</button>
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

async function deleteFolder(id) {
  const conf = await showConfirm("Delete this folder? Filestreams will be unassigned but not deleted.");
  if (!conf) return;
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
  uploadBtn.onclick = () => showUploadModal(id);
  
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
        <div class="file-row explorer-row">
          <p class="file-name" title="${meta.filename}">${displayTitle}</p>
          <p style="color:var(--text-muted); font-size:0.8rem; font-weight:600;">${ext}</p>
          <p style="color:var(--text-muted); font-size:0.8rem;">${formatBytes(meta.size)}</p>
          <div class="btn-group">
            <button class="action-btn view" onclick="viewMyFile(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\'")}', ${meta.size}, false, null, false)">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
              <span>View</span>
            </button>
            <button class="action-btn save" onclick="downloadFile(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\'")}')" style="background:rgba(50,255,100,0.05); color:#44ff77; border-color:rgba(50,255,100,0.1);">
              <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px; height:14px;"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
              Save
            </button>
            <button class="action-btn share" onclick="openShareModal(${f.file_id}, '${meta.filename.replace(/'/g,"\\'")}', '${f.encrypted_key}')" style="background:rgba(250,204,21,0.05); color:#facc15; border-color:rgba(250,204,21,0.1);">
              <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px; height:14px;"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              Share
            </button>
            <button class="action-btn delete" onclick="deleteFile(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\'")}')" style="background:rgba(255,50,50,0.05); color:var(--danger); border-color:rgba(255,50,50,0.1);">
              <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px; height:14px;"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              Delete
            </button>
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

async function loadFiles() {
  const res = await fetch(`${API_URL}/files`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
  allFiles = await res.json();
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
        <div class="file-row">
          <p class="file-name" title="${meta.filename}">${displayTitle}</p>
          <p style="color:var(--text-muted); font-size:0.8rem;">${ext}</p>
          <p style="color:var(--text-muted); font-size:0.8rem;">${formatBytes(meta.size)}</p>
          <p style="color:var(--text-muted); font-size:0.75rem;">${new Date(f.created_at).toLocaleDateString()}</p>
          <div class="btn-group">
            <button class="action-btn view" onclick="viewMyFile(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\'")}', ${meta.size}, false, null, false)">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
              <span>View</span>
            </button>
            <button class="action-btn save" onclick="downloadFile(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\'")}')">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
              <span>Save</span>
            </button>
            <button class="action-btn share" onclick="openShareModal(${f.file_id}, '${meta.filename.replace(/'/g,"\\'")}', '${f.encrypted_key}')">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              <span>Share</span>
            </button>
            <button class="action-btn delete" onclick="deleteFile(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\'")}')">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              <span>Delete</span>
            </button>
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
        <p style="font-weight:700; color: #fff; font-size: 1rem;">Encrypted Record</p>
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

async function deleteFile(id, keyStr, filename) {
  const conf = await showConfirm(`Are you sure you want to PERMANENTLY delete this file?`, "danger");
  if (!conf) return;
  const verified = await verifyPIN();
  if (!verified) return;
  
  await fetch(`${API_URL}/delete-file`, { 
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
    body: JSON.stringify({ fileId: id })
  });
  silentSync();
  showToast("Record Terminalized", "success");
}

function verifyPIN() {
  return new Promise((resolve) => {
    document.getElementById("pin-modal").classList.remove("hidden");
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
          closeModal("pin-modal");
          verifyBtn.onclick = null;
          resolve(true);
        } else {
          showToast(data.message || "Invalid PIN", "error");
        }
      } catch (err) { resolve(false); }
    };

    const onAbort = () => {
      closeModal("pin-modal");
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
  
  showToast("Suspending shared access...");
  await fetch(`${API_URL}/share/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` } });
  loadFiles();
  showToast("Record removed from feed", "success");
}

// ==========================================
// UPLOAD logic
// ==========================================

async function showUploadModal(preselectFolderId = null) {
  const verified = await verifyPIN();
  if (!verified) return;

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
    showToast("Transmission Successful"); 
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
      const verified = await verifyPIN();
      if (!verified) return;
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
  } catch (err) { showToast("Download failed", "error"); }
}

async function viewMyFile(id, keyStr, name, size, alreadyDecrypted = false, decBuffer = null, canDownload = true, linkId = null) {
  let dec = decBuffer;
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
        showToast("Shared access terminated and record cleared", "info");
      } catch (err) { closeModal('file-view-modal'); }
    };
  } else {
    closeBtn.onclick = () => closeModal('file-view-modal');
  }

  document.getElementById("view-filename").textContent = truncateName(name);
  document.getElementById("file-view-modal").classList.remove("hidden");
  const viewer = document.getElementById("view-content");

  if (!alreadyDecrypted) {
    viewer.innerHTML = '<p style="color:#444;">Awaiting Identity Verification...</p>';

    const verified = await verifyPIN();
    if (!verified) {
      closeModal('file-view-modal');
      return;
    }

    viewer.innerHTML = '<p style="color:#444;">Establishing Secure Feed...</p>';
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

    // 1. IMAGE PROTOCOL (Direct)
    if (["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "tiff", "tif", "ico", "heic"].includes(ext)) {
      const img = document.createElement("img"); img.src = currentBlobUrl;
      img.style.maxWidth = "100%"; img.style.maxHeight = "100%"; img.style.objectFit = "contain"; 
      img.style.borderRadius = "20px"; img.style.boxShadow = "0 30px 60px rgba(0,0,0,0.6)";
      viewer.appendChild(img);
    } 
    // 2. VIDEO PROTOCOL (Direct)
    else if (["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "mpeg", "mpg", "3gp"].includes(ext)) {
      const video = document.createElement("video"); video.src = currentBlobUrl;
      video.controls = true; video.style.maxWidth = "100%"; video.style.maxHeight = "100%";
      video.style.borderRadius = "16px"; video.style.background = "#000"; video.style.boxShadow = "0 20px 40px rgba(0,0,0,0.5)";
      viewer.appendChild(video);
    } 
    // 3. AUDIO PROTOCOL (Direct)
    else if (["mp3", "wav", "aac", "flac", "ogg", "m4a", "wma", "aiff"].includes(ext)) {
      viewer.innerHTML = `
        <div style="text-align:center; padding: 2rem; background: rgba(255,255,255,0.02); border-radius: 24px; width: 100%;">
          <div style="font-size:4rem; margin-bottom: 1rem;">🎵</div>
          <audio src="${currentBlobUrl}" controls style="width:100%;"></audio>
          <p style="margin-top:15px; color:#fff; font-weight: 700;">${name}</p>
        </div>
      `;
    }
    // 4. MICROSOFT WORD PROTOCOL (Direct DOM Rendering)
    else if (["docx", "doc", "odt", "rtf", "pages"].includes(ext)) {
        viewer.innerHTML = '<div style="color:var(--accent-cyan); text-align:center; padding:40px; font-family:var(--font-heading);">MANIFESTING DOCUMENT CONTENT...</div>';
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
                    const viewport = page.getViewport({ scale: 2 });
                    const canvas = document.createElement("canvas");
                    canvas.className = "pdf-page-canvas";
                    canvas.style.width = "100%"; canvas.style.marginBottom = "20px";
                    canvas.style.borderRadius = "8px"; canvas.style.boxShadow = "0 10px 30px rgba(0,0,0,0.3)";
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
        viewer.innerHTML = '<div style="color:var(--accent-cyan); text-align:center; padding:40px;">EXTRACTING PRESENTATION CONTENT...</div>';
        
        try {
            const zip = await JSZip.loadAsync(dec);
            
            const container = document.createElement("div");
            container.style.width = "100%";
            container.style.height = "100%";
            container.style.overflow = "auto";
            container.style.background = "transparent";
            container.style.backdropFilter = "none";
            container.style.border = "none";
            container.style.borderRadius = "0";
            container.style.padding = "30px";
            container.style.boxSizing = "border-box";
            container.style.fontFamily = "var(--font-main)";
            container.style.color = "#fff";
            
            const title = document.createElement("h2");
            title.textContent = "Presentation Content";
            title.style.borderBottom = "none";
            title.style.paddingBottom = "10px";
            container.appendChild(title);

            // Extract slide text
            const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/;
            const slideFiles = Object.keys(zip.files).filter(f => slideRegex.test(f));
            
            if (slideFiles.length > 0) {
                // Sort numerically
                slideFiles.sort((a,b) => parseInt(a.match(slideRegex)[1]) - parseInt(b.match(slideRegex)[1]));
                
                for (const slideFile of slideFiles) {
                    const xml = await zip.file(slideFile).async("string");
                    const slideDiv = document.createElement("div");
                    slideDiv.style.marginBottom = "30px";
                    slideDiv.style.padding = "10px";
                    slideDiv.style.background = "transparent";
                    slideDiv.style.borderRadius = "0";
                    slideDiv.style.border = "none";
                    
                    const slideHeader = document.createElement("h3");
                    slideHeader.textContent = `Slide ${slideFile.match(slideRegex)[1]}`;
                    slideHeader.style.color = "var(--accent-cyan)";
                    slideHeader.style.fontSize = "1.0rem";
                    slideHeader.style.fontWeight = "400";
                    slideHeader.style.marginBottom = "15px";
                    slideHeader.style.borderBottom = "none";
                    slideHeader.style.paddingBottom = "5px";
                    slideDiv.appendChild(slideHeader);
                    
                    const pMatches = xml.match(/<a:p[\s>][\s\S]*?<\/a:p>/g) || [];
                    let paragraphs = pMatches.map(p => {
                        const textMatches = p.match(/<a:t[\s>][\s\S]*?<\/a:t>/g) || [];
                        return textMatches.map(m => m.replace(/<\/?[^>]+(>|$)/g, "")).join("");
                    }).filter(t => t.trim().length > 0);
                    
                    let slideText = paragraphs.join("\n\n");
                    
                    if (slideText) {
                        const pre = document.createElement("pre");
                        pre.style.whiteSpace = "pre-wrap";
                        pre.style.wordWrap = "break-word";
                        pre.style.fontFamily = "var(--font-main)";
                        pre.style.fontSize = "0.95rem";
                        pre.style.lineHeight = "1.8";
                        pre.style.color = "#fff";
                        pre.style.margin = "0";
                        pre.textContent = slideText;
                        slideDiv.appendChild(pre);
                    } else {
                        const p = document.createElement("p");
                        p.textContent = "[No textual content on this slide]";
                        p.style.fontStyle = "italic";
                        p.style.color = "rgba(255,255,255,0.5)";
                        slideDiv.appendChild(p);
                    }
                    container.appendChild(slideDiv);
                }
            } else {
                const p = document.createElement("p");
                p.textContent = "No slides found or unsupported PPTX format.";
                container.appendChild(p);
            }

            // Extract media files
            const mediaFiles = Object.keys(zip.files).filter(f => f.startsWith("ppt/media/"));
            if (mediaFiles.length > 0) {
                const mediaHeader = document.createElement("h3");
                mediaHeader.textContent = "Presentation Media";
                mediaHeader.style.marginTop = "40px";
                mediaHeader.style.marginBottom = "20px";
                mediaHeader.style.borderBottom = "none";
                mediaHeader.style.paddingBottom = "10px";
                container.appendChild(mediaHeader);
                
                const grid = document.createElement("div");
                grid.style.display = "grid";
                grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(200px, 1fr))";
                grid.style.gap = "15px";
                
                for (const media of mediaFiles) {
                    if (media.match(/\.(png|jpe?g|gif|svg)$/i)) {
                        const blob = await zip.file(media).async("blob");
                        const img = document.createElement("img");
                        img.src = URL.createObjectURL(blob);
                        img.style.width = "100%";
                        img.style.borderRadius = "8px";
                        img.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
                        grid.appendChild(img);
                    }
                }
                container.appendChild(grid);
            }

            viewer.innerHTML = "";
            viewer.appendChild(container);
            
        } catch (err) {
            viewer.innerHTML = `<p style="color:var(--danger); padding:20px;">Protocol Error: Could not extract presentation content. (${err.message})</p>`;
        }
    }
    // 9. UNIVERSAL "ORIGINAL CONTENT" PROTOCOL (Text/Code/Binary-Strings)
    else {
      // For EVERYTHING ELSE (.exe, .apk, .py, .db, .sql, etc.): We project the RAW STRING CONTENT.
      const pre = document.createElement("pre");
      try {
          // Attempt high-fidelity text decoding
          pre.textContent = new TextDecoder('utf-8', { fatal: true }).decode(dec);
      } catch {
          // Fallback to binary string representation of the ORIGINAL content
          let binary = "";
          const bytes = new Uint8Array(dec.slice(0, 10000)); // Sample 10k for performance
          for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
          }
          pre.textContent = binary;
      }
      pre.style.color = "#00f2ff"; pre.style.width = "100%"; pre.style.height = "100%";
      pre.style.whiteSpace = "pre-wrap"; pre.style.padding = "25px";
      pre.style.background = "rgba(10,10,15,0.9)"; pre.style.borderRadius = "16px";
      pre.style.fontSize = "0.8rem"; pre.style.fontFamily = "'Fira Code', monospace";
      pre.style.overflowY = "auto"; pre.style.margin = "0";
      viewer.appendChild(pre);
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
let currentShareFile = null;
async function openShareModal(id, name, keyStr) {
  currentShareFile = { id, name, keyStr };
  document.getElementById("share-modal").classList.remove("hidden");
  document.getElementById("share-step-input").classList.remove("hidden");
  document.getElementById("share-step-result").classList.add("hidden");

  const verified = await verifyPIN();
  if (!verified) {
    closeModal('share-modal');
    return;
  }
}

async function generateShareLink(btn) {
  if (!currentShareFile) return showToast("No file selected for sharing", "error");
  const email = document.getElementById("share-email").value.trim();
  if (!email) return showToast("Recipient email is required", "error");
  
  const targetBtn = btn || (window.event ? window.event.target : null);
  const origText = targetBtn ? targetBtn.textContent : "Generate Link";
  if (targetBtn) { targetBtn.textContent = "Securing..."; targetBtn.disabled = true; }

  try {
    const [ivHex, keyBase64] = currentShareFile.keyStr.split(":");
    const masterKey = await getClientMasterKey();
    const fileKey = await decryptKey(base64ToArrayBuffer(keyBase64), masterKey, hexToBytes(ivHex));
    const linkKey = await generateFileKey();
    const { encryptedKey: encKeyLink, iv: lIv } = await encryptKey(fileKey, linkKey);
    const { encryptedData: encMetLink, iv: lmIv } = await encryptMetadata({ filename: currentShareFile.name }, linkKey);
    const linkKeyHex = bytesToHex(new Uint8Array(await window.crypto.subtle.exportKey("raw", linkKey)));
    
    const downloadable = document.getElementById("share-downloadable").checked;
    
    const res = await fetch(`${API_URL}/share`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionStorage.getItem("token")}` },
      body: JSON.stringify({
        fileId: currentShareFile.id, recipientEmail: email,
        encryptedFileKeyForLink: bytesToHex(lIv) + ":" + arrayBufferToBase64(encKeyLink),
        encryptedMetadataForLink: arrayBufferToBase64(encMetLink),
        metadataIv: bytesToHex(lmIv), linkKey: linkKeyHex,
        downloadable
      })
    });

    const data = await res.json();
    if (res.ok) {
      document.getElementById("generated-share-link").textContent = linkKeyHex;
      document.getElementById("share-step-input").classList.add("hidden");
      document.getElementById("share-step-result").classList.remove("hidden");
      showToast("Secure Link Generated");
    } else {
      showToast(data.message || "Sharing protocol failed", "error");
    }
  } catch (err) { 
    console.error("Share Protocol Deviation:", err);
    showToast("Share Encryption Failed: " + (err.message || "Internal error"), "error"); 
  } finally {
    if (targetBtn) { targetBtn.textContent = origText; targetBtn.disabled = false; }
  }
}

function copyShareLink() {
  navigator.clipboard.writeText(document.getElementById("generated-share-link").textContent);
  showToast("Link Key Copied"); 
  closeModal("share-modal");
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
    
    if (data.username) {
      document.getElementById("profile-username-display").textContent = data.username;
      document.getElementById("profile-username-header").textContent = data.username;
      document.getElementById("display-alias").textContent = data.username;
      document.getElementById("profile-email-full").textContent = data.email;
      const displayEmail = document.getElementById("display-email");
      if (displayEmail) displayEmail.textContent = data.email;
      
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

    if (data.profile_photo) {
      pPhoto.src = data.profile_photo;
      pPhoto.classList.remove("hidden");
      pInitials.classList.add("hidden");
      if (removeBtn) removeBtn.classList.remove("hidden");

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
      
      const hImg = document.getElementById("header-avatar-img");
      if (hImg) hImg.classList.add("hidden");
      const hAvatar = document.getElementById("header-avatar");
      if (hAvatar) hAvatar.classList.remove("hidden");
    }
  } catch (err) { console.warn("Profile sync deferred:", err); }
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
          if (authSection) {
            authSection.classList.remove("hidden");
            authSection.classList.add("visible");
          }
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
            } else {
              toggleAuthMode("login");
            }
          }
        }, 1200); 
      }, 1000); 
    }, 800); 
  }, 400); 
})();
