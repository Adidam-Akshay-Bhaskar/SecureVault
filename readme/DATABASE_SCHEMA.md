# 🗄️ Database Schema - SecureVault

This document provides a comprehensive overview of the database structure, tables, fields, relationships, and constraints used in SecureVault.

---

## 📋 Table of Contents

1. [Database Overview](#database-overview)
2. [Tables](#tables)
3. [Relationships](#relationships)
4. [Indexes](#indexes)
5. [Sample Queries](#sample-queries)

---

## 1. Database Overview

**Database Name**: `secure_file_sharing`  
**Database Engine**: MySQL 8.0+  
**Character Set**: utf8mb4  
**Collation**: utf8mb4_unicode_ci

### Schema Statistics

- **Total Tables**: 8
- **User Tables**: 5
- **Admin Tables**: 2
- **Audit Tables**: 1

---

## 2. Tables

### 2.1 Users Table

**Purpose**: Store user account information

```sql
CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    security_pin_hash VARCHAR(255),
    profile_photo LONGTEXT,
    theme_preference VARCHAR(50) DEFAULT 'theme-light',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

| Column              | Type         | Constraints                 | Description                      |
| ------------------- | ------------ | --------------------------- | -------------------------------- |
| `user_id`           | INT          | PRIMARY KEY, AUTO_INCREMENT | Unique user identifier           |
| `username`          | VARCHAR(255) | NOT NULL                    | User's display name              |
| `email`             | VARCHAR(255) | UNIQUE, NOT NULL            | User's email (login identifier)  |
| `password_hash`     | VARCHAR(255) | NOT NULL                    | bcrypt hashed password           |
| `security_pin_hash` | VARCHAR(255) | NULL                        | bcrypt hashed security PIN (2FA) |
| `profile_photo`     | LONGTEXT     | NULL                        | Base64 encoded profile image     |
| `theme_preference`  | VARCHAR(50)  | DEFAULT 'theme-light'       | UI theme preference              |
| `created_at`        | TIMESTAMP    | DEFAULT CURRENT_TIMESTAMP   | Account creation timestamp       |

**Indexes:**

- PRIMARY KEY on `user_id`
- UNIQUE INDEX on `email`

---

### 2.2 Files Table

**Purpose**: Store file metadata and ownership information

```sql
CREATE TABLE IF NOT EXISTS files (
    file_id INT AUTO_INCREMENT PRIMARY KEY,
    file_uuid VARCHAR(36) UNIQUE NOT NULL,
    owner_id INT NOT NULL,
    file_type VARCHAR(50),
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(user_id)
);
```

| Column       | Type        | Constraints                 | Description              |
| ------------ | ----------- | --------------------------- | ------------------------ |
| `file_id`    | INT         | PRIMARY KEY, AUTO_INCREMENT | Unique file identifier   |
| `file_uuid`  | VARCHAR(36) | UNIQUE, NOT NULL            | UUID for S3 object key   |
| `owner_id`   | INT         | FOREIGN KEY, NOT NULL       | Reference to users table |
| `file_type`  | VARCHAR(50) | NULL                        | File MIME type category  |
| `is_deleted` | BOOLEAN     | DEFAULT FALSE               | Soft delete flag         |
| `created_at` | TIMESTAMP   | DEFAULT CURRENT_TIMESTAMP   | Upload timestamp         |

**Indexes:**

- PRIMARY KEY on `file_id`
- UNIQUE INDEX on `file_uuid`
- INDEX on `owner_id`
- INDEX on `is_deleted`

**Foreign Keys:**

- `owner_id` → `users(user_id)`

---

### 2.3 File Metadata Table

**Purpose**: Store encrypted file metadata (filename, size, type)

```sql
CREATE TABLE IF NOT EXISTS file_metadata (
    file_id INT PRIMARY KEY,
    encrypted_metadata BLOB NOT NULL,
    iv VARCHAR(255) NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE
);
```

| Column               | Type         | Constraints              | Description                          |
| -------------------- | ------------ | ------------------------ | ------------------------------------ |
| `file_id`            | INT          | PRIMARY KEY, FOREIGN KEY | Reference to files table             |
| `encrypted_metadata` | BLOB         | NOT NULL                 | AES-256-GCM encrypted metadata JSON  |
| `iv`                 | VARCHAR(255) | NOT NULL                 | Initialization vector for decryption |

**Indexes:**

- PRIMARY KEY on `file_id`

**Foreign Keys:**

- `file_id` → `files(file_id)` ON DELETE CASCADE

**Metadata Structure (before encryption):**

```json
{
  "originalName": "document.pdf",
  "size": 1048576,
  "type": "application/pdf",
  "uploadedAt": "2026-01-12T00:00:00.000Z"
}
```

---

### 2.4 File Keys Table

**Purpose**: Store encrypted file encryption keys

```sql
CREATE TABLE IF NOT EXISTS file_keys (
    file_id INT PRIMARY KEY,
    encrypted_key TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE
);
```

| Column          | Type      | Constraints               | Description                  |
| --------------- | --------- | ------------------------- | ---------------------------- |
| `file_id`       | INT       | PRIMARY KEY, FOREIGN KEY  | Reference to files table     |
| `encrypted_key` | TEXT      | NOT NULL                  | RSA-OAEP wrapped AES-256 key |
| `created_at`    | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Key creation timestamp       |

**Indexes:**

- PRIMARY KEY on `file_id`

**Foreign Keys:**

- `file_id` → `files(file_id)` ON DELETE CASCADE

---

### 2.5 Shared Links Table

**Purpose**: Store one-time shareable file links

```sql
CREATE TABLE IF NOT EXISTS shared_links (
    link_id INT AUTO_INCREMENT PRIMARY KEY,
    file_id INT NOT NULL,
    recipient_email VARCHAR(255),
    token_hash VARCHAR(64) NOT NULL,
    encrypted_file_key TEXT NOT NULL,
    encrypted_metadata BLOB,
    iv VARCHAR(255),
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE
);
```

| Column               | Type         | Constraints                 | Description                       |
| -------------------- | ------------ | --------------------------- | --------------------------------- |
| `link_id`            | INT          | PRIMARY KEY, AUTO_INCREMENT | Unique link identifier            |
| `file_id`            | INT          | FOREIGN KEY, NOT NULL       | Reference to files table          |
| `recipient_email`    | VARCHAR(255) | NULL                        | Intended recipient email          |
| `token_hash`         | VARCHAR(64)  | NOT NULL                    | SHA-256 hash of share token       |
| `encrypted_file_key` | TEXT         | NOT NULL                    | File key encrypted with share key |
| `encrypted_metadata` | BLOB         | NULL                        | Metadata encrypted with share key |
| `iv`                 | VARCHAR(255) | NULL                        | Initialization vector             |
| `expires_at`         | TIMESTAMP    | NOT NULL                    | Link expiration time (24 hours)   |
| `is_used`            | BOOLEAN      | DEFAULT FALSE               | Burn-after-read flag              |
| `created_at`         | TIMESTAMP    | DEFAULT CURRENT_TIMESTAMP   | Link creation timestamp           |

**Indexes:**

- PRIMARY KEY on `link_id`
- INDEX on `file_id`
- INDEX on `token_hash`
- INDEX on `recipient_email`
- INDEX on `is_used`

**Foreign Keys:**

- `file_id` → `files(file_id)` ON DELETE CASCADE

---

### 2.6 Audit Logs Table

**Purpose**: Track all system activities for security monitoring

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    file_id INT,
    action VARCHAR(255) NOT NULL,
    details TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

| Column      | Type         | Constraints                 | Description                          |
| ----------- | ------------ | --------------------------- | ------------------------------------ |
| `log_id`    | INT          | PRIMARY KEY, AUTO_INCREMENT | Unique log identifier                |
| `user_id`   | INT          | NULL                        | Reference to users table (optional)  |
| `file_id`   | INT          | NULL                        | Reference to files table (optional)  |
| `action`    | VARCHAR(255) | NOT NULL                    | Action type (e.g., UPLOAD, DOWNLOAD) |
| `details`   | TEXT         | NULL                        | Additional action details            |
| `timestamp` | TIMESTAMP    | DEFAULT CURRENT_TIMESTAMP   | Action timestamp                     |

**Common Actions:**

- `UPLOAD_COMPLETED`
- `DOWNLOAD`
- `SHARED`
- `ACCESSED_BURNED`
- `FILE_DELETED`
- `LOGIN`
- `LOGOUT`

**Indexes:**

- PRIMARY KEY on `log_id`
- INDEX on `user_id`
- INDEX on `file_id`
- INDEX on `action`
- INDEX on `timestamp`

---

### 2.7 Admins Table

**Purpose**: Store administrator account information

```sql
CREATE TABLE IF NOT EXISTS admins (
    admin_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL
);
```

| Column          | Type         | Constraints                 | Description                |
| --------------- | ------------ | --------------------------- | -------------------------- |
| `admin_id`      | INT          | PRIMARY KEY, AUTO_INCREMENT | Unique admin identifier    |
| `username`      | VARCHAR(255) | UNIQUE, NOT NULL            | Admin username             |
| `email`         | VARCHAR(255) | UNIQUE, NOT NULL            | Admin email (for OTP)      |
| `password_hash` | VARCHAR(255) | NOT NULL                    | bcrypt hashed password     |
| `created_at`    | TIMESTAMP    | DEFAULT CURRENT_TIMESTAMP   | Account creation timestamp |
| `last_login`    | TIMESTAMP    | NULL                        | Last successful login      |

**Indexes:**

- PRIMARY KEY on `admin_id`
- UNIQUE INDEX on `username`
- UNIQUE INDEX on `email`

---

### 2.8 Admin Logs Table

**Purpose**: Track administrator activities

```sql
CREATE TABLE IF NOT EXISTS admin_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT,
    action VARCHAR(255) NOT NULL,
    details TEXT,
    ip_address VARCHAR(45),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(admin_id)
);
```

| Column       | Type         | Constraints                 | Description                  |
| ------------ | ------------ | --------------------------- | ---------------------------- |
| `log_id`     | INT          | PRIMARY KEY, AUTO_INCREMENT | Unique log identifier        |
| `admin_id`   | INT          | FOREIGN KEY                 | Reference to admins table    |
| `action`     | VARCHAR(255) | NOT NULL                    | Admin action type            |
| `details`    | TEXT         | NULL                        | Action details               |
| `ip_address` | VARCHAR(45)  | NULL                        | Admin IP address (IPv4/IPv6) |
| `timestamp`  | TIMESTAMP    | DEFAULT CURRENT_TIMESTAMP   | Action timestamp             |

**Common Actions:**

- `LOGIN`
- `LOGOUT`
- `USER_SUSPENDED`
- `USER_DELETED`
- `FILE_VIEWED`
- `SYSTEM_CONFIG_CHANGED`

**Indexes:**

- PRIMARY KEY on `log_id`
- INDEX on `admin_id`
- INDEX on `timestamp`

**Foreign Keys:**

- `admin_id` → `admins(admin_id)`

---

## 3. Relationships

### Entity Relationship Diagram

```
┌─────────────────┐
│     USERS       │
│  (user_id PK)   │
└────────┬────────┘
         │
         │ 1:N (owner_id)
         │
         ▼
┌─────────────────┐         ┌─────────────────┐
│     FILES       │────────►│  FILE_METADATA  │
│  (file_id PK)   │   1:1   │  (file_id PK,FK)│
└────────┬────────┘         └─────────────────┘
         │
         │ 1:1              ┌─────────────────┐
         ├─────────────────►│   FILE_KEYS     │
         │                  │  (file_id PK,FK)│
         │                  └─────────────────┘
         │
         │ 1:N              ┌─────────────────┐
         └─────────────────►│  SHARED_LINKS   │
                            │  (link_id PK)   │
                            │  (file_id FK)   │
                            └─────────────────┘

┌─────────────────┐
│   AUDIT_LOGS    │
│  (log_id PK)    │
│  (user_id FK)   │ (Optional references)
│  (file_id FK)   │
└─────────────────┘

┌─────────────────┐
│     ADMINS      │
│  (admin_id PK)  │
└────────┬────────┘
         │
         │ 1:N
         │
         ▼
┌─────────────────┐
│   ADMIN_LOGS    │
│  (log_id PK)    │
│  (admin_id FK)  │
└─────────────────┘
```

### Relationship Details

| Parent Table | Child Table     | Relationship | Foreign Key | On Delete |
| ------------ | --------------- | ------------ | ----------- | --------- |
| `users`      | `files`         | 1:N          | `owner_id`  | -         |
| `files`      | `file_metadata` | 1:1          | `file_id`   | CASCADE   |
| `files`      | `file_keys`     | 1:1          | `file_id`   | CASCADE   |
| `files`      | `shared_links`  | 1:N          | `file_id`   | CASCADE   |
| `admins`     | `admin_logs`    | 1:N          | `admin_id`  | -         |

---

## 4. Indexes

### Performance Optimization

```sql
-- Users table
CREATE INDEX idx_users_email ON users(email);

-- Files table
CREATE INDEX idx_files_owner ON files(owner_id);
CREATE INDEX idx_files_uuid ON files(file_uuid);
CREATE INDEX idx_files_deleted ON files(is_deleted);

-- Shared links table
CREATE INDEX idx_shared_token ON shared_links(token_hash);
CREATE INDEX idx_shared_recipient ON shared_links(recipient_email);
CREATE INDEX idx_shared_used ON shared_links(is_used);

-- Audit logs table
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_file ON audit_logs(file_id);
CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_action ON audit_logs(action);

-- Admin logs table
CREATE INDEX idx_admin_logs_admin ON admin_logs(admin_id);
CREATE INDEX idx_admin_logs_timestamp ON admin_logs(timestamp);
```

---

## 5. Sample Queries

### 5.1 User Operations

**Register New User:**

```sql
INSERT INTO users (username, email, password_hash, security_pin_hash)
VALUES ('john_doe', 'john@example.com', '$2a$10$...', '$2a$10$...');
```

**Login User:**

```sql
SELECT user_id, username, email, password_hash, security_pin_hash
FROM users
WHERE email = 'john@example.com';
```

**Update Theme Preference:**

```sql
UPDATE users
SET theme_preference = 'theme-dark'
WHERE user_id = 1;
```

### 5.2 File Operations

**Upload File (Complete Transaction):**

```sql
START TRANSACTION;

-- Insert file record
INSERT INTO files (file_uuid, owner_id, file_type)
VALUES ('550e8400-e29b-41d4-a716-446655440000', 1, 'application/pdf');

SET @file_id = LAST_INSERT_ID();

-- Insert metadata
INSERT INTO file_metadata (file_id, encrypted_metadata, iv)
VALUES (@file_id, UNHEX('...'), 'base64_iv_string');

-- Insert encrypted key
INSERT INTO file_keys (file_id, encrypted_key)
VALUES (@file_id, 'base64_wrapped_key');

-- Log action
INSERT INTO audit_logs (user_id, file_id, action)
VALUES (1, @file_id, 'UPLOAD_COMPLETED');

COMMIT;
```

**Get User's Files:**

```sql
SELECT
    f.file_id,
    f.file_uuid,
    f.created_at,
    fm.encrypted_metadata,
    fm.iv,
    fk.encrypted_key
FROM files f
JOIN file_metadata fm ON f.file_id = fm.file_id
JOIN file_keys fk ON f.file_id = fk.file_id
WHERE f.owner_id = 1 AND f.is_deleted = FALSE
ORDER BY f.created_at DESC;
```

**Soft Delete File:**

```sql
UPDATE files
SET is_deleted = TRUE
WHERE file_id = 123 AND owner_id = 1;
```

### 5.3 Sharing Operations

**Create Share Link:**

```sql
INSERT INTO shared_links
    (file_id, recipient_email, token_hash, encrypted_file_key,
     encrypted_metadata, iv, expires_at)
VALUES
    (123, 'recipient@example.com', SHA2('random_token', 256),
     'encrypted_key', UNHEX('...'), 'iv_string',
     DATE_ADD(NOW(), INTERVAL 24 HOUR));
```

**Access Share Link:**

```sql
SELECT
    sl.link_id,
    sl.encrypted_file_key,
    sl.encrypted_metadata,
    sl.iv,
    sl.expires_at,
    sl.is_used,
    f.file_uuid
FROM shared_links sl
JOIN files f ON sl.file_id = f.file_id
WHERE sl.token_hash = SHA2('token_from_url', 256)
  AND sl.is_used = FALSE
  AND sl.expires_at > NOW();
```

**Burn Link After Use:**

```sql
UPDATE shared_links
SET is_used = TRUE
WHERE link_id = 456;
```

### 5.4 Admin Operations

**Get All Users:**

```sql
SELECT
    user_id,
    username,
    email,
    created_at,
    (SELECT COUNT(*) FROM files WHERE owner_id = users.user_id AND is_deleted = FALSE) as file_count
FROM users
ORDER BY created_at DESC;
```

**Get System Statistics:**

```sql
SELECT
    (SELECT COUNT(*) FROM users) as total_users,
    (SELECT COUNT(*) FROM files WHERE is_deleted = FALSE) as total_files,
    (SELECT COUNT(*) FROM shared_links WHERE is_used = FALSE) as active_shares,
    (SELECT COUNT(*) FROM audit_logs WHERE DATE(timestamp) = CURDATE()) as today_actions;
```

**Get Recent Activity:**

```sql
SELECT
    al.action,
    al.details,
    al.timestamp,
    u.username,
    u.email
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.user_id
ORDER BY al.timestamp DESC
LIMIT 50;
```

### 5.5 Audit Queries

**User Activity Report:**

```sql
SELECT
    action,
    COUNT(*) as count,
    DATE(timestamp) as date
FROM audit_logs
WHERE user_id = 1
GROUP BY action, DATE(timestamp)
ORDER BY date DESC;
```

**File Access History:**

```sql
SELECT
    al.action,
    al.timestamp,
    u.username,
    u.email
FROM audit_logs al
LEFT JOIN users u ON al.user_id = u.user_id
WHERE al.file_id = 123
ORDER BY al.timestamp DESC;
```

---

## 📊 Database Maintenance

### Backup Strategy

```bash
# Full database backup
mysqldump -u root -p secure_file_sharing > backup_$(date +%Y%m%d).sql

# Table-specific backup
mysqldump -u root -p secure_file_sharing users files > users_files_backup.sql
```

### Cleanup Queries

**Delete Expired Share Links:**

```sql
DELETE FROM shared_links
WHERE expires_at < NOW() OR is_used = TRUE;
```

**Archive Old Audit Logs:**

```sql
-- Create archive table
CREATE TABLE audit_logs_archive LIKE audit_logs;

-- Move old logs
INSERT INTO audit_logs_archive
SELECT * FROM audit_logs
WHERE timestamp < DATE_SUB(NOW(), INTERVAL 1 YEAR);

-- Delete from main table
DELETE FROM audit_logs
WHERE timestamp < DATE_SUB(NOW(), INTERVAL 1 YEAR);
```

---

**This schema ensures data integrity, security, and optimal performance for SecureVault.**
