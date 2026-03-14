# ⚠️ Known Issues - SecureVault

This document lists current limitations, known bugs, and workarounds for SecureVault.

---

## 📋 Table of Contents

1. [Current Limitations](#current-limitations)
2. [Known Bugs](#known-bugs)
3. [Workarounds](#workarounds)
4. [Browser Compatibility](#browser-compatibility)
5. [Performance Issues](#performance-issues)
6. [Planned Fixes](#planned-fixes)

---

## 1. Current Limitations

### 1.1 File Size Restrictions

**Issue**: Large file uploads may timeout or fail

**Details:**

- Maximum recommended file size: **50 MB**
- Files larger than 100 MB may cause browser memory issues
- Very large files (>500 MB) will likely fail

**Impact**: Medium  
**Severity**: ⚠️ Warning

**Reason:**

- Client-side encryption loads entire file into memory
- Browser memory limitations
- S3 presigned URL timeout (5 minutes)

**Planned Fix**: Version 1.1.0

- Implement chunked upload
- Stream encryption for large files
- Extended presigned URL expiry

---

### 1.2 Browser Storage Limitations

**Issue**: Master key stored in browser memory only

**Details:**

- Master key is lost on page refresh
- Files cannot be decrypted after browser restart
- User must re-login to regenerate master key

**Impact**: High  
**Severity**: ⚠️ Warning

**Reason:**

- Security design (zero-knowledge architecture)
- Master key never sent to server
- Cannot be recovered if lost

**Workaround:**

- Keep browser tab open during file operations
- Download files immediately after upload
- Use "Remember Me" feature (if implemented)

**Not a Bug**: This is intentional for security

---

### 1.3 Security PIN Recovery

**Issue**: Security PIN cannot be recovered if forgotten

**Details:**

- No backdoor or master key exists
- Admin cannot reset user's PIN
- Account becomes inaccessible

**Impact**: Critical  
**Severity**: 🔴 Critical

**Reason:**

- Zero-knowledge architecture
- PIN is hashed (irreversible)
- No recovery mechanism by design

**Workaround:**

- **PREVENTION ONLY**:
  - Write down PIN in secure location
  - Use password manager
  - Store in encrypted note

**Not a Bug**: This is intentional for security

---

### 1.4 Concurrent Upload Limit

**Issue**: Only one file can be uploaded at a time

**Details:**

- Multiple simultaneous uploads may fail
- Upload queue not implemented
- Browser may freeze with multiple uploads

**Impact**: Low  
**Severity**: ℹ️ Info

**Workaround:**

- Upload files one at a time
- Wait for each upload to complete

**Planned Fix**: Version 1.1.0

- Implement upload queue
- Support concurrent uploads

---

### 1.5 Mobile Browser Limitations

**Issue**: Limited functionality on mobile browsers

**Details:**

- File picker may not work on some mobile browsers
- Large file uploads fail on mobile
- UI may not be fully responsive

**Impact**: Medium  
**Severity**: ⚠️ Warning

**Affected Browsers:**

- Safari iOS (file picker issues)
- Chrome Android (memory limitations)
- Firefox Android (upload timeouts)

**Workaround:**

- Use desktop browser for large files
- Use mobile app (when available)

**Planned Fix**: Version 1.2.0

- Dedicated mobile app
- Improved mobile web support

---

## 2. Known Bugs

### 2.1 Theme Switching Delay

**Issue**: Theme change has visible delay/flash

**Details:**

- Brief white flash when switching themes
- Transition not smooth on some browsers
- CSS variables update delay

**Impact**: Low  
**Severity**: ℹ️ Info

**Steps to Reproduce:**

1. Login to dashboard
2. Click theme switcher
3. Observe brief flash

**Workaround:**

- None (cosmetic issue)

**Status**: Investigating  
**Planned Fix**: Version 1.0.1

---

### 2.2 Share Link Email Delay

**Issue**: Share link emails may be delayed or not sent

**Details:**

- Email delivery depends on Gmail SMTP
- May be marked as spam
- Delivery can take 1-5 minutes

**Impact**: Medium  
**Severity**: ⚠️ Warning

**Workaround:**

- Check spam folder
- Check server console for OTP (development)
- Manually copy share link from database

**Status**: Known limitation  
**Planned Fix**: Version 1.1.0

- Implement email queue
- Add alternative notification methods

---

### 2.3 Admin OTP Console Logging

**Issue**: OTP codes printed to console (development mode)

**Details:**

- OTP codes visible in server logs
- Security risk in production
- Should be disabled in production

**Impact**: High (in production)  
**Severity**: 🔴 Critical (if deployed)

**Workaround:**

- Remove console.log statements before production
- Use environment variable to control logging

**Status**: By design (development feature)  
**Fix**: Remove before production deployment

---

### 2.4 File Metadata Visibility

**Issue**: File metadata visible even when "Allow Data Extraction" is OFF

**Details:**

- Metadata encryption not fully implemented
- Filename, size, type may be visible to admin
- Contradicts zero-knowledge promise

**Impact**: Medium  
**Severity**: ⚠️ Warning

**Status**: Partial implementation  
**Planned Fix**: Version 1.0.1

- Fully encrypt metadata
- Hide from admin panel

---

### 2.5 Session Timeout

**Issue**: No automatic session timeout

**Details:**

- JWT tokens don't expire
- User remains logged in indefinitely
- Security risk for shared computers

**Impact**: Medium  
**Severity**: ⚠️ Warning

**Workaround:**

- Manually logout after use
- Clear browser storage

**Planned Fix**: Version 1.0.1

- Implement token expiry
- Add session timeout (30 minutes)
- Auto-logout on inactivity

---

## 3. Workarounds

### 3.1 Upload Fails with Large Files

**Problem**: File upload fails or times out

**Solutions:**

1. **Compress the file**

   - Use ZIP, RAR, or 7Z compression
   - Reduce file size before upload

2. **Split large files**

   - Use file splitter tool
   - Upload parts separately
   - Combine after download

3. **Use different browser**

   - Chrome: Best performance
   - Firefox: Good alternative
   - Edge: Acceptable

4. **Increase browser memory**
   - Close other tabs
   - Restart browser
   - Clear cache

---

### 3.2 Cannot Download File

**Problem**: Download fails or file is corrupted

**Solutions:**

1. **Check file still exists**

   - Verify in file list
   - Check not deleted by owner

2. **Clear browser cache**

   - Press Ctrl+Shift+Delete
   - Clear cached files
   - Refresh page

3. **Try different browser**

   - Use Chrome or Firefox
   - Disable extensions
   - Try incognito mode

4. **Check internet connection**
   - Verify stable connection
   - Try wired connection
   - Disable VPN

---

### 3.3 Share Link Not Working

**Problem**: Recipient cannot access shared file

**Solutions:**

1. **Verify link not used**

   - Links are one-time use only
   - Generate new link if needed

2. **Check link not expired**

   - Links expire after 24 hours
   - Generate new link

3. **Verify recipient registered**

   - Recipient must have account
   - Ask them to register first

4. **Check file not deleted**
   - Verify file still exists
   - Owner may have deleted file

---

### 3.4 Admin Cannot Login

**Problem**: Admin OTP not received or invalid

**Solutions:**

1. **Check email spam folder**

   - OTP may be marked as spam
   - Add sender to whitelist

2. **Check server console**

   - OTP printed to console (development)
   - Look for "ADMIN OTP VERIFICATION CODE"

3. **Wait and retry**

   - OTP may be delayed
   - Wait 2-3 minutes
   - Request new OTP

4. **Verify email configuration**
   - Check .env file
   - Verify Gmail app password
   - Test SMTP connection

---

## 4. Browser Compatibility

### 4.1 Fully Supported

✅ **Google Chrome 90+**

- All features work
- Best performance
- Recommended browser

✅ **Mozilla Firefox 88+**

- All features work
- Good performance
- Good alternative

✅ **Microsoft Edge 90+**

- All features work
- Good performance
- Chromium-based

---

### 4.2 Partially Supported

⚠️ **Safari 14+**

- Most features work
- File picker issues on iOS
- Slower encryption performance

⚠️ **Opera 76+**

- Most features work
- Some UI glitches
- Not extensively tested

---

### 4.3 Not Supported

❌ **Internet Explorer**

- Not supported
- Missing Web Crypto API
- Use Edge instead

❌ **Old Browsers**

- Chrome < 90
- Firefox < 88
- Safari < 14

---

## 5. Performance Issues

### 5.1 Slow Encryption

**Issue**: Large files take long to encrypt

**Details:**

- 10 MB file: ~5 seconds
- 50 MB file: ~20 seconds
- 100 MB file: ~45 seconds

**Impact**: Medium  
**Severity**: ℹ️ Info

**Workaround:**

- Be patient
- Use smaller files
- Compress before upload

**Planned Fix**: Version 1.1.0

- Web Workers for background encryption
- Progress indicator improvements

---

### 5.2 High Memory Usage

**Issue**: Browser uses excessive memory during file operations

**Details:**

- File loaded entirely into memory
- Memory = 2-3x file size
- May crash on low-end devices

**Impact**: Medium  
**Severity**: ⚠️ Warning

**Workaround:**

- Close other tabs
- Use desktop with more RAM
- Upload smaller files

**Planned Fix**: Version 1.1.0

- Stream processing
- Chunked encryption

---

### 5.3 Slow Page Load

**Issue**: Dashboard takes time to load with many files

**Details:**

- All files loaded at once
- No pagination
- Slow with 100+ files

**Impact**: Low  
**Severity**: ℹ️ Info

**Workaround:**

- Delete old files
- Use search/filter

**Planned Fix**: Version 1.0.1

- Implement pagination
- Lazy loading
- Virtual scrolling

---

## 6. Planned Fixes

### Version 1.0.1 (Next Patch)

- [ ] Fix theme switching flash
- [ ] Implement JWT token expiry
- [ ] Add session timeout
- [ ] Improve metadata encryption
- [ ] Add pagination to file list

### Version 1.1.0 (Next Minor)

- [ ] Chunked file upload
- [ ] Upload queue
- [ ] Web Workers for encryption
- [ ] Email queue system
- [ ] File versioning

### Version 1.2.0 (Future)

- [ ] Mobile app
- [ ] Desktop app
- [ ] Improved mobile web support
- [ ] Offline mode
- [ ] PWA support

---

## 📞 Reporting Issues

**Found a new bug?**

1. **Check if already reported** in this document
2. **Gather information**:

   - Browser and version
   - Operating system
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots (if applicable)

3. **Report via**:

   - Email: bugs@securevault.com
   - GitHub Issues: [github.com/yourusername/securevault/issues](https://github.com/yourusername/securevault/issues)

4. **Include**:
   - Detailed description
   - Reproduction steps
   - System information
   - Error messages (if any)

---

## 🔄 Issue Status Legend

- ✅ **Fixed**: Issue resolved in latest version
- 🔧 **In Progress**: Currently being worked on
- 📋 **Planned**: Scheduled for future version
- ⏸️ **On Hold**: Postponed
- ❌ **Won't Fix**: By design or not feasible
- ℹ️ **Info**: Not a bug, informational

---

**Last Updated**: 2026-01-12  
**Version**: 1.0.0

---

**Despite these known issues, SecureVault remains secure and functional for its intended use case. We're actively working on improvements!**
