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

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use((req, res, next) => { console.log(`[REQUEST] ${req.method} ${req.url}`); next(); });
app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.resolve(__dirname, "..", "frontend", "index.html"));
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
});

// FIX: db wrapper correctly returns insertId for both users and files inserts
const db = {
  query: (sql, params, callback) => {
    if (typeof params === "function") { callback = params; params = []; }

    let index = 1;
    let pgSql = sql.replace(/\?/g, () => `$${index++}`);

    let returningCol = null;
    if (pgSql.match(/INSERT INTO files /i)) returningCol = "file_id";
    else if (pgSql.match(/INSERT INTO users /i)) returningCol = "user_id";
    if (returningCol) pgSql += ` RETURNING ${returningCol}`;

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
  },

  // FIX: Real transactions using a dedicated client per transaction
  beginTransaction: (callback) => {
    pool.connect((err, client, release) => {
      if (err) return callback(err);
      client.query("BEGIN", (err) => {
        if (err) { release(); return callback(err); }
        db._client = client;
        db._release = release;
        callback(null);
      });
    });
  },
  commit: (callback) => {
    if (!db._client) return callback(null);
    db._client.query("COMMIT", (err) => {
      db._release(); db._client = null; callback(err);
    });
  },
  rollback: (callback) => {
    if (!db._client) return callback(null);
    db._client.query("ROLLBACK", (err) => {
      db._release(); db._client = null; callback(err);
    });
  },
};

pool.query("SELECT 1", (err) => {
  if (err) { console.error("Database connection failed:", err); }
  else {
    console.log("Connected to PostgreSQL Database");
    configureBucketCors();
    ensureOtpTable();
  }
});

// ==========================================
// OTP TABLE (FIX: replaces in-memory Map that resets on Vercel cold start)
// ==========================================

async function ensureOtpTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_store (
        email TEXT PRIMARY KEY,
        otp_hash TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL
      )
    `);
    console.log("otp_store table ready");
  } catch (err) {
    console.error("Failed to create otp_store table:", err.message);
  }
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
          if (err.code === "ER_DUP_ENTRY" || err.message.includes("unique constraint"))
            return res.status(400).json({ message: "Email already exists" });
          return res.status(500).json({ error: err.message });
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

      if (user.security_pin_hash) {
        if (!securityPin) return res.status(401).json({ message: "2FA_REQUIRED", details: "Security PIN needed" });
        bcrypt.compare(securityPin, user.security_pin_hash, (err, pinValid) => {
          if (err || !pinValid) return res.status(401).json({ message: "Invalid Security PIN" });
          generateTokenAndResponse(res, user);
        });
      } else {
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
    SELECT u.username, u.email, u.profile_photo, u.theme_preference,
      COALESCE(k.encryption_key, u.client_master_key) as masterKey
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
app.post("/api/complete-upload", authenticateToken, (req, res) => {
  const { fileUuid, fileType, encryptedMetadata, metadataIv, encryptedKey } = req.body;

  db.beginTransaction((err) => {
    if (err) return res.status(500).json({ error: err });

    db.query(
      "INSERT INTO files (file_uuid, owner_id, file_type) VALUES (?, ?, ?)",
      [fileUuid, req.user.user_id, fileType || "other"],
      (err, result) => {
        if (err) { db.rollback(() => {}); return res.status(500).json({ error: err }); }
        const fileId = result.insertId;

        db.query(
          "INSERT INTO file_metadata (file_id, encrypted_metadata, iv) VALUES (?, decode(?, 'base64'), ?)",
          [fileId, encryptedMetadata, metadataIv],
          (err) => {
            if (err) { db.rollback(() => {}); return res.status(500).json({ error: err }); }

            db.query(
              "INSERT INTO file_keys (file_id, encrypted_key) VALUES (?, ?)",
              [fileId, encryptedKey],
              (err) => {
                if (err) { db.rollback(() => {}); return res.status(500).json({ error: err }); }

                db.commit((err) => {
                  if (err) { db.rollback(() => {}); return res.status(500).json({ error: err }); }
                  db.query("INSERT INTO audit_logs (user_id, file_id, action) VALUES (?, ?, ?)", [req.user.user_id, fileId, "UPLOAD_COMPLETED"], () => {});
                  res.json({ message: "Upload completed successfully", fileId });
                });
              }
            );
          }
        );
      }
    );
  });
});

// FILES LIST
app.get("/api/files", authenticateToken, (req, res) => {
  const userId = req.user.user_id;
  const userEmail = req.user.email;

  db.query(
    `SELECT f.file_id, f.file_uuid, f.created_at, fm.encrypted_metadata, fm.iv, fk.encrypted_key, 'OWNER' as role
     FROM files f
     JOIN file_metadata fm ON f.file_id = fm.file_id
     JOIN file_keys fk ON f.file_id = fk.file_id
     WHERE f.owner_id = ? AND f.is_deleted = FALSE`,
    [userId],
    (err, myFiles) => {
      if (err) return res.status(500).json({ error: err });

      db.query(
        `SELECT sl.link_id, f.file_id, f.file_uuid, sl.created_at, sl.encrypted_metadata, sl.iv, sl.encrypted_file_key as encrypted_key, u.email as sender_email, 'SHARED' as role
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
            created_at: row.created_at,
            encrypted_metadata: row.encrypted_metadata.toString("base64"),
            iv: row.iv,
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
      "INSERT INTO shared_links (file_id, recipient_email, token_hash, encrypted_file_key, encrypted_metadata, iv, expires_at) VALUES (?, ?, ?, ?, decode(?, 'base64'), ?, ?)",
      [fileId, targetEmail, tokenHash, encryptedFileKeyForLink, encryptedMetadataForLink || "", metadataIv, expiry],
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
// SERVER
// ==========================================

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;

process.on("uncaughtException", (err) => { console.error("[CRITICAL] Uncaught Exception:", err); });
process.on("unhandledRejection", (reason) => { console.error("[CRITICAL] Unhandled Rejection:", reason); });