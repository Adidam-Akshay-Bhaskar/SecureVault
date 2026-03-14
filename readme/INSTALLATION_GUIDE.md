# 🚀 Installation Guide - SecureVault

This guide provides step-by-step instructions to set up and run the SecureVault application on your local machine or production server.

---

## 📋 Table of Contents

1. [Software Requirements](#software-requirements)
2. [Database Setup](#database-setup)
3. [AWS S3 Configuration](#aws-s3-configuration)
4. [Backend Configuration](#backend-configuration)
5. [Environment Variables](#environment-variables)
6. [Running the Application](#running-the-application)
7. [Admin Account Setup](#admin-account-setup)
8. [Troubleshooting](#troubleshooting)

---

## 1. Software Requirements

### Minimum System Requirements

- **OS**: Windows 10/11, macOS 10.15+, or Linux (Ubuntu 20.04+)
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 500MB for application + database space
- **Internet**: Stable connection for AWS S3 access

### Required Software

#### Node.js & npm

- **Version**: Node.js v14.0.0 or higher
- **Download**: https://nodejs.org/

**Verify Installation:**

```bash
node --version
npm --version
```

#### MySQL Server

- **Version**: MySQL 8.0 or higher
- **Download**: https://dev.mysql.com/downloads/mysql/

**Verify Installation:**

```bash
mysql --version
```

#### Git (Optional)

- **Version**: Latest stable
- **Download**: https://git-scm.com/

#### Text Editor (Optional)

- VS Code, Sublime Text, or any code editor

---

## 2. Database Setup

### Step 1: Install MySQL

**Windows:**

1. Download MySQL Installer from official website
2. Run the installer and choose "Developer Default"
3. Set root password during installation
4. Complete the installation wizard

**macOS:**

```bash
brew install mysql
brew services start mysql
```

**Linux (Ubuntu):**

```bash
sudo apt update
sudo apt install mysql-server
sudo mysql_secure_installation
```

### Step 2: Create Database

**Option A: Using Command Line**

```bash
mysql -u root -p
```

Then execute:

```sql
CREATE DATABASE secure_file_sharing;
EXIT;
```

**Option B: Using Automated Script**

```bash
cd database
node init_db.js
```

### Step 3: Verify Database Creation

```bash
mysql -u root -p
SHOW DATABASES;
USE secure_file_sharing;
SHOW TABLES;
```

You should see the following tables:

- `users`
- `files`
- `file_metadata`
- `file_keys`
- `shared_links`
- `audit_logs`
- `admins`
- `admin_logs`

---

## 3. AWS S3 Configuration

### Step 1: Create AWS Account

1. Go to https://aws.amazon.com/
2. Sign up for a free tier account
3. Complete email verification

### Step 2: Create IAM User

1. **Navigate to IAM Console**

   - Go to AWS Console → IAM → Users → Add User

2. **User Details**

   - Username: `securevault-app`
   - Access type: ✅ Programmatic access

3. **Set Permissions**

   - Attach existing policies directly
   - Select: `AmazonS3FullAccess`

4. **Save Credentials**
   - Download the CSV file containing:
     - Access Key ID
     - Secret Access Key
   - ⚠️ **Keep these credentials secure!**

### Step 3: Create S3 Bucket

1. **Navigate to S3 Console**

   - Go to AWS Console → S3 → Create Bucket

2. **Bucket Configuration**

   - **Bucket name**: `securevault-files-[your-unique-id]`
   - **Region**: Choose closest region (e.g., `eu-north-1`)
   - **Block Public Access**: Keep all enabled (default)
   - **Versioning**: Disabled (optional)
   - **Encryption**: Server-side encryption (optional, we use client-side)

3. **Create Bucket**

### Step 4: Configure CORS (Automatic)

The application automatically configures CORS on startup. However, if you need to set it manually:

1. Go to your S3 bucket
2. Navigate to **Permissions** → **CORS**
3. Add the following configuration:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag"]
  }
]
```

---

## 4. Backend Configuration

### Step 1: Navigate to Project Directory

```bash
cd Project56/backend
```

### Step 2: Install Dependencies

```bash
npm install
```

This will install:

- express
- mysql2
- aws-sdk
- bcryptjs
- jsonwebtoken
- cors
- dotenv
- nodemailer
- crypto (built-in)

### Step 3: Verify Installation

```bash
npm list
```

---

## 5. Environment Variables

### Step 1: Create `.env` File

In the `backend` directory, create a file named `.env`:

```bash
cd backend
touch .env
```

### Step 2: Configure Environment Variables

Open `.env` in a text editor and add:

```env
# Server Configuration
PORT=3000

# Database Configuration
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=secure_file_sharing

# JWT Secret (Generate a random string)
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production

# AWS Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=eu-north-1
S3_BUCKET_NAME=securevault-files-your-unique-id

# Email Configuration (for OTP)
SYSTEM_EMAIL=your_email@gmail.com
SYSTEM_EMAIL_PASS=your_gmail_app_password
```

### Step 3: Generate Strong JWT Secret

**Option A: Using Node.js**

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Option B: Using OpenSSL**

```bash
openssl rand -hex 64
```

### Step 4: Gmail App Password Setup

1. Go to Google Account Settings
2. Navigate to Security → 2-Step Verification
3. Scroll to "App passwords"
4. Generate new app password for "Mail"
5. Copy the 16-character password
6. Use this in `SYSTEM_EMAIL_PASS`

⚠️ **Note**: Regular Gmail password won't work. You must use an App Password.

---

## 6. Running the Application

### Step 1: Start the Server

**Development Mode:**

```bash
cd backend
npm start
```

**Production Mode (with PM2):**

```bash
npm install -g pm2
pm2 start server.js --name securevault
pm2 save
pm2 startup
```

### Step 2: Verify Server is Running

You should see:

```
=======================================================
       !!! SECURE VAULT - CLOUD STORAGE LIVE !!!
=======================================================

Connected to MySQL Database
S3 Bucket CORS Configured Successfully
Server running on port 3000
```

### Step 3: Access the Application

Open your browser and navigate to:

```
http://localhost:3000
```

You should see the SecureVault login page.

---

## 7. Admin Account Setup

### Option 1: Using Setup Script

1. **Create setup script** (if not exists):

Create `backend/setup_admin.js`:

```javascript
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function createAdmin() {
  const username = "admin";
  const password = "admin123";
  const email = "admin@securevault.com";

  const hashedPassword = await bcrypt.hash(password, 10);

  const sql =
    "INSERT INTO admins (username, email, password_hash) VALUES (?, ?, ?)";

  db.query(sql, [username, email, hashedPassword], (err) => {
    if (err) {
      console.error("Error creating admin:", err);
    } else {
      console.log("✅ Admin account created successfully!");
      console.log("Username:", username);
      console.log("Password:", password);
      console.log("⚠️ Please change the password after first login!");
    }
    db.end();
  });
}

db.connect((err) => {
  if (err) {
    console.error("Database connection failed:", err);
  } else {
    createAdmin();
  }
});
```

2. **Run the script:**

```bash
node setup_admin.js
```

### Option 2: Manual SQL Insert

```bash
mysql -u root -p
```

```sql
USE secure_file_sharing;

INSERT INTO admins (username, email, password_hash)
VALUES ('admin', 'admin@securevault.com', '$2a$10$YourHashedPasswordHere');
```

### Default Admin Credentials

- **Username**: `admin`
- **Password**: `admin123`
- **Email**: `admin@securevault.com`

⚠️ **Important**: Change these credentials immediately after first login!

---

## 8. Troubleshooting

### Database Connection Issues

**Error**: `ER_ACCESS_DENIED_ERROR`

```bash
# Reset MySQL root password
mysql -u root
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'new_password';
FLUSH PRIVILEGES;
```

**Error**: `ER_BAD_DB_ERROR`

```bash
# Recreate database
mysql -u root -p
CREATE DATABASE secure_file_sharing;
```

### AWS S3 Issues

**Error**: `InvalidAccessKeyId`

- Verify AWS credentials in `.env`
- Check IAM user has S3 permissions
- Ensure no extra spaces in credentials

**Error**: `NoSuchBucket`

- Verify bucket name matches `.env`
- Check bucket exists in correct region
- Ensure region code is correct (e.g., `eu-north-1`)

### Port Already in Use

**Error**: `EADDRINUSE: address already in use :::3000`

**Windows:**

```bash
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**macOS/Linux:**

```bash
lsof -ti:3000 | xargs kill -9
```

Or change port in `.env`:

```env
PORT=3001
```

### Email OTP Not Sending

1. **Verify Gmail App Password**

   - Use App Password, not regular password
   - Enable 2-Step Verification first

2. **Check Console Logs**

   - OTP is always printed to console for development
   - Look for: `🔐 ADMIN OTP VERIFICATION CODE`

3. **Test Email Configuration**

```javascript
// Test script
const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "your_email@gmail.com",
    pass: "your_app_password",
  },
});

transporter.sendMail(
  {
    from: "your_email@gmail.com",
    to: "test@example.com",
    subject: "Test",
    text: "Test email",
  },
  (err, info) => {
    console.log(err || "Email sent: " + info.response);
  }
);
```

### Frontend Not Loading

1. **Clear Browser Cache**

   - Press `Ctrl + Shift + Delete`
   - Clear cached images and files

2. **Check Console Errors**

   - Press `F12` → Console tab
   - Look for JavaScript errors

3. **Verify Static Files**
   - Ensure `frontend` folder exists
   - Check `index.html`, `style.css`, `app.js` are present

### CORS Errors

**Error**: `Access-Control-Allow-Origin`

1. **Check S3 CORS Configuration**
2. **Restart Server** (CORS is auto-configured on startup)
3. **Manually set CORS** in S3 bucket permissions

---

## ✅ Installation Complete!

Your SecureVault application should now be running successfully!

### Next Steps:

1. Register a new user account
2. Test file upload and encryption
3. Test secure sharing functionality
4. Login to admin panel
5. Review [User Guide](USER_GUIDE.md) for usage instructions

### Quick Test Checklist:

- [ ] Server starts without errors
- [ ] Database connection successful
- [ ] Frontend loads at `http://localhost:3000`
- [ ] User registration works
- [ ] User login works
- [ ] File upload works
- [ ] File download works
- [ ] Admin login works
- [ ] OTP emails received

---

**Need Help?** Check [KNOWN_ISSUES.md](KNOWN_ISSUES.md) or contact support.
