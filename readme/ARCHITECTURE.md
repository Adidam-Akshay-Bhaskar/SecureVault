# 🏗️ System Architecture - SecureVault

This document provides a comprehensive overview of the SecureVault system architecture, including module interactions, data flow, and encryption mechanisms.

---

## 📋 Table of Contents

1. [Overall System Architecture](#overall-system-architecture)
2. [Component Architecture](#component-architecture)
3. [Module Interactions](#module-interactions)
4. [Data Flow](#data-flow)
5. [Encryption Flow](#encryption-flow)
6. [Database Architecture](#database-architecture)
7. [Cloud Architecture](#cloud-architecture)

---

## 1. Overall System Architecture

SecureVault follows a **three-tier architecture** with client-side encryption:

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT TIER                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   HTML/CSS   │  │  JavaScript  │  │  Web Crypto  │      │
│  │  (Frontend)  │  │   (Logic)    │  │     API      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                  │             │
│         └──────────────────┴──────────────────┘             │
│                           │                                 │
│                    HTTPS (TLS 1.3)                         │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────┐
│                    APPLICATION TIER                         │
│                           │                                 │
│  ┌────────────────────────▼──────────────────────────┐     │
│  │           Node.js + Express.js Server             │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │     │
│  │  │   Auth   │  │   File   │  │    Admin     │    │     │
│  │  │  Module  │  │  Module  │  │   Module     │    │     │
│  │  └──────────┘  └──────────┘  └──────────────┘    │     │
│  └────────────────────────┬──────────────────────────┘     │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
┌───────▼──────────────┐            ┌──────────▼──────────┐
│    DATA TIER         │            │   STORAGE TIER      │
│                      │            │                     │
│  ┌────────────────┐  │            │  ┌──────────────┐  │
│  │  MySQL         │  │            │  │   AWS S3     │  │
│  │  Database      │  │            │  │   Bucket     │  │
│  │                │  │            │  │              │  │
│  │ • Users        │  │            │  │ • Encrypted  │  │
│  │ • Files Meta   │  │            │  │   Files      │  │
│  │ • Keys         │  │            │  │ • Blobs      │  │
│  │ • Audit Logs   │  │            │  │              │  │
│  └────────────────┘  │            │  └──────────────┘  │
└──────────────────────┘            └─────────────────────┘
```

---

## 2. Component Architecture

### 2.1 Frontend Components

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND LAYER                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────┐      │
│  │         Presentation Layer (HTML/CSS)        │      │
│  │  • Landing Page                              │      │
│  │  • Authentication Forms                      │      │
│  │  • Dashboard UI                              │      │
│  │  • Admin Panel                               │      │
│  └──────────────────┬───────────────────────────┘      │
│                     │                                   │
│  ┌──────────────────▼───────────────────────────┐      │
│  │         Application Logic (JavaScript)       │      │
│  │  • Event Handlers                            │      │
│  │  • API Communication                         │      │
│  │  • State Management                          │      │
│  │  • Theme Management                          │      │
│  └──────────────────┬───────────────────────────┘      │
│                     │                                   │
│  ┌──────────────────▼───────────────────────────┐      │
│  │         Cryptography Layer                   │      │
│  │  • AES-256-GCM Encryption                    │      │
│  │  • RSA-OAEP Key Wrapping                     │      │
│  │  • Key Generation                            │      │
│  │  • File Encryption/Decryption                │      │
│  └──────────────────────────────────────────────┘      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Backend Components

```
┌─────────────────────────────────────────────────────────┐
│                    BACKEND LAYER                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────┐      │
│  │         API Gateway (Express.js)             │      │
│  │  • Route Handling                            │      │
│  │  • CORS Management                           │      │
│  │  • Request Validation                        │      │
│  └──────────────────┬───────────────────────────┘      │
│                     │                                   │
│  ┌──────────────────▼───────────────────────────┐      │
│  │         Authentication Module                │      │
│  │  • JWT Token Generation                      │      │
│  │  • Password Hashing (bcrypt)                 │      │
│  │  • Security PIN Verification                 │      │
│  │  • Session Management                        │      │
│  └──────────────────┬───────────────────────────┘      │
│                     │                                   │
│  ┌──────────────────▼───────────────────────────┐      │
│  │         File Management Module               │      │
│  │  • Presigned URL Generation                  │      │
│  │  • Metadata Storage                          │      │
│  │  • File Key Management                       │      │
│  │  • Share Link Generation                     │      │
│  └──────────────────┬───────────────────────────┘      │
│                     │                                   │
│  ┌──────────────────▼───────────────────────────┐      │
│  │         Admin Module                         │      │
│  │  • User Management                           │      │
│  │  • System Monitoring                         │      │
│  │  • Audit Log Tracking                        │      │
│  │  • OTP Email Service                         │      │
│  └──────────────────┬───────────────────────────┘      │
│                     │                                   │
│  ┌──────────────────▼───────────────────────────┐      │
│  │         Database Layer (MySQL)               │      │
│  │  • Connection Pool                           │      │
│  │  • Query Execution                           │      │
│  │  • Transaction Management                    │      │
│  └──────────────────┬───────────────────────────┘      │
│                     │                                   │
│  ┌──────────────────▼───────────────────────────┐      │
│  │         Cloud Storage Layer (AWS SDK)        │      │
│  │  • S3 Client Configuration                   │      │
│  │  • Presigned URL Generation                  │      │
│  │  • CORS Configuration                        │      │
│  └──────────────────────────────────────────────┘      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Module Interactions

### 3.1 User Registration Flow

```
┌──────────┐         ┌──────────┐         ┌──────────┐
│  Client  │         │  Server  │         │ Database │
└────┬─────┘         └────┬─────┘         └────┬─────┘
     │                    │                     │
     │ 1. Register Form   │                     │
     ├───────────────────►│                     │
     │                    │                     │
     │                    │ 2. Hash Password    │
     │                    │    (bcrypt)         │
     │                    │                     │
     │                    │ 3. Hash PIN         │
     │                    │                     │
     │                    │ 4. Insert User      │
     │                    ├────────────────────►│
     │                    │                     │
     │                    │ 5. User Created     │
     │                    │◄────────────────────┤
     │                    │                     │
     │ 6. Success         │                     │
     │◄───────────────────┤                     │
     │                    │                     │
```

### 3.2 File Upload Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Client  │    │  Server  │    │ Database │    │   AWS S3 │
└────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │               │
     │ 1. Select File│               │               │
     │               │               │               │
     │ 2. Generate   │               │               │
     │    AES Key    │               │               │
     │               │               │               │
     │ 3. Encrypt    │               │               │
     │    File       │               │               │
     │               │               │               │
     │ 4. Request    │               │               │
     │    Upload URL │               │               │
     ├──────────────►│               │               │
     │               │               │               │
     │               │ 5. Generate   │               │
     │               │    Presigned  │               │
     │               │    URL        │               │
     │               ├──────────────────────────────►│
     │               │               │               │
     │               │ 6. Return URL │               │
     │               │◄──────────────────────────────┤
     │               │               │               │
     │ 7. Upload URL │               │               │
     │◄──────────────┤               │               │
     │               │               │               │
     │ 8. PUT Encrypted File         │               │
     ├──────────────────────────────────────────────►│
     │               │               │               │
     │ 9. Upload Success             │               │
     │◄──────────────────────────────────────────────┤
     │               │               │               │
     │ 10. Wrap AES  │               │               │
     │     Key with  │               │               │
     │     Master Key│               │               │
     │               │               │               │
     │ 11. Send      │               │               │
     │     Metadata  │               │               │
     ├──────────────►│               │               │
     │               │               │               │
     │               │ 12. Store     │               │
     │               │     Metadata  │               │
     │               ├──────────────►│               │
     │               │               │               │
     │               │ 13. Stored    │               │
     │               │◄──────────────┤               │
     │               │               │               │
     │ 14. Complete  │               │               │
     │◄──────────────┤               │               │
     │               │               │               │
```

### 3.3 Secure Share Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Owner   │    │  Server  │    │ Database │    │Recipient │
└────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │               │
     │ 1. Share File │               │               │
     ├──────────────►│               │               │
     │               │               │               │
     │               │ 2. Verify     │               │
     │               │    Recipient  │               │
     │               │    Exists     │               │
     │               ├──────────────►│               │
     │               │               │               │
     │               │ 3. User Found │               │
     │               │◄──────────────┤               │
     │               │               │               │
     │               │ 4. Generate   │               │
     │               │    Token      │               │
     │               │               │               │
     │               │ 5. Store Link │               │
     │               ├──────────────►│               │
     │               │               │               │
     │               │ 6. Send Email │               │
     │               ├──────────────────────────────►│
     │               │               │               │
     │ 7. Link Sent  │               │               │
     │◄──────────────┤               │               │
     │               │               │               │
     │               │               │ 8. Click Link │
     │               │               │◄──────────────┤
     │               │               │               │
     │               │ 9. Access Link│               │
     │               │◄──────────────────────────────┤
     │               │               │               │
     │               │ 10. Verify    │               │
     │               │     Token     │               │
     │               ├──────────────►│               │
     │               │               │               │
     │               │ 11. Return    │               │
     │               │     File Data │               │
     │               │◄──────────────┤               │
     │               │               │               │
     │               │ 12. Burn Link │               │
     │               ├──────────────►│               │
     │               │               │               │
     │               │ 13. File Data │               │
     │               ├──────────────────────────────►│
     │               │               │               │
```

---

## 4. Data Flow

### 4.1 Authentication Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                  AUTHENTICATION FLOW                    │
└─────────────────────────────────────────────────────────┘

User Input (Email + Password + PIN)
         │
         ▼
┌─────────────────────┐
│ Client Validation   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Send to Server      │
│ (HTTPS POST)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Server Validation   │
│ • Email format      │
│ • Password strength │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Database Query      │
│ SELECT user         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ bcrypt.compare()    │
│ Password Hash       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ bcrypt.compare()    │
│ PIN Hash            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Generate JWT Token  │
│ Sign with Secret    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Return Token        │
│ + User Data         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Store in LocalStorage│
│ (Client Side)       │
└─────────────────────┘
```

### 4.2 File Encryption Data Flow

```
┌─────────────────────────────────────────────────────────┐
│              FILE ENCRYPTION FLOW                       │
└─────────────────────────────────────────────────────────┘

Original File (Plaintext)
         │
         ▼
┌─────────────────────┐
│ Read as ArrayBuffer │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Generate Random     │
│ AES-256 Key         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Generate Random IV  │
│ (12 bytes)          │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ AES-GCM Encrypt     │
│ File + IV           │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Encrypted File Blob │
│ (IV + Ciphertext)   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Upload to S3        │
│ via Presigned URL   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Wrap AES Key with   │
│ User's Master Key   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Store Wrapped Key   │
│ in Database         │
└─────────────────────┘
```

---

## 5. Encryption Flow

### 5.1 Key Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│                    KEY HIERARCHY                        │
└─────────────────────────────────────────────────────────┘

┌──────────────────────────────────────┐
│        User Master Key (RSA)         │
│  • Generated per session             │
│  • Stored in browser memory only     │
│  • Never sent to server              │
│  • Used to wrap file keys            │
└──────────────┬───────────────────────┘
               │
               │ Wraps
               │
               ▼
┌──────────────────────────────────────┐
│       File Encryption Key (AES)      │
│  • Unique per file                   │
│  • 256-bit random key                │
│  • Used to encrypt file content      │
│  • Wrapped before storage            │
└──────────────┬───────────────────────┘
               │
               │ Encrypts
               │
               ▼
┌──────────────────────────────────────┐
│          File Content                │
│  • Encrypted with AES-256-GCM        │
│  • Stored in AWS S3                  │
│  • Server cannot decrypt             │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│       Share Link Key (Random)        │
│  • Generated for each share          │
│  • Included in share URL             │
│  • Used to unwrap file key           │
│  • One-time use only                 │
└──────────────────────────────────────┘
```

### 5.2 Encryption Algorithm Details

```
┌─────────────────────────────────────────────────────────┐
│              ENCRYPTION SPECIFICATIONS                  │
└─────────────────────────────────────────────────────────┘

File Encryption:
┌────────────────────────────────────┐
│ Algorithm: AES-256-GCM             │
│ Key Size: 256 bits                 │
│ IV Size: 96 bits (12 bytes)        │
│ Tag Size: 128 bits (16 bytes)      │
│ Mode: Galois/Counter Mode          │
└────────────────────────────────────┘

Key Wrapping:
┌────────────────────────────────────┐
│ Algorithm: RSA-OAEP                │
│ Key Size: 2048 bits                │
│ Hash: SHA-256                      │
│ MGF: MGF1 with SHA-256             │
└────────────────────────────────────┘

Password Hashing:
┌────────────────────────────────────┐
│ Algorithm: bcrypt                  │
│ Rounds: 10                         │
│ Salt: Auto-generated               │
└────────────────────────────────────┘

Token Signing:
┌────────────────────────────────────┐
│ Algorithm: HMAC-SHA256             │
│ Token Type: JWT                    │
│ Expiry: Session-based              │
└────────────────────────────────────┘
```

---

## 6. Database Architecture

### 6.1 Entity Relationship Diagram

```
┌─────────────────┐
│     USERS       │
├─────────────────┤
│ PK user_id      │
│    username     │
│    email        │
│    password_hash│
│    security_pin │
│    profile_photo│
│    theme_pref   │
└────────┬────────┘
         │
         │ 1:N
         │
         ▼
┌─────────────────┐         ┌─────────────────┐
│     FILES       │────────►│  FILE_METADATA  │
├─────────────────┤   1:1   ├─────────────────┤
│ PK file_id      │         │ PK,FK file_id   │
│    file_uuid    │         │    encrypted_   │
│ FK owner_id     │         │    metadata     │
│    file_type    │         │    iv           │
│    is_deleted   │         └─────────────────┘
└────────┬────────┘
         │                   ┌─────────────────┐
         │──────────────────►│   FILE_KEYS     │
         │          1:1      ├─────────────────┤
         │                   │ PK,FK file_id   │
         │                   │    encrypted_key│
         │                   └─────────────────┘
         │
         │ 1:N
         │
         ▼
┌─────────────────┐
│  SHARED_LINKS   │
├─────────────────┤
│ PK link_id      │
│ FK file_id      │
│    recipient    │
│    token_hash   │
│    encrypted_key│
│    expires_at   │
│    is_used      │
└─────────────────┘

┌─────────────────┐
│   AUDIT_LOGS    │
├─────────────────┤
│ PK log_id       │
│ FK user_id      │
│ FK file_id      │
│    action       │
│    details      │
│    timestamp    │
└─────────────────┘

┌─────────────────┐
│     ADMINS      │
├─────────────────┤
│ PK admin_id     │
│    username     │
│    email        │
│    password_hash│
│    last_login   │
└────────┬────────┘
         │
         │ 1:N
         │
         ▼
┌─────────────────┐
│   ADMIN_LOGS    │
├─────────────────┤
│ PK log_id       │
│ FK admin_id     │
│    action       │
│    details      │
│    ip_address   │
│    timestamp    │
└─────────────────┘
```

---

## 7. Cloud Architecture

### 7.1 AWS Integration

```
┌─────────────────────────────────────────────────────────┐
│                   AWS ARCHITECTURE                      │
└─────────────────────────────────────────────────────────┘

┌──────────────────────────────────────┐
│          Application Server          │
│         (Node.js + Express)          │
└──────────────┬───────────────────────┘
               │
               │ AWS SDK
               │
               ▼
┌──────────────────────────────────────┐
│            AWS IAM User              │
│  • Access Key ID                     │
│  • Secret Access Key                 │
│  • Permissions: S3FullAccess         │
└──────────────┬───────────────────────┘
               │
               │ Authenticate
               │
               ▼
┌──────────────────────────────────────┐
│           AWS S3 Bucket              │
│  • Region: eu-north-1                │
│  • Encryption: Client-side           │
│  • Versioning: Disabled              │
│  • Public Access: Blocked            │
│  • CORS: Configured                  │
└──────────────────────────────────────┘

File Storage Structure:
s3://bucket-name/
  ├── {file-uuid-1}  (Encrypted blob)
  ├── {file-uuid-2}  (Encrypted blob)
  ├── {file-uuid-3}  (Encrypted blob)
  └── ...
```

### 7.2 Presigned URL Flow

```
Client                Server              AWS S3
  │                     │                   │
  │ 1. Request Upload   │                   │
  ├────────────────────►│                   │
  │                     │                   │
  │                     │ 2. Generate       │
  │                     │    Presigned URL  │
  │                     │    (5 min expiry) │
  │                     │                   │
  │                     │ 3. Sign with      │
  │                     │    AWS Credentials│
  │                     │                   │
  │ 4. Return URL       │                   │
  │◄────────────────────┤                   │
  │                     │                   │
  │ 5. PUT File (Direct Upload)            │
  ├────────────────────────────────────────►│
  │                     │                   │
  │ 6. Upload Success   │                   │
  │◄────────────────────────────────────────┤
  │                     │                   │
```

---

## 📊 Performance Considerations

### Scalability

- **Horizontal Scaling**: Multiple Node.js instances with load balancer
- **Database**: Connection pooling for efficient resource usage
- **S3**: Unlimited storage capacity, auto-scaling
- **CDN**: Can be added for static assets

### Security

- **Zero-Knowledge**: Server never sees plaintext files
- **Encryption**: All files encrypted before leaving client
- **Authentication**: JWT tokens with expiry
- **Audit**: Complete activity logging

### Reliability

- **S3 Durability**: 99.999999999% (11 9's)
- **Database**: Transaction support for data integrity
- **Error Handling**: Comprehensive error handling and logging
- **Backup**: S3 versioning can be enabled for backups

---

**This architecture ensures maximum security, scalability, and performance for the SecureVault system.**
