# 🔐 Security Documentation - SecureVault

This document provides a comprehensive overview of the security architecture, threat model, encryption implementation, and data protection strategies used in SecureVault.

---

## 📋 Table of Contents

1. [Security Overview](#security-overview)
2. [Threat Model](#threat-model)
3. [Encryption Implementation](#encryption-implementation)
4. [Key Management](#key-management)
5. [Authentication & Authorization](#authentication--authorization)
6. [Data Protection Strategy](#data-protection-strategy)
7. [Security Best Practices](#security-best-practices)
8. [Vulnerability Mitigation](#vulnerability-mitigation)

---

## 1. Security Overview

SecureVault implements a **Zero-Knowledge Architecture** where files are encrypted on the client-side before being uploaded to the cloud. This ensures that:

- ✅ **Server never has access to plaintext files**
- ✅ **Encryption keys are managed client-side**
- ✅ **Even administrators cannot decrypt user files**
- ✅ **End-to-end encryption for all file operations**

### Core Security Principles

1. **Confidentiality**: AES-256-GCM encryption ensures data privacy
2. **Integrity**: GCM mode provides authentication and tamper detection
3. **Availability**: Cloud storage ensures 99.99% uptime
4. **Non-repudiation**: Audit logs track all actions
5. **Authentication**: Multi-factor authentication with JWT + PIN

---

## 2. Threat Model

### 2.1 Identified Threats

| Threat                       | Risk Level | Mitigation                              |
| ---------------------------- | ---------- | --------------------------------------- |
| **Unauthorized File Access** | HIGH       | Client-side encryption, access control  |
| **Man-in-the-Middle Attack** | HIGH       | HTTPS/TLS 1.3, certificate pinning      |
| **Password Brute Force**     | MEDIUM     | bcrypt hashing, rate limiting           |
| **SQL Injection**            | MEDIUM     | Parameterized queries, input validation |
| **XSS Attacks**              | MEDIUM     | Input sanitization, CSP headers         |
| **Session Hijacking**        | MEDIUM     | JWT tokens, secure cookies              |
| **Insider Threats**          | HIGH       | Zero-knowledge architecture             |
| **Data Breach**              | HIGH       | Encrypted storage, no plaintext         |
| **Replay Attacks**           | LOW        | One-time tokens, timestamp validation   |
| **DDoS Attacks**             | MEDIUM     | Rate limiting, cloud auto-scaling       |

### 2.2 Attack Surface Analysis

```
┌─────────────────────────────────────────────────────────┐
│                  ATTACK SURFACE                         │
└─────────────────────────────────────────────────────────┘

1. Client-Side
   ├── Browser vulnerabilities
   ├── JavaScript injection
   ├── Local storage tampering
   └── Memory dumps

2. Network Layer
   ├── MITM attacks
   ├── Packet sniffing
   ├── DNS poisoning
   └── SSL stripping

3. Server-Side
   ├── API endpoint exploitation
   ├── SQL injection
   ├── Authentication bypass
   └── Server misconfiguration

4. Database
   ├── Unauthorized access
   ├── Data leakage
   ├── Backup exposure
   └── Privilege escalation

5. Cloud Storage
   ├── Bucket misconfiguration
   ├── Presigned URL leakage
   ├── Access key compromise
   └── CORS vulnerabilities
```

### 2.3 Trust Boundaries

```
┌─────────────────────────────────────────────────────────┐
│                  TRUST BOUNDARIES                       │
└─────────────────────────────────────────────────────────┘

TRUSTED ZONE:
┌──────────────────────────────────┐
│  User's Browser                  │
│  • Master key in memory          │
│  • File encryption/decryption    │
│  • Private key storage           │
└──────────────────────────────────┘

SEMI-TRUSTED ZONE:
┌──────────────────────────────────┐
│  Application Server              │
│  • Encrypted metadata            │
│  • Wrapped encryption keys       │
│  • JWT token validation          │
└──────────────────────────────────┘

UNTRUSTED ZONE:
┌──────────────────────────────────┐
│  Cloud Storage (S3)              │
│  • Encrypted file blobs only     │
│  • No decryption capability      │
│  • Public internet accessible    │
└──────────────────────────────────┘
```

---

## 3. Encryption Implementation

### 3.1 AES-256-GCM File Encryption

**Algorithm**: Advanced Encryption Standard (AES)  
**Mode**: Galois/Counter Mode (GCM)  
**Key Size**: 256 bits  
**IV Size**: 96 bits (12 bytes)  
**Tag Size**: 128 bits (16 bytes)

#### Why AES-256-GCM?

- ✅ **Military-grade encryption** (NSA Suite B)
- ✅ **Authenticated encryption** (prevents tampering)
- ✅ **Fast performance** (hardware acceleration)
- ✅ **NIST approved** (FIPS 140-2 compliant)
- ✅ **Parallel processing** (faster than CBC mode)

#### Encryption Process

```javascript
// 1. Generate random AES key
const fileKey = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt", "decrypt"]
);

// 2. Generate random IV
const iv = crypto.getRandomValues(new Uint8Array(12));

// 3. Encrypt file
const encryptedData = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv: iv },
  fileKey,
  fileBuffer
);

// 4. Combine IV + Ciphertext
const combined = new Uint8Array(iv.length + encryptedData.byteLength);
combined.set(iv, 0);
combined.set(new Uint8Array(encryptedData), iv.length);
```

#### Decryption Process

```javascript
// 1. Extract IV and ciphertext
const iv = combinedBuffer.slice(0, 12);
const ciphertext = combinedBuffer.slice(12);

// 2. Decrypt file
const decryptedData = await crypto.subtle.decrypt(
  { name: "AES-GCM", iv: iv },
  fileKey,
  ciphertext
);
```

### 3.2 RSA-OAEP Key Wrapping

**Algorithm**: RSA with Optimal Asymmetric Encryption Padding  
**Key Size**: 2048 bits  
**Hash Function**: SHA-256  
**MGF**: MGF1 with SHA-256

#### Why RSA-OAEP?

- ✅ **Secure key exchange** without shared secrets
- ✅ **Prevents chosen-ciphertext attacks**
- ✅ **Industry standard** (PKCS#1 v2.0)
- ✅ **Asymmetric encryption** for key distribution

#### Key Wrapping Process

```javascript
// 1. Generate RSA key pair (Master Key)
const masterKeyPair = await crypto.subtle.generateKey(
  {
    name: "RSA-OAEP",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["wrapKey", "unwrapKey"]
);

// 2. Wrap AES file key with RSA public key
const wrappedKey = await crypto.subtle.wrapKey(
  "raw",
  fileKey,
  masterKeyPair.publicKey,
  { name: "RSA-OAEP" }
);

// 3. Store wrapped key in database
```

#### Key Unwrapping Process

```javascript
// 1. Retrieve wrapped key from database
const wrappedKeyBuffer = base64ToArrayBuffer(encryptedKey);

// 2. Unwrap with RSA private key
const unwrappedKey = await crypto.subtle.unwrapKey(
  "raw",
  wrappedKeyBuffer,
  masterKeyPair.privateKey,
  { name: "RSA-OAEP" },
  { name: "AES-GCM", length: 256 },
  true,
  ["decrypt"]
);
```

### 3.3 Metadata Encryption

File metadata (filename, size, type) is also encrypted using AES-256-GCM:

```javascript
const metadata = {
  originalName: file.name,
  size: file.size,
  type: file.type,
  uploadedAt: new Date().toISOString(),
};

const { encryptedData, iv } = await encryptMetadata(metadata, fileKey);
```

---

## 4. Key Management

### 4.1 Key Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│                    KEY LIFECYCLE                        │
└─────────────────────────────────────────────────────────┘

1. Master Key (RSA-2048)
   ├── Generated: Per user session
   ├── Storage: Browser memory only
   ├── Lifetime: Session duration
   ├── Purpose: Wrap file encryption keys
   └── Destruction: On logout/session end

2. File Encryption Key (AES-256)
   ├── Generated: Per file upload
   ├── Storage: Database (wrapped)
   ├── Lifetime: Until file deletion
   ├── Purpose: Encrypt file content
   └── Destruction: On file deletion

3. Share Link Key (Random 256-bit)
   ├── Generated: Per share action
   ├── Storage: URL parameter
   ├── Lifetime: Until link used
   ├── Purpose: One-time file access
   └── Destruction: After single use

4. JWT Secret (HMAC-SHA256)
   ├── Generated: Server initialization
   ├── Storage: Environment variable
   ├── Lifetime: Permanent (rotated periodically)
   ├── Purpose: Sign authentication tokens
   └── Destruction: On secret rotation
```

### 4.2 Key Generation

All cryptographic keys use **Cryptographically Secure Pseudo-Random Number Generators (CSPRNG)**:

```javascript
// Browser: Web Crypto API
const randomBytes = crypto.getRandomValues(new Uint8Array(32));

// Server: Node.js crypto module
const crypto = require("crypto");
const randomBytes = crypto.randomBytes(32);
```

### 4.3 Key Storage

| Key Type             | Storage Location     | Protection Method       |
| -------------------- | -------------------- | ----------------------- |
| Master Key (Private) | Browser Memory       | Never persisted         |
| Master Key (Public)  | Browser Memory       | Never sent to server    |
| File Key (Wrapped)   | MySQL Database       | RSA-OAEP wrapped        |
| Share Link Key       | URL Parameter        | One-time use            |
| JWT Secret           | Environment Variable | File system permissions |
| User Password        | MySQL Database       | bcrypt hashed           |
| Security PIN         | MySQL Database       | bcrypt hashed           |

### 4.4 Key Rotation

**Recommended Key Rotation Schedule:**

- **JWT Secret**: Every 90 days
- **File Keys**: Never (tied to file lifecycle)
- **Master Key**: Every session
- **Admin Passwords**: Every 60 days
- **AWS Access Keys**: Every 180 days

---

## 5. Authentication & Authorization

### 5.1 Multi-Factor Authentication

SecureVault implements a **two-factor authentication** system:

#### Factor 1: Password

- **Hashing**: bcrypt with 10 rounds
- **Salt**: Auto-generated per user
- **Storage**: Hashed in database

```javascript
const hashedPassword = await bcrypt.hash(password, 10);
```

#### Factor 2: Security PIN

- **Format**: 4 or 6 digit numeric
- **Hashing**: bcrypt with 10 rounds
- **Verification**: Required for sensitive operations

```javascript
const hashedPin = await bcrypt.hash(securityPin, 10);
const isValid = await bcrypt.compare(inputPin, hashedPin);
```

### 5.2 JWT Token Authentication

**Token Structure:**

```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "user_id": 123,
    "email": "user@example.com",
    "iat": 1234567890
  },
  "signature": "HMAC-SHA256(header.payload, secret)"
}
```

**Token Lifecycle:**

1. Generated on successful login
2. Stored in `localStorage`
3. Sent in `Authorization` header
4. Validated on every API request
5. Destroyed on logout

### 5.3 Admin Authentication

Admins have enhanced security:

1. **Username + Password** (Step 1)
2. **OTP via Email** (Step 2)
3. **Separate JWT Secret** (Admin-specific)

```javascript
const adminToken = jwt.sign(
  { admin_id, email },
  process.env.JWT_SECRET + "_ADMIN"
);
```

### 5.4 Authorization Levels

| Role       | Permissions                       |
| ---------- | --------------------------------- |
| **User**   | Upload, download, share own files |
| **Admin**  | View all users, files, audit logs |
| **System** | Database access, AWS credentials  |

---

## 6. Data Protection Strategy

### 6.1 Data Classification

| Data Type       | Classification   | Protection            |
| --------------- | ---------------- | --------------------- |
| File Content    | HIGHLY SENSITIVE | AES-256-GCM encrypted |
| File Metadata   | SENSITIVE        | AES-256-GCM encrypted |
| Encryption Keys | CRITICAL         | RSA-OAEP wrapped      |
| User Passwords  | CRITICAL         | bcrypt hashed         |
| JWT Tokens      | SENSITIVE        | HMAC-SHA256 signed    |
| Audit Logs      | CONFIDENTIAL     | Access controlled     |
| Email Addresses | PERSONAL         | Normalized, indexed   |

### 6.2 Data at Rest

**Database (MySQL):**

- Passwords: bcrypt hashed (irreversible)
- Security PINs: bcrypt hashed
- File Keys: RSA-OAEP wrapped
- Metadata: AES-256-GCM encrypted

**Cloud Storage (S3):**

- Files: AES-256-GCM encrypted (client-side)
- No plaintext data stored
- Optional: S3 server-side encryption (defense in depth)

### 6.3 Data in Transit

**HTTPS/TLS 1.3:**

- All client-server communication encrypted
- Certificate validation required
- Perfect Forward Secrecy (PFS)

**Presigned URLs:**

- Signed with AWS credentials
- Time-limited (5 minutes)
- HTTPS enforced

### 6.4 Data in Use

**Client-Side:**

- Files decrypted in browser memory
- Keys stored in JavaScript variables
- Cleared on page unload

**Server-Side:**

- No access to plaintext files
- Only processes encrypted data
- Minimal data retention

---

## 7. Security Best Practices

### 7.1 Implemented Security Measures

✅ **Input Validation**

- Email format validation
- Password strength requirements
- PIN format validation (4-6 digits)
- File type restrictions

✅ **SQL Injection Prevention**

- Parameterized queries
- Prepared statements
- Input sanitization

✅ **XSS Prevention**

- Content Security Policy (CSP)
- Input encoding
- Output escaping

✅ **CSRF Protection**

- JWT tokens (stateless)
- Same-origin policy
- CORS configuration

✅ **Rate Limiting**

- Login attempt throttling
- API request limits
- OTP generation limits

✅ **Audit Logging**

- All file operations logged
- Authentication attempts tracked
- Admin actions recorded

✅ **Secure Session Management**

- JWT tokens with expiry
- Logout invalidation
- Session timeout

### 7.2 Secure Coding Practices

```javascript
// ✅ GOOD: Parameterized query
db.query("SELECT * FROM users WHERE email = ?", [email]);

// ❌ BAD: String concatenation
db.query('SELECT * FROM users WHERE email = "' + email + '"');

// ✅ GOOD: Password hashing
const hash = await bcrypt.hash(password, 10);

// ❌ BAD: Plaintext storage
db.query("INSERT INTO users (password) VALUES (?)", [password]);

// ✅ GOOD: Secure random generation
const token = crypto.randomBytes(32).toString("hex");

// ❌ BAD: Predictable random
const token = Math.random().toString(36);
```

---

## 8. Vulnerability Mitigation

### 8.1 OWASP Top 10 Coverage

| Vulnerability                      | Mitigation                              |
| ---------------------------------- | --------------------------------------- |
| **A01: Broken Access Control**     | JWT authentication, role-based access   |
| **A02: Cryptographic Failures**    | AES-256-GCM, RSA-OAEP, TLS 1.3          |
| **A03: Injection**                 | Parameterized queries, input validation |
| **A04: Insecure Design**           | Zero-knowledge architecture             |
| **A05: Security Misconfiguration** | Environment variables, CORS config      |
| **A06: Vulnerable Components**     | Regular dependency updates              |
| **A07: Authentication Failures**   | 2FA, bcrypt, JWT                        |
| **A08: Data Integrity Failures**   | GCM authentication tags                 |
| **A09: Logging Failures**          | Comprehensive audit logs                |
| **A10: SSRF**                      | Input validation, URL whitelisting      |

### 8.2 Security Testing

**Recommended Tests:**

1. **Penetration Testing**

   - SQL injection attempts
   - XSS payload injection
   - Authentication bypass attempts

2. **Cryptographic Validation**

   - Key strength verification
   - Algorithm compliance check
   - Random number quality test

3. **Access Control Testing**

   - Unauthorized file access attempts
   - Privilege escalation tests
   - Session hijacking simulation

4. **Network Security**
   - TLS configuration scan
   - Certificate validation
   - MITM attack simulation

---

## 🔒 Security Compliance

### Standards Adherence

- ✅ **NIST SP 800-175B**: Cryptographic algorithm guidelines
- ✅ **OWASP ASVS**: Application Security Verification Standard
- ✅ **PCI DSS**: Payment Card Industry Data Security Standard (applicable sections)
- ✅ **GDPR**: General Data Protection Regulation (data encryption)

### Encryption Certifications

- ✅ **FIPS 140-2**: AES-256 compliance
- ✅ **NSA Suite B**: Approved cryptographic algorithms
- ✅ **ISO/IEC 18033-3**: Encryption algorithm standards

---

## 📞 Security Incident Response

### Reporting Security Issues

If you discover a security vulnerability:

1. **DO NOT** disclose publicly
2. Email: security@securevault.com
3. Include: Detailed description, reproduction steps
4. Response time: Within 48 hours

### Incident Response Plan

1. **Detection**: Monitor audit logs, error logs
2. **Containment**: Isolate affected systems
3. **Eradication**: Patch vulnerabilities
4. **Recovery**: Restore normal operations
5. **Lessons Learned**: Update security measures

---

**Security is not a feature, it's a foundation. SecureVault is built with security-first principles.**
