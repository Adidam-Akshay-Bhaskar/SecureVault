# 👤 User Guide - SecureVault

This guide provides step-by-step instructions for end-users to effectively use SecureVault for secure file storage and sharing.

---

## 📋 Table of Contents

1. [Getting Started](#getting-started)
2. [Registration & Login](#registration--login)
3. [Uploading Files](#uploading-files)
4. [Downloading Files](#downloading-files)
5. [Sharing Files](#sharing-files)
6. [Managing Files](#managing-files)
7. [Profile Settings](#profile-settings)
8. [Troubleshooting](#troubleshooting)

---

## 1. Getting Started

### System Requirements

**Browser Compatibility:**

- ✅ Google Chrome 90+ (Recommended)
- ✅ Mozilla Firefox 88+
- ✅ Microsoft Edge 90+
- ✅ Safari 14+

**Internet Connection:**

- Stable internet connection required
- Minimum 1 Mbps for file uploads

**JavaScript:**

- Must be enabled in browser

### Accessing SecureVault

1. Open your web browser
2. Navigate to: `http://localhost:3000` (or your deployment URL)
3. You'll see the SecureVault landing page

---

## 2. Registration & Login

### 2.1 Creating a New Account

**Step 1: Navigate to Registration**

1. Click the **"Register"** tab on the landing page
2. You'll see the registration form

**Step 2: Fill Registration Form**

![Registration Form](https://via.placeholder.com/600x400?text=Registration+Form)

Enter the following information:

- **Codename** (Username): Your display name
  - Example: `john_doe`
- **Access Email**: Your email address
  - Example: `john@example.com`
- **Passcode** (Password): Strong password
  - Minimum 8 characters
  - Mix of letters, numbers, and symbols
  - Example: `SecurePass123!`
- **Security PIN**: 4 or 6 digit PIN
  - Example: `123456`
  - ⚠️ **IMPORTANT**: Save this PIN securely! It's required for password recovery and cannot be reset.

**Step 3: Submit Registration**

1. Click **"Get Started"** button
2. Wait for confirmation message
3. You'll see: "User registered successfully"

**Step 4: Login**

1. Click the **"Login"** tab
2. Enter your email and password
3. Click **"Access Dashboard"**

---

### 2.2 Logging In

**Standard Login:**

1. **Enter Credentials**

   - Email: Your registered email
   - Password: Your password

2. **Security PIN Verification** (if enabled)

   - After entering credentials, you'll be prompted for your Security PIN
   - Enter your 4 or 6 digit PIN
   - Click **"Unseal"**

3. **Access Dashboard**
   - Upon successful login, you'll be redirected to your dashboard

**Login Tips:**

- ✅ Email is case-insensitive
- ✅ Password is case-sensitive
- ✅ Use "Remember Me" for trusted devices
- ⚠️ Never share your credentials

---

### 2.3 Password Recovery

**If you forget your password:**

1. **Click "Forgot Password?"** on login page

2. **Verify Identity**

   - Enter your registered email
   - Enter your Security PIN
   - Click **"Verify Identity"**

3. **Set New Password**

   - Enter new password
   - Confirm new password
   - Click **"Update"**

4. **Login with New Password**

⚠️ **Note**: You MUST know your Security PIN to reset your password. If you forget your PIN, account recovery is not possible.

---

## 3. Uploading Files

### 3.1 Upload Process

**Step 1: Access Upload**

1. Login to your dashboard
2. Click the **"Upload"** button or drag-and-drop area

**Step 2: Select File**

1. Click **"Choose File"** or drag file into upload zone
2. Supported file types:
   - Documents: PDF, DOC, DOCX, TXT
   - Images: JPG, PNG, GIF, SVG
   - Videos: MP4, AVI, MOV
   - Archives: ZIP, RAR, 7Z
   - Others: Any file type

**Step 3: Configure Upload**

1. **Allow Data Extraction** toggle:
   - ✅ ON: File metadata visible (filename, size, type)
   - ❌ OFF: Metadata encrypted (maximum privacy)

**Step 4: Upload**

1. Click **"Upload File"** button
2. Wait for encryption process (automatic)
3. File is uploaded to cloud
4. You'll see: "Upload completed successfully"

**Upload Progress:**

```
┌─────────────────────────────────────┐
│ Encrypting file...        [████░░] │
│ Generating keys...        [██████] │
│ Uploading to cloud...     [███░░░] │
│ Finalizing...             [░░░░░░] │
└─────────────────────────────────────┘
```

---

### 3.2 What Happens During Upload?

**Behind the Scenes:**

1. **Client-Side Encryption**

   - Your browser generates a random AES-256 encryption key
   - File is encrypted on YOUR device
   - Encrypted file is uploaded to AWS S3

2. **Key Management**

   - Encryption key is wrapped with your master key
   - Wrapped key is stored in database
   - Original key never leaves your browser

3. **Metadata Protection**
   - Filename, size, and type are encrypted
   - Server only sees encrypted data

**Security Guarantee:**

- ✅ File is encrypted BEFORE upload
- ✅ Server never sees plaintext
- ✅ Even admins cannot decrypt your files

---

## 4. Downloading Files

### 4.1 Download Your Files

**Step 1: View Files**

1. Navigate to **"My Files"** section
2. You'll see list of your uploaded files

**Step 2: Select File**

1. Click on the file you want to download
2. Or click the **download icon** next to the file

**Step 3: Download**

1. Click **"Download"** button
2. File is automatically:
   - Downloaded from cloud
   - Decrypted in your browser
   - Saved to your device

**Download Process:**

```
┌─────────────────────────────────────┐
│ Fetching from cloud...    [████░░] │
│ Decrypting file...        [███░░░] │
│ Preparing download...     [██████] │
└─────────────────────────────────────┘
```

---

### 4.2 Download Shared Files

**If someone shared a file with you:**

1. **Check Email**

   - You'll receive an email with a secure link
   - Link format: `http://localhost:3000/?token=xxx&key=yyy`

2. **Click Link**

   - Opens SecureVault in your browser
   - Automatically verifies the link

3. **Download File**
   - File is automatically decrypted
   - Saved to your device

⚠️ **One-Time Use**: Share links can only be used ONCE. After downloading, the link is permanently invalidated.

---

## 5. Sharing Files

### 5.1 Share with Another User

**Step 1: Select File**

1. Go to **"My Files"**
2. Click the **share icon** next to the file you want to share

**Step 2: Enter Recipient**

1. Enter recipient's email address
2. ⚠️ **Important**: Recipient must be registered on SecureVault

**Step 3: Generate Share Link**

1. Click **"Share"** button
2. System generates a secure one-time link
3. Link is automatically emailed to recipient

**Step 4: Confirmation**

- You'll see: "Secure link generated"
- Recipient receives email with download link

---

### 5.2 Share Link Details

**What the recipient receives:**

```
Subject: Secure File Share from SecureVault

Hello,

A file has been securely shared with you!

Click the link below to download:
http://localhost:3000/?token=abc123&key=xyz789

⚠️ This link can only be used ONCE and expires in 24 hours.

---
SecureVault - Your Files, Safely Shared
```

**Security Features:**

- ✅ One-time use only (burn-after-read)
- ✅ Expires in 24 hours
- ✅ Encrypted with unique share key
- ✅ Recipient must be registered user

---

### 5.3 Viewing Shared Files

**Files shared WITH you:**

1. Navigate to **"Shared With Me"** section
2. You'll see files others have shared with you
3. Click to download (same process as your files)

**Managing Shared Files:**

- You can delete shared files from your view
- This doesn't delete the original file
- Owner retains full control

---

## 6. Managing Files

### 6.1 View File Details

**File Information:**

- **Filename**: Original name (if metadata not encrypted)
- **Size**: File size in KB/MB/GB
- **Type**: File MIME type
- **Uploaded**: Date and time of upload
- **Status**: Active, Shared, Deleted

**View Details:**

1. Click on a file in your list
2. Details panel appears on the right
3. Shows encryption status and share history

---

### 6.2 Delete Files

**Deleting Your Files:**

1. **Select File**

   - Click the **delete icon** next to the file

2. **Confirm Deletion**

   - Confirmation dialog appears
   - Click **"Confirm"** to proceed

3. **File Deleted**
   - File is soft-deleted (marked as deleted)
   - Removed from your file list
   - Can be permanently deleted by admin

⚠️ **Note**: Deleting a file also invalidates all share links for that file.

---

### 6.3 Search and Filter

**Search Files:**

1. Use the search bar at the top
2. Search by filename (if metadata not encrypted)
3. Results appear in real-time

**Filter Options:**

- **All Files**: Show all your files
- **Recent**: Files uploaded in last 7 days
- **Shared**: Files you've shared with others
- **Type**: Filter by file type (PDF, Images, etc.)

---

## 7. Profile Settings

### 7.1 Update Profile Photo

**Change Your Avatar:**

1. Click your **profile icon** in top-right
2. Select **"Profile Settings"**
3. Click **"Change Photo"**
4. Upload new image (JPG, PNG)
5. Image is automatically resized and saved

---

### 7.2 Change Password

**Update Your Password:**

1. Go to **Profile Settings**
2. Click **"Change Password"**
3. Enter:
   - Current password
   - New password
   - Confirm new password
4. Click **"Update Password"**
5. You'll see: "Security protocol updated"

**Password Requirements:**

- Minimum 8 characters
- Mix of uppercase and lowercase
- Include numbers and symbols
- Different from old password

---

### 7.3 Theme Customization

**Change UI Theme:**

1. Click **theme icon** in header
2. Choose from available themes:

   - 🌞 **Light Mode**: Clean, bright interface
   - 🌙 **Dark Mode**: Easy on the eyes
   - 🌌 **Cosmic**: Purple gradient theme
   - 🌊 **Ocean**: Blue aquatic theme
   - 🌅 **Sunset**: Warm orange theme

3. Theme is automatically saved
4. Applied across all sessions

---

## 8. Troubleshooting

### 8.1 Common Issues

**Problem: "Upload Failed"**

**Solutions:**

- ✅ Check internet connection
- ✅ Verify file size (max 50MB recommended)
- ✅ Try different browser
- ✅ Clear browser cache
- ✅ Disable browser extensions

---

**Problem: "Cannot Download File"**

**Solutions:**

- ✅ Check if file still exists
- ✅ Verify you have access permission
- ✅ Check browser's download settings
- ✅ Disable popup blocker
- ✅ Try incognito mode

---

**Problem: "Share Link Not Working"**

**Possible Reasons:**

- ❌ Link already used (one-time only)
- ❌ Link expired (24 hour limit)
- ❌ Recipient not registered
- ❌ File was deleted by owner

**Solution:**

- Ask owner to generate new share link

---

**Problem: "Forgot Security PIN"**

**Unfortunately:**

- ❌ Security PIN cannot be recovered
- ❌ Account cannot be accessed without PIN
- ❌ No backdoor or master key exists

**Prevention:**

- ✅ Write down PIN in secure location
- ✅ Use password manager
- ✅ Store in encrypted note

---

### 8.2 Browser Issues

**Clear Browser Cache:**

**Chrome:**

1. Press `Ctrl + Shift + Delete`
2. Select "Cached images and files"
3. Click "Clear data"

**Firefox:**

1. Press `Ctrl + Shift + Delete`
2. Select "Cache"
3. Click "Clear Now"

**Edge:**

1. Press `Ctrl + Shift + Delete`
2. Select "Cached data and files"
3. Click "Clear"

---

### 8.3 Performance Tips

**For Faster Uploads:**

- ✅ Use wired internet connection
- ✅ Close unnecessary browser tabs
- ✅ Upload during off-peak hours
- ✅ Compress large files before upload

**For Better Experience:**

- ✅ Use latest browser version
- ✅ Enable hardware acceleration
- ✅ Disable unnecessary extensions
- ✅ Use recommended browsers (Chrome, Firefox)

---

## 🎯 Quick Reference

### Keyboard Shortcuts

| Shortcut   | Action             |
| ---------- | ------------------ |
| `Ctrl + U` | Open upload dialog |
| `Ctrl + F` | Focus search bar   |
| `Ctrl + T` | Toggle theme       |
| `Esc`      | Close modal/dialog |

### File Size Limits

| File Type | Max Size |
| --------- | -------- |
| Documents | 50 MB    |
| Images    | 25 MB    |
| Videos    | 100 MB   |
| Archives  | 100 MB   |

### Support

**Need Help?**

- 📧 Email: support@securevault.com
- 📚 Documentation: [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md)
- 🐛 Report Issues: [KNOWN_ISSUES.md](KNOWN_ISSUES.md)

---

**Enjoy secure file sharing with SecureVault! 🔐**
