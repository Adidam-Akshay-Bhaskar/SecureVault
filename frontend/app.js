const API_URL = "/api"; // FIX: always relative, never localhost
let currentUser = null;
let sessionMasterKey = null;

// ==========================================
// CRYPTO UTILS
// ==========================================
const ALGO_NAME = "AES-GCM";
const KEY_LENGTH = 256;

async function getClientMasterKey() {
  if (sessionMasterKey) return sessionMasterKey;

  // If we have a token but no user profile yet, wait for loadProfile
  if (localStorage.getItem("token") && !currentUser) {
    try {
      await loadProfile();
    } catch (e) {
      console.error("Critical: Profile load failed, cannot retrieve Master Key.");
      throw new Error("SECURE_ACCESS_DENIED");
    }
  }

  if (currentUser && currentUser.masterKey) {
    sessionMasterKey = await window.crypto.subtle.importKey(
      "jwk", JSON.parse(currentUser.masterKey), { name: ALGO_NAME }, false,
      ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
    );
    return sessionMasterKey;
  }

  // If we reach here and have a token, it means we are logged in but have NO key in DB.
  // This is a critical error state. We SHOULD NOT generate a new random key here
  // because it will be unable to decrypt existing files.
  if (localStorage.getItem("token")) {
    throw new Error("ENCRYPTION_KEY_NOT_FOUND");
  }

  // Fallback for brand new registration ONLY (where token is not set yet)
  const key = await window.crypto.subtle.generateKey(
    { name: ALGO_NAME, length: KEY_LENGTH }, true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
  sessionMasterKey = key;
  return sessionMasterKey;
}

async function syncMasterKey(rawKey) {
  await fetch(`${API_URL}/save-master-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${localStorage.getItem("token")}` },
    body: JSON.stringify({ masterKey: rawKey })
  });
}

async function generateFileKey() {
  return window.crypto.subtle.generateKey({ name: ALGO_NAME, length: KEY_LENGTH }, true, ["encrypt", "decrypt"]);
}

async function encryptMetadata(dataObj, key) {
  const encoded = new TextEncoder().encode(JSON.stringify(dataObj));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt({ name: ALGO_NAME, iv }, key, encoded);
  return { encryptedData: encrypted, iv };
}

async function decryptMetadata(encryptedBuffer, key, iv) {
  const decrypted = await window.crypto.subtle.decrypt({ name: ALGO_NAME, iv }, key, encryptedBuffer);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function encryptKey(keyToEncrypt, wrappingKey) {
  const rawKey = await window.crypto.subtle.exportKey("raw", keyToEncrypt);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt({ name: ALGO_NAME, iv }, wrappingKey, rawKey);
  return { encryptedKey: encrypted, iv };
}

async function decryptKey(encryptedKeyBuffer, wrappingKey, iv) {
  const rawKey = await window.crypto.subtle.decrypt({ name: ALGO_NAME, iv }, wrappingKey, encryptedKeyBuffer);
  return window.crypto.subtle.importKey("raw", rawKey, { name: ALGO_NAME }, true, ["encrypt", "decrypt"]);
}

async function encryptFile(file, key) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const fileBuffer = await file.arrayBuffer();
  const encryptedContent = await window.crypto.subtle.encrypt({ name: ALGO_NAME, iv }, key, fileBuffer);
  const combined = new Uint8Array(iv.byteLength + encryptedContent.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encryptedContent), iv.byteLength);
  return combined;
}

async function decryptFile(combinedBuffer, key) {
  const iv = combinedBuffer.subarray(0, 12);
  const data = combinedBuffer.subarray(12);
  return await window.crypto.subtle.decrypt({ name: ALGO_NAME, iv }, key, data);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunkSize)
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
  return window.btoa(binary);
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

// ==========================================
// UI HELPERS
// ==========================================

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div class="toast-icon">${type === "error" ? "⚠️" : "✨"}</div><div class="toast-message">${message}</div>`;
  requestAnimationFrame(() => container.appendChild(toast));
  setTimeout(() => {
    toast.style.animation = "fadeOutToast 0.25s cubic-bezier(0.4,0,1,1) forwards";
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 250);
  }, 2500);
}

// FIX: Single showConfirm, single argument
function showConfirm(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    document.getElementById("confirm-msg").textContent = message;
    modal.classList.remove("hidden");

    const okBtn = document.getElementById("confirm-ok-btn");
    const cancelBtn = document.getElementById("confirm-cancel-btn");
    const newOk = okBtn.cloneNode(true);
    const newCancel = cancelBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

    newOk.onclick = () => { modal.classList.add("hidden"); resolve(true); };
    newCancel.onclick = () => { modal.classList.add("hidden"); resolve(false); };
  });
}

function getInitials(name) { return name ? name.substring(0, 2).toUpperCase() : "UN"; }

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(Math.max(0, decimals)))} ${sizes[i]}`;
}

function getMimeType(ext) {
  const map = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain", html: "text/html" };
  return map[ext] || "application/octet-stream";
}

function closeModal(id) { document.getElementById(id).classList.add("hidden"); }

// ==========================================
// AUTH TABS
// ==========================================

let tempLoginCredentials = null;

function switchAuthTab(tab) {
  document.querySelectorAll(".tab-pill").forEach(p => p.classList.remove("active"));
  ["login-form","register-form","verify-pin-form","reset-identity-form","reset-password-form"]
    .forEach(id => document.getElementById(id).classList.add("hidden"));

  const map = {
    login:        ["tab-login",    "login-form"],
    register:     ["tab-register", "register-form"],
    verify:       ["tab-verify",   "verify-pin-form"],
    reset:        ["tab-reset",    "reset-identity-form"],
    "reset-step-2": ["tab-reset", "reset-password-form"],
  };
  if (map[tab]) {
    document.getElementById(map[tab][0]).classList.add("active");
    document.getElementById(map[tab][1]).classList.remove("hidden");
    if (tab === "verify") document.getElementById("verify-pin-input").focus();
    if (tab === "reset") document.getElementById("reset-email").focus();
    if (tab === "reset-step-2") document.getElementById("reset-new-password").focus();
  }
}

function cancelVerify() {
  tempLoginCredentials = null;
  document.getElementById("verify-pin-input").value = "";
  switchAuthTab("login");
}

// ==========================================
// LOGIN
// ==========================================

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault(); e.stopPropagation();
  const email = document.getElementById("login-email").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;
  const btn = e.target.querySelector('button[type="submit"]');
  const orig = btn.innerHTML;
  try {
    btn.disabled = true; btn.innerHTML = "Verifying...";
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(`${API_URL}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }), signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!res.headers.get("content-type")?.includes("application/json")) throw new Error("Invalid Server Response");
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem("token", data.accessToken);
      if (data.user?.masterKey) {
        sessionMasterKey = await window.crypto.subtle.importKey(
          "jwk", JSON.parse(data.user.masterKey), { name: ALGO_NAME }, false,
          ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
        );
      }
      showToast("Identity Verified. Welcome back.");
      await loadProfile();
      showDashboard();
    } else if (data.message === "2FA_REQUIRED") {
      tempLoginCredentials = { email, password };
      showToast("Secondary Verification Protocol Required", "info");
      switchAuthTab("verify");
    } else {
      showToast(data.message, "error");
    }
  } catch (err) {
    showToast(err.name === "AbortError" ? "Connection Timeout" : "Connection Refused. Server offline?", "error");
  } finally { btn.disabled = false; btn.innerHTML = orig; }
});

document.getElementById("verify-pin-form").addEventListener("submit", async (e) => {
  e.preventDefault(); e.stopPropagation();
  if (!tempLoginCredentials) { showToast("Session expired.", "error"); return switchAuthTab("login"); }
  const securityPin = document.getElementById("verify-pin-input").value;
  const btn = e.target.querySelector('button[type="submit"]');
  const orig = btn.innerHTML;
  try {
    btn.disabled = true; btn.innerHTML = "Unsealing...";
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(`${API_URL}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...tempLoginCredentials, securityPin }), signal: ctrl.signal,
    });
    clearTimeout(tid);
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem("token", data.accessToken);
      if (data.user?.masterKey) {
        sessionMasterKey = await window.crypto.subtle.importKey(
          "jwk", JSON.parse(data.user.masterKey), { name: ALGO_NAME }, false,
          ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
        );
      }
      showToast("Identity Verified. Welcome back.");
      await loadProfile(); showDashboard();
      tempLoginCredentials = null;
      document.getElementById("verify-pin-input").value = "";
    } else { showToast(data.message, "error"); }
  } catch (err) {
    showToast(err.name === "AbortError" ? "Timeout" : "Connection Error", "error");
  } finally { btn.disabled = false; btn.innerHTML = orig; }
});

document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault(); e.stopPropagation();
  const username = document.getElementById("reg-username").value.trim();
  const email = document.getElementById("reg-email").value.trim().toLowerCase();
  const password = document.getElementById("reg-password").value;
  const securityPin = document.getElementById("reg-pin").value;

  const key = await window.crypto.subtle.generateKey(
    { name: ALGO_NAME, length: KEY_LENGTH }, true, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
  const masterKey = JSON.stringify(await window.crypto.subtle.exportKey("jwk", key));

  try {
    const res = await fetch(`${API_URL}/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, securityPin, masterKey }),
    });
    if (res.ok) { showToast("Uplink Established. Please Login."); switchAuthTab("login"); }
    else showToast((await res.json()).message, "error");
  } catch { showToast("Registration failed: Network Error", "error"); }
});

let tempResetCredentials = null;

document.getElementById("reset-identity-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("reset-email").value.trim().toLowerCase();
  const securityPin = document.getElementById("reset-pin").value.trim();
  try {
    const res = await fetch(`${API_URL}/verify-identity`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, securityPin }),
    });
    if (res.ok) {
      tempResetCredentials = { email, securityPin };
      showToast("Identity Confirmed. Proceed to Phase 2.");
      switchAuthTab("reset-step-2");
    } else {
      const ct = res.headers.get("content-type");
      showToast(ct?.includes("application/json") ? (await res.json()).message : "Server Verification Error", "error");
    }
  } catch { showToast("Verification Failed: Connection Refused", "error"); }
});

document.getElementById("reset-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!tempResetCredentials) { showToast("Session Expired.", "error"); return switchAuthTab("reset"); }
  const newPassword = document.getElementById("reset-new-password").value;
  const confirmPassword = document.getElementById("reset-confirm-password").value;
  if (newPassword !== confirmPassword) return showToast("Passcodes do not match", "error");
  try {
    const res = await fetch(`${API_URL}/reset-password`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...tempResetCredentials, newPassword }),
    });
    if (res.ok) {
      showToast("Credentials Updated Successfully.");
      tempResetCredentials = null;
      ["reset-email","reset-pin","reset-new-password","reset-confirm-password"].forEach(id => document.getElementById(id).value = "");
      switchAuthTab("login");
    } else { showToast((await res.json()).message, "error"); }
  } catch { showToast("Update Failed", "error"); }
});

function logout() {
  localStorage.removeItem("token");
  currentUser = null;
  sessionMasterKey = null;
  window.location.href = window.location.pathname;
}

// ==========================================
// PROFILE
// ==========================================

async function loadProfile() {
  const token = localStorage.getItem("token");
  if (!token) return;

  try {
    const res = await fetch(`${API_URL}/profile`, { headers: { Authorization: `Bearer ${token}` } });
    
    if (!res.ok) {
      // If server says user doesn't exist (404) or database is down (500), 
      // we must clear the stale token and log out.
      if (res.status === 404 || res.status === 401 || res.status === 403) {
        console.warn("Session invalid or user not found. Logging out.");
        logout();
      }
      throw new Error(`SERVER_ERROR_${res.status}`);
    }

    currentUser = await res.json();
    
    if (currentUser.masterKey) {
      sessionMasterKey = await window.crypto.subtle.importKey(
        "jwk", JSON.parse(currentUser.masterKey), { name: ALGO_NAME }, false,
        ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
      );
    }
    const usernameDisplays = [
      document.getElementById("profile-username-display"),
      document.getElementById("welcome-message")
    ];
    const emailDisplay = document.getElementById("profile-email-display");

    if (emailDisplay) emailDisplay.textContent = currentUser.email;
    usernameDisplays.forEach(el => { if (el) el.textContent = currentUser.username; });

    // 3. Handle Theme
    document.body.classList.remove("theme-cosmic", "theme-light");
    const theme = currentUser.theme_preference || "theme-light";
    document.body.classList.add(theme === "default" ? "theme-light" : theme);
    updateThemeToggleButton(theme === "theme-cosmic");

    // 4. Update Avatars
    updateAvatarDisplay("header-avatar", currentUser);
    updateAvatarDisplay("profile-container", currentUser, true);
    
  } catch (e) { 
    console.error("Profile Load Error:", e);
    // If it's a server error but not a 404/401/403, we just toast it.
    // The initAuth will catch the thrown error and handle the redirect.
    throw e;
  }
}

function updateAvatarDisplay(contextId, user, isBig = false) {
  const initials = getInitials(user.username);
  if (!isBig) {
    document.getElementById("avatar-initials").textContent = initials;
    const img = document.getElementById("header-avatar-img");
    if (user.profile_photo) { img.src = user.profile_photo; img.classList.remove("hidden"); document.getElementById("avatar-initials").classList.add("hidden"); }
    else { img.classList.add("hidden"); document.getElementById("avatar-initials").classList.remove("hidden"); }
  } else {
    document.getElementById("profile-initials").textContent = initials;
    const img = document.getElementById("profile-avatar-img");
    const removeBtn = document.getElementById("remove-photo-btn");
    if (user.profile_photo) {
      img.src = user.profile_photo; img.classList.remove("hidden");
      document.getElementById("profile-initials").classList.add("hidden");
      if (removeBtn) removeBtn.classList.remove("hidden");
    } else {
      img.classList.add("hidden"); document.getElementById("profile-initials").classList.remove("hidden");
      if (removeBtn) removeBtn.classList.add("hidden");
    }
  }
}

async function uploadProfilePhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      await fetch(`${API_URL}/profile/photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ photoBase64: e.target.result }),
      });
      currentUser.profile_photo = e.target.result;
      updateAvatarDisplay("header-avatar", currentUser);
      updateAvatarDisplay("profile-container", currentUser, true);
      showToast("Visual Identification Updated");
    } catch { showToast("Update failed", "error"); }
  };
  reader.readAsDataURL(file);
}

async function removeProfilePhoto() {
  // FIX: single-argument showConfirm (no 3-arg version)
  const confirmed = await showConfirm("Are you sure you want to permanently delete your profile photo?");
  if (!confirmed) return;
  try {
    const res = await fetch(`${API_URL}/profile/photo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ photoBase64: null }),
    });
    if (res.ok) {
      currentUser.profile_photo = null;
      updateAvatarDisplay("header-avatar", currentUser);
      updateAvatarDisplay("profile-container", currentUser, true);
      showToast("Profile Photo Removed");
    } else showToast("Removal failed", "error");
  } catch { showToast("Server error", "error"); }
}

document.getElementById("update-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById("current-password").value;
  const newPassword = document.getElementById("new-password").value;
  try {
    const res = await fetch(`${API_URL}/profile/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast("Security Protocol Updated. Please Re-authenticate.");
      setTimeout(() => { localStorage.removeItem("token"); currentUser = null; sessionMasterKey = null; window.location.href = "index.html"; }, 2000);
    } else showToast(data.message, "error");
  } catch (err) { showToast("Update failed: " + err.message, "error"); }
});

// ==========================================
// THEME
// ==========================================

function updateThemeToggleButton(isDark) {
  const icon = document.getElementById("theme-icon");
  if (icon) icon.textContent = isDark ? "☀️" : "🌙";
}

async function toggleTheme() {
  const token = localStorage.getItem("token");
  if (!token) return;
  document.body.classList.add("theme-switching");
  const newTheme = document.body.classList.contains("theme-cosmic") ? "theme-light" : "theme-cosmic";
  try {
    const res = await fetch(`${API_URL}/update-theme`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ theme: newTheme }),
    });
    if (res.ok) {
      document.body.classList.remove("theme-cosmic", "theme-light");
      document.body.classList.add(newTheme);
      updateThemeToggleButton(newTheme === "theme-cosmic");
      if (currentUser) currentUser.theme_preference = newTheme;
      setTimeout(() => document.body.classList.remove("theme-switching"), 50);
    } else { document.body.classList.remove("theme-switching"); showToast("Failed to update theme", "error"); }
  } catch { document.body.classList.remove("theme-switching"); showToast("Theme update failed", "error"); }
}

// ==========================================
// NAVIGATION
// ==========================================

function showDashboard() {
  localStorage.setItem("current_view", "dashboard");
  const auth = document.getElementById("auth-section");
  const profile = document.getElementById("profile-section");
  [auth, profile].forEach(el => {
    el.style.animation = "none";
    el.style.transition = "opacity 0.3s ease, transform 0.3s ease";
  });
  requestAnimationFrame(() => {
    auth.style.opacity = "0"; auth.style.transform = "scale(0.95)";
    profile.style.opacity = "0"; profile.style.transform = "scale(0.95)";
  });
  setTimeout(() => {
    [auth, profile].forEach(el => {
      el.classList.add("hidden");
      el.style.opacity = ""; el.style.transform = ""; el.style.animation = "";
    });
    const dashboard = document.getElementById("dashboard-section");
    const header = document.getElementById("app-header");
    dashboard.classList.remove("hidden"); header.classList.remove("hidden");
    dashboard.style.opacity = "0"; header.style.opacity = "0";
    dashboard.style.animation = "none";
    header.style.transition = "opacity 0.5s ease";
    dashboard.style.transition = "opacity 0.5s ease";
    requestAnimationFrame(() => { dashboard.style.opacity = "1"; header.style.opacity = "1"; });
    loadFiles();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, 300);
}

function showProfile() {
  localStorage.setItem("current_view", "profile");
  document.getElementById("dashboard-section").classList.add("hidden");
  document.getElementById("profile-section").classList.remove("hidden");
  document.getElementById("app-header").classList.remove("hidden");
}

function showUploadModal() { document.getElementById("upload-modal").classList.remove("hidden"); }

// ==========================================
// UPLOAD
// ==========================================

document.getElementById("upload-form").addEventListener("submit", async (e) => {
  e.preventDefault(); e.stopPropagation();
  const file = document.getElementById("file-input").files[0];
  if (!file) return;
  const btn = e.target.querySelector('button[type="submit"]');
  const orig = btn.textContent;
  btn.textContent = "Encrypting..."; btn.disabled = true;
  try {
    const fileKey = await generateFileKey();
    const encryptedFileBuffer = await encryptFile(file, fileKey);
    const masterKey = await getClientMasterKey();
    const { encryptedData: encMeta, iv: metaIv } = await encryptMetadata({ filename: file.name, size: file.size, type: file.type }, masterKey);
    const { encryptedKey: encKey, iv: keyIv } = await encryptKey(fileKey, masterKey);
    const { uploadUrl, fileUuid } = await (await fetch(`${API_URL}/upload-url`, { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })).json();
    await fetch(uploadUrl, { method: "PUT", body: encryptedFileBuffer, headers: { "Content-Type": "application/octet-stream" } });
    await fetch(`${API_URL}/complete-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({
        fileUuid, fileType: file.name.split(".").pop().toLowerCase(),
        encryptedMetadata: arrayBufferToBase64(encMeta), metadataIv: bytesToHex(metaIv),
        encryptedKey: bytesToHex(keyIv) + ":" + arrayBufferToBase64(encKey),
      }),
    });
    showToast("Data Encrypted & Transmitted");
    closeModal("upload-modal"); loadFiles();
    document.getElementById("upload-form").reset();
    document.getElementById("file-label").textContent = "No file selected";
  } catch (err) { showToast("Upload Failed: " + err.message, "error"); }
  finally { btn.textContent = orig; btn.disabled = false; }
});

// ==========================================
// FILES
// ==========================================

async function loadFiles() {
  const res = await fetch(`${API_URL}/files`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
  const data = await res.json();
  const myTbody = document.getElementById("file-list-body");
  const sharedTbody = document.getElementById("shared-list-body");
  myTbody.innerHTML = ""; sharedTbody.innerHTML = "";
  const masterKey = await getClientMasterKey();

  data.myFiles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  data.sharedFiles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  for (const f of data.myFiles) {
    try {
      const meta = await decryptMetadata(base64ToArrayBuffer(f.encrypted_metadata), masterKey, hexToBytes(f.iv));
      const safeName = meta.filename.replace(/'/g, "\\'");
      const typeExt = meta.filename.split(".").pop().toUpperCase();
      myTbody.innerHTML += `
        <tr>
          <td><span style="font-weight:600;color:var(--text-main);" title="${meta.filename}">${meta.filename}</span></td>
          <td><span class="type-badge type-${typeExt.toLowerCase()}">${typeExt}</span></td>
          <td style="color:var(--text-muted);">${formatBytes(meta.size)}</td>
          <td style="color:var(--text-muted);">${new Date(f.created_at).toLocaleString()}</td>
          <td>
            <div style="display:flex;gap:8px;">
              <button onclick="viewMyFile(${f.file_id},'${f.encrypted_key}','${safeName}',${meta.size},this)" class="action-glass-btn btn-view">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg><span>View</span>
              </button>
              <button onclick="downloadFile(${f.file_id},'${f.encrypted_key}','OWNER',null,'${safeName}')" class="action-glass-btn btn-download">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg><span>Download</span>
              </button>
              <button onclick="openShareModal(${f.file_id},'${safeName}','${f.encrypted_key}')" class="action-glass-btn btn-share">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg><span>Share</span>
              </button>
              <button onclick="deleteFile(${f.file_id})" class="action-glass-btn btn-delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>Delete</span>
              </button>
            </div>
          </td>
        </tr>`;
    } catch (e) {
      console.error("Error decrypting file", e);
      myTbody.innerHTML += `
        <tr>
          <td><span style="color:var(--text-muted);">🔒 Decryption Failed (Missing Key?)</span></td>
          <td style="color:var(--text-muted);">---</td>
          <td style="color:var(--text-muted);">${new Date(f.created_at).toLocaleDateString()}</td>
          <td>
            <button onclick="showToast('Cannot access file: Master Key mismatch.','error')" class="secondary-btn small">❓</button>
            <button onclick="deleteFile(${f.file_id})" class="danger-btn small">🗑</button>
          </td>
        </tr>`;
    }
  }

  for (const f of data.sharedFiles) {
    sharedTbody.innerHTML += `
      <tr>
        <td><span style="color:var(--text-muted);font-style:italic;">🔒 Locked File</span></td>
        <td>${new Date(f.created_at).toLocaleString()}</td>
        <td><span class="status-badge" style="font-family:monospace;font-size:0.8rem;">${f.sender_email || "SHARED"}</span></td>
        <td>
          <div style="display:flex;gap:8px;">
            <button onclick="openUnlockModal(${f.file_id},${f.link_id},'${f.encrypted_key}','${f.encrypted_metadata}','${f.iv}')" class="action-glass-btn btn-unlock">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg><span>Unlock</span>
            </button>
            <button onclick="deleteSharedLink(${f.link_id})" class="action-glass-btn btn-delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg><span>Remove</span>
            </button>
          </div>
        </td>
      </tr>`;
  }
}

async function deleteSharedLink(linkId, skipConfirm = false) {
  if (!skipConfirm) { const confirmed = await showConfirm("Remove this transmission record?"); if (!confirmed) return; }
  try {
    const res = await fetch(`${API_URL}/share/${linkId}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
    if (res.ok) { showToast("Record Deleted"); loadFiles(); }
    else showToast("Removal failed", "error");
  } catch { showToast("Removal failed", "error"); }
}

async function deleteFile(fileId) {
  const confirmed = await showConfirm("Permanently delete this data? This cannot be undone.");
  if (!confirmed) return;
  try {
    const res = await fetch(`${API_URL}/delete-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ fileId }),
    });
    if (res.ok) { showToast("Data Deleted"); loadFiles(); }
    else showToast("Delete failed", "error");
  } catch { showToast("Delete failed", "error"); }
}

// ==========================================
// SHARE
// ==========================================

let currentShareItem = null;

function openShareModal(fileId, filename, encryptedKeyStr) {
  currentShareItem = { fileId, filename, encryptedKeyStr };
  document.getElementById("share-modal").classList.remove("hidden");
  document.getElementById("share-step-input").classList.remove("hidden");
  document.getElementById("share-step-result").classList.add("hidden");
  const nameEl = document.getElementById("share-file-name");
  nameEl.textContent = filename; nameEl.title = filename;
  document.getElementById("share-email").value = "";
}

document.getElementById("share-form").addEventListener("submit", async (e) => {
  e.preventDefault(); e.stopPropagation();
  const email = document.getElementById("share-email").value;
  const allowDownloadEl = document.getElementById("share-allow-download");
  const allowDownload = allowDownloadEl ? allowDownloadEl.checked : true;
  const btn = document.getElementById("share-btn-submit");
  const orig = btn.textContent;
  btn.textContent = "Securing..."; btn.disabled = true;
  try {
    const [ivHex, keyBase64] = currentShareItem.encryptedKeyStr.split(":");
    const masterKey = await getClientMasterKey();
    const fileKey = await decryptKey(base64ToArrayBuffer(keyBase64), masterKey, hexToBytes(ivHex));
    const linkKey = await generateFileKey();
    const { encryptedKey: encKeyLink, iv: lIv } = await encryptKey(fileKey, linkKey);
    const { encryptedData: encMetLink, iv: lmIv } = await encryptMetadata({ filename: currentShareItem.filename, allowDownload }, linkKey);
    const linkKeyHex = bytesToHex(new Uint8Array(await window.crypto.subtle.exportKey("raw", linkKey)));
    const res = await fetch(`${API_URL}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({
        fileId: currentShareItem.fileId, recipientEmail: email,
        encryptedFileKeyForLink: bytesToHex(lIv) + ":" + arrayBufferToBase64(encKeyLink),
        encryptedMetadataForLink: arrayBufferToBase64(encMetLink),
        metadataIv: bytesToHex(lmIv), linkKey: linkKeyHex,
      }),
    });
    if (res.ok) {
      showToast((await res.json()).message || "Secure Channel Established!");
      document.getElementById("generated-share-key").value = linkKeyHex;
      document.getElementById("share-step-input").classList.add("hidden");
      document.getElementById("share-step-result").classList.remove("hidden");
    } else showToast((await res.json()).message || "Share failed", "error");
  } catch (err) { showToast("Share Error: " + err.message, "error"); }
  finally { btn.textContent = orig; btn.disabled = false; }
});

function copyShareKey() {
  const k = document.getElementById("generated-share-key");
  k.select(); k.setSelectionRange(0, 99999);
  navigator.clipboard.writeText(k.value)
    .then(() => showToast("Key copied to clipboard"))
    .catch(() => { document.execCommand("copy"); showToast("Key copied to clipboard"); });
}

// ==========================================
// UNLOCK
// ==========================================

function openUnlockModal(fileId, linkId, encryptedKeyStr, encryptedMetadataStr, metadataIv) {
  document.getElementById("unlock-modal").classList.remove("hidden");
  document.getElementById("unlock-file-id").value = fileId;
  document.getElementById("unlock-encrypted-key").value = encryptedKeyStr;
  const modal = document.getElementById("unlock-modal");
  modal.dataset.encMeta = encryptedMetadataStr;
  modal.dataset.metaIv = metadataIv;
  modal.dataset.linkId = linkId;
  document.getElementById("unlock-key-input").value = "";
  document.getElementById("unlock-key-input").focus();
  document.getElementById("unlock-step-1").classList.remove("hidden");
  document.getElementById("unlock-step-2").classList.add("hidden");
}

function backToUnlockStep1() {
  document.getElementById("unlock-step-2").classList.add("hidden");
  document.getElementById("unlock-step-1").classList.remove("hidden");
}

let tempFileAccessData = null;

document.getElementById("unlock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const modal = document.getElementById("unlock-modal");
  const keyHex = document.getElementById("unlock-key-input").value.trim();
  const encKeyStr = document.getElementById("unlock-encrypted-key").value;
  const fileId = document.getElementById("unlock-file-id").value;
  try {
    const linkKey = await window.crypto.subtle.importKey("raw", hexToBytes(keyHex), { name: ALGO_NAME }, false, ["unwrapKey", "decrypt"]);
    const [ivHex, keyBase64] = encKeyStr.split(":");
    const fileKey = await decryptKey(base64ToArrayBuffer(keyBase64), linkKey, hexToBytes(ivHex));
    const metadata = await decryptMetadata(base64ToArrayBuffer(modal.dataset.encMeta), linkKey, hexToBytes(modal.dataset.metaIv));
    tempFileAccessData = { fileKey, metadata, fileId, linkId: modal.dataset.linkId };
    document.getElementById("unlock-step-1").classList.add("hidden");
    document.getElementById("unlock-step-2").classList.remove("hidden");
    const pinInput = document.getElementById("file-pin-input");
    pinInput.value = "";
    setTimeout(() => pinInput.focus(), 100);
  } catch (err) { showToast(`Invalid Decryption Key: ${err.message}`, "error"); }
});

document.getElementById("file-pin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!tempFileAccessData) { showToast("Session expired.", "error"); closeModal("unlock-modal"); return; }
  const securityPin = document.getElementById("file-pin-input").value.trim();
  const btn = e.target.querySelector('button[type="submit"]');
  const orig = btn.innerHTML;
  try {
    btn.disabled = true; btn.innerHTML = "Verifying...";
    const res = await fetch(`${API_URL}/verify-file-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify({ securityPin }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.message || "Invalid Security PIN", "error"); btn.disabled = false; btn.innerHTML = "Access File"; return; }
    showToast("Identity Verified. Decrypting file...");
    const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${tempFileAccessData.fileId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })).json();
    const encryptedBlob = await (await fetch(downloadUrl)).arrayBuffer();
    const decryptedBuffer = await decryptFile(new Uint8Array(encryptedBlob), tempFileAccessData.fileKey);
    openSecureViewer(decryptedBuffer, tempFileAccessData.metadata, tempFileAccessData.fileId, tempFileAccessData.linkId);
    closeModal("unlock-modal");
    tempFileAccessData = null;
    document.getElementById("file-pin-input").value = "";
    loadFiles();
  } catch (err) { showToast(`Verification Failed: ${err.message}`, "error"); }
  finally { btn.disabled = false; btn.innerHTML = orig; }
});

// ==========================================
// SECURE VIEWER
// ==========================================

let currentDecryptedBlobUrl = null;

async function openSecureViewer(buffer, metadata, fileId, linkId) {
  const modal = document.getElementById("access-modal");
  const viewer = document.getElementById("access-viewer-body");
  const badges = document.getElementById("access-badges");
  const burnBtn = modal.querySelector(".danger-btn");

  const existingDlBtn = document.getElementById("access-download-btn");
  if (existingDlBtn) existingDlBtn.remove();

  if (!linkId) {
    burnBtn.textContent = "Close Viewer"; burnBtn.className = "secondary-btn";
    burnBtn.onclick = () => {
      modal.classList.add("hidden");
      if (currentDecryptedBlobUrl) URL.revokeObjectURL(currentDecryptedBlobUrl);
      viewer.innerHTML = "";
      setTimeout(() => { burnBtn.className = "danger-btn"; }, 300);
    };
  } else {
    burnBtn.textContent = "Close & Burn"; burnBtn.className = "danger-btn";
    burnBtn.onclick = () => closeViewer(linkId);
    if (metadata.allowDownload) {
      const dlBtn = document.createElement("button");
      dlBtn.id = "access-download-btn"; dlBtn.className = "action-glass-btn btn-download";
      dlBtn.style.cssText = "padding:0.5rem 1rem;font-size:0.85rem;min-width:auto;margin-right:0.5rem;";
      dlBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg><span>Download</span>`;
      burnBtn.parentElement.insertBefore(dlBtn, burnBtn);
      dlBtn.onclick = () => { const a = document.createElement("a"); a.href = currentDecryptedBlobUrl; a.download = metadata.filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); };
    }
  }

  const fnEl = document.getElementById("access-filename");
  fnEl.textContent = metadata.filename; fnEl.title = metadata.filename;
  modal.classList.remove("hidden");
  viewer.innerHTML = ""; badges.innerHTML = "";
  if (currentDecryptedBlobUrl) URL.revokeObjectURL(currentDecryptedBlobUrl);

  if (!buffer) { viewer.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);"><p>Loading...</p></div>`; return; }

  const ext = metadata.filename.split(".").pop().toLowerCase();
  const blob = new Blob([buffer], { type: getMimeType(ext) });
  currentDecryptedBlobUrl = URL.createObjectURL(blob);

  if (ext === "zip") {
    viewer.innerHTML = '<div style="color:var(--text-muted);padding:2rem;">Parsing archive...</div>';
    await new Promise(r => setTimeout(r, 50));
    try {
      const zip = await JSZip.loadAsync(buffer);
      let fileList = ""; let count = 0;
      zip.forEach((relativePath, zipEntry) => {
        if (count++ > 150) return;
        fileList += `<li style="padding:8px 12px;border-bottom:1px solid var(--glass-border);display:flex;align-items:center;gap:12px;font-size:0.9rem;">
          <span>${zipEntry.dir ? "📁" : "📄"}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;">${relativePath}</span>
          ${!zipEntry.dir ? `<span style="font-size:0.8rem;opacity:0.6;">${(zipEntry._data.uncompressedSize/1024).toFixed(1)} KB</span>` : ""}
        </li>`;
      });
      viewer.innerHTML = `<div style="overflow:auto;width:100%;height:100%;padding:2rem;display:flex;flex-direction:column;align-items:center;">
        <h3 style="margin-bottom:1rem;color:var(--text-main);">Archive Contents</h3>
        <ul style="list-style:none;padding:0;width:100%;max-width:800px;">${fileList || '<li style="padding:1rem;opacity:0.7;">Empty Archive</li>'}</ul>
        ${count > 150 ? '<p style="opacity:0.5;font-size:0.8rem;">(Showing first 150 items)</p>' : ""}
      </div>`;
    } catch (e) { viewer.innerHTML = `<div style="color:#ef4444;padding:2rem;">Failed to read ZIP.<br><small>${e.message}</small></div>`; }
  } else if (["png","jpg","jpeg","gif","webp"].includes(ext)) {
    viewer.innerHTML = `<img src="${currentDecryptedBlobUrl}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;">`;
  } else if (ext === "pdf") {
    viewer.innerHTML = `<iframe src="${currentDecryptedBlobUrl}#toolbar=0" style="width:100%;height:100%;border:none;"></iframe>`;
  } else if (["txt","md","json","js","css","html","java","py","c","cpp","h","cs","go","rs","php","rb","swift","kt","ts","tsx","jsx","sql","sh","yaml","yml","xml","env","gitignore"].includes(ext)) {
    const reader = new FileReader();
    reader.onload = (e) => { viewer.innerHTML = `<pre style="color:white;overflow:auto;padding:1rem;white-space:pre-wrap;width:100%;height:100%;text-align:left;font-family:'Consolas','Monaco',monospace;font-size:0.9rem;line-height:1.5;">${e.target.result.replace(/</g,"&lt;")}</pre>`; };
    reader.readAsText(blob);
  } else if (ext === "docx") {
    viewer.innerHTML = '<div style="color:var(--text-muted);padding:2rem;">Parsing document...</div>';
    await new Promise(r => setTimeout(r, 50));
    if (window.mammoth) mammoth.convertToHtml({ arrayBuffer: buffer }).then(r => { viewer.innerHTML = `<div style="background:white;color:black;padding:2rem;overflow:auto;height:100%;border-radius:4px;">${r.value}</div>`; }).catch(e => { viewer.innerHTML = `<div style="color:var(--danger);text-align:center;">Failed: ${e.message}</div>`; });
    else viewer.innerHTML = `<div style="text-align:center;padding:2rem;">Word viewer not loaded. Please download.</div>`;
  } else if (["xlsx","xls","csv"].includes(ext)) {
    viewer.innerHTML = '<div style="color:var(--text-muted);padding:2rem;">Parsing spreadsheet...</div>';
    await new Promise(r => setTimeout(r, 50));
    if (window.XLSX) {
      try {
        const wb = XLSX.read(buffer, { type:"array", dense:true, bookVBA:false, cellStyles:false, cellFormula:false });
        viewer.innerHTML = `<div style="background:white;color:black;padding:1rem;overflow:auto;height:100%;border-radius:4px;">${XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]])}</div>`;
      } catch (e) { viewer.innerHTML = `<div style="color:var(--danger);text-align:center;">Failed: ${e.message}</div>`; }
    } else viewer.innerHTML = `<div style="text-align:center;padding:2rem;">Excel viewer not loaded. Please download.</div>`;
  } else {
    viewer.innerHTML = `<div style="text-align:center;"><div style="font-size:3rem;margin-bottom:1rem;">📦</div><p>Preview not available for .${ext} files.</p></div>`;
  }
}

async function closeViewer(linkId) {
  document.getElementById("access-modal").classList.add("hidden");
  if (currentDecryptedBlobUrl) URL.revokeObjectURL(currentDecryptedBlobUrl);
  document.getElementById("access-viewer-body").innerHTML = "";
  if (linkId) await deleteSharedLink(linkId, true);
}

async function viewMyFile(fileId, encryptedKeyStr, filename, size, btnRef) {
  const btn = btnRef || event.target.closest("button");
  const orig = btn.innerHTML;
  btn.innerHTML = `<svg class="animate-spin" viewBox="0 0 24 24" style="width:18px;height:18px;fill:none;stroke:currentColor;"><circle cx="12" cy="12" r="10" stroke-width="4" style="opacity:0.3"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" style="opacity:0.75"></path></svg><span>...</span>`;
  btn.disabled = true;
  try {
    const [ivHex, keyBase64] = encryptedKeyStr.split(":");
    const [fileKey, encryptedBlob] = await Promise.all([
      (async () => { const mk = await getClientMasterKey(); return decryptKey(base64ToArrayBuffer(keyBase64), mk, hexToBytes(ivHex)); })(),
      (async () => { const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${fileId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })).json(); return (await fetch(downloadUrl, { priority: "high" })).arrayBuffer(); })()
    ]);
    const decryptedBuffer = await decryptFile(new Uint8Array(encryptedBlob), fileKey);
    openSecureViewer(decryptedBuffer, { filename, size, allowDownload: true, type: filename.split(".").pop().toUpperCase() }, fileId, null);
  } catch (err) { showToast("View Error: " + err.message, "error"); }
  finally { btn.innerHTML = orig; btn.disabled = false; }
}

async function downloadFile(fileId, encryptedKeyStr, role, providedFileKey = null, originalFilename = "decrypted_file") {
  const displayName = originalFilename.length > 25 ? originalFilename.substring(0, 12) + "..." + originalFilename.substring(originalFilename.length - 8) : originalFilename;
  const confirmed = await showConfirm(`Download "${displayName}"?`);
  if (!confirmed) return;
  try {
    const { downloadUrl } = await (await fetch(`${API_URL}/download-url/${fileId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } })).json();
    const encryptedBlob = await (await fetch(downloadUrl)).arrayBuffer();
    let fileKey = providedFileKey;
    if (!fileKey) {
      const [ivHex, keyBase64] = encryptedKeyStr.split(":");
      const masterKey = await getClientMasterKey();
      fileKey = await decryptKey(base64ToArrayBuffer(keyBase64), masterKey, hexToBytes(ivHex));
    }
    const decryptedBuffer = await decryptFile(new Uint8Array(encryptedBlob), fileKey);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([decryptedBuffer]));
    a.download = originalFilename; a.click();
    showToast("Data Decrypted & Downloaded");
  } catch (e) { showToast("Download Error: " + e.message, "error"); }
}

// ==========================================
// INIT
// ==========================================

(async function initAuth() {
  const token = localStorage.getItem("token");
  if (token) {
    try {
      await loadProfile();
      if (localStorage.getItem("current_view") === "profile") showProfile();
      else showDashboard();
    } catch (e) {
      console.error("InitAuth Error:", e.message);
      // If we can't load the profile, we CANNOT proceed to the dashboard.
      // The user is likely seeing stale data or the DB is disconnected.
      localStorage.removeItem("token");
      document.getElementById("auth-section").classList.remove("hidden");
      document.getElementById("dashboard-section").classList.add("hidden");
      document.getElementById("app-header").classList.add("hidden");
      if (e.message.includes("SERVER_ERROR_500")) {
        showToast("Database Gateway Timeout. Please retry.", "error");
      }
    }
  } else {
    document.getElementById("auth-section").classList.remove("hidden");
  }
})();