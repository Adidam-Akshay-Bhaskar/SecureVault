# SecureVault
### Client-Side Encrypted Cloud Storage & Secure File Sharing System

SecureVault is an end-to-end encrypted file storage and secure sharing web application. All cryptographic operations — file payload encryption, key wrapping, and metadata obfuscation — take place **directly inside the client's browser** via the standard Web Crypto API. Binary payloads are streamed directly to AWS S3 using pre-signed URLs, ensuring the backend server never processes or stores unencrypted file contents.

Built with Semantic HTML5, Vanilla CSS3, and ES6+ JavaScript on the frontend, and Node.js (Express 5), PostgreSQL (Supabase/Neon), and AWS S3 on the backend.

---

## Architecture Overview

```mermaid
graph TD
    subgraph Browser ["Client Browser (Web Crypto API)"]
        UI["User Interface (SPA)"]
        Crypto["Crypto Engine (AES-GCM 256)"]
        Viewer["Frictionless Enclave Viewer"]
        Cache["sessionStorage / Memory Cache"]
    end

    subgraph AWS ["Amazon Web Services"]
        S3["AWS S3 Bucket (Encrypted Binary Blobs)"]
    end

    subgraph Backend ["Node.js Express API"]
        Server["Express 5 Server"]
        AuthMiddleware["JWT Auth Middleware"]
        CronTask["Hourly Recycle Bin Pruning Worker"]
        SMTP["Nodemailer (Gmail SMTP TLS)"]
    end

    subgraph Database ["PostgreSQL (Supabase / Neon)"]
        DB[("PostgreSQL Database
        • users & credentials
        • encrypted file keys
        • encrypted metadata (BYTEA)
        • folders & shared links
        • audit logs & recovery tokens")]
    end

    UI -->|ArrayBuffer| Crypto
    Crypto -->|Encrypted Payload via Pre-Signed PUT URL| S3
    UI -->|JWT + Encrypted Metadata & Keys| Server
    Server --> AuthMiddleware
    AuthMiddleware -->|SQL Queries| DB
    Server -->|Signed Download / Upload URLs| S3
    Server --> CronTask
    CronTask -->|Purge Expired Blobs > 7 Days| S3
    CronTask -->|DELETE Cascaded Rows| DB
    Server -->|Dispatch 15-min Reset Token| SMTP
    S3 -.->|Pre-Signed GET Stream| Crypto
    Crypto -.->|In-Memory Decrypted Stream| Viewer
    Cache -.->|Zero-Lag Instant Re-render| UI
```

The server never processes plaintext file contents. File names, file sizes, and file types are encrypted into opaque byte arrays before leaving the client browser.

---

## Cryptographic Engine & Key Management

### 1. File Payload Encryption
- **Algorithm**: `AES-GCM` (Galois/Counter Mode) with 256-bit key length.
- **Initialization Vector (IV)**: A cryptographically secure 12-byte random IV (`crypto.getRandomValues(new Uint8Array(12))`) generated per encryption operation.
- **Payload Structure**: The 12-byte IV is prepended to the ciphertext along with the 16-byte GCM authentication tag: `[12-byte IV] + [Ciphertext + Auth Tag]`.
- **Integrity Verification**: Any bit-level modification or truncation of ciphertext triggers an authentication tag failure in `crypto.subtle.decrypt`.

### 2. File Metadata Encryption
- **Algorithm**: `AES-GCM` 256-bit.
- **Payload**: JSON-encoded metadata containing `{ filename, size, type }` is encrypted under the user's Master Key with a unique 12-byte IV.
- **Database Storage**: The ciphertext is stored in PostgreSQL as `BYTEA` (binary data) via `decode($2, 'base64')` in `file_metadata.encrypted_metadata`, and the IV is stored as a hexadecimal string in `file_metadata.iv`.

### 3. Historical Architectural Context: The RSA-OAEP Hybrid Specification
In the original architectural specification of SecureVault, the system was designed around a **Hybrid Cryptosystem** pairing asymmetric and symmetric cryptography:
- **Payload Encryption**: Symmetric `AES-256-GCM` for file data.
- **Asymmetric Key Wrapping (`RSA-OAEP`)**: Each user held an `RSA-OAEP` 2048-bit asymmetric keypair generated in the browser:
  - The user's **RSA Public Key** was used to wrap (encrypt) individual AES-256 file keys.
  - The user's **RSA Private Key** was retained locally to unwrap (decrypt) file keys prior to payload decryption.
- This design provided asymmetric key separation, establishing the foundational principle that the server should never possess unencrypted file keys.

### 4. Active Production Engine: Symmetric AES-GCM 256-bit Key Wrapping
To maximize throughput, minimize browser memory overhead during large file transfers, and provide seamless cross-device synchronization, the active implementation utilizes **Symmetric AES-GCM 256-bit Key Wrapping**:
- **Master Key (`sessionMasterKey`)**: Generated in the browser via `window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt", "wrapKey", "unwrapKey"])`.
- **Key Serialization**: Exported as a standard JSON Web Key (`JWK`) string and synchronized to the user's secure account records (`users.client_master_key` and `user_keys.encryption_key`) to enable access across authorized sessions.
- **File Key Wrapping (`encryptKey`)**: Each file is encrypted with a distinct 256-bit AES-GCM key (`fileKey`). The raw 32 bytes of `fileKey` are wrapped under the user's Master Key using a fresh 12-byte random IV:
  - Format: `bytesToHex(keyIv) + ":" + arrayBufferToBase64(encryptedKey)`
  - Stored in: `file_keys.encrypted_key`
- **File Key Unwrapping (`decryptKey`)**: The client splits the string, decodes the IV and ciphertext, decrypts with `sessionMasterKey`, and imports the raw 32-byte key back into `crypto.subtle`.

### 5. Ephemeral Transmission Protocol for Secure Sharing (`linkKey`)
When sharing files (both In-Vault and external links), the owner's Master Key is never exposed:
1. The sender's client unwraps the file's `fileKey` using their `sessionMasterKey`.
2. A new ephemeral 256-bit AES-GCM key (`linkKey`) is generated.
3. The `fileKey` is re-wrapped under `linkKey` with a fresh 12-byte random IV.
4. The file metadata is re-encrypted under `linkKey` with a fresh 12-byte random IV.
5. The `linkKey` is exported to raw bytes and converted into a **64-character hexadecimal Transmission Security Key** (`linkKeyHex`).
6. The recipient uses this Transmission Security Key to unwrap the file key and decrypt the payload.

---

## Feature Set

### 📁 DataVault — Encrypted File & Folder Manager
- **Contextual Uploads**: Upload any file type directly from the browser with real-time XHR upload progress indicators (`0%` to `100%`).
- **Direct S3 Streaming**: Binary payloads stream directly between the client browser and AWS S3 via 5-minute pre-signed S3 URLs.
- **Folder Organization**: Create virtual directories, rename folders, delete folders (files are unassigned to Root Vault, not deleted), and explore directories within a dedicated **Folder Hub Explorer**.
- **Storage Quota Enforcement**: Client-side storage tracking actively monitors and enforces a **2.5 GB (2,684,354,560 bytes)** quota. Uploads exceeding quota are prevented prior to transmission.
- **Search Filtering**: Real-time client-side search filtering across files and folders with automatic file extension stripping for intuitive matching.
- **Skeleton Loaders**: Custom pulsing skeleton screens render instantly on all view switches, providing immediate visual feedback during async operations.

### 👁️ Frictionless Enclave Viewer (10 Universal Renderers)
Files are decrypted into memory and rendered directly in-browser inside an edge-to-edge modal without saving decrypted files to disk:

| File Category | Extensions Supported | Implementation & Technology | Rendering Behavior |
|---|---|---|---|
| **PDF Documents** | `.pdf` | `PDF.js` (3.4.120) with Worker | Centered high-resolution canvas with warm gray gutters (`#E8E5E0`), compact floating zoom pill (`125%` default, `+` / `−` controls), and page counter. |
| **Word Documents** | `.docx`, `.doc`, `.odt`, `.rtf`, `.pages` | `Mammoth.js` (1.6.0) | HTML conversion formatted as simulated **A4 paginated sheets** (`816px` width, `1056px` min-height, page numbering, Word default typography). |
| **PowerPoint Slides** | `.pptx`, `.ppt` | `JSZip` (3.10.1) XML Parser | Extracts `ppt/slides/slide*.xml`, parses text blocks, extracts embedded images (`ppt/media/`), renders as **16:9 responsive slide cards** on dark canvas (`#1E1E2E`). |
| **Spreadsheets** | `.xlsx`, `.xls`, `.csv`, `.ods`, `.tsv`, `.numbers` | `SheetJS (XLSX)` (0.18.5) | Decodes workbook sheets into an interactive, styled matrix table (`.matrix-table`). |
| **ZIP Archives** | `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.bz2`, `.xz`, `.iso` | `JSZip` (3.10.1) File Tree | Interactive **collapsible directory tree** with folder chevrons, individual file sizes, folder item counts, and file-type glyphs. |
| **Source Code** | `.js`, `.ts`, `.jsx`, `.tsx`, `.py`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.sql`, `.sh`, `.yaml`, `.yml`, `.xml`, `.log`, `.md` | `Highlight.js` (11.8.0) | Syntax highlighted inside an `#0D1117` IDE container with UTF-8 and ISO-8859-1 decoding fallbacks. |
| **Images** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp`, `.ico` | Native Browser Blob URL | Edge-to-edge centered viewport preview with drop shadow. |
| **Video** | `.mp4`, `.mkv`, `.webm`, `.mov`, `.avi` | HTML5 `<video>` Player | Native video playback with `nodownload noplaybackrate` and `disablePictureInPicture` attributes enforced. |
| **Audio** | `.mp3`, `.wav`, `.aac`, `.flac`, `.ogg`, `.m4a` | HTML5 `<audio>` Player | Dedicated media player card with audio icon and track details. |
| **Unsupported** | Any unrecognized binary | Authoritative Fallback Protocol | Informative fallback screen indicating file format cannot be rendered in-browser, with download prompt. |

### 🔗 Dual Sharing Protocols

#### Protocol 1: In-Vault Inter-Agent Sharing
- Direct sharing to any registered user's email address.
- Generates an ephemeral `linkKeyHex` (Transmission Security Key).
- Sender transmits the 64-character key to the recipient out-of-band.
- Recipient accesses their **Incoming Data** tab, clicks **Unlock**, enters the Transmission Security Key, and confirms their personal **Security PIN**.
- **Burn-After-Viewing**: Closing the viewer automatically calls `DELETE /api/share/:linkId` to remove the record from the recipient's incoming feed.

#### Protocol 2: External Ghost Link Sharing
- Generates a public link for external recipients (`recipientEmail = "protocol-link"`).
- Creates an encrypted share token stored as a SHA-256 hash in `shared_links`.
- Sender delivers the URL (`/?token=<raw_token>`) and the 64-character Transmission Security Key (`linkKeyHex`).
- External recipient navigates to the URL and inputs the Transmission Key.
- **Burn-After-Reading**: The backend marks the token as used (`is_used = TRUE`) upon first access; subsequent access attempts return HTTP 410.

#### Permission Controls
Both sharing modes support granular role delegation:
- **Vault Viewer (Read-Only)**: Recipient can view/stream the decrypted file inside the Enclave Viewer; the Download button is suppressed.
- **Vault Editor (Download)**: Full download privileges granted; recipient can save the decrypted file locally.

### 🗑️ Recycle Bin — 7-Day Retention Buffer
- Soft-deleted records enter retention (`is_deleted = TRUE`, `deleted_at = NOW()`).
- Real-time countdown timer displays remaining retention window (`X days Y hours left`).
- Users can manually **Restore** records to Vault Base or **Permanently Delete** them.
- Server-side background worker prunes records older than 7 days every hour from both S3 and PostgreSQL.

### 🛡️ 5-Layer Screenshot & Content Protection
1. **Print & PDF Export Suppression**: `@media print { body { display: none !important; } }` blanks the entire page if print dialog or PDF export is triggered.
2. **Keyboard Interception (Capture Phase)**: Intercepts and blocks `PrintScreen`, `Ctrl+P`, `Ctrl+U`, `Ctrl+Shift+S`, `Ctrl+Shift+I/J`, and macOS `Cmd+Shift+3/4/5`. Automatically clears the system clipboard on `PrintScreen` keystroke.
3. **Context Menu Prevention**: Right-click context menus are suppressed across the secure dashboard.
4. **Drag-and-Drop Prevention**: Prevents text and element dragging out of the browser window.
5. **Visibility & Focus Defense Overlay**: Fullscreen opaque black screen (`#sv-security-overlay`) with a pulsing security shield activates instantly when `document.hidden` is true (tab switch, mobile app switcher) or `window.blur` fires (Snipping Tool, Alt+Tab).

### 🌓 Dual Theme System
- **Light Theme** (Default): Pure `#FFFFFF` background, `#F8FAFC` cards, dark navy sidebar (`#0C1A3A`).
- **Dark Theme**: Pure `#000000` background, `#121212` cards, `#0C1A3A` dark navy sidebar.
- Theme preferences persist in both browser `localStorage` and the PostgreSQL database (`users.theme_preference`).

### 📱 Mobile Bottom Capsule Navigation
On screens $\le 768\text{px}$:
- The desktop sidebar transforms into a floating, pill-shaped capsule (`border-radius: 26px`, width `90%`, max-width `340px`, height `52px`).
- Dark navy translucent surface (`rgba(30, 58, 138, 0.85)`) with `backdrop-filter: blur(20px)`.
- 4 evenly distributed navigation tabs (DataVault, Incoming Data, Recycle Bin, Settings).

### ⚡ Batch Operations Suite
- Multi-select files and folders via `Ctrl` / `Cmd` + Click or clicking the select indicator checkbox.
- Floating dynamic selection toolbar (`#selection-toolbar`) appears automatically with selection counter.
- Supports **Select All**, **Clear Selection**, **Mass Download**, **Mass Restore**, and **Mass Delete**.

### 🔐 Identity, Profile & Account Security
- **Security PIN**: 4 or 6-digit numeric PIN verified on-demand for critical operations (file view, download, share, delete, folder access, account deletion).
- **Email Account Recovery**: Dispatches 15-minute expiring SHA-256 tokens via Gmail SMTP (`nodemailer`) to reset Master Password or Security PIN.
- **Profile Photo**: Upload and storage of profile avatars (up to 2MB base64 encoded) with instant initials fallback.
- **Session Activity Log**: Real-time client-side activity stream tracking logins, uploads, downloads, deletions, and folder modifications with exact timestamps.
- **Session & Device Monitor**: Automatic fingerprinting of browser, operating system, device type, and local timezone.
- **Account Termination Protocol**: Irreversible destruction protocol requiring confirmation by typing `DELETE` and entering the Security PIN.

---

## Database Schema (PostgreSQL)

| Table | Column | Type | Constraints / Description |
|---|---|---|---|
| `users` | `user_id` | `SERIAL PRIMARY KEY` | Auto-incrementing unique user ID |
| | `username` | `TEXT NOT NULL` | Display username |
| | `email` | `TEXT UNIQUE NOT NULL` | Normalized lowercase email address |
| | `password_hash` | `TEXT NOT NULL` | bcrypt hash (10 rounds) of login password |
| | `security_pin_hash`| `TEXT` | bcrypt hash (10 rounds) of 4 or 6 digit PIN |
| | `profile_photo` | `TEXT` | Base64-encoded user avatar data URL |
| | `client_master_key`| `TEXT` | Exported JWK string of the user's AES-GCM Master Key |
| | `theme_preference` | `TEXT DEFAULT 'theme-light'` | User theme selection |
| | `created_at` | `TIMESTAMP DEFAULT NOW()` | Account creation timestamp |
| `folders` | `folder_id` | `SERIAL PRIMARY KEY` | Unique folder ID |
| | `owner_id` | `INTEGER REFERENCES users` | Cascades on user deletion |
| | `name` | `TEXT NOT NULL` | Virtual directory label |
| | `created_at` | `TIMESTAMP DEFAULT NOW()` | Creation timestamp |
| `files` | `file_id` | `SERIAL PRIMARY KEY` | Internal database file ID |
| | `file_uuid` | `TEXT NOT NULL` | Random UUID matching the AWS S3 object key |
| | `owner_id` | `INTEGER REFERENCES users` | Owner reference |
| | `file_type` | `TEXT` | Lowercase extension identifier |
| | `folder_id` | `INTEGER REFERENCES folders` | Virtual folder reference (`NULL` = Root Vault) |
| | `is_deleted` | `BOOLEAN DEFAULT FALSE` | Soft-delete retention flag |
| | `deleted_at` | `TIMESTAMP` | Timestamp when moved to Recycle Bin |
| | `created_at` | `TIMESTAMP DEFAULT NOW()` | Upload timestamp |
| `file_metadata` | `file_id` | `INTEGER REFERENCES files` | Cascades on file deletion |
| | `encrypted_metadata`| `BYTEA NOT NULL` | AES-GCM encrypted `{ filename, size, type }` |
| | `iv` | `TEXT NOT NULL` | 12-byte initialization vector in hex format |
| `file_keys` | `file_id` | `INTEGER REFERENCES files` | Cascades on file deletion |
| | `encrypted_key` | `TEXT NOT NULL` | Master-key wrapped file key (`iv_hex:base64(key)`) |
| `user_keys` | `user_id` | `INTEGER PRIMARY KEY` | Cascades on user deletion |
| | `encryption_key` | `TEXT NOT NULL` | Synchronized user Master Key JWK string |
| `shared_links` | `link_id` | `SERIAL PRIMARY KEY` | Unique share ID |
| | `file_id` | `INTEGER REFERENCES files` | Cascades on file deletion |
| | `recipient_email` | `TEXT NOT NULL` | Recipient email or `'protocol-link'` for external |
| | `token_hash` | `TEXT NOT NULL` | SHA-256 hash of share access token |
| | `encrypted_file_key`| `TEXT NOT NULL` | File key wrapped under ephemeral Transmission Key |
| | `encrypted_metadata`| `BYTEA` | File metadata encrypted under Transmission Key |
| | `iv` | `TEXT` | Metadata IV in hex format |
| | `is_used` | `BOOLEAN DEFAULT FALSE` | Burn-after-read flag |
| | `downloadable` | `BOOLEAN DEFAULT FALSE` | Permission toggle (`true` = download, `false` = read-only) |
| | `expires_at` | `TIMESTAMP NOT NULL` | Link expiration (24 hours default) |
| | `created_at` | `TIMESTAMP DEFAULT NOW()` | Share creation timestamp |
| `recovery_tokens` | `token_id` | `SERIAL PRIMARY KEY` | Unique recovery token ID |
| | `user_id` | `INTEGER REFERENCES users` | Target user account |
| | `token_hash` | `TEXT NOT NULL` | SHA-256 hash of 32-byte recovery token |
| | `type` | `TEXT NOT NULL` | Recovery target: `'password'` or `'pin'` |
| | `expires_at` | `TIMESTAMP NOT NULL` | Expiration timestamp (15 minutes TTL) |
| | `created_at` | `TIMESTAMP DEFAULT NOW()` | Generation timestamp |
| `audit_logs` | `log_id` | `SERIAL PRIMARY KEY` | Unique log entry ID |
| | `user_id` | `INTEGER REFERENCES users` | Actor ID (`ON DELETE SET NULL`) |
| | `file_id` | `INTEGER REFERENCES files` | Target file ID (`ON DELETE SET NULL`) |
| | `action` | `TEXT NOT NULL` | Action code (`UPLOAD_COMPLETED`, `SHARED_IN_APP`, etc.) |
| | `details` | `TEXT` | Supplementary details |
| | `created_at` | `TIMESTAMP DEFAULT NOW()` | Event timestamp |
| `otp_store` | `email` | `TEXT PRIMARY KEY` | Account verification store |
| | `otp_hash` | `TEXT NOT NULL` | SHA-256 hash of OTP |
| | `expires_at` | `TIMESTAMP NOT NULL` | OTP expiration timestamp |

---

## REST API Reference

### Authentication & Recovery
- `POST /api/register` — Registers a new account, hashes password and PIN, stores `masterKey` JWK.
- `POST /api/login` — Verifies password (and optional PIN), returns 7-day JWT and user profile.
- `POST /api/auth/recover-request` — Dispatches a 15-minute recovery link to user's registered email via Gmail SMTP.
- `GET /api/auth/verify-recovery/:token` — Validates an incoming password/PIN recovery token.
- `POST /api/auth/reset-execute` — Executes password or PIN reset with token validation and burns token.
- `POST /api/verify-identity` — Verifies user PIN for password reset flows.
- `POST /api/reset-password` — Direct password reset following identity verification.

### Profile & Settings (Requires JWT)
- `GET /api/profile` — Retrieves username, email, avatar, and Master Key JWK.
- `POST /api/profile/photo` — Saves base64 profile image.
- `DELETE /api/profile/photo` — Purges profile image.
- `PUT /api/profile/password` — Changes password after validating current password.
- `POST /api/update-theme` — Saves theme preference (`theme-light` or `dark-theme`).
- `POST /api/save-master-key` — Synchronizes Master Key in `user_keys`.

### File Operations (Requires JWT)
- `POST /api/upload-url` — Generates a 5-minute pre-signed S3 `putObject` URL with a UUID key.
- `POST /api/complete-upload` — Atomically commits file metadata, folder ID, wrapped keys, and audit log.
- `GET /api/files` — Returns list of active owned files and incoming shared files.
- `GET /api/download-url/:fileId` — Generates a 5-minute pre-signed S3 `getObject` URL.
- `POST /api/delete-file` — Moves file to Recycle Bin (`is_deleted = TRUE`).
- `GET /api/recycle-bin` — Retrieves soft-deleted files awaiting retention expiration.
- `POST /api/restore-file` — Restores file from Recycle Bin (`is_deleted = FALSE`).
- `POST /api/permanent-delete` — Permanently deletes file record, keys, and metadata.
- `POST /api/verify-file-pin` — Verifies Security PIN for protected actions.

### Virtual Folders (Requires JWT)
- `POST /api/folders` — Creates a new folder.
- `GET /api/folders` — Lists all folders owned by the authenticated user.
- `PUT /api/folders/:id` — Renames an existing folder.
- `DELETE /api/folders/:id` — Deletes folder (contained files are unassigned, not deleted).

### Secure Sharing
- `POST /api/share` *(JWT required)* — Initializes an In-Vault or external share protocol with custom permissions.
- `DELETE /api/share/:linkId` *(JWT required)* — Revokes an active share link.
- `POST /api/access-share` *(Public)* — Accesses an external ghost link, marks token as used (`is_used = TRUE`), and returns pre-signed S3 URL with wrapped keys.

---

## Tech Stack

### Frontend
- **Core**: Semantic HTML5, Vanilla CSS3, ES6+ JavaScript (zero build step, zero frameworks).
- **Cryptography**: Web Crypto API (`window.crypto.subtle`) — `AES-GCM` 256-bit, `SHA-256`.
- **Viewers & Parsing**:
  - `PDF.js` (3.4.120) — Canvas PDF rendering
  - `Mammoth.js` (1.6.0) — DOCX to HTML conversion
  - `SheetJS` (0.18.5) — Excel workbook to HTML matrix table
  - `JSZip` (3.10.1) — ZIP file tree & PPTX slide extraction
  - `Highlight.js` (11.8.0) — Syntax highlighting for code/text

### Backend
- **Runtime**: Node.js 18+, Express 5
- **Database**: PostgreSQL (Supabase / Neon) via `pg` connection pool
- **File Storage**: AWS S3 via `aws-sdk` (v4 pre-signed URL pattern)
- **Authentication**: `jsonwebtoken` (7-day JWT expiration), `bcryptjs` (10 rounds)
- **Email Service**: `nodemailer` with Gmail SMTP (port 465 SSL)

---

## Installation & Setup

### Prerequisites
1. **Node.js**: v18.0.0 or higher
2. **PostgreSQL**: Cloud database instance (Supabase, Neon, Railway) or local PostgreSQL
3. **AWS S3**: An S3 bucket with CORS configured for PUT/GET requests
4. **Gmail Account**: With 2-Step Verification and an **App Password** generated for SMTP

### 1. Clone & Configure

```bash
git clone https://github.com/Adidam-Akshay-Bhaskar/SecureVault.git
cd SecureVault
```

Create `.env` inside the `backend/` directory from the template:

```bash
cp backend/.env.example backend/.env
```

Configure your `backend/.env` with your credentials:

```ini
PORT=3000
NODE_ENV=development

# PostgreSQL Database (Supabase / Neon)
DB_HOST=aws-0-ap-south-1.pooler.supabase.com
DB_USER=postgres.your_project_id
DB_PASSWORD=your_database_password
DB_NAME=postgres
DB_PORT=5432

# AWS S3 Storage
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=ap-south-1
S3_BUCKET_NAME=your-s3-bucket-name

# Security
JWT_SECRET=your_super_long_cryptographically_secure_random_jwt_secret

# Email Service (Gmail SMTP for account recovery)
SYSTEM_EMAIL=your-vault-email@gmail.com
SYSTEM_EMAIL_PASS=your_16_char_gmail_app_password

# Frontend Base URL (for email recovery links)
FRONTEND_URL=http://localhost:3000
```

### 2. Install & Start Backend

```bash
cd backend
npm install
npm start        # Production mode
# or
npm run dev      # Development mode with nodemon
```

The server automatically initializes all 10 PostgreSQL tables, runs migrations, configures S3 CORS rules, and starts the hourly Recycle Bin cleanup worker on boot.

### 3. Open Application

Visit:
```
http://localhost:3000
```

Express statically serves the `frontend/` directory. No build step or bundler is required.

---

## Deployment to Vercel

The project includes a production-ready `vercel.json` configured for Vercel Serverless:

```json
{
  "version": 2,
  "cleanUrls": true,
  "builds": [
    { "src": "backend/server.js", "use": "@vercel/node" },
    { "src": "frontend/**", "use": "@vercel/static" }
  ],
  "rewrites": [
    { "source": "/api/:match*", "destination": "/backend/server.js" },
    { "source": "/((?!api/).*)", "destination": "/frontend/$1" }
  ]
}
```

1. Import the repository into your Vercel dashboard.
2. In Project Settings $\rightarrow$ Environment Variables, add all variables from `backend/.env.example`.
3. Set `FRONTEND_URL` to your production Vercel domain (e.g., `https://your-app.vercel.app`).
4. Deploy.

---

## Background Maintenance Tasks

| Task | Execution Frequency | Actions Performed |
|---|---|---|
| **Recycle Bin Pruning** | Every 1 hour (`setInterval`) | Queries `files` where `is_deleted = TRUE` and `deleted_at < NOW() - 7 days`. Deletes matching binary blobs from AWS S3, then deletes rows from PostgreSQL. |
| **Recovery Token Cleanup** | On each reset execution | Recovery tokens are immediately destroyed upon successful password or PIN update. |
| **Shared Link Burn** | On each link access / close | External links are marked `is_used = TRUE` on first fetch; In-Vault shares are deleted from DB on viewer close. |

---

## License

This project is licensed under the MIT License.
