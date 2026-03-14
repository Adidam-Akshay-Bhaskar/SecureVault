const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
console.log("\n=======================================================");
console.log("       !!! SECURE VAULT - CLOUD STORAGE LIVE !!!       ");
console.log("=======================================================\n");

const { Pool } = require("pg");
const AWS = require("aws-sdk");
const crypto = require("crypto");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const uuidv4 = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");

const app = express();

app.set("trust proxy", 1); // Trust Vercel proxy
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Logging middleware
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});

const frontendPath = path.resolve(__dirname, "..", "frontend");
app.use(express.static(frontendPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// ==========================================
// AWS S3
// ==========================================

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
  signatureVersion: "v4",
});
const s3 = new AWS.S3();

// ==========================================
// DATABASE
// ==========================================

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || ""),
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
  ssl: { rejectUnauthorized: false },
  // FIX: Supabase transaction-mode pooler (port 6543) doesn't persist search_path
  // so tables in the 'public' schema appear not to exist. Setting it explicitly fixes this.
  options: "-c search_path=public",
});

// FIX: db wrapper correctly returns insertId for both users and files inserts
// FIX: Improved db wrapper for standard PG usage and better transaction handling
const db = {
  // Standard query using a fresh connection from the pool
  query: (sql, params, callback) => {
    if (typeof params === "function") { callback = params; params = []; }
    
    // Auto-map ? to $1, $2 for backward compatibility with old code
    let index = 1;
    let pgSql = sql.replace(/\?/g, () => `$${index++}`);

    let returningCol = null;
    if (pgSql.match(/INSERT INTO files /i)) returningCol = "file_id";
    else if (pgSql.match(/INSERT INTO users /i)) returningCol = "user_id";
    if (returningCol && !pgSql.includes("RETURNING")) pgSql += ` RETURNING ${returningCol}`;

    pool.query(pgSql, params, (err, res) => {
      if (err) {
        if (err.code === "23505") err.code = "ER_DUP_ENTRY";
        return callback(err, null);
      }
      if (res.command === "SELECT") return callback(null, res.rows);
      const resultObj = { affectedRows: res.rowCount };
      if (returningCol && res.rows?.length > 0) resultObj.insertId = res.rows[0][returningCol];
      return callback(null, resultObj);
    });
  }
};

pool.query("SELECT 1", (err) => {
  if (err) { console.error("Database connection failed:", err); }
  else {
    console.log("Connected to PostgreSQL Database");
    configureBucketCors();
    ensureAllTables();
  }
});

// ==========================================
// DB SCHEMA INITIALIZATION
// ==========================================

async function ensureAllTables() {
  const createQueries = [
    `CREATE TABLE IF NOT EXISTS users (
      user_id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      security_pin_hash TEXT,
      profile_photo TEXT,
      client_master_key TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS files (
      file_id SERIAL PRIMARY KEY,
      file_uuid TEXT NOT NULL,
      owner_id INTEGER REFERENCES users(user_id),
      file_type TEXT,
      is_deleted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS file_metadata (
      file_id INTEGER REFERENCES files(file_id) ON DELETE CASCADE,
      encrypted_metadata BYTEA NOT NULL,
      iv TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS file_keys (
      file_id INTEGER REFERENCES files(file_id) ON DELETE CASCADE,
      encrypted_key TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_keys (
      user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      encryption_key TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS otp_store (
      email TEXT PRIMARY KEY,
      otp_hash TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS shared_links (
      link_id SERIAL PRIMARY KEY,
      file_id INTEGER REFERENCES files(file_id) ON DELETE CASCADE,
      recipient_email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      encrypted_file_key TEXT NOT NULL,
      encrypted_metadata BYTEA,
      iv TEXT,
      is_used BOOLEAN DEFAULT FALSE,
      downloadable BOOLEAN DEFAULT FALSE,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      log_id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
      file_id INTEGER REFERENCES files(file_id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS folders (
      folder_id SERIAL PRIMARY KEY,
      owner_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS recovery_tokens (
      token_id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      type TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  // Migrations: safely add columns that may be missing from older DB deployments
  const migrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS client_master_key TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference TEXT DEFAULT 'theme-light'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS security_pin_hash TEXT`,
    `ALTER TABLE files ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES folders(folder_id) ON DELETE SET NULL`,
    `ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS downloadable BOOLEAN DEFAULT FALSE`,
  ];

  for (const q of createQueries) {
    try { await pool.query(q); } catch (err) { console.error("Schema create error:", err.message); }
  }
  for (const q of migrations) {
    try { await pool.query(q); } catch (err) { /* column already exists - ignore */ }
  }
  console.log("All database tables verified/migrated.");
}


async function saveOTP(email, otp) {
  const otpHash = crypto.createHash("sha256").update(String(otp)).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await pool.query(
    `INSERT INTO otp_store (email, otp_hash, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET otp_hash = EXCLUDED.otp_hash, expires_at = EXCLUDED.expires_at`,
    [email, otpHash, expiresAt]
  );
}

async function verifyAndConsumeOTP(email, otp) {
  const result = await pool.query("SELECT * FROM otp_store WHERE email = $1", [email]);
  if (result.rows.length === 0) return { valid: false, reason: "Invalid or expired OTP" };
  const record = result.rows[0];
  if (new Date() > new Date(record.expires_at)) {
    await pool.query("DELETE FROM otp_store WHERE email = $1", [email]);
    return { valid: false, reason: "OTP has expired" };
  }
  const otpHash = crypto.createHash("sha256").update(String(otp)).digest("hex");
  if (otpHash !== record.otp_hash) return { valid: false, reason: "Invalid OTP" };
  await pool.query("DELETE FROM otp_store WHERE email = $1", [email]);
  return { valid: true };
}

// ==========================================
// EMAIL
// ==========================================

const emailTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.SYSTEM_EMAIL, pass: process.env.SYSTEM_EMAIL_PASS },
});

// ==========================================
// AUTH MIDDLEWARE
// ==========================================

const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// ==========================================
// S3 CORS
// ==========================================

async function configureBucketCors() {
  try {
    await s3.putBucketCors({
      Bucket: process.env.S3_BUCKET_NAME,
      CORSConfiguration: {
        CORSRules: [{ AllowedHeaders: ["*"], AllowedMethods: ["PUT","GET","HEAD"], AllowedOrigins: ["*"], ExposeHeaders: ["ETag"] }],
      },
    }).promise();
    console.log("S3 Bucket CORS Configured Successfully");
  } catch (err) {
    console.warn("Could not configure S3 CORS.", err.message);
  }
}

// ==========================================
// HELPER: generateTokenAndResponse
// FIX: Falls back to client_master_key if user_keys is empty, auto-migrates
// ==========================================

function generateTokenAndResponse(res, user) {
  // FIX: JWT now expires after 7 days (was never expiring)
  const accessToken = jwt.sign(
    { user_id: user.user_id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  db.query("SELECT encryption_key FROM user_keys WHERE user_id = ?", [user.user_id], (err, keyResults) => {
    let masterKey = (!err && keyResults?.length > 0) ? keyResults[0].encryption_key : null;

    // FIX: Fallback to client_master_key column if user_keys is empty
    if (!masterKey && user.client_master_key) {
      masterKey = user.client_master_key;
      // Auto-migrate to user_keys so future logins always hit the right table
      db.query(
        "INSERT INTO user_keys (user_id, encryption_key) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING",
        [user.user_id, masterKey],
        () => {}
      );
    }

    res.json({
      accessToken,
      user: { username: user.username, email: user.email, masterKey },
    });
  });
}

// ==========================================
// ROUTES
// ==========================================

app.get("/api/health", (req, res) => {
  res.json({ status: "online", port: process.env.PORT, db: "connected" });
});

// RECOVERY REQUEST (Sends Email)
app.post("/api/auth/recover-request", (req, res) => {
  const { email, type } = req.body; // type: 'password' or 'pin'
  if (!email || !type) return res.status(400).json({ message: "Email and recovery type are required." });

  const normalizedEmail = email.trim().toLowerCase();
  db.query("SELECT user_id, username FROM users WHERE email = ?", [normalizedEmail], async (err, results) => {
    if (results.length === 0) return res.status(200).json({ message: "If an account exists, a recovery link will be sent." });

    const user = results[0];
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    db.query(
      "INSERT INTO recovery_tokens (user_id, token_hash, type, expires_at) VALUES (?, ?, ?, ?)",
      [user.user_id, tokenHash, type, expiry],
      (err) => {
        if (err) return res.status(500).json({ message: "DB Error" });

        const resetLink = `${req.protocol}://${req.get("host")}/?recovery_token=${token}&type=${type}`;
        
        const mailOptions = {
          from: `"SecureVault Support" <${process.env.SYSTEM_EMAIL}>`,
          to: user.email,
          subject: `SecureVault - ${type.toUpperCase()} Reset Link`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; color: #333;">
              <h2>Vault Recovery Protocol</h2>
              <p>Hello, <strong>${user.username}</strong>.</p>
              <p>We received a request to reset your <strong>${type}</strong>. This link will expire in 15 minutes.</p>
              <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background: #00f2ff; color: #000; text-decoration: none; border-radius: 8px; font-weight: bold;">Reset ${type}</a>
              <p style="font-size: 0.8rem; color: #666; margin-top: 20px;">If you did not request this, please ignore this email.</p>
            </div>
          `
        };

        emailTransporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            console.error("Email Error:", error);
            // Even if email fails to SEND, we tell user it's sent for security
          }
          res.json({ message: "Recovery link dispatched to your email." });
        });
      }
    );
  });
});

// VERIFY RECOVERY TOKEN
app.get("/api/auth/verify-recovery/:token", (req, res) => {
  const tokenHash = crypto.createHash("sha256").update(req.params.token).digest("hex");
  db.query("SELECT * FROM recovery_tokens WHERE token_hash = ?", [tokenHash], (err, results) => {
    if (results.length === 0 || new Date() > new Date(results[0].expires_at)) {
      return res.status(403).json({ valid: false, message: "Link expired or invalid." });
    }
    res.json({ valid: true, type: results[0].type });
  });
});

// EXECUTE RESET
app.post("/api/auth/reset-execute", async (req, res) => {
  const { token, newValue } = req.body;
  if (!token || !newValue) return res.status(400).json({ message: "Missing data." });

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  db.query("SELECT * FROM recovery_tokens WHERE token_hash = ?", [tokenHash], async (err, results) => {
    if (results.length === 0 || new Date() > new Date(results[0].expires_at)) {
      return res.status(403).json({ message: "Link expired." });
    }

    const recovery = results[0];
    const hashedValue = await bcrypt.hash(newValue, 10);
    const tableField = recovery.type === "password" ? "password_hash" : "security_pin_hash";

    db.query(`UPDATE users SET ${tableField} = ? WHERE user_id = ?`, [hashedValue, recovery.user_id], (err) => {
      if (err) return res.status(500).json({ message: "Update failed." });
      
      // Delete the token immediately
      db.query("DELETE FROM recovery_tokens WHERE token_id = ?", [recovery.token_id], () => {});
      
      res.json({ message: `${recovery.type === "password" ? "Password" : "PIN"} successfully restored.` });
    });
  });
});

// REGISTER
app.post("/api/register", async (req, res) => {
  const { username, email, password, securityPin, masterKey } = req.body;

  if (!username || !email || !password || !securityPin)
    return res.status(400).json({ message: "Missing fields (PIN required)" });

  if (!/^\d{4}$|^\d{6}$/.test(securityPin))
    return res.status(400).json({ message: "PIN must be 4 or 6 digits" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedPin = await bcrypt.hash(securityPin, 10);
    const normalizedEmail = email.trim().toLowerCase();

    db.query(
      "INSERT INTO users (username, email, password_hash, security_pin_hash, client_master_key) VALUES (?, ?, ?, ?, ?)",
      [username.trim(), normalizedEmail, hashedPassword, hashedPin, masterKey || null],
      (err, result) => {
        if (err) {
          console.error("Registration Error:", err);
          if (err.code === "ER_DUP_ENTRY" || err.message.includes("unique constraint"))
            return res.status(400).json({ message: "Email already exists" });
          return res.status(500).json({ message: "Server Registration Error: " + err.message });
        }
        // FIX: Also write to user_keys immediately on registration
        // result.insertId now works correctly due to db wrapper fix
        if (masterKey && result.insertId) {
          db.query(
            "INSERT INTO user_keys (user_id, encryption_key) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING",
            [result.insertId, masterKey],
            () => {}
          );
        }
        res.status(201).json({ message: "User registered successfully" });
      }
    );
  } catch (err) {
    res.status(500).send();
  }
});

// SAVE MASTER KEY
app.post("/api/save-master-key", authenticateToken, (req, res) => {
  const { masterKey } = req.body;
  if (!masterKey) return res.status(400).json({ message: "Master key missing" });
  db.query(
    "INSERT INTO user_keys (user_id, encryption_key) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET encryption_key = EXCLUDED.encryption_key",
    [req.user.user_id, masterKey],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Security key synchronized" });
    }
  );
});

// LOGIN
app.post("/api/login", (req, res) => {
  const { email, password, securityPin } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Missing credentials" });

  const normalizedEmail = email.trim().toLowerCase();
  db.query("SELECT * FROM users WHERE email = ?", [normalizedEmail], (err, results) => {
    if (err) return res.status(500).json({ error: "Internal Server Error" });
    if (results.length === 0) return res.status(401).json({ message: "Invalid Credentials" });

    const user = results[0];
    bcrypt.compare(password, user.password_hash, (err, isValid) => {
      if (err || !isValid) return res.status(401).json({ message: "Invalid Credentials" });

      // FIX: User requested to not be asked for PIN during login
      // We still keep the check if they DO provide it for 2FA flows, but otherwise proceed.
      if (user.security_pin_hash && securityPin) {
        bcrypt.compare(securityPin, user.security_pin_hash, (err, pinValid) => {
          if (err || !pinValid) return res.status(401).json({ message: "Invalid Security PIN" });
          generateTokenAndResponse(res, user);
        });
      } else {
        // Just password is enough now
        generateTokenAndResponse(res, user);
      }
    });
  });
});

// VERIFY IDENTITY (for password reset)
app.post("/api/verify-identity", (req, res) => {
  const { email, securityPin } = req.body;
  if (!email || !securityPin) return res.status(400).json({ message: "Missing fields" });

  const normalizedEmail = email.trim().toLowerCase();
  db.query("SELECT * FROM users WHERE email = ?", [normalizedEmail], (err, results) => {
    if (err) return res.status(500).json({ message: "Database Error" });
    if (results.length === 0) return res.status(404).json({ message: "User not found" });

    const user = results[0];
    if (!user.security_pin_hash) return res.status(400).json({ message: "No Security PIN set." });

    bcrypt.compare(String(securityPin).trim(), user.security_pin_hash, (err, pinValid) => {
      if (err || !pinValid) return res.status(401).json({ message: "Invalid Security PIN" });
      res.json({ message: "Identity Verified" });
    });
  });
});

// RESET PASSWORD
app.post("/api/reset-password", (req, res) => {
  const { email, securityPin, newPassword } = req.body;
  if (!email || !securityPin || !newPassword) return res.status(400).json({ message: "Missing fields" });

  const normalizedEmail = email.trim().toLowerCase();
  db.query("SELECT * FROM users WHERE email = ?", [normalizedEmail], (err, results) => {
    if (err || results.length === 0) return res.status(404).json({ message: "User not found" });
    const user = results[0];
    if (!user.security_pin_hash) return res.status(400).json({ message: "No Security PIN set." });

    bcrypt.compare(securityPin, user.security_pin_hash, async (err, pinValid) => {
      if (err || !pinValid) return res.status(401).json({ message: "Invalid Security PIN" });
      try {
        const newHashedPassword = await bcrypt.hash(newPassword, 10);
        db.query("UPDATE users SET password_hash = ? WHERE user_id = ?", [newHashedPassword, user.user_id], (err) => {
          if (err) return res.status(500).json({ error: "Update failed" });
          res.json({ message: "Password updated" });
        });
      } catch { res.status(500).json({ error: "Error" }); }
    });
  });
});

// PROFILE
app.get("/api/profile", authenticateToken, (req, res) => {
  // FIX: COALESCE so profile always returns masterKey even if user_keys is empty
  const sql = `
    SELECT u.username, u.email, u.profile_photo,
      COALESCE(k.encryption_key, u.client_master_key) as "masterKey"
    FROM users u
    LEFT JOIN user_keys k ON u.user_id = k.user_id
    WHERE u.user_id = ?
  `;
  db.query(sql, [req.user.user_id], (err, results) => {
    if (err) return res.status(500).json({ error: err });
    if (results.length === 0) return res.status(404).json({ message: "User not found" });
    res.json(results[0]);
  });
});

// PROFILE PHOTO
app.post("/api/profile/photo", authenticateToken, (req, res) => {
  const { photoBase64 } = req.body;
  db.query("UPDATE users SET profile_photo = ? WHERE user_id = ?", [photoBase64, req.user.user_id], (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ message: "Profile photo updated" });
  });
});

app.delete("/api/profile/photo", authenticateToken, (req, res) => {
  db.query("UPDATE users SET profile_photo = NULL WHERE user_id = ?", [req.user.user_id], (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ message: "Profile photo removed" });
  });
});

// CHANGE PASSWORD
app.put("/api/profile/password", authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ message: "Missing fields" });

  db.query("SELECT * FROM users WHERE user_id = ?", [req.user.user_id], (err, results) => {
    if (err) return res.status(500).json({ error: err });
    if (results.length === 0) return res.status(404).json({ message: "User not found" });

    bcrypt.compare(currentPassword, results[0].password_hash, async (err, isValid) => {
      if (err) return res.status(500).json({ error: "Verification failed" });
      if (!isValid) return res.status(401).json({ message: "Incorrect current password" });
      try {
        const newHashed = await bcrypt.hash(newPassword, 10);
        db.query("UPDATE users SET password_hash = ? WHERE user_id = ?", [newHashed, req.user.user_id], (err) => {
          if (err) return res.status(500).json({ error: err });
          res.json({ message: "Security protocol updated" });
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
  });
});

// UPDATE THEME
app.post("/api/update-theme", authenticateToken, (req, res) => {
  const { theme } = req.body;
  if (!theme) return res.status(400).json({ message: "Theme is required" });
  db.query("UPDATE users SET theme_preference = ? WHERE user_id = ?", [theme, req.user.user_id], (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ message: "Theme updated successfully", theme });
  });
});

// UPLOAD URL
app.post("/api/upload-url", authenticateToken, async (req, res) => {
  const fileUuid = uuidv4();
  try {
    const uploadUrl = await s3.getSignedUrlPromise("putObject", {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: fileUuid,
      Expires: 300,
      ContentType: "application/octet-stream",
    });
    res.json({ uploadUrl, fileUuid });
  } catch (err) {
    res.status(500).json({ error: "Could not generate upload URL" });
  }
});

// COMPLETE UPLOAD
// FIX: Using atomic transaction to ensure data integrity
app.post("/api/complete-upload", authenticateToken, async (req, res) => {
  const { fileUuid, fileType, encryptedMetadata, metadataIv, encryptedKey, folderId } = req.body;
  const userId = req.user.user_id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Create File Record
    const fileRes = await client.query(
      "INSERT INTO files (file_uuid, owner_id, file_type, folder_id) VALUES ($1, $2, $3, $4) RETURNING file_id",
      [fileUuid, userId, fileType || "other", folderId || null]
    );
    const fileId = fileRes.rows[0].file_id;

    // 2. Create Metadata Record (using BYTEA for binary safety)
    await client.query(
      "INSERT INTO file_metadata (file_id, encrypted_metadata, iv) VALUES ($1, decode($2, 'base64'), $3)",
      [fileId, encryptedMetadata, metadataIv]
    );

    // 3. Create File Keys
    await client.query(
      "INSERT INTO file_keys (file_id, encrypted_key) VALUES ($1, $2)",
      [fileId, encryptedKey]
    );

    // 4. Log the action
    await client.query(
      "INSERT INTO audit_logs (user_id, file_id, action) VALUES ($1, $2, $3)",
      [userId, fileId, "UPLOAD_COMPLETED"]
    );

    await client.query("COMMIT");
    res.json({ message: "Upload completed successfully", fileId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Critical Upload Error:", err);
    res.status(500).json({ message: "Failed to finalize encryption and upload storage." });
  } finally {
    client.release();
  }
});

// FILES LIST
app.get("/api/files", authenticateToken, (req, res) => {
  const userId = req.user.user_id;
  const userEmail = req.user.email;

  db.query(
    `SELECT f.file_id, f.file_uuid, f.created_at, f.folder_id, fm.encrypted_metadata, fm.iv, fk.encrypted_key, 'OWNER' as role
     FROM files f
     JOIN file_metadata fm ON f.file_id = fm.file_id
     JOIN file_keys fk ON f.file_id = fk.file_id
     WHERE f.owner_id = ? AND f.is_deleted = FALSE`,
    [userId],
    (err, myFiles) => {
      if (err) return res.status(500).json({ error: err });

      db.query(
        `SELECT sl.link_id, f.file_id, f.file_uuid, sl.created_at, sl.encrypted_metadata, sl.iv, sl.encrypted_file_key as encrypted_key, sl.downloadable, u.email as sender_email, 'SHARED' as role
         FROM shared_links sl
         JOIN files f ON sl.file_id = f.file_id
         JOIN users u ON f.owner_id = u.user_id
         WHERE sl.recipient_email = ? AND sl.is_used = FALSE AND f.is_deleted = FALSE`,
        [userEmail],
        (err, sharedFiles) => {
          if (err) return res.status(500).json({ error: err });

          const processFiles = (list) => list.map((row) => ({
            link_id: row.link_id,
            file_id: row.file_id,
            file_uuid: row.file_uuid,
            folder_id: row.folder_id,
            created_at: row.created_at,
            encrypted_metadata: row.encrypted_metadata.toString("base64"),
            iv: row.iv,
            downloadable: row.downloadable === 1 || row.downloadable === true,
            encrypted_key: row.encrypted_key,
            role: row.role,
            sender_email: row.sender_email,
          }));

          res.json({ myFiles: processFiles(myFiles), sharedFiles: processFiles(sharedFiles) });
        }
      );
    }
  );
});

// DOWNLOAD URL
app.get("/api/download-url/:fileId", authenticateToken, (req, res) => {
  db.query(
    `SELECT f.file_uuid FROM files f
     LEFT JOIN shared_links sl ON f.file_id = sl.file_id
     WHERE f.file_id = ? AND (f.owner_id = ? OR (sl.recipient_email = ? AND sl.is_used = FALSE))`,
    [req.params.fileId, req.user.user_id, req.user.email],
    async (err, results) => {
      if (err || results.length === 0) return res.status(403).json({ error: "Not authorized or file not found" });
      const url = s3.getSignedUrl("getObject", { Bucket: process.env.S3_BUCKET_NAME, Key: results[0].file_uuid, Expires: 300 });
      res.json({ downloadUrl: url });
    }
  );
});

// DELETE FILE
app.post("/api/delete-file", authenticateToken, (req, res) => {
  const { fileId } = req.body;
  db.query("UPDATE files SET is_deleted = TRUE WHERE file_id = ? AND owner_id = ?", [fileId, req.user.user_id], (err, result) => {
    if (err) return res.status(500).json({ error: err });
    if (result.affectedRows === 0) return res.status(403).json({ message: "Unauthorized or file not found" });
    res.json({ message: "File deleted" });
  });
});

// VERIFY FILE PIN
app.post("/api/verify-file-pin", authenticateToken, (req, res) => {
  const { securityPin } = req.body;
  if (!securityPin) return res.status(400).json({ message: "Security PIN required" });

  db.query("SELECT security_pin_hash FROM users WHERE user_id = ?", [req.user.user_id], (err, results) => {
    if (err) return res.status(500).json({ message: "Database Error" });
    if (results.length === 0) return res.status(404).json({ message: "User not found" });
    if (!results[0].security_pin_hash) return res.status(400).json({ message: "No Security PIN set" });

    bcrypt.compare(securityPin, results[0].security_pin_hash, (err, pinValid) => {
      if (err || !pinValid) return res.status(401).json({ message: "Invalid Security PIN" });
      res.json({ message: "PIN Verified", success: true });
    });
  });
});

// SHARE
app.post("/api/share", authenticateToken, (req, res) => {
  const { fileId, recipientEmail, encryptedFileKeyForLink, encryptedMetadataForLink, metadataIv, linkKey } = req.body;
  const targetEmail = recipientEmail.trim();

  db.query("SELECT user_id FROM users WHERE email = ?", [targetEmail], (err, results) => {
    if (err) return res.status(500).json({ error: err });
    if (results.length === 0) return res.status(404).json({ message: "Recipient user not found." });

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiry = new Date(); expiry.setHours(expiry.getHours() + 24);

    db.query(
      "INSERT INTO shared_links (file_id, recipient_email, token_hash, encrypted_file_key, encrypted_metadata, iv, downloadable, expires_at) VALUES (?, ?, ?, ?, decode(?, 'base64'), ?, ?, ?)",
      [fileId, targetEmail, tokenHash, encryptedFileKeyForLink, encryptedMetadataForLink || "", metadataIv, req.body.downloadable ? 1 : 0, expiry],
      (err) => {
        if (err) return res.status(500).json({ error: err });

        // FIX: use req.protocol instead of hardcoded http
        const shareLink = `${req.protocol}://${req.get("host")}/?token=${token}&key=${linkKey}`;

        db.query("INSERT INTO audit_logs (user_id, file_id, action, details) VALUES (?, ?, ?, ?)",
          [req.user.user_id, fileId, "SHARED", `With ${recipientEmail}`], () => {});

        res.json({ message: "Secure link generated." });
      }
    );
  });
});

// DELETE SHARED LINK
app.delete("/api/share/:linkId", authenticateToken, (req, res) => {
  db.query(
    "DELETE FROM shared_links WHERE link_id = ? AND recipient_email = ?",
    [req.params.linkId, req.user.email],
    (err, result) => {
      if (err) return res.status(500).json({ error: err });
      if (result.affectedRows === 0) return res.status(403).json({ message: "Unauthorized or not found" });
      res.json({ message: "Access removed" });
    }
  );
});

// ACCESS SHARE (burn-after-read link)
app.post("/api/access-share", (req, res) => {
  const { token } = req.body;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  db.query(
    `SELECT sl.link_id, sl.encrypted_file_key, sl.encrypted_metadata, sl.iv, sl.expires_at, sl.is_used, f.file_uuid
     FROM shared_links sl JOIN files f ON sl.file_id = f.file_id WHERE sl.token_hash = ?`,
    [tokenHash],
    (err, results) => {
      if (err || results.length === 0) return res.status(403).json({ message: "Invalid Link" });
      const link = results[0];
      if (link.is_used) return res.status(410).json({ message: "This link has already been used." });
      if (new Date() > new Date(link.expires_at)) return res.status(410).json({ message: "This link has expired." });

      const downloadUrl = s3.getSignedUrl("getObject", { Bucket: process.env.S3_BUCKET_NAME, Key: link.file_uuid, Expires: 300 });

      db.query("UPDATE shared_links SET is_used = TRUE WHERE link_id = ?", [link.link_id], () => {});

      res.json({
        encryptedFileKey: link.encrypted_file_key,
        encryptedMetadata: link.encrypted_metadata ? link.encrypted_metadata.toString("base64") : null,
        metadataIv: link.iv,
        downloadUrl,
      });
    }
  );
});

// ==========================================
// FOLDERS
app.post("/api/folders", authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: "Folder name required" });
  db.query(
    "INSERT INTO folders (owner_id, name) VALUES (?, ?)",
    [req.user.user_id, name.trim()],
    (err) => {
      if (err) return res.status(500).json({ message: "DB Error" });
      res.json({ message: "Folder created" });
    }
  );
});

app.get("/api/folders", authenticateToken, (req, res) => {
  db.query(
    "SELECT * FROM folders WHERE owner_id = ? ORDER BY name ASC",
    [req.user.user_id],
    (err, results) => {
      if (err) return res.status(500).json({ message: "DB Error" });
      res.json(results);
    }
  );
});

app.delete("/api/folders/:id", authenticateToken, (req, res) => {
  db.query(
    "DELETE FROM folders WHERE folder_id = ? AND owner_id = ?",
    [req.params.id, req.user.user_id],
    (err) => {
      if (err) return res.status(500).json({ message: "DB Error" });
      res.json({ message: "Folder deleted" });
    }
  );
});

// START SERVER
// ==========================================

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;

process.on("uncaughtException", (err) => { console.error("[CRITICAL] Uncaught Exception:", err); });
process.on("unhandledRejection", (reason) => { console.error("[CRITICAL] Unhandled Rejection:", reason); });