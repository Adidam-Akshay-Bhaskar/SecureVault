const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
console.log("\n\n\n\n=======================================================");
console.log("       !!! SECURE VAULT - CLOUD STORAGE LIVE !!!       ");
console.log("=======================================================\n\n\n");
const { Pool } = require("pg");
const AWS = require("aws-sdk");
const crypto = require("crypto");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const uuidv4 = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
const nodemailer = require('nodemailer');

const app = express();

app.get("/", (req, res) => {
  res.sendFile(path.resolve(__dirname, "..", "frontend", "index.html"));
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  next();
});
app.use(express.static(path.join(__dirname, "../frontend")));

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
  signatureVersion: "v4",
});

const s3 = new AWS.S3();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || ""),
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
  ssl: { rejectUnauthorized: false }
});

const db = {
  query: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    
    let index = 1;
    let pgSql = sql.replace(/\?/g, () => `$${index++}`);
    
    let isFilesInsert = false;
    if (pgSql.match(/INSERT INTO files /i)) {
      pgSql += " RETURNING file_id";
      isFilesInsert = true;
    }
    
    pool.query(pgSql, params, (err, res) => {
      if (err) {
        if (err.code === '23505') err.code = "ER_DUP_ENTRY";
        return callback(err, null);
      }
      
      if (res.command === 'SELECT') {
        return callback(null, res.rows);
      }
      
      let resultObj = { affectedRows: res.rowCount };
      if (isFilesInsert && res.rows && res.rows.length > 0) {
        resultObj.insertId = res.rows[0].file_id || res.rows[0].id;
      }
      
      return callback(null, resultObj);
    });
  },
  
  beginTransaction: (callback) => { callback(null); },
  commit: (callback) => { callback(null); },
  rollback: (callback) => { callback(null); }
};

pool.query("SELECT 1", (err) => {
  if (err) {
    console.error("Database connection failed:", err);
  } else {
    console.log("Connected to PostgreSQL Database");
    configureBucketCors();
  }
});

const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SYSTEM_EMAIL,
    pass: process.env.SYSTEM_EMAIL_PASS
  }
});

const otpStore = new Map();

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

async function configureBucketCors() {
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedHeaders: ["*"],
          AllowedMethods: ["PUT", "GET", "HEAD"],
          AllowedOrigins: ["*"],
          ExposeHeaders: ["ETag"],
        },
      ],
    },
  };
  try {
    await s3.putBucketCors(params).promise();
    console.log("S3 Bucket CORS Configured Successfully");
  } catch (err) {
    console.warn("Could not configure S3 CORS.", err.message);
  }
}

// ROUTES

app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    port: process.env.PORT,
    db: "connected",
  });
});

app.post("/api/register", async (req, res) => {
  const { username, email, password, securityPin } = req.body;

  if (!username || !email || !password || !securityPin) {
    return res.status(400).json({ message: "Missing fields (PIN required)" });
  }

  if (!/^\d{4}$|^\d{6}$/.test(securityPin)) {
    return res.status(400).json({ message: "PIN must be 4 or 6 digits" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedPin = await bcrypt.hash(securityPin, 10);
    const normalizedEmail = email.trim().toLowerCase();

    const sql =
      "INSERT INTO users (username, email, password_hash, security_pin_hash) VALUES (?, ?, ?, ?)";
    db.query(
      sql,
      [username.trim(), normalizedEmail, hashedPassword, hashedPin],
      (err, result) => {
        if (err) {
          if (err.code === "ER_DUP_ENTRY")
            return res.status(400).json({ message: "Email already exists" });
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: "User registered successfully" });
      }
    );
  } catch (err) {
    res.status(500).send();
  }
});

app.post("/api/login", (req, res) => {
  const { email, password, securityPin } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "Missing credentials" });

  const normalizedEmail = email.trim().toLowerCase();

  const sql = "SELECT * FROM users WHERE email = ?";
  db.query(sql, [normalizedEmail], (err, results) => {
    if (err) {
      return res.status(500).json({ error: "Internal Server Error" });
    }

    if (results.length === 0) {
      return res.status(401).json({ message: "Invalid Credentials" });
    }

    const user = results[0];
    bcrypt.compare(password, user.password_hash, (err, isValid) => {
      if (err || !isValid) {
        return res.status(401).json({ message: "Invalid Credentials" });
      }

      if (user.security_pin_hash) {
        if (!securityPin) {
          return res.status(401).json({
            message: "2FA_REQUIRED",
            details: "Security PIN needed for verification",
          });
        }

        bcrypt.compare(securityPin, user.security_pin_hash, (err, pinValid) => {
          if (err || !pinValid) {
            return res.status(401).json({ message: "Invalid Security PIN" });
          }
          generateTokenAndResponse(res, user);
        });
      } else {
        generateTokenAndResponse(res, user);
      }
    });
  });
});

app.post("/api/verify-identity", (req, res) => {
  const { email, securityPin } = req.body;
  if (!email || !securityPin) return res.status(400).json({ message: "Missing fields" });

  const normalizedEmail = email.trim().toLowerCase();
  const pinStr = String(securityPin).trim(); 

  const sql = "SELECT * FROM users WHERE email = ?";
  db.query(sql, [normalizedEmail], (err, results) => {
    if (err) {
       return res.status(500).json({ message: "Database Error" });
    }
    if (results.length === 0) return res.status(404).json({ message: "User not found" });
    
    const user = results[0];

    if (!user.security_pin_hash) return res.status(400).json({ message: "No Security PIN set." });

    bcrypt.compare(pinStr, user.security_pin_hash, (err, pinValid) => {
      if (err || !pinValid) {
          return res.status(401).json({ message: "Invalid Security PIN" });
      }
      res.json({ message: "Identity Verified" });
    });
  });
});

app.post("/api/reset-password", (req, res) => {
  const { email, securityPin, newPassword } = req.body;
  if (!email || !securityPin || !newPassword) return res.status(400).json({ message: "Missing fields" });

  const normalizedEmail = email.trim().toLowerCase();
  const sql = "SELECT * FROM users WHERE email = ?";
  db.query(sql, [normalizedEmail], (err, results) => {
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
      } catch (e) { res.status(500).json({ error: "Error" }); }
    });
  });
});

function generateTokenAndResponse(res, user) {
  const accessToken = jwt.sign(
    { user_id: user.user_id, email: user.email },
    process.env.JWT_SECRET
  );
  res.json({
    accessToken: accessToken,
    user: { username: user.username, email: user.email },
  });
}

app.post("/api/upload-url", authenticateToken, async (req, res) => {
  const fileUuid = uuidv4(); 
  const s3Params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileUuid,
    Expires: 300, 
    ContentType: "application/octet-stream",
  };

  try {
    const uploadUrl = await s3.getSignedUrlPromise("putObject", s3Params);
    res.json({ uploadUrl, fileUuid });
  } catch (err) {
    res.status(500).json({ error: "Could not generate upload URL" });
  }
});

app.post("/api/complete-upload", authenticateToken, (req, res) => {
  const { fileUuid, fileType, encryptedMetadata, metadataIv, encryptedKey } = req.body;
  
  db.beginTransaction((err) => {
    if (err) return res.status(500).json({ error: err });

    const fileSql = "INSERT INTO files (file_uuid, owner_id, file_type) VALUES (?, ?, ?)";
    db.query(fileSql, [fileUuid, req.user.user_id, fileType || 'other'], (err, result) => {
      if (err) {
        db.rollback(() => {});
        return res.status(500).json({ error: err });
      }
      const fileId = result.insertId;

      const metaSql =
        "INSERT INTO file_metadata (file_id, encrypted_metadata, iv) VALUES (?, decode(?, 'base64'), ?)";
      db.query(
        metaSql,
        [fileId, encryptedMetadata, metadataIv],
        (err) => {
          if (err) {
            db.rollback(() => {});
            return res.status(500).json({ error: err });
          }

          const keySql =
            "INSERT INTO file_keys (file_id, encrypted_key) VALUES (?, ?)";
          db.query(keySql, [fileId, encryptedKey], (err) => {
            if (err) {
              db.rollback(() => {});
              return res.status(500).json({ error: err });
            }

            db.commit((err) => {
              if (err) {
                db.rollback(() => {});
                return res.status(500).json({ error: err });
              }

              db.query(
                "INSERT INTO audit_logs (user_id, file_id, action) VALUES (?, ?, ?)",
                [req.user.user_id, fileId, "UPLOAD_COMPLETED"],
                () => {}
              );

              res.json({ message: "Upload completed successfully", fileId });
            });
          });
        }
      );
    });
  });
});

app.get("/api/files", authenticateToken, (req, res) => {
  const userId = req.user.user_id;
  const userEmail = req.user.email;

  const myFilesSql = `
        SELECT f.file_id, f.file_uuid, f.created_at, fm.encrypted_metadata, fm.iv, fk.encrypted_key, 'OWNER' as role 
        FROM files f
        JOIN file_metadata fm ON f.file_id = fm.file_id
        JOIN file_keys fk ON f.file_id = fk.file_id
        WHERE f.owner_id = ? AND f.is_deleted = FALSE
    `;

  const sharedSql = `
        SELECT sl.link_id, f.file_id, f.file_uuid, sl.created_at, sl.encrypted_metadata, sl.iv, sl.encrypted_file_key as encrypted_key, u.email as sender_email, 'SHARED' as role
        FROM shared_links sl
        JOIN files f ON sl.file_id = f.file_id
        JOIN users u ON f.owner_id = u.user_id  
        WHERE sl.recipient_email = ? AND sl.is_used = FALSE AND f.is_deleted = FALSE
    `;

  db.query(myFilesSql, [userId], (err, myFiles) => {
    if (err) return res.status(500).json({ error: err });

    db.query(sharedSql, [userEmail], (err, sharedFiles) => {
      if (err) return res.status(500).json({ error: err });

      const processFiles = (list) =>
        list.map((row) => ({
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

      res.json({
        myFiles: processFiles(myFiles),
        sharedFiles: processFiles(sharedFiles),
      });
    });
  });
});

app.post("/api/profile/photo", authenticateToken, (req, res) => {
  const { photoBase64 } = req.body; 
  const sql = "UPDATE users SET profile_photo = ? WHERE user_id = ?";
  db.query(sql, [photoBase64, req.user.user_id], (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ message: "Profile photo updated" });
  });
});

app.put("/api/profile/password", authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: "Missing fields" });
  }

  const sql = "SELECT * FROM users WHERE user_id = ?";
  db.query(sql, [req.user.user_id], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err });
    }
    if (results.length === 0)
      return res.status(404).json({ message: "User not found" });

    const user = results[0];
    bcrypt.compare(
      currentPassword,
      user.password_hash,
      async (err, isValid) => {
        if (err) {
          return res.status(500).json({ error: "Encryption verification failed" });
        }
        if (!isValid) {
          return res.status(401).json({ message: "Incorrect current password" });
        }

        try {
          const newHashed = await bcrypt.hash(newPassword, 10);
          db.query(
            "UPDATE users SET password_hash = ? WHERE user_id = ?",
            [newHashed, req.user.user_id],
            (err) => {
              if (err) return res.status(500).json({ error: err });
              res.json({ message: "Security protocol updated" });
            }
          );
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      }
    );
  });
});

app.post("/api/delete-file", authenticateToken, (req, res) => {
  const { fileId } = req.body;
  const sql = "UPDATE files SET is_deleted = TRUE WHERE file_id = ? AND owner_id = ?";
  db.query(sql, [fileId, req.user.user_id], (err, result) => {
    if (err) return res.status(500).json({ error: err });
    if (result.affectedRows === 0)
      return res.status(403).json({ message: "Unauthorized or file not found" });
    res.json({ message: "File deleted" });
  });
});

app.delete("/api/share/:linkId", authenticateToken, (req, res) => {
  const linkId = req.params.linkId;
  const sql = "DELETE FROM shared_links WHERE link_id = ? AND recipient_email = ?";
  db.query(sql, [linkId, req.user.email], (err, result) => {
    if (err) return res.status(500).json({ error: err });
    if (result.affectedRows === 0)
      return res.status(403).json({ message: "Unauthorized or not found" });
    res.json({ message: "Access removed" });
  });
});

app.get("/api/debug/users", (req, res) => {
    db.query("SELECT * FROM users", (err, results) => {
        res.json(results);
    });
});

app.get("/api/profile", authenticateToken, (req, res) => {
  const sql = "SELECT username, email, profile_photo, theme_preference FROM users WHERE user_id = ?";
  db.query(sql, [req.user.user_id], (err, results) => {
    if (err) return res.status(500).json({ error: err });
    if (results.length === 0)
      return res.status(404).json({ message: "User not found" });
    res.json(results[0]);
  });
});

app.post("/api/update-theme", authenticateToken, (req, res) => {
  const { theme } = req.body;
  
  if (!theme) {
    return res.status(400).json({ message: "Theme is required" });
  }
  
  const sql = "UPDATE users SET theme_preference = ? WHERE user_id = ?";
  db.query(sql, [theme, req.user.user_id], (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ message: "Theme updated successfully", theme });
  });
});

app.get("/api/download-url/:fileId", authenticateToken, (req, res) => {
  const sql = `
        SELECT f.file_uuid 
        FROM files f 
        LEFT JOIN shared_links sl ON f.file_id = sl.file_id 
        WHERE f.file_id = ? 
        AND (
            f.owner_id = ? 
            OR (sl.recipient_email = ? AND sl.is_used = FALSE)
        )
    `;
  db.query(
    sql,
    [req.params.fileId, req.user.user_id, req.user.email],
    async (err, results) => {
      if (err || results.length === 0)
        return res
          .status(403)
          .json({ error: "Not authorized or file not found" });

      const fileUuid = results[0].file_uuid;
      const url = s3.getSignedUrl("getObject", {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: fileUuid,
        Expires: 300,
      });
      res.json({ downloadUrl: url });
    }
  );
});

app.post("/api/verify-file-pin", authenticateToken, (req, res) => {
  const { securityPin } = req.body;
  
  if (!securityPin) {
    return res.status(400).json({ message: "Security PIN required" });
  }
  
  const sql = "SELECT security_pin_hash FROM users WHERE user_id = ?";
  db.query(sql, [req.user.user_id], (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Database Error" });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    
    const user = results[0];
    
    if (!user.security_pin_hash) {
      return res.status(400).json({ message: "No Security PIN set" });
    }
    
    bcrypt.compare(securityPin, user.security_pin_hash, (err, pinValid) => {
      if (err || !pinValid) {
        return res.status(401).json({ message: "Invalid Security PIN" });
      }
      res.json({ message: "PIN Verified", success: true });
    });
  });
});

app.post("/api/share", authenticateToken, (req, res) => {
  const {
    fileId,
    recipientEmail,
    encryptedFileKeyForLink,
    encryptedMetadataForLink,
    metadataIv,
  } = req.body;

  const targetEmail = recipientEmail.trim();
  
  db.query("SELECT user_id FROM users WHERE email = ?", [targetEmail], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ message: "Recipient user not found." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 24);

    const sql =
      "INSERT INTO shared_links (file_id, recipient_email, token_hash, encrypted_file_key, encrypted_metadata, iv, expires_at) VALUES (?, ?, ?, ?, decode(?, 'base64'), ?, ?)";

    db.query(
      sql,
      [
        fileId,
        targetEmail,
        tokenHash,
        encryptedFileKeyForLink,
        encryptedMetadataForLink || '',
        metadataIv,
        expiry,
      ],
      async (err) => {
        if (err) return res.status(500).json({ error: err });

        const { linkKey } = req.body;
      const shareLink = `http://${req.get(
        "host"
      )}/?token=${token}&key=${linkKey}`;

      db.query(
        "INSERT INTO audit_logs (user_id, file_id, action, details) VALUES (?, ?, ?, ?)",
        [req.user.user_id, fileId, "SHARED", `With ${recipientEmail}`],
        () => {}
      );

      res.json({ message: `Secure link generated.` });
    }
  );
  });
});

app.post("/api/access-share", (req, res) => {
  const { token } = req.body;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const sql = `
        SELECT sl.link_id, sl.encrypted_file_key, sl.encrypted_metadata, sl.iv, sl.expires_at, sl.is_used, f.file_uuid
        FROM shared_links sl
        JOIN files f ON sl.file_id = f.file_id
        WHERE sl.token_hash = ?
    `;

  db.query(sql, [tokenHash], (err, results) => {
    if (err || results.length === 0)
      return res.status(403).json({ message: "Invalid Link" });

    const link = results[0];

    if (link.is_used)
      return res
        .status(410)
        .json({ message: "This link has already been used. Access denied." });
    if (new Date() > new Date(link.expires_at))
      return res.status(410).json({ message: "This link has expired." });

    const downloadUrl = s3.getSignedUrl("getObject", {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: link.file_uuid,
      Expires: 300,
    });

    db.query(
      "UPDATE shared_links SET is_used = TRUE WHERE link_id = ?",
      [link.link_id],
      () => {
        db.query(
          "INSERT INTO audit_logs (file_id, action, details) VALUES (?, ?, ?)",
          [0, "ACCESSED_BURNED", "Link used"],
          () => {}
        );
      }
    );

    res.json({
      encryptedFileKey: link.encrypted_file_key,
      encryptedMetadata: link.encrypted_metadata
        ? link.encrypted_metadata.toString("base64")
        : null,
      metadataIv: link.iv,
      downloadUrl: downloadUrl,
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

process.on("uncaughtException", (err) => {
  console.error("[CRITICAL] Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRITICAL] Unhandled Rejection:", reason);
});
