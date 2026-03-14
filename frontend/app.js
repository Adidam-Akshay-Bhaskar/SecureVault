const API_URL = window.location.origin + "/api";
const ALGO_NAME = "AES-GCM";

let sessionMasterKey = null;
let tempLoginCredentials = null;
let currentView = "my-vault";
let allFiles = [];
let allFolders = [];
let currentFolderId = null;

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
    const res = await fetch(`${API_URL}/profile`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
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

function showConfirm(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    document.getElementById("confirm-msg").textContent = message;
    modal.classList.remove("hidden");
    const ok = document.getElementById("confirm-ok-btn");
    const cancel = document.getElementById("confirm-cancel-btn");
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

function closeModal(id) { 
  const el = document.getElementById(id);
  if (el) el.classList.add("hidden"); 
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
  const modes = ["login", "register", "verify"];
  modes.forEach(m => {
    const el = document.getElementById(`${m}-form-container`);
    if (el) el.classList.add("hidden");
  });
  const active = document.getElementById(`${mode}-form-container`);
  if (active) active.classList.remove("hidden");
}

function switchAuthTab(tab) {
  toggleAuthMode(tab);
}

function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const isCollapsed = sidebar.classList.toggle("collapsed");
  document.body.classList.toggle("sidebar-collapsed");
  localStorage.setItem("sidebarCollapsed", isCollapsed);
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
      localStorage.setItem("token", data.accessToken);
      if (data.user?.masterKey) {
         sessionMasterKey = await window.crypto.subtle.importKey(
           "jwk", JSON.parse(data.user.masterKey), { name: ALGO_NAME }, false, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
         );
      }
      showToast("Identity Verified"); await loadProfile(); showView("my-vault");
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
      localStorage.setItem("token", data.accessToken);
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
      toggleAuthMode("login");
    } else showToast(data.message, "error");
  } catch { showToast("Registration failure", "error"); }
  finally { btn.disabled = false; btn.textContent = orig; }
});

function logout() {
  localStorage.removeItem("token");
  sessionMasterKey = null;
  document.getElementById("view-dashboard").classList.add("hidden");
  document.getElementById("auth-section").classList.remove("hidden");
  toggleAuthMode("login");
}

function cancelVerify() { tempLoginCredentials = null; switchAuthTab("login"); }

// ==========================================
// NAVIGATION
// ==========================================

function showView(view) {
  currentView = view;
  const views = ["my-vault", "incoming", "profile"];
  views.forEach(v => document.getElementById(`section-${v}`).classList.add("hidden"));
  document.getElementById(`section-${view}`).classList.remove("hidden");
  
  document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
  const activeItem = document.querySelector(`.nav-item[onclick="showView('${view}')"]`);
  if (activeItem) activeItem.classList.add("active");

  const title = document.getElementById("view-title");
  if (view === "my-vault") title.textContent = "My Data Vault";
  if (view === "incoming") title.textContent = "Incoming Data";
  if (view === "profile") title.textContent = "Profile & Security";

  document.getElementById("auth-section").classList.add("hidden");
  document.getElementById("view-dashboard").classList.remove("hidden");

  if (view === "my-vault") { loadFolders(); loadFiles(); }
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
}

// ==========================================
// FOLDERS logic
// ==========================================

async function loadFolders() {
  try {
    const res = await fetch(`${API_URL}/folders`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
    const data = await res.json();
    allFolders = data;
    const grid = document.getElementById("folder-list");
    const select = document.getElementById("upload-folder-select");
    grid.innerHTML = "";
    select.innerHTML = '<option value="">Root Vault</option>';
    
    document.getElementById("stat-folder-count").textContent = allFolders.length;

    allFolders.forEach(f => {
      grid.innerHTML += `
        <div class="folder-card" onclick="openFolder(${f.folder_id}, '${f.name}')">
          <span class="folder-icon">📂</span>
          <p class="folder-name">${f.name}</p>
          <p class="folder-count">Stored Data Group</p>
          <button class="action-btn" style="position:absolute; top:10px; right:10px; padding:4px 8px; font-size:10px;" onclick="event.stopPropagation(); deleteFolder(${f.folder_id})">Delete</button>
        </div>
      `;
      select.innerHTML += `<option value="${f.folder_id}">${f.name}</option>`;
    });
  } catch {}
}

function showCreateFolderModal() { document.getElementById("folder-modal").classList.remove("hidden"); }

async function createFolder() {
  const name = document.getElementById("new-folder-name").value.trim();
  if (!name) return;
  try {
    const res = await fetch(`${API_URL}/folders`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
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
  const conf = await showConfirm("Dissolve this folder? Filestreams will be unassigned but not deleted.");
  if (!conf) return;
  try {
    await fetch(`${API_URL}/folders/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
    loadFolders(); loadFiles();
  } catch {}
}

function openFolder(id, name) {
  currentFolderId = id;
  showToast(`Filtering by ${name}`, "info");
  toggleVaultSubView("files");
  renderFiles();
}

// ==========================================
// FILES logic
// ==========================================

async function loadFiles() {
  try {
    const res = await fetch(`${API_URL}/files`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
    const data = await res.json();
    allFiles = data;
    renderFiles();
  } catch (e) { console.error(e); }
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

  for (const f of filteredMy) {
    try {
      const meta = await decryptMetadata(base64ToArrayBuffer(f.encrypted_metadata), masterKey, hexToBytes(f.iv));
      const ext = meta.filename.split(".").pop().toUpperCase();

      myBody.innerHTML += `
        <div class="file-row">
          <div style="min-width:0; width:100%;">
            <p class="file-name" title="${meta.filename}">${meta.filename}</p>
            <p style="font-size:0.7rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin:0;">Encrypted</p>
          </div>
          <p style="color:var(--text-muted); font-size:0.8rem;">${ext}</p>
          <p style="color:var(--text-muted); font-size:0.8rem;">${formatBytes(meta.size)}</p>
          <p style="color:var(--text-muted); font-size:0.75rem;">${new Date(f.created_at).toLocaleDateString()}</p>
          <div class="btn-group">
            <button class="action-btn view" onclick="viewMyFile(${f.file_id}, '${f.encrypted_key}', '${meta.filename.replace(/'/g,"\\'")}', ${meta.size})">
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
            <button class="action-btn delete" onclick="deleteFile(${f.file_id})">
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

  for (const f of allFiles.sharedFiles) {
    shBody.innerHTML += `
      <div class="file-row" style="grid-template-columns: 3.5fr 1.5fr 1fr 3.5fr;">
        <div class="file-info">
          <p style="font-weight:600;">Encrypted Record</p>
        </div>
        <p style="color:var(--text-muted); font-size:0.8rem;">${f.sender_email}</p>
        <p style="color:var(--text-muted); font-size:0.8rem;">${new Date(f.created_at).toLocaleDateString()}</p>
        <div class="btn-group">
          <button class="action-btn" style="border-color:var(--primary); color:var(--primary);" onclick="openUnlockModal(${f.file_id}, ${f.link_id}, '${f.encrypted_key}', '${f.encrypted_metadata}', '${f.iv}')">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>
            <span>Unlock</span>
          </button>
          <button class="action-btn delete" onclick="deleteSharedLink(${f.link_id})">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            <span>Delete</span>
          </button>
        </div>
      </div>
    `;
  }
}

async function deleteFile(id) {
  const conf = await showConfirm("Delete this record permanently?");
  if (!conf) return;
  await fetch(`${API_URL}/delete-file`, { 
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
    body: JSON.stringify({ fileId: id })
  });
  loadFiles();
}

async function deleteSharedLink(id) {
  await fetch(`${API_URL}/share/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
  loadFiles();
}

// ==========================================
// UPLOAD logic
// ==========================================

function showUploadModal() { 
  document.getElementById("upload-modal").classList.remove("hidden");
  // Auto-detect current folder context
  const select = document.getElementById("upload-folder-select");
  if (select) select.value = currentFolderId || "";
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
    
    const urlRes = await fetch(`${API_URL}/upload-url`, { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
    const { uploadUrl, fileUuid } = await urlRes.json();
    
    await fetch(uploadUrl, { method: "PUT", body: encryptedFileBuffer, headers: { "Content-Type": "application/octet-stream" } });
    
    await fetch(`${API_URL}/complete-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({
        fileUuid, fileType: file.name.split(".").pop().toLowerCase(),
        encryptedMetadata: arrayBufferToBase64(encMeta), metadataIv: bytesToHex(metaIv),
        encryptedKey: bytesToHex(keyIv) + ":" + arrayBufferToBase64(encKey),
        folderId: folderId || null
      }),
    });
    showToast("Transmission Successful"); closeModal("upload-modal"); loadFiles();
  } catch (err) { showToast("Error: " + err.message, "error"); }
  finally { btn.textContent = orig; btn.disabled = false; }
});

// ==========================================
// DOWNLOAD & VIEW (Stripped down/adapted)
// ==========================================

async function downloadFile(fileId, encryptedKeyStr, filename) {
  try {
    const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${fileId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })).json();
    const encryptedBlob = await (await fetch(downloadUrl)).arrayBuffer();
    const [ivHex, keyBase64] = encryptedKeyStr.split(":");
    const mk = await getClientMasterKey();
    const fk = await decryptKey(base64ToArrayBuffer(keyBase64), mk, hexToBytes(ivHex));
    const dec = await decryptFile(new Uint8Array(encryptedBlob), fk);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([dec])); a.download = filename; a.click();
  } catch {}
}

async function viewMyFile(id, keyStr, name, size) {
  showToast("Pre-calculating decryption...", "info");
  try {
    const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })).json();
    const blob = await (await fetch(downloadUrl)).arrayBuffer();
    const [ivHex, keyB64] = keyStr.split(":");
    const mk = await getClientMasterKey();
    const fk = await decryptKey(base64ToArrayBuffer(keyB64), mk, hexToBytes(ivHex));
    const dec = await decryptFile(new Uint8Array(blob), fk);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([dec])); a.target = "_blank"; a.click();
    showToast("File Open in Secure Tab");
  } catch {}
}

// ==========================================
// UNLOCK & VIEW logic
// ==========================================

let tempUnlockData = null;

function openUnlockModal(fileId, linkId, encKey, encMeta, iv) {
  tempUnlockData = { fileId, linkId, encKey, encMeta, iv };
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
    
    // Test decryption of metadata to verify key
    const fileKey = await decryptKey(base64ToArrayBuffer(keyBase64), linkKey, hexToBytes(ivHex));
    const meta = await decryptMetadata(base64ToArrayBuffer(tempUnlockData.encMeta), linkKey, hexToBytes(tempUnlockData.iv));
    
    tempUnlockData.fileKey = fileKey;
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
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ securityPin }),
    });
    if (!res.ok) throw new Error("Verification Failed");
    
    showToast("Identity Confirmed. Decrypting record...");
    const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${tempUnlockData.fileId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })).json();
    const encryptedBlob = await (await fetch(downloadUrl)).arrayBuffer();
    const dec = await decryptFile(new Uint8Array(encryptedBlob), tempUnlockData.fileKey);
    
    closeModal("unlock-modal");
    openSecureViewer(dec, tempUnlockData.meta, tempUnlockData.linkId);
  } catch (err) {
    showToast("Identity Verification Failed", "error");
  }
}

let currentBlobUrl = null;

async function openSecureViewer(buffer, meta, linkIdToBurn = null) {
  const modal = document.getElementById("access-modal");
  const viewer = document.getElementById("access-viewer-body");
  const footer = document.getElementById("access-footer");
  
  document.getElementById("access-filename").textContent = meta.filename;
  modal.classList.remove("hidden");
  viewer.innerHTML = "Initializing secure stream...";
  footer.innerHTML = "";

  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  const ext = meta.filename.split(".").pop().toLowerCase();
  const blob = new Blob([buffer], { type: getMimeType(ext) });
  currentBlobUrl = URL.createObjectURL(blob);

  // Render Preview
  if (["png","jpg","jpeg","gif","webp"].includes(ext)) {
    viewer.innerHTML = `<img src="${currentBlobUrl}" style="max-width:100%; max-height:100%; object-fit:contain;">`;
  } else if (ext === "pdf") {
    viewer.innerHTML = `<iframe src="${currentBlobUrl}#toolbar=0" style="width:100%; height:100%; border:none;"></iframe>`;
  } else if (["txt","md","json","js","css","html"].includes(ext)) {
    const text = await blob.text();
    viewer.innerHTML = `<pre style="color:#fff; padding:2rem; width:100%; overflow:auto; text-align:left;">${text.replace(/</g,"&lt;")}</pre>`;
  } else {
    viewer.innerHTML = `<div style="text-align:center;"><p style="font-size:3rem;">📄</p><p>Preview not supported for .${ext}</p></div>`;
  }

  // Footer Actions
  const dlBtn = document.createElement("button");
  dlBtn.className = "action-btn";
  dlBtn.textContent = "Download Decrypted";
  dlBtn.onclick = () => {
    const a = document.createElement("a"); a.href = currentBlobUrl; a.download = meta.filename; a.click();
  };
  footer.appendChild(dlBtn);

  if (linkIdToBurn) {
    const burnBtn = document.createElement("button");
    burnBtn.className = "primary-btn";
    burnBtn.style.background = "var(--danger)";
    burnBtn.textContent = "Close & Burn Link";
    burnBtn.onclick = async () => {
      await deleteSharedLink(linkIdToBurn);
      closeViewer();
    };
    footer.appendChild(burnBtn);
  }
}

function closeViewer() {
  document.getElementById("access-modal").classList.add("hidden");
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  currentBlobUrl = null;
}

function getMimeType(ext) {
  const Map = { 
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", 
    jpeg: "image/jpeg", gif: "image/gif", txt: "text/plain",
    html: "text/html", json: "application/json"
  };
  return Map[ext] || "application/octet-stream";
}
let currentShareFile = null;
function openShareModal(id, name, keyStr) {
  currentShareFile = { id, name, keyStr };
  document.getElementById("share-modal").classList.remove("hidden");
  document.getElementById("share-step-input").classList.remove("hidden");
  document.getElementById("share-step-result").classList.add("hidden");
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
    
    const res = await fetch(`${API_URL}/share`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({
        fileId: currentShareFile.id, recipientEmail: email,
        encryptedFileKeyForLink: bytesToHex(lIv) + ":" + arrayBufferToBase64(encKeyLink),
        encryptedMetadataForLink: arrayBufferToBase64(encMetLink),
        metadataIv: bytesToHex(lmIv), linkKey: linkKeyHex
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
    const res = await fetch(`${API_URL}/profile`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.username) return;

    if (document.getElementById("profile-username-display")) document.getElementById("profile-username-display").textContent = data.username;
    if (document.getElementById("profile-email-full")) document.getElementById("profile-email-full").textContent = data.email;
    if (document.getElementById("profile-email-display")) document.getElementById("profile-email-display").textContent = data.email;
    if (document.getElementById("welcome-message")) document.getElementById("welcome-message").textContent = data.username;
    
    if (data.username) {
      const initial = data.username[0].toUpperCase();
      if (document.getElementById("avatar-initials")) document.getElementById("avatar-initials").textContent = initial;
      if (document.getElementById("profile-initials")) document.getElementById("profile-initials").textContent = initial;
      if (document.getElementById("header-avatar")) document.getElementById("header-avatar").textContent = initial;
    }
    
    if (data.profile_photo) {
      ["header-avatar-img", "profile-avatar-img"].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.src = data.profile_photo; el.classList.remove("hidden"); }
      });
    }
  } catch (err) { console.warn("Profile sync deferred:", err); }
}

async function toggleTheme() {
  document.body.classList.toggle("theme-dark");
  document.body.classList.toggle("theme-light");
}

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
  
  if (localStorage.getItem("sidebarCollapsed") === "true") {
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) {
      sidebar.classList.add("collapsed");
      document.body.classList.add("sidebar-collapsed");
    }
  }
  const token = localStorage.getItem("token");
  // Ultra-Smooth Premium Pacing
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
            setTimeout(() => authSection.classList.add("visible"), 50);
          }
        }, 300);

        setTimeout(async () => {
          // Preloader finally removed from layout
          if (preloader) preloader.classList.add("hidden");
          
          if (token) {
            try { 
              await loadProfile(); 
              showView("my-vault"); 
            } catch (err) { logout(); }
          } else {
            toggleAuthMode("login");
          }
        }, 1200); 
      }, 1000); 
    }, 800); 
  }, 400); 
})();
