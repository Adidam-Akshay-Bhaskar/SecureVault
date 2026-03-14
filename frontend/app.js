const API_URL =
  window.location.port === "3000" ? "/api" : "http://127.0.0.1:3000/api";
let currentUser = null;

// ==========================================
// THEME ENGINE (User-Specific)
// ==========================================

// Theme will be loaded after user login from their profile

// ==========================================
// CRYPTO UTILS (Web Crypto API)
// ==========================================
const ALGO_NAME = "AES-GCM";
const KEY_LENGTH = 256;

// 1. Generate/Get Master Key
async function getClientMasterKey() {
  let rawKey = localStorage.getItem("client_master_key");
  if (!rawKey) {
    const key = await window.crypto.subtle.generateKey(
      { name: ALGO_NAME, length: KEY_LENGTH },
      true,
      ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
    );
    const exported = await window.crypto.subtle.exportKey("jwk", key);
    rawKey = JSON.stringify(exported);
    localStorage.setItem("client_master_key", rawKey);
  }
  return window.crypto.subtle.importKey(
    "jwk",
    JSON.parse(rawKey),
    { name: ALGO_NAME },
    false,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
}

// 2. Generate Random File Key
async function generateFileKey() {
  return window.crypto.subtle.generateKey(
    { name: ALGO_NAME, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
}

// 3. Encrypt Metadata
async function encryptMetadata(dataObj, key) {
  const encoded = new TextEncoder().encode(JSON.stringify(dataObj));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: ALGO_NAME, iv: iv },
    key,
    encoded
  );
  return { encryptedData: encrypted, iv: iv };
}

// 4. Decrypt Metadata
async function decryptMetadata(encryptedBuffer, key, iv) {
  const decrypted = await window.crypto.subtle.decrypt(
    { name: ALGO_NAME, iv: iv },
    key,
    encryptedBuffer
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// 5. Encrypt Key (Wrap)
async function encryptKey(keyToEncrypt, wrappingKey) {
  const rawKey = await window.crypto.subtle.exportKey("raw", keyToEncrypt);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: ALGO_NAME, iv: iv },
    wrappingKey,
    rawKey
  );
  return { encryptedKey: encrypted, iv: iv };
}

// 6. Decrypt Key (Unwrap)
async function decryptKey(encryptedKeyBuffer, wrappingKey, iv) {
  const rawKey = await window.crypto.subtle.decrypt(
    { name: ALGO_NAME, iv: iv },
    wrappingKey,
    encryptedKeyBuffer
  );
  return window.crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: ALGO_NAME },
    true,
    ["encrypt", "decrypt"]
  );
}

// 7. Encrypt File
async function encryptFile(file, key) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const fileBuffer = await file.arrayBuffer();
  const encryptedContent = await window.crypto.subtle.encrypt(
    { name: ALGO_NAME, iv: iv },
    key,
    fileBuffer
  );
  const combined = new Uint8Array(iv.byteLength + encryptedContent.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encryptedContent), iv.byteLength);
  return combined;
}

// 8. Decrypt File
async function decryptFile(combinedBuffer, key) {
  // Use subarray to create a view (O(1)) instead of slice (O(N) copy)
  // This heavily reduces lag for large files
  const iv = combinedBuffer.subarray(0, 12);
  const data = combinedBuffer.subarray(12);
  return await window.crypto.subtle.decrypt(
    { name: ALGO_NAME, iv: iv },
    key,
    data
  );
}

// UTILS
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB chunks
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunkSize, len))
    );
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ==========================================
// UI LOGIC
// ==========================================

// ==========================================
// UI LOGIC (COSMIC THEME)
// ==========================================

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  // Modern icons
  const icon = type === "error" ? "⚠️" : "✨";

  toast.innerHTML = `
         <div class="toast-icon">${icon}</div>
         <div class="toast-message">${message}</div>
     `;

  // Use requestAnimationFrame for smoother insertion
  requestAnimationFrame(() => {
    container.appendChild(toast);
  });

  // Auto-remove with optimized animation
  const removeToast = () => {
    toast.style.animation =
      "fadeOutToast 0.25s cubic-bezier(0.4, 0, 1, 1) forwards";
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 250);
  };

  setTimeout(removeToast, 2500); // 2.5 seconds display
}

let tempLoginCredentials = null;

function switchAuthTab(tab) {
  console.log("Switching to tab:", tab);
  // Reset Tabs
  document
    .querySelectorAll(".tab-pill")
    .forEach((pill) => pill.classList.remove("active"));

  // Reset Forms (Hide all)
  document.getElementById("login-form").classList.add("hidden");
  document.getElementById("register-form").classList.add("hidden");

  document.getElementById("verify-pin-form").classList.add("hidden"); // Ensure verify is hidden
  document.getElementById("reset-identity-form").classList.add("hidden");
  document.getElementById("reset-password-form").classList.add("hidden");

  if (tab === "login") {
    document.getElementById("tab-login").classList.add("active");
    document.getElementById("login-form").classList.remove("hidden");
  } else if (tab === "register") {
    document.getElementById("tab-register").classList.add("active");
    document.getElementById("register-form").classList.remove("hidden");

  } else if (tab === "verify") {
    document.getElementById("tab-verify").classList.add("active");
    document.getElementById("verify-pin-form").classList.remove("hidden");
    document.getElementById("verify-pin-input").focus();
  } else if (tab === "reset") {
    document.getElementById("tab-reset").classList.add("active");
    document.getElementById("reset-identity-form").classList.remove("hidden");
    document.getElementById("reset-email").focus();
  } else if (tab === "reset-step-2") {
    document.getElementById("tab-reset").classList.add("active");
    document.getElementById("reset-password-form").classList.remove("hidden");
    document.getElementById("reset-new-password").focus();
  }
}

// --- Navigation Helpers for Back Buttons ---
// --- Navigation Helpers for Back Buttons ---

function cancelVerify() {
  tempLoginCredentials = null;
  document.getElementById("verify-pin-input").value = "";
  switchAuthTab("login");
}

// Login
// Login (Step 1)
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const email = document
    .getElementById("login-email")
    .value.trim()
    .toLowerCase();
  const password = document.getElementById("login-password").value;
  const btn = e.target.querySelector('button[type="submit"]');
  const originalText = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.innerHTML = "Verifying...";

    // Add Timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // Guard against non-JSON
    if (!res.headers.get("content-type")?.includes("application/json")) {
      throw new Error("Invalid Server Response");
    }

    const data = await res.json();

    if (res.ok) {
      // Direct Login (No 2FA)
      localStorage.setItem("token", data.accessToken);
      showToast("Identity Verified. Welcome back.");
      await loadProfile();
      showDashboard();
    } else if (data.message === "2FA_REQUIRED") {
      // 2FA Required - Switch to Step 2
      tempLoginCredentials = { email, password };
      showToast("Secondary Verification Protocol Required", "info");
      switchAuthTab("verify");
    } else {
      showToast(data.message, "error");
    }
  } catch (err) {
    console.error("Login Fetch Error:", err);
    const msg =
      err.name === "AbortError"
        ? "Connection Timeout"
        : "Connection Refused. Server offline?";
    showToast(msg, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
});

// Verify PIN (Step 2)
document
  .getElementById("verify-pin-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!tempLoginCredentials) {
      showToast("Session expired. Please start over.", "error");
      return switchAuthTab("login");
    }

    const securityPin = document.getElementById("verify-pin-input").value;
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;

    try {
      btn.disabled = true;
      btn.innerHTML = "Unsealing...";

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send ALL credentials (Password is re-sent, safer backend handling)
        body: JSON.stringify({ ...tempLoginCredentials, securityPin }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem("token", data.accessToken);
        showToast("Identity Verified. Welcome back.");
        await loadProfile();
        showDashboard();
        // Clear credentials after success
        tempLoginCredentials = null;
        document.getElementById("verify-pin-input").value = "";
      } else {
        showToast(data.message, "error");
      }
    } catch (err) {
      showToast(
        err.name === "AbortError" ? "Timeout" : "Connection Error",
        "error"
      );
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

// Register
document
  .getElementById("register-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const username = document.getElementById("reg-username").value.trim();
    const email = document
      .getElementById("reg-email")
      .value.trim()
      .toLowerCase();
    const password = document.getElementById("reg-password").value;
    const securityPin = document.getElementById("reg-pin").value;
    try {
      const res = await fetch(`${API_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, securityPin }),
      });
      if (res.ok) {
        showToast("Uplink Established. Please Login.");
        switchAuthTab("login");
      } else showToast((await res.json()).message, "error");
    } catch (err) {
      showToast("Registration failed: Network Error", "error");
    }
  });

// Reset Password
// Reset Password - Step 1: Verify Identity
let tempResetCredentials = null;

document
  .getElementById("reset-identity-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document
      .getElementById("reset-email")
      .value.trim()
      .toLowerCase();
    const securityPin = document.getElementById("reset-pin").value.trim();

    try {
      const res = await fetch(`${API_URL}/verify-identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, securityPin }),
      });

      const contentType = res.headers.get("content-type");
      if (res.ok) {
        tempResetCredentials = { email, securityPin };
        showToast("Identity Confirmed. Proceed to Phase 2.");
        switchAuthTab("reset-step-2");
      } else {
        if (contentType && contentType.includes("application/json")) {
          const data = await res.json();
          showToast(data.message, "error");
        } else {
          // Fallback for non-JSON errors (like 404 HTML)
          console.error("Non-JSON Error Response:", await res.text());
          showToast("Server Verification Error (API Not Found?)", "error");
        }
      }
    } catch (err) {
      console.error("Identity Verification Exception:", err);
      showToast("Verification Failed: Connection Refused", "error");
    }
  });

// Reset Password - Step 2: Update Password
document
  .getElementById("reset-password-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!tempResetCredentials) {
      showToast("Session Expired. Restarting...", "error");
      return switchAuthTab("reset");
    }

    const newPassword = document.getElementById("reset-new-password").value;
    const confirmPassword = document.getElementById(
      "reset-confirm-password"
    ).value;

    if (newPassword !== confirmPassword) {
      return showToast("Passcodes do not match", "error");
    }

    try {
      const res = await fetch(`${API_URL}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...tempResetCredentials, newPassword }),
      });

      if (res.ok) {
        showToast("Credentials Updated Successfully.");
        tempResetCredentials = null; // Clear
        // Clear Inputs
        document.getElementById("reset-email").value = "";
        document.getElementById("reset-pin").value = "";
        document.getElementById("reset-new-password").value = "";
        document.getElementById("reset-confirm-password").value = "";
        switchAuthTab("login");
      } else {
        showToast((await res.json()).message, "error");
      }
    } catch (err) {
      showToast("Update Failed", "error");
    }
  });

function logout() {
  // Clear authentication
  localStorage.removeItem("token");
  currentUser = null;

  // Perform a full refresh to redirect to the landing page in a clean state
  window.location.href = window.location.pathname;
}

function getInitials(name) {
  return name ? name.substring(0, 2).toUpperCase() : "UN";
}

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

async function loadProfile() {
  try {
    const res = await fetch(`${API_URL}/profile`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (res.ok) {
      currentUser = await res.json();

      // Apply user's theme preference
      if (
        currentUser.theme_preference &&
        currentUser.theme_preference !== "default"
      ) {
        // Remove any existing theme classes
        document.body.classList.remove("theme-cosmic", "theme-light");
        // Apply user's theme class
        document.body.classList.add(currentUser.theme_preference);
      } else {
        // Default to theme-light (Purple Header) if nothing set or 'default'
        document.body.classList.remove("theme-cosmic", "theme-light");
        document.body.classList.add("theme-light");
      }

      // Update theme toggle button UI
      const isDark = currentUser.theme_preference === "theme-cosmic";
      updateThemeToggleButton(isDark);

      // Update Header Avatar
      updateAvatarDisplay("header-avatar", currentUser);

      // Update Profile Page
      document.getElementById("profile-username-display").textContent =
        currentUser.username;
      document.getElementById("profile-email-display").textContent =
        currentUser.email;

      // Update Dashboard Welcome
      const welcome = document.getElementById("welcome-message");
      if (welcome)
        welcome.textContent = `Welcome back, ${currentUser.username}.`;

      updateAvatarDisplay("profile-container", currentUser, true);
    }
  } catch (e) {
    console.error(e);
  }
}

function updateAvatarDisplay(contextId, user, isBig = false) {
  const initials = getInitials(user.username);

  // Header
  if (!isBig) {
    document.getElementById("avatar-initials").textContent = initials;
    const img = document.getElementById("header-avatar-img");
    if (user.profile_photo) {
      img.src = user.profile_photo;
      img.classList.remove("hidden");
      document.getElementById("avatar-initials").classList.add("hidden");
    } else {
      img.classList.add("hidden");
      document.getElementById("avatar-initials").classList.remove("hidden");
    }
  } else {
    // Big Profile
    document.getElementById("profile-initials").textContent = initials;
    const img = document.getElementById("profile-avatar-img");
    const removeBtn = document.getElementById("remove-photo-btn");

    if (user.profile_photo) {
      img.src = user.profile_photo;
      img.classList.remove("hidden");
      document.getElementById("profile-initials").classList.add("hidden");
      if (removeBtn) removeBtn.classList.remove("hidden");
    } else {
      img.classList.add("hidden");
      document.getElementById("profile-initials").classList.remove("hidden");
      if (removeBtn) removeBtn.classList.add("hidden");
    }
  }
}

function showDashboard() {
  localStorage.setItem('current_view', 'dashboard'); // Persist State
  // Fade out auth/profile sections
  const authSection = document.getElementById("auth-section");
  const profileSection = document.getElementById("profile-section");

  // Fix: Remove animation property to unlock opacity and set transition
  authSection.style.animation = "none";
  profileSection.style.animation = "none";
  authSection.style.transition = "opacity 0.3s ease, transform 0.3s ease";
  profileSection.style.transition = "opacity 0.3s ease, transform 0.3s ease";

  // Trigger Fade Out
  requestAnimationFrame(() => {
    authSection.style.opacity = "0";
    authSection.style.transform = "scale(0.95)";
    profileSection.style.opacity = "0";
    profileSection.style.transform = "scale(0.95)";
  });

  setTimeout(() => {
    // Hide old sections
    authSection.classList.add("hidden");
    profileSection.classList.add("hidden");
    
    // Reset styles for next time
    authSection.style.opacity = "";
    authSection.style.transform = "";
    authSection.style.animation = "";
    profileSection.style.opacity = "";
    profileSection.style.transform = "";
    profileSection.style.animation = "";

    // Show dashboard and header
    const dashboard = document.getElementById("dashboard-section");
    const header = document.getElementById("app-header");

    dashboard.classList.remove("hidden");
    header.classList.remove("hidden");

    // Prepare for fade-in
    dashboard.style.opacity = "0";
    header.style.opacity = "0";
    dashboard.style.animation = "none"; 
    header.style.transition = "opacity 0.5s ease";
    dashboard.style.transition = "opacity 0.5s ease";

    requestAnimationFrame(() => {
      dashboard.style.opacity = "1";
      header.style.opacity = "1";
    });

    // Initialize Dashboard Data
    loadFiles();
    window.scrollTo({ top: 0, behavior: "smooth" });

  }, 300); // Wait for 300ms transition
}

function showProfile() {
  localStorage.setItem("current_view", "profile"); // Persist State
  document.getElementById("dashboard-section").classList.add("hidden");
  document.getElementById("profile-section").classList.remove("hidden");
  // App Header stays visible for Profile
  document.getElementById("app-header").classList.remove("hidden");
}

async function uploadProfilePhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (e) {
    const base64 = e.target.result;
    try {
      await fetch(`${API_URL}/profile/photo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ photoBase64: base64 }),
      });
      // Update UI immediately
      currentUser.profile_photo = base64;
      updateAvatarDisplay("header-avatar", currentUser);
      updateAvatarDisplay("profile-container", currentUser, true);
      showToast("Visual Identification Updated");
    } catch {
      showToast("Update failed", "error");
    }
  };
  reader.readAsDataURL(file);
}

async function removeProfilePhoto() {
  const confirmed = await showConfirm(
    "Security Clearance Required",
    "Are you sure you want to permanently delete your visual identification (profile photo)?",
    "🗑️"
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`${API_URL}/profile/photo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify({ photoBase64: null }),
    });

    if (res.ok) {
      currentUser.profile_photo = null;
      updateAvatarDisplay("header-avatar", currentUser);
      updateAvatarDisplay("profile-container", currentUser, true);
      showToast("Profile Photo Removed");
    } else {
      showToast("Removal failed", "error");
    }
  } catch (err) {
    showToast("Server error", "error");
  }
}

document
  .getElementById("update-password-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById("current-password").value;
    const newPassword = document.getElementById("new-password").value;

    try {
      const res = await fetch(`${API_URL}/profile/password`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Security Protocol Updated. Please Re-authenticate.");
        // Clear token and reload to landing page
        setTimeout(() => {
          localStorage.removeItem("token");
          currentUser = null;
          window.location.href = "index.html"; // Force reload to landing page
        }, 2000);
      } else {
        showToast(data.message, "error");
      }
    } catch (err) {
      console.error("[Update Error]", err);
      showToast("Update failed: " + err.message, "error");
    }
  });

// -------------------------------------------------------------
// THEME TOGGLE (Light/Dark Only)
// -------------------------------------------------------------
function updateThemeToggleButton(isDark) {
  const icon = document.getElementById("theme-icon");

  if (icon) {
    if (isDark) {
      icon.textContent = "☀️";
    } else {
      icon.textContent = "🌙";
    }
  }
}

async function toggleTheme() {
  const token = localStorage.getItem("token");
  if (!token) return;

  // Disable all transitions temporarily for instant change
  document.body.classList.add("theme-switching");

  // Toggle between light and cosmic
  const isCurrentlyDark = document.body.classList.contains("theme-cosmic");
  const newTheme = isCurrentlyDark ? "theme-light" : "theme-cosmic";

  try {
    const res = await fetch(`${API_URL}/update-theme`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ theme: newTheme }),
    });

    if (res.ok) {
      // Instant theme change
      document.body.classList.remove("theme-cosmic", "theme-light");
      document.body.classList.add(newTheme);

      updateThemeToggleButton(newTheme === "theme-cosmic");

      if (currentUser) {
        currentUser.theme_preference = newTheme;
      }

      // Re-enable transitions after a brief delay
      setTimeout(() => {
        document.body.classList.remove("theme-switching");
      }, 50);
    } else {
      document.body.classList.remove("theme-switching");
      showToast("Failed to update theme", "error");
    }
  } catch (err) {
    document.body.classList.remove("theme-switching");
    console.error("Theme toggle error:", err);
    showToast("Theme update failed", "error");
  }
}

// -------------------------------------------------------------
// FILES
// -------------------------------------------------------------
function showUploadModal() {
  document.getElementById("upload-modal").classList.remove("hidden");
}
function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

function showConfirm(title, text, icon = "⚠️") {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-text").textContent = text;
    document.getElementById("confirm-icon").textContent = icon;

    const okBtn = document.getElementById("confirm-ok-btn");
    const cancelBtn = document.getElementById("confirm-cancel-btn");

    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      okBtn.removeEventListener("click", handleConfirm);
      cancelBtn.removeEventListener("click", handleCancel);
      closeModal("confirm-modal");
    };

    okBtn.addEventListener("click", handleConfirm);
    cancelBtn.addEventListener("click", handleCancel);

    modal.classList.remove("hidden");
  });
}

// 3. Upload File (Client-Side Encryption)
document.getElementById("upload-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const file = document.getElementById("file-input").files[0];
  if (!file) return;
  const btn = e.target.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.textContent = "Encrypting...";
  btn.disabled = true;

  try {
    const fileKey = await generateFileKey();
    const encryptedFileBuffer = await encryptFile(file, fileKey);

    const masterKey = await getClientMasterKey();
    const metadata = { filename: file.name, size: file.size, type: file.type };
    const { encryptedData: encMeta, iv: metaIv } = await encryptMetadata(
      metadata,
      masterKey
    );
    const { encryptedKey: encKey, iv: keyIv } = await encryptKey(
      fileKey,
      masterKey
    );

    const uploadRes = await fetch(`${API_URL}/upload-url`, {
      method: "POST",
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    const { uploadUrl, fileUuid } = await uploadRes.json();

    await fetch(uploadUrl, {
      method: "PUT",
      body: encryptedFileBuffer,
      headers: { "Content-Type": "application/octet-stream" },
    });

    const fileType = file.name.split(".").pop().toLowerCase();
    const keyStr = bytesToHex(keyIv) + ":" + arrayBufferToBase64(encKey);
    await fetch(`${API_URL}/complete-upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify({
        fileUuid,
        fileType,
        encryptedMetadata: arrayBufferToBase64(encMeta),
        metadataIv: bytesToHex(metaIv),
        encryptedKey: keyStr,
      }),
    });

    showToast("Data Encrypted & Transmitted");
    closeModal("upload-modal");
    loadFiles();
    // Reset form
    document.getElementById("upload-form").reset();
    document.getElementById("file-label").textContent = "No file selected";
  } catch (err) {
    showToast("Upload Failed: " + err.message, "error");
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
});

async function loadFiles() {
  const res = await fetch(`${API_URL}/files`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
  });
  const data = await res.json(); // { myFiles, sharedFiles }

  const myTbody = document.getElementById("file-list-body");
  const sharedTbody = document.getElementById("shared-list-body");
  myTbody.innerHTML = "";
  sharedTbody.innerHTML = "";

  const masterKey = await getClientMasterKey();

  // Sort files by date (newest first)
  data.myFiles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  data.sharedFiles.sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  // My Files
  for (const f of data.myFiles) {
    try {
      // For my files, metadata is encrypted by my Master Key
      const metaIv = hexToBytes(f.iv);
      const meta = await decryptMetadata(
        base64ToArrayBuffer(f.encrypted_metadata),
        masterKey,
        metaIv
      );

      // Safe strings for share/download (which require filename)
      const safeName = meta.filename.replace(/'/g, "\\'");
      const typeExt = meta.filename.split(".").pop().toUpperCase();
      const typeClass = "type-" + typeExt.toLowerCase();

      myTbody.innerHTML += `
                  <tr>
                      <td><span style="font-weight:600; color:var(--text-main);" title="${
                        meta.filename
                      }">${meta.filename}</span></td>
                      <td><span class="type-badge ${typeClass}">${typeExt}</span></td>
                      <td style="color:var(--text-muted);">${formatBytes(meta.size)}</td>
                      <td style="color:var(--text-muted);">${new Date(
                        f.created_at
                      ).toLocaleString()}</td>
                      <td>
                          <div style="display:flex; gap:8px;">
                              <button onclick="viewMyFile(${f.file_id}, '${
        f.encrypted_key
      }', '${safeName}', ${
        meta.size
      }, this)" class="action-glass-btn btn-view" title="View">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                  <span>View</span>
                              </button>
                              <button onclick="downloadFile(${f.file_id}, '${
        f.encrypted_key
      }', 'OWNER', null, '${safeName}')" class="action-glass-btn btn-download" title="Download">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                  <span>Download</span>
                              </button>
                              <button onclick="openShareModal(${
                                f.file_id
                              }, '${safeName}', '${
        f.encrypted_key
      }')" class="action-glass-btn btn-share" title="Share">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                                  <span>Share</span>
                              </button>
                              <button onclick="deleteFile(${
                                f.file_id
                              })" class="action-glass-btn btn-delete" title="Delete">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                  <span>Delete</span>
                              </button>
                          </div>
                      </td>
                  </tr>
              `;
    } catch (e) {
      console.error("Error decrypting my file", e);
      myTbody.innerHTML += `
                  <tr>
                      <td><span style="color:var(--text-muted);">🔒 Decryption Failed (Missing Key?)</span></td>
                      <td style="color:var(--text-muted);">---</td>
                      <td style="color:var(--text-muted);">${new Date(
                        f.created_at
                      ).toLocaleDateString()}</td>
                      <td>
                          <button onclick="showToast('Cannot access file: Master Key mismatch or missing.', 'error')" class="secondary-btn small" title="Missing Key">❓</button>
                          <button onclick="deleteFile(${
                            f.file_id
                          })" class="danger-btn small" title="Delete">🗑</button>
                      </td>
                  </tr>
              `;
    }
  }

  // Shared Files
  for (const f of data.sharedFiles) {
    sharedTbody.innerHTML += `
               <tr>
                   <td><span style="color:var(--text-muted); font-style:italic;">🔒 Locked File</span></td>
                   <td>${new Date(f.created_at).toLocaleString()}</td>
                   <td><span class="status-badge" style="text-transform:none; letter-spacing:0; font-family:monospace; font-size:0.8rem;">${f.sender_email || 'SHARED'}</span></td>
                   <td>
                       <div style="display:flex; gap:8px;">
                           <button onclick="openUnlockModal(${f.file_id}, ${
      f.link_id
    }, '${f.encrypted_key}', '${f.encrypted_metadata}', '${
      f.iv
    }')" class="action-glass-btn btn-unlock" title="Unlock">
                               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
                               <span>Unlock</span>
                           </button>
                           <button onclick="deleteSharedLink(${
                             f.link_id
                           })" class="action-glass-btn btn-delete" title="Remove">
                               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                               <span>Remove</span>
                           </button>
                       </div>
                   </td>
               </tr>
           `;
  }
}

function showConfirm(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    const msg = document.getElementById("confirm-msg");
    msg.textContent = message;

    modal.classList.remove("hidden");

    const okBtn = document.getElementById("confirm-ok-btn");
    const cancelBtn = document.getElementById("confirm-cancel-btn");

    // Clone to strip listeners
    const newOk = okBtn.cloneNode(true);
    const newCancel = cancelBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

    newOk.onclick = () => {
      modal.classList.add("hidden");
      resolve(true);
    };
    newCancel.onclick = () => {
      modal.classList.add("hidden");
      resolve(false);
    };
  });
}

async function deleteSharedLink(linkId, skipConfirm = false) {
  if (!skipConfirm) {
    const confirmed = await showConfirm("Remove this transmission record?");
    if (!confirmed) return;
  }

  try {
    const res = await fetch(`${API_URL}/share/${linkId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (res.ok) {
      showToast("Record Deleted");
      loadFiles();
    } else showToast("Removal failed", "error");
  } catch {
    showToast("Removal failed", "error");
  }
}

async function deleteFile(fileId) {
  const confirmed = await showConfirm(
    "Permanently delete this data? This cannot be undone."
  );
  if (!confirmed) return;
  try {
    const res = await fetch(`${API_URL}/delete-file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify({ fileId }),
    });
    if (res.ok) {
      showToast("Data Deleted");
      loadFiles();
    } else showToast("Delete failed", "error");
  } catch {
    showToast("Delete failed", "error");
  }
}

// -------------------------------------------------------------
// SHARE LOGIC
let currentShareItem = null;
function openShareModal(fileId, filename, encryptedKeyStr) {
  currentShareItem = { fileId, filename, encryptedKeyStr };
  const modal = document.getElementById("share-modal");
  modal.classList.remove("hidden");

  // Reset Steps
  document.getElementById("share-step-input").classList.remove("hidden"); // Show Step 1
  document.getElementById("share-step-result").classList.add("hidden"); // Hide Step 2

  // Set filename for Step 2
  const nameEl = document.getElementById("share-file-name");
  nameEl.textContent = filename;
  nameEl.title = filename; // Tooltip for long names
  document.getElementById("share-email").value = ""; // Clear Previous
}

// ==========================================
// DOWNLOAD & SECURE VIEWER LOGIC
// ==========================================

// Modified Share Logic to include "allowDownload" permission
document.getElementById("share-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  e.stopPropagation(); // Stop bubbling
  const email = document.getElementById("share-email").value;
  const allowDownloadMeta = document.getElementById("share-allow-download");
  const allowDownload = allowDownloadMeta ? allowDownloadMeta.checked : true;

  const btn = document.getElementById("share-btn-submit");
  const originalText = btn.textContent;
  btn.textContent = "Securing...";
  btn.disabled = true;

  try {
    const [ivHex, keyBase64] = currentShareItem.encryptedKeyStr.split(":");
    const masterKey = await getClientMasterKey();
    const fileKey = await decryptKey(
      base64ToArrayBuffer(keyBase64),
      masterKey,
      hexToBytes(ivHex)
    );

    const linkKey = await generateFileKey();
    const { encryptedKey: encKeyLink, iv: lIv } = await encryptKey(
      fileKey,
      linkKey
    );

    const { encryptedData: encMetLink, iv: lmIv } = await encryptMetadata(
      {
        filename: currentShareItem.filename,
        allowDownload: allowDownload,
      },
      linkKey
    );

    const linkKeyRaw = await window.crypto.subtle.exportKey("raw", linkKey);
    const linkKeyHex = bytesToHex(new Uint8Array(linkKeyRaw));
    const encKeyLinkStr =
      bytesToHex(lIv) + ":" + arrayBufferToBase64(encKeyLink);

    const res = await fetch(`${API_URL}/share`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: JSON.stringify({
        fileId: currentShareItem.fileId,
        recipientEmail: email,
        encryptedFileKeyForLink: encKeyLinkStr,
        encryptedMetadataForLink: arrayBufferToBase64(encMetLink),
        metadataIv: bytesToHex(lmIv),
        linkKey: linkKeyHex,
      }),
    });

    if (res.ok) {
      const s = await res.json();
      showToast(s.message || "Secure Channel Established!");
      document.getElementById("generated-share-key").value = linkKeyHex;

      // SWITCH TO RESULT STEP
      document.getElementById("share-step-input").classList.add("hidden");
      document.getElementById("share-step-result").classList.remove("hidden");
    } else {
      const errorData = await res.json();
      showToast(errorData.message || "Share failed", "error");
    }
  } catch (err) {
    showToast("Share Error: " + err.message, "error");
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
});

// Preview Function Removed

function copyShareKey() {
  const k = document.getElementById("generated-share-key");
  k.select();
  k.setSelectionRange(0, 99999); /* For mobile devices */
  navigator.clipboard
    .writeText(k.value)
    .then(() => {
      showToast("Key copied to clipboard");
    })
    .catch(() => {
      // Fallback
      document.execCommand("copy");
      showToast("Key copied to clipboard");
    });
}

function openUnlockModal(
  fileId,
  linkId,
  encryptedKeyStr,
  encryptedMetadataStr,
  metadataIv
) {
  document.getElementById("unlock-modal").classList.remove("hidden");
  document.getElementById("unlock-file-id").value = fileId;
  document.getElementById("unlock-encrypted-key").value = encryptedKeyStr;
  // Store metadata info in data attributes for the submit handler
  document.getElementById("unlock-modal").dataset.encMeta =
    encryptedMetadataStr;
  document.getElementById("unlock-modal").dataset.metaIv = metadataIv;
  document.getElementById("unlock-modal").dataset.linkId = linkId;

  document.getElementById("unlock-key-input").value = "";
  document.getElementById("unlock-key-input").focus();
  
  // RESET WIZARD
  document.getElementById("unlock-step-1").classList.remove("hidden");
  document.getElementById("unlock-step-2").classList.add("hidden");
}

function backToUnlockStep1() {
  document.getElementById("unlock-step-2").classList.add("hidden");
  document.getElementById("unlock-step-1").classList.remove("hidden");
}

// Modified Unlock Logic - Step 1: Decrypt Key Validation
// Store decryption data temporarily for PIN verification
let tempFileAccessData = null;
document.getElementById("unlock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const keyHex = document.getElementById("unlock-key-input").value.trim();
  const encKeyStr = document.getElementById("unlock-encrypted-key").value;
  const fileId = document.getElementById("unlock-file-id").value;
  const encMetaStr = document.getElementById("unlock-modal").dataset.encMeta;
  const metaIvHex = document.getElementById("unlock-modal").dataset.metaIv;
  const linkId = document.getElementById("unlock-modal").dataset.linkId;

  try {
    // 1. Decrypt Link Key & File Key
    const linkKey = await window.crypto.subtle.importKey(
      "raw",
      hexToBytes(keyHex),
      { name: ALGO_NAME },
      false,
      ["unwrapKey", "decrypt"]
    );
    const [ivHex, keyBase64] = encKeyStr.split(":");
    const fileKey = await decryptKey(
      base64ToArrayBuffer(keyBase64),
      linkKey,
      hexToBytes(ivHex)
    );

    // 2. Decrypt Metadata (Check Permissions)
    const metadata = await decryptMetadata(
      base64ToArrayBuffer(encMetaStr),
      linkKey,
      hexToBytes(metaIvHex)
    );

    // Store all data for PIN verification step
    tempFileAccessData = {
      fileKey,
      metadata,
      fileId,
      linkId
    };

    // Transition to Wizard Step 2 (PIN)
    document.getElementById("unlock-step-1").classList.add("hidden");
    document.getElementById("unlock-step-2").classList.remove("hidden");
    
    // Focus PIN input
    const pinInput = document.getElementById("file-pin-input");
    pinInput.value = "";
    setTimeout(() => pinInput.focus(), 100);

  } catch (err) {
    console.error("[Decryption Error Details]", err);
    showToast(`Invalid Decryption Key: ${err.message}`, "error");
  }
});

// Step 2: PIN Verification and File Access
document
  .getElementById("file-pin-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!tempFileAccessData) {
      showToast("Session expired. Please start over.", "error");
      closeModal("unlock-modal"); // Close the main modal
      return;
    }

    const securityPin = document.getElementById("file-pin-input").value.trim();
    const btn = e.target.querySelector('button[type="submit"]');
    // const originalText = btn.innerHTML; // Not used in refined flow

    try {
      btn.disabled = true;
      btn.innerHTML = "Verifying...";

      // Verify PIN with backend
      const res = await fetch(`${API_URL}/verify-file-pin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ securityPin }),
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.message || "Invalid Security PIN", "error");
        btn.disabled = false;
        btn.innerHTML = "Access File"; // Reset text on failure
        return;
      }

      // PIN verified successfully - proceed with file access
      showToast("Identity Verified. Decrypting file...");

      // 3. Fetch Encrypted Blob
      const downloadRes = await fetch(
        `${API_URL}/download-url/${tempFileAccessData.fileId}`,
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );
      const { downloadUrl } = await downloadRes.json();
      const blobRes = await fetch(downloadUrl);
      const encryptedBlob = await blobRes.arrayBuffer();

      // 4. Decrypt Content
      const decryptedBuffer = await decryptFile(
        new Uint8Array(encryptedBlob),
        tempFileAccessData.fileKey
      );

      // 5. Open Secure Viewer
      openSecureViewer(
        decryptedBuffer,
        tempFileAccessData.metadata,
        tempFileAccessData.fileId,
        tempFileAccessData.linkId
      );

      closeModal("unlock-modal"); // Close the single unified modal

      // Clear sensitive data
      tempFileAccessData = null;
      document.getElementById("file-pin-input").value = "";

      // 6. Refresh List (Link is likely burned)
      loadFiles();
    } catch (err) {
      console.error("[PIN Verification Error]", err);
      showToast(`Verification Failed: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

let currentDecryptedBlobUrl = null;

async function openSecureViewer(buffer, metadata, fileId, linkId) {
  const modal = document.getElementById("access-modal");
  const viewer = document.getElementById("access-viewer-body");
  const badges = document.getElementById("access-badges");
  const burnBtn = modal.querySelector(".danger-btn"); // Close & Burn button

  // RESET: Always remove any existing download button from previous sessions
  const existingDlBtn = document.getElementById("access-download-btn");
  if (existingDlBtn) {
    existingDlBtn.remove();
  }

  // Update Close Button Text based on context (Owner vs Visitor)
  if (!linkId) {
    burnBtn.textContent = "Close Viewer";
    burnBtn.className = "secondary-btn"; // Neutral style for simple close
    burnBtn.onclick = () => {
      document.getElementById("access-modal").classList.add("hidden");
      if (currentDecryptedBlobUrl) URL.revokeObjectURL(currentDecryptedBlobUrl);
      document.getElementById("access-viewer-body").innerHTML = "";

      // Reset styling for next time
      setTimeout(() => {
        burnBtn.className = "danger-btn";
      }, 300);
    };
  } else {
    burnBtn.textContent = "Close & Burn";
    burnBtn.className = "danger-btn"; // Red style for destructive action
    burnBtn.onclick = () => closeViewer(linkId);

    // Add Download Button if Allowed (for shared files only)
    if (metadata.allowDownload) {
      const headerActions = modal.querySelector(".danger-btn").parentElement; // Parent of Close button

      // Create new download button
      const dlBtn = document.createElement("button");
      dlBtn.id = "access-download-btn";
      dlBtn.className = "action-glass-btn btn-download";
      dlBtn.style.padding = "0.5rem 1rem";
      dlBtn.style.fontSize = "0.85rem";
      dlBtn.style.minWidth = "auto";
      dlBtn.innerHTML = `
                     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                     <span>Download</span>
                 `;
      dlBtn.style.marginRight = "0.5rem";
      headerActions.insertBefore(dlBtn, burnBtn);

      dlBtn.onclick = () => {
        const a = document.createElement("a");
        a.href = currentDecryptedBlobUrl;
        a.download = metadata.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
    }
  }

  const fnEl = document.getElementById("access-filename");
  fnEl.textContent = metadata.filename;
  fnEl.title = metadata.filename;
  modal.classList.remove("hidden");

  // Reset
  viewer.innerHTML = "";
  badges.innerHTML = "";
  if (currentDecryptedBlobUrl) URL.revokeObjectURL(currentDecryptedBlobUrl);

  // 1. Permission Badge Removed

  // 2. File Type Badge - HIDDEN for minimalist view
  // if (metadata.type) {
  //   badges.innerHTML += `<span style="background:rgba(99, 102, 241, 0.2); color:var(--primary-glow); padding:4px 8px; border-radius:4px; font-size:0.8rem; margin-left:8px;">Type: ${metadata.type}</span>`;
  // }

  // 3. Size Badge - HIDDEN for minimalist view
  // if (metadata.size) {
  //   const sizeStr = formatBytes(metadata.size);
  //   badges.innerHTML += `<span style="background:rgba(255, 255, 255, 0.1); color:var(--text-muted); padding:4px 8px; border-radius:4px; font-size:0.8rem; margin-left:8px;">Size: ${sizeStr}</span>`;
  // }

  // Download Button Logic Removed from Viewer

  // Preview Logic (Based on Extension)
  const ext = metadata.filename.split(".").pop().toLowerCase();

  // LOADING STATE (If buffer is null, we are waiting for data)
  if (!buffer) {
    viewer.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text-muted);">
         <svg class="animate-spin" viewBox="0 0 24 24" style="width:40px;height:40px;fill:none;stroke:currentColor;margin-bottom:1rem;">
           <circle cx="12" cy="12" r="10" stroke-width="3" style="opacity:0.2"></circle>
           <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" style="opacity:0.8"></path>
         </svg>
         <p style="font-size:0.95rem; letter-spacing:0.5px; opacity:0.8;">Loading...</p>
      </div>
    `;
    return;
  }
  const blob = new Blob([buffer], { type: getMimeType(ext) });
  currentDecryptedBlobUrl = URL.createObjectURL(blob);

  if (ext === "zip") {
    viewer.innerHTML = '<div style="color:var(--text-muted); padding:2rem;">Parsing archive...</div>';
    await new Promise(r => setTimeout(r, 50)); // Force paint
    try {
      const zip = await JSZip.loadAsync(buffer);
      let fileList = "";
      let count = 0;
      
      zip.forEach((relativePath, zipEntry) => {
        if (count++ > 150) return; // Limit items
        const isDir = zipEntry.dir;
        const icon = isDir ? "📁" : "📄";
        const color = isDir ? "var(--primary-glow)" : "var(--text-main)";
        const size = isDir ? "" : (zipEntry._data.uncompressedSize / 1024).toFixed(1) + " KB";
        
        fileList += `
          <li style="
            padding: 8px 12px;
            border-bottom: 1px solid var(--glass-border);
            display: flex;
            align-items: center;
            gap: 12px;
            color: ${color};
            font-size: 0.9rem;
          ">
            <span>${icon}</span>
            <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:monospace;">${relativePath}</span>
            <span style="font-size:0.8rem; opacity:0.6;">${size}</span>
          </li>
        `;
      });

      if (count === 0) fileList = '<div style="padding:1rem; opacity:0.7">Empty Archive</div>';
      else fileList = `<ul style="list-style:none; padding:0; width:100%; max-width:800px; text-align:left;">${fileList}</ul>`;

      viewer.innerHTML = `
        <div style="overflow:auto; width:100%; height:100%; padding:2rem; display:flex; flex-direction:column; align-items:center;">
          <h3 style="margin-bottom:1rem; color:var(--text-main);">Archive Contents</h3>
          ${fileList}
          ${count > 150 ? '<p style="opacity:0.5; font-size:0.8rem;">(Showing first 150 items)</p>' : ''}
        </div>
      `;
    } catch (e) {
      console.error(e);
      viewer.innerHTML = `<div style="color:#ef4444; padding:2rem;">Failed to read ZIP structure.<br><small>${e.message}</small></div>`;
    }
  } else if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
    viewer.innerHTML = `<img src="${currentDecryptedBlobUrl}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:8px;">`;
  } else if (ext === "pdf") {
    // Embed PDF (Disable toolbar if possible via #toolbar=0)
    viewer.innerHTML = `<iframe src="${currentDecryptedBlobUrl}#toolbar=0" style="width:100%; height:100%; border:none;"></iframe>`;
  } else if (
    [
      "txt",
      "md",
      "json",
      "js",
      "css",
      "html",
      "java",
      "py",
      "c",
      "cpp",
      "h",
      "cs",
      "go",
      "rs",
      "php",
      "rb",
      "swift",
      "kt",
      "ts",
      "tsx",
      "jsx",
      "sql",
      "sh",
      "yaml",
      "yml",
      "xml",
      "env",
      "gitignore",
    ].includes(ext)
  ) {
    // Text preview
    const reader = new FileReader();
    reader.onload = (e) => {
      viewer.innerHTML = `<pre style="color:white; overflow:auto; padding:1rem; white-space:pre-wrap; width:100%; height:100%; text-align:left; font-family: 'Consolas', 'Monaco', monospace; font-size:0.9rem; line-height:1.5;">${e.target.result.replace(
        /</g,
        "&lt;"
      )}</pre>`;
    };
    reader.readAsText(blob);
  } else if (ext === "docx") {
    // Word Preview (Mammoth) - Async
    viewer.innerHTML = '<div style="color:var(--text-muted); padding:2rem;">Parsing document...</div>';
    // Yield to UI thread to show loading message
    await new Promise(r => setTimeout(r, 50)); 
    
    if (window.mammoth) {
      mammoth
        .convertToHtml({ arrayBuffer: buffer })
        .then((result) => {
          viewer.innerHTML = `<div style="background:white; color:black; padding:2rem; overflow:auto; height:100%; border-radius:4px;">${result.value}</div>`;
        })
        .catch((err) => {
          viewer.innerHTML = `<div style="color:var(--danger); text-align:center;">Failed to render Word document: ${err.message}</div>`;
        });
    } else {
      viewer.innerHTML = `<div style="text-align:center; padding:2rem;">Word viewer (Mammoth) not loaded. Please download.</div>`;
    }
  } else if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    // Excel Preview (SheetJS)
    viewer.innerHTML = '<div style="color:var(--text-muted); padding:2rem;">Parsing spreadsheet...</div>';
    // Yield to UI thread
    await new Promise(r => setTimeout(r, 50));

    if (window.XLSX) {
      try {
        const wb = XLSX.read(buffer, { 
            type: "array",
            dense: true,       // Performance optimization
            bookVBA: false,    // Skip VBA
            cellStyles: false, // Skip styles (faster)
            cellFormula: false // Skip formulas
        });
        const ws = wb.Sheets[wb.SheetNames[0]]; // First sheet
        const html = XLSX.utils.sheet_to_html(ws);
        viewer.innerHTML = `<div style="background:white; color:black; padding:1rem; overflow:auto; height:100%; border-radius:4px;">${html}</div>`;
      } catch (err) {
        viewer.innerHTML = `<div style="color:var(--danger); text-align:center;">Failed to render Excel sheet: ${err.message}</div>`;
      }
    } else {
      viewer.innerHTML = `<div style="text-align:center; padding:2rem;">Excel viewer (SheetJS) not loaded. Please download.</div>`;
    }
  } else {
    viewer.innerHTML = `
            <div style="text-align:center;">
                <div style="font-size:3rem; margin-bottom:1rem;">📦</div>
                <p>Preview not available for .${ext} files.</p>
            </div>`;
  }
}

async function closeViewer(linkId) {
  document.getElementById("access-modal").classList.add("hidden");
  if (currentDecryptedBlobUrl) URL.revokeObjectURL(currentDecryptedBlobUrl);
  document.getElementById("access-viewer-body").innerHTML = ""; // Clear sensitve data

  // Burn the link on close!
  if (linkId) {
    await deleteSharedLink(linkId, true); // True to skip confirm
  }
}

function getMimeType(ext) {
  const map = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    txt: "text/plain",
    html: "text/html",
  };
  return map[ext] || "application/octet-stream";
}



// Helper to update loading text in an open viewer
function updateViewerStatus(text) {
  const el = document.querySelector("#access-viewer-body p");
  if (el) el.textContent = text;
}

// NEW: View My File Logic (Optimized for Parallel Execution)
async function viewMyFile(fileId, encryptedKeyStr, filename, size, btnRef) {
  const btn = btnRef || event.target.closest("button");
  const originalContent = btn.innerHTML; // Save HTML
  
  // 1. Button Feedback Only (No Modal yet)
  btn.innerHTML = `<svg class="animate-spin" viewBox="0 0 24 24" style="width:18px;height:18px;fill:none;stroke:currentColor;"><circle cx="12" cy="12" r="10" stroke-width="4" style="opacity:0.3"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" style="opacity:0.75"></path></svg><span>...</span>`;
  btn.disabled = true;

  const metadata = {
    filename: filename,
    size: size,
    allowDownload: true, 
    type: filename.split(".").pop().toUpperCase(),
  };

  try {
    const [ivHex, keyBase64] = encryptedKeyStr.split(":");
    
    // 2. PARALLEL: Start Key Decryption AND File Download simultaneously
    const keyPromise = (async () => {
        const masterKey = await getClientMasterKey();
        return await decryptKey(
          base64ToArrayBuffer(keyBase64),
          masterKey,
          hexToBytes(ivHex)
        );
    })();

    const downloadPromise = (async () => {
        const res = await fetch(`${API_URL}/download-url/${fileId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });
        const { downloadUrl } = await res.json();
        // Fetch Blob (High Priority)
        const blobRes = await fetch(downloadUrl, { priority: 'high' });
        return await blobRes.arrayBuffer();
    })();

    // 3. AWAIT BOTH
    const [fileKey, encryptedBlob] = await Promise.all([keyPromise, downloadPromise]);
    
    // 4. Decrypt Content
    const decryptedBuffer = await decryptFile(
      new Uint8Array(encryptedBlob),
      fileKey
    );

    // 5. Render - Modal opens ONLY now, with content ready
    openSecureViewer(decryptedBuffer, metadata, fileId, null);
    
  } catch (err) {
    console.error(err);
    showToast("View Error: " + err.message, "error");
  } finally {
    btn.innerHTML = originalContent;
    btn.disabled = false;
  }
}

// Keep Download Logic for "My Files" (Owner always has access)
async function downloadFile(
  fileId,
  encryptedKeyStr,
  role,
  providedFileKey = null,
  originalFilename = "decrypted_file"
) {
  // Show confirmation popup with truncated name for long files
  const displayName = originalFilename.length > 25 
    ? originalFilename.substring(0, 12) + "..." + originalFilename.substring(originalFilename.length - 8)
    : originalFilename;
  const confirmed = await showConfirm(`Download "${displayName}"?`);
  if (!confirmed) return;

  // ... (Existing Logic for Owners) ...
  try {
    const res = await fetch(`${API_URL}/download-url/${fileId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    const { downloadUrl } = await res.json();
    const blobRes = await fetch(downloadUrl);
    const encryptedBlob = await blobRes.arrayBuffer();

    let fileKey = providedFileKey;
    if (!fileKey) {
      const [ivHex, keyBase64] = encryptedKeyStr.split(":");
      const masterKey = await getClientMasterKey();
      fileKey = await decryptKey(
        base64ToArrayBuffer(keyBase64),
        masterKey,
        hexToBytes(ivHex)
      );
    }

    const decryptedBuffer = await decryptFile(
      new Uint8Array(encryptedBlob),
      fileKey
    );

    const blob = new Blob([decryptedBuffer]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = originalFilename;
    a.click();
    showToast("Data Decrypted & Downloaded");
  } catch (e) {
    showToast("Download Error: " + e.message, "error");
  }
}

// ==========================================
// INIT APP
// ==========================================
(async function initAuth() {
  const token = localStorage.getItem("token");

  if (token) {
    // User is logged in - show dashboard instantly
    try {
      await loadProfile();

      // Check for saved view state (default to dashboard)
      const lastView = localStorage.getItem("current_view");
      if (lastView === "profile") {
        showProfile();
      } else {
        showDashboard();
      }
    } catch (e) {
      console.error("Session verification failed", e);
      // Show auth screen on failure
      document.getElementById("auth-section").classList.remove("hidden");
    }
  } else {
    // No token - show auth screen instantly
    document.getElementById("auth-section").classList.remove("hidden");
  }
})();

// ==========================================
// ADMIN LOGIN WITH 2FA OTP
// ==========================================
let adminEmail = null; // Store email for OTP verification
let otpMode = false; // Track if we're in OTP verification mode

// ==========================================
// PREMIUM 6-BOX OTP INPUT HANDLER
// ==========================================
// ==========================================
// SCOPED OTP INPUT HANDLER (Replaces Global)
// ==========================================
function setupOTP(containerId, submitCallback) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const otpBoxes = container.querySelectorAll(".otp-box");

  otpBoxes.forEach((box, index) => {
    // Clear old listeners if possible (cloning) to prevent stacking
    // simplier approach: assume setupOTP is called once per show, or manage idempotency.
    // We'll use a simple attribute to check if initialized if needed,
    // but standard addEventListener stacks. ideally we clone node.
    // For now, we'll accept stacking if rarely called, or rely on clean DOM.
    // Better: Clone text node? No.
    // Let's Just add listeners.

    box.oninput = (e) => {
      const value = e.target.value;
      if (!/^\d*$/.test(value)) {
        e.target.value = "";
        return;
      }

      if (value.length === 1 && index < otpBoxes.length - 1) {
        otpBoxes[index + 1].focus();
      }

      // Auto-Submit
      const allFilled = Array.from(otpBoxes).every((b) => b.value.length === 1);
      if (allFilled && submitCallback) {
        setTimeout(submitCallback, 50);
      }
    };

    box.onkeydown = (e) => {
      if (e.key === "Backspace" && !e.target.value && index > 0) {
        otpBoxes[index - 1].focus();
        otpBoxes[index - 1].value = "";
      }
      if (e.key === "ArrowLeft" && index > 0) otpBoxes[index - 1].focus();
      if (e.key === "ArrowRight" && index < otpBoxes.length - 1)
        otpBoxes[index + 1].focus();

      // ENTER KEY SUPPORT
      if (e.key === "Enter") {
        e.preventDefault();
        if (submitCallback) submitCallback();
      }
    };

    box.onpaste = (e) => {
      e.preventDefault();
      const data = e.clipboardData.getData("text").trim();
      if (/^\d{6}$/.test(data)) {
        data.split("").forEach((d, i) => {
          if (otpBoxes[i]) otpBoxes[i].value = d;
        });
        otpBoxes[otpBoxes.length - 1].focus();
        if (submitCallback) setTimeout(submitCallback, 50);
      }
    };
  });
}

function getScopedOTP(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return "";
  const otpBoxes = container.querySelectorAll(".otp-box");
  return Array.from(otpBoxes)
    .map((b) => b.value)
    .join("");
}

function clearScopedOTP(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const otpBoxes = container.querySelectorAll(".otp-box");
  otpBoxes.forEach((b) => (b.value = ""));
  if (otpBoxes.length > 0) otpBoxes[0].focus();
}

// ==========================================
// OTP MODAL CONTROL (Legacy/User?)
// ==========================================
function showOTPModal(email) {
  const modal = document.getElementById("otp-modal");
  document.getElementById("otp-modal-email").textContent = email;
  modal.classList.remove("hidden");

  // Setup User Modal OTP
  setupOTP("otp-modal", verifyOTP);

  setTimeout(() => {
    const b = modal.querySelector(".otp-box");
    if (b) b.focus();
  }, 100);
}

function closeOTPModal() {
  document.getElementById("otp-modal").classList.add("hidden");
  clearScopedOTP("otp-modal");
  // Reset Admin Form elements if shared (Admin uses inline now, so this might be redundant but safe)
  document.getElementById("admin-username").disabled = false;
  document.getElementById("admin-password").disabled = false;
  document.getElementById("admin-submit-btn").disabled = false;
  document.getElementById("admin-submit-btn").textContent = "Access Dashboard";
  adminEmail = null;
}

async function verifyOTP() {
  const otpInput = getScopedOTP("otp-modal");
  const submitBtn = document.getElementById("otp-verify-btn");
  const originalText = submitBtn.textContent;

  if (!otpInput || otpInput.length !== 6) {
    showToast("Please enter all 6 digits", "error");
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Verifying...";
    const res = await fetch(`${API_URL}/admin/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, otp: otpInput }),
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem("adminToken", data.token);
      localStorage.setItem("adminName", data.admin.username);
      showToast("✅ Login successful!", "success");
      closeOTPModal();
      setTimeout(() => (window.location.href = "admin.html"), 500);
    } else {
      showToast(data.message || "Invalid OTP", "error");
      clearScopedOTP("otp-modal");
    }
  } catch (err) {
    showToast("Connection error", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}

async function resendOTP() {
  // Legacy mapping
  resendAdminOTP();
}

// ==========================================
// ADMIN LOGIN Handlers (Inline)
// ==========================================
// (Already updated above) document.getElementById("admin-form-step1").addEventListener...

async function verifyAdminOTP() {
  const otpInput = getScopedOTP("admin-form-step2");
  const submitBtn = document.getElementById("admin-otp-verify-btn");
  const originalText = submitBtn.textContent;

  if (!otpInput || otpInput.length !== 6) {
    showToast("Enter 6 digits", "error");
    return; // Don't clear boxes so user can correct
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Verifying...";

    // Add Timeout for OTP verify too
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`${API_URL}/admin/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, otp: otpInput }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await res.json();

    if (res.ok) {
      localStorage.setItem("adminToken", data.token);
      localStorage.setItem("adminName", data.admin.username);
      // Reset section specific for fresh login
      localStorage.removeItem("adminActiveSection");
      showToast("✅ Success!", "success");
      window.location.href = "admin.html";
    } else {
      showToast(data.message || "Invalid OTP", "error");
      clearScopedOTP("admin-form-step2");
    }
  } catch (err) {
    console.error("OTP Error:", err);
    showToast("Connection error", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}

async function resendOTP() {
  // Legacy mapping
  resendAdminOTP();
}

// ==========================================
// ADMIN LOGIN Handlers (Inline)
// ==========================================
document
  .getElementById("admin-form-step1")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("admin-username").value;
    const password = document.getElementById("admin-password").value;
    const submitBtn = document.getElementById("admin-submit-btn");
    const originalText = submitBtn.innerHTML || "Access Dashboard";

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = "Verifying...";

      // Safety Timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(`${API_URL}/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Explicitly check for non-JSON responses (500/404 HTML pages)
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server Error: Invalid Response Format");
      }

      const data = await res.json();

      if (res.ok && data.requiresOTP) {
        adminEmail = data.email;

        document.getElementById("admin-form-step1").classList.add("hidden");
        document.getElementById("admin-form-step2").classList.remove("hidden");
        document.getElementById("admin-otp-email").textContent =
          data.maskedEmail || data.email;

        // SETUP SCOPED OTP
        setupOTP("admin-form-step2", verifyAdminOTP);

        const firstBox = document.querySelector("#admin-form-step2 .otp-box");
        if (firstBox) requestAnimationFrame(() => firstBox.focus());
        showToast(`OTP sent`, "success");

        // Note: We don't reset button here because we are changing the view
      } else if (res.ok) {
        localStorage.setItem("adminToken", data.token);
        localStorage.setItem("adminName", data.admin.username);
        // Reset section specific for fresh login
        localStorage.removeItem("adminActiveSection");
        window.location.href = "admin.html";
      } else {
        showToast(data.message || "Invalid credentials", "error");
      }
    } catch (err) {
      console.error("Admin Login Error:", err);
      showToast(
        err.name === "AbortError" ? "Login Timeout" : "Connection error",
        "error"
      );
    } finally {
      // Always reset button state
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }
  });

async function verifyAdminOTP() {
  const otpInput = getScopedOTP("admin-form-step2");
  const submitBtn = document.getElementById("admin-otp-verify-btn");

  if (!otpInput || otpInput.length !== 6) {
    showToast("Enter 6 digits", "error");
    return; // Don't clear boxes so user can correct
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Verifying...";

    const res = await fetch(`${API_URL}/admin/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, otp: otpInput }),
    });
    const data = await res.json();

    if (res.ok) {
      localStorage.setItem("adminToken", data.token);
      localStorage.setItem("adminName", data.admin.username);
      // Reset section specific for fresh login
      localStorage.removeItem("adminActiveSection");
      showToast("✅ Success!", "success");
      window.location.href = "admin.html";
    } else {
      showToast(data.message || "Invalid OTP", "error");
      clearScopedOTP("admin-form-step2");
      submitBtn.disabled = false;
      submitBtn.textContent = "Verify OTP";
    }
  } catch (err) {
    showToast("Connection error", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Verify OTP";
  }
}

// Back to login (from OTP step)
function backToAdminLogin() {
  // Hide Step 2, Show Step 1
  document.getElementById("admin-form-step2").classList.add("hidden");
  document.getElementById("admin-form-step1").classList.remove("hidden");

  // Reset form
  document.getElementById("admin-submit-btn").disabled = false;
  document.getElementById("admin-submit-btn").textContent = "Access Dashboard";

  // Clear OTP boxes
  clearOTPBoxes();

  // Clear stored data
  adminEmail = null;

  // Focus username
  document.getElementById("admin-username").focus();
}

// Resend OTP
async function resendAdminOTP() {
  if (!adminEmail) {
    showToast("Session expired. Please login again.", "error");
    backToAdminLogin();
    return;
  }

  showToast("Sending new OTP...", "success");

  const username = document.getElementById("admin-username").value;
  const password = document.getElementById("admin-password").value;

  try {
    const res = await fetch(`${API_URL}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (res.ok && data.requiresOTP) {
      showToast("📧 New OTP sent!", "success");
      clearOTPBoxes();
    } else {
      showToast("Failed to resend OTP", "error");
    }
  } catch (err) {
    showToast("Connection error", "error");
  }
}

// ==========================================
// ADMIN FORGOT PASSWORD FLOW
// ==========================================
window.showAdminForgot = function () {
  // Attach to window to ensure HTML access
  document.getElementById("admin-form-step1").classList.add("hidden");
  document.getElementById("admin-form-step2").classList.add("hidden");
  document.getElementById("admin-reset-flow").classList.remove("hidden");
  document.getElementById("admin-reset-step1").classList.remove("hidden");
  document.getElementById("admin-reset-step2").classList.add("hidden");
  document.getElementById("admin-reset-step3").classList.add("hidden");

  // Initialize OTP Inputs
  const inputs = document.querySelectorAll(".admin-reset-digit");
  const hiddenInput = document.getElementById("admin-reset-otp");

  inputs.forEach((input, index) => {
    // Clear value on init
    input.value = "";

    input.addEventListener("input", (e) => {
      // Allow only numbers
      e.target.value = e.target.value.replace(/[^0-9]/g, "");

      if (e.target.value) {
        // Move to next
        if (index < inputs.length - 1) {
          inputs[index + 1].focus();
        }
      } else {
        // If deleted, stay or move back? Standard is stay, backspace handled below
      }

      // Consolidate value
      updateHiddenOTP();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !e.target.value) {
        if (index > 0) {
          inputs[index - 1].focus();
        }
      }
      if (e.key === "Enter") {
        e.preventDefault();
        verifyAdminResetOTP();
      }
    });

    // Handle Paste
    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const pasteData = e.clipboardData
        .getData("text")
        .replace(/[^0-9]/g, "")
        .slice(0, 6);
      if (pasteData) {
        pasteData.split("").forEach((char, i) => {
          if (inputs[i]) inputs[i].value = char;
        });
        updateHiddenOTP();
        // Focus the next empty or the last one
        const lastIndex = Math.min(pasteData.length, 5);
        inputs[lastIndex].focus();
      }
    });
  });

  function updateHiddenOTP() {
    let otp = "";
    inputs.forEach((i) => (otp += i.value));
    if (hiddenInput) hiddenInput.value = otp;
  }
};

window.requestAdminResetOTP = async function () {
  const username = document.getElementById("admin-reset-username").value.trim();
  if (!username) return showToast("Please enter username", "error");

  const btn = event.target; // Simple capture or get by ID
  const originalText = btn.textContent;
  btn.textContent = "Sending...";
  btn.disabled = true;

  try {
    const res = await fetch(`${API_URL}/admin/forgot-password/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();

    if (res.ok) {
      showToast("Recovery OTP Sent");
      document.getElementById("admin-reset-step1").classList.add("hidden");
      document.getElementById("admin-reset-step2").classList.remove("hidden");
    } else {
      showToast(data.message || "Failed to send OTP", "error");
    }
  } catch (err) {
    showToast("Connection Error", "error");
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
};

window.verifyAdminResetOTP = async function () {
  const username = document.getElementById("admin-reset-username").value.trim();
  const otp = document.getElementById("admin-reset-otp").value.trim();
  if (!otp) return showToast("Enter OTP", "error");

  try {
    const res = await fetch(`${API_URL}/admin/forgot-password/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, otp }),
    });
    const data = await res.json();

    if (res.ok) {
      showToast("Identity Verified");
      document.getElementById("admin-reset-step2").classList.add("hidden");
      document.getElementById("admin-reset-step3").classList.remove("hidden");
    } else {
      showToast(data.message || "Invalid OTP", "error");
    }
  } catch (err) {
    showToast("Verification Error", "error");
  }
};

window.updateAdminPassword = async function () {
  const username = document.getElementById("admin-reset-username").value.trim();
  const otp = document.getElementById("admin-reset-otp").value.trim();
  const newPass = document.getElementById("admin-reset-new-pass").value;
  const confirmPass = document.getElementById("admin-reset-confirm-pass").value;

  if (!newPass || !confirmPass) return showToast("Enter new password", "error");
  if (newPass !== confirmPass)
    return showToast("Passwords do not match", "error");

  try {
    const res = await fetch(`${API_URL}/admin/forgot-password/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, otp, newPassword: newPass }),
    });
    const data = await res.json();

    if (res.ok) {
      showToast("Password Updated Successfully");
      window.backToAdminLogin();
    } else {
      showToast(data.message || "Update Failed", "error");
    }
  } catch (err) {
    showToast("Update Error", "error");
  }
};

window.backToAdminLogin = function () {
  // Hide all admin sub-flows
  document.getElementById("admin-form-step2").classList.add("hidden");
  document.getElementById("admin-reset-flow").classList.add("hidden");

  // Show main login
  document.getElementById("admin-form-step1").classList.remove("hidden");

  // Clear Reset Inputs
  document.getElementById("admin-reset-username").value = "";
  document.getElementById("admin-reset-otp").value = "";
  document.getElementById("admin-reset-new-pass").value = "";
  document.getElementById("admin-reset-confirm-pass").value = "";
};

// ==========================================
// UX IMPROVEMENTS (ENTER KEY SUPPORT)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  // 1. Admin Login OTP Inputs (Step 2)
  const adminOtpInputs = document.querySelectorAll(
    "#admin-form-step2 .otp-box"
  );
  adminOtpInputs.forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        verifyAdminOTP();
      }
    });
  });

  // 2. Admin Forgot Password - Username Step
  const resetUser = document.getElementById("admin-reset-username");
  if (resetUser) {
    resetUser.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        requestAdminResetOTP();
      }
    });
  }

  // 3. Admin Forgot Password - New Password Step
  const passInputs = ["admin-reset-new-pass", "admin-reset-confirm-pass"];
  passInputs.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          updateAdminPassword();
        }
      });
    }
  });
});
