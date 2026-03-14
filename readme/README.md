# SecureVault - Secure File Sharing System Using Cloud

![SecureVault](https://img.shields.io/badge/Security-AES%20%2B%20RSA-blue) ![Platform](https://img.shields.io/badge/Platform-AWS%20S3-orange) ![Status](https://img.shields.io/badge/Status-Active-success)

## 📋 Project Overview

**SecureVault** is an advanced cloud-based file sharing platform that implements **client-side encryption** using **AES-256-GCM** and **RSA key wrapping** to ensure maximum security and privacy. Files are encrypted on the user's device before being uploaded to AWS S3, ensuring that even the server never has access to unencrypted data.

### 🎯 Key Highlights

- **Zero-Knowledge Architecture**: Files are encrypted client-side before upload
- **Hybrid Encryption**: AES-256-GCM for file encryption + RSA for key wrapping
- **Secure Sharing**: One-time use shareable links with automatic burn-after-read
- **Two-Factor Authentication**: Security PIN verification for enhanced account protection
- **Admin Dashboard**: Complete system monitoring and user management
- **Cloud Storage**: AWS S3 integration for scalable file storage
- **Modern UI**: Responsive glassmorphic design with dark/light theme support

---

## ✨ Features

### User Features

- 🔐 **Secure Registration & Login** with 2FA (Security PIN)
- 📤 **Client-Side File Encryption** (AES-256-GCM)
- ☁️ **Cloud Upload** to AWS S3 with presigned URLs
- 📥 **Secure Download** with automatic decryption
- 🔗 **Shareable Links** with one-time access tokens
- 🔥 **Burn-After-Read** - Links expire after single use
- 👤 **Profile Management** with photo upload
- 🎨 **Theme Customization** (Light/Dark modes)
- 🔑 **Password Recovery** using Security PIN

### Admin Features

- 📊 **System Dashboard** with real-time statistics
- 👥 **User Management** (view, suspend, delete users)
- 📁 **File Monitoring** across all users
- 🔍 **Audit Logs** for security tracking
- 📧 **OTP-Based Login** for enhanced admin security
- 🔐 **Admin Password Recovery** with email verification

### Security Features

- **Client-Side Encryption**: Files never leave the device unencrypted
- **AES-256-GCM**: Military-grade symmetric encryption
- **RSA Key Wrapping**: Secure key exchange mechanism
- **JWT Authentication**: Stateless session management
- **Bcrypt Password Hashing**: Industry-standard password protection
- **Security PIN**: Additional 2FA layer
- **Audit Logging**: Complete activity tracking
- **One-Time Links**: Automatic link invalidation after use

---

## 🛠️ Tech Stack

### Frontend

- **HTML5** - Semantic markup
- **CSS3** - Glassmorphic design with animations
- **Vanilla JavaScript** - No framework dependencies
- **Web Crypto API** - Client-side encryption

### Backend

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **MySQL** - Relational database
- **AWS SDK** - S3 cloud storage integration

### Security

- **AES-256-GCM** - File encryption
- **RSA-OAEP** - Key wrapping
- **bcryptjs** - Password hashing
- **jsonwebtoken** - JWT authentication
- **nodemailer** - Email OTP delivery

### Cloud Infrastructure

- **AWS S3** - Object storage
- **AWS IAM** - Access management
- **CORS Configuration** - Secure cross-origin requests

---

## 🔒 Security Model

### Encryption Flow

```
┌─────────────┐
│   User File │
└──────┬──────┘
       │
       ▼
┌─────────────────────────┐
│ Generate Random AES Key │ (256-bit)
└──────────┬──────────────┘
           │
           ▼
┌──────────────────────┐
│ Encrypt File with AES│ (AES-256-GCM)
└──────────┬───────────┘
           │
           ▼
┌────────────────────────┐
│ Upload to AWS S3       │ (Encrypted Blob)
└────────────────────────┘

┌──────────────────────────┐
│ Wrap AES Key with Master │ (RSA-OAEP)
└──────────┬───────────────┘
           │
           ▼
┌─────────────────────┐
│ Store in Database   │ (Encrypted Key)
└─────────────────────┘
```

### Key Management

1. **Master Key**: Generated once per user session, stored in browser memory
2. **File Key**: Unique AES-256 key per file
3. **Wrapped Key**: File key encrypted with master key, stored in database
4. **Share Key**: Temporary key for one-time link access

---

## 🚀 How to Run

### Prerequisites

- Node.js (v14 or higher)
- MySQL Server (v8.0 or higher)
- AWS Account with S3 access
- Gmail account for OTP emails (or SMTP server)

### Installation Steps

1. **Clone the Repository**

   ```bash
   git clone <repository-url>
   cd Project56
   ```

2. **Install Dependencies**

   ```bash
   cd backend
   npm install
   ```

3. **Configure Environment**
   Create a `.env` file in the `backend` directory:

   ```env
   PORT=3000
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=secure_file_sharing
   JWT_SECRET=your_super_secret_jwt_key
   AWS_ACCESS_KEY_ID=your_aws_access_key
   AWS_SECRET_ACCESS_KEY=your_aws_secret_key
   AWS_REGION=eu-north-1
   S3_BUCKET_NAME=your_bucket_name
   SYSTEM_EMAIL=your_email@gmail.com
   SYSTEM_EMAIL_PASS=your_app_password
   ```

4. **Setup Database**

   ```bash
   cd database
   node init_db.js
   ```

5. **Create Admin Account**

   ```bash
   cd backend
   node setup_admin.js
   ```

   Default admin credentials: `username=admin`, `password=admin123`

6. **Start the Server**

   ```bash
   npm start
   ```

7. **Access the Application**
   Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

---

## 📚 Documentation

- [Installation Guide](INSTALLATION_GUIDE.md) - Detailed setup instructions
- [Architecture](ARCHITECTURE.md) - System design and components
- [Security](SECURITY.md) - Encryption and threat model
- [Database Schema](DATABASE_SCHEMA.md) - Database structure
- [API Documentation](API_DOCUMENTATION.md) - REST API endpoints
- [User Guide](USER_GUIDE.md) - End-user instructions
- [Admin Guide](ADMIN_GUIDE.md) - Admin panel usage
- [Testing](TESTING.md) - Test cases and validation

---

## 👥 Team

**Project Type**: Final Year College Project  
**Domain**: Cloud Security & Cryptography  
**Institution**: [Your College Name]

---

## 📄 License

This project is developed for educational purposes as part of a college final year project.

---

## 🙏 Acknowledgments

- AWS for cloud infrastructure
- Web Crypto API for client-side encryption
- MySQL for reliable data storage
- Node.js community for excellent packages

---

## 📞 Support

For issues or questions, please refer to:

- [Known Issues](KNOWN_ISSUES.md)
- [Changelog](CHANGELOG.md)

---

**Built with 🔐 by [Your Name]**
