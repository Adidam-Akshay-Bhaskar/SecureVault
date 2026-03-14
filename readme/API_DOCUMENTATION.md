# 🔌 API Documentation - SecureVault

This document provides comprehensive documentation for all REST API endpoints available in SecureVault.

---

## 📋 Table of Contents

1. [API Overview](#api-overview)
2. [Authentication](#authentication)
3. [User Endpoints](#user-endpoints)
4. [File Endpoints](#file-endpoints)
5. [Share Endpoints](#share-endpoints)
6. [Admin Endpoints](#admin-endpoints)
7. [Error Handling](#error-handling)

---

## 1. API Overview

**Base URL**: `http://localhost:3000/api`  
**Protocol**: HTTP/HTTPS  
**Data Format**: JSON  
**Authentication**: JWT Bearer Token

### Common Headers

```http
Content-Type: application/json
Authorization: Bearer <jwt_token>
```

### Response Format

**Success Response:**

```json
{
  "message": "Operation successful",
  "data": { ... }
}
```

**Error Response:**

```json
{
  "message": "Error description",
  "error": "Detailed error message"
}
```

---

## 2. Authentication

### 2.1 Register User

**Endpoint**: `POST /api/register`  
**Authentication**: None  
**Description**: Create a new user account

**Request Body:**

```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "securityPin": "123456"
}
```

**Validation Rules:**

- `username`: Required, 3-50 characters
- `email`: Required, valid email format
- `password`: Required, minimum 8 characters
- `securityPin`: Required, 4 or 6 digits

**Success Response** (201):

```json
{
  "message": "User registered successfully"
}
```

**Error Responses:**

- `400`: Missing fields or invalid PIN format
- `400`: Email already exists
- `500`: Server error

---

### 2.2 Login User

**Endpoint**: `POST /api/login`  
**Authentication**: None  
**Description**: Authenticate user and receive JWT token

**Request Body:**

```json
{
  "email": "john@example.com",
  "password": "SecurePass123!",
  "securityPin": "123456"
}
```

**Success Response** (200):

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "username": "john_doe",
    "email": "john@example.com"
  }
}
```

**2FA Required Response** (401):

```json
{
  "message": "2FA_REQUIRED",
  "details": "Security PIN needed for verification"
}
```

**Error Responses:**

- `400`: Missing credentials
- `401`: Invalid credentials or PIN
- `500`: Server error

---

### 2.3 Verify Identity (Password Reset Step 1)

**Endpoint**: `POST /api/verify-identity`  
**Authentication**: None  
**Description**: Verify user identity using email and security PIN

**Request Body:**

```json
{
  "email": "john@example.com",
  "securityPin": "123456"
}
```

**Success Response** (200):

```json
{
  "message": "Identity Verified"
}
```

**Error Responses:**

- `400`: Missing fields or no PIN set
- `401`: Invalid security PIN
- `404`: User not found
- `500`: Database error

---

### 2.4 Reset Password (Password Reset Step 2)

**Endpoint**: `POST /api/reset-password`  
**Authentication**: None  
**Description**: Reset user password after identity verification

**Request Body:**

```json
{
  "email": "john@example.com",
  "securityPin": "123456",
  "newPassword": "NewSecurePass456!"
}
```

**Success Response** (200):

```json
{
  "message": "Password updated"
}
```

**Error Responses:**

- `400`: Missing fields
- `401`: Invalid security PIN
- `404`: User not found
- `500`: Update failed

---

## 3. User Endpoints

### 3.1 Get User Profile

**Endpoint**: `GET /api/profile`  
**Authentication**: Required  
**Description**: Retrieve current user's profile information

**Headers:**

```http
Authorization: Bearer <jwt_token>
```

**Success Response** (200):

```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "profile_photo": "data:image/png;base64,...",
  "theme_preference": "theme-dark"
}
```

**Error Responses:**

- `401`: Unauthorized (no token)
- `403`: Forbidden (invalid token)
- `404`: User not found
- `500`: Server error

---

### 3.2 Update Profile Photo

**Endpoint**: `POST /api/profile/photo`  
**Authentication**: Required  
**Description**: Update user's profile photo

**Request Body:**

```json
{
  "photoBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

**Success Response** (200):

```json
{
  "message": "Profile photo updated"
}
```

**Error Responses:**

- `401`: Unauthorized
- `500`: Server error

---

### 3.3 Update Password

**Endpoint**: `PUT /api/profile/password`  
**Authentication**: Required  
**Description**: Change user's password

**Request Body:**

```json
{
  "currentPassword": "OldPass123!",
  "newPassword": "NewPass456!"
}
```

**Success Response** (200):

```json
{
  "message": "Security protocol updated"
}
```

**Error Responses:**

- `400`: Missing fields
- `401`: Incorrect current password
- `404`: User not found
- `500`: Server error

---

### 3.4 Update Theme Preference

**Endpoint**: `POST /api/update-theme`  
**Authentication**: Required  
**Description**: Update user's UI theme preference

**Request Body:**

```json
{
  "theme": "theme-dark"
}
```

**Valid Themes:**

- `theme-light`
- `theme-dark`
- `theme-cosmic`
- `theme-ocean`
- `theme-sunset`

**Success Response** (200):

```json
{
  "message": "Theme updated successfully",
  "theme": "theme-dark"
}
```

**Error Responses:**

- `400`: Theme is required
- `401`: Unauthorized
- `500`: Server error

---

## 4. File Endpoints

### 4.1 Get Upload URL

**Endpoint**: `POST /api/upload-url`  
**Authentication**: Required  
**Description**: Generate presigned S3 URL for file upload

**Request Body:**

```json
{}
```

**Success Response** (200):

```json
{
  "uploadUrl": "https://bucket.s3.amazonaws.com/uuid?X-Amz-Algorithm=...",
  "fileUuid": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Usage:**

1. Client encrypts file with AES-256-GCM
2. Client uploads encrypted file to `uploadUrl` using PUT request
3. Client calls `/api/complete-upload` with metadata

**Error Responses:**

- `401`: Unauthorized
- `500`: Could not generate upload URL

---

### 4.2 Complete Upload

**Endpoint**: `POST /api/complete-upload`  
**Authentication**: Required  
**Description**: Register file metadata after successful S3 upload

**Request Body:**

```json
{
  "fileUuid": "550e8400-e29b-41d4-a716-446655440000",
  "fileType": "application/pdf",
  "encryptedMetadata": "base64_encrypted_metadata",
  "metadataIv": "base64_iv_string",
  "encryptedKey": "base64_wrapped_aes_key"
}
```

**Success Response** (200):

```json
{
  "message": "Upload completed successfully",
  "fileId": 123
}
```

**Error Responses:**

- `401`: Unauthorized
- `500`: Database transaction failed

---

### 4.3 List Files

**Endpoint**: `GET /api/files`  
**Authentication**: Required  
**Description**: Get user's files and files shared with them

**Success Response** (200):

```json
{
  "myFiles": [
    {
      "file_id": 123,
      "file_uuid": "550e8400-e29b-41d4-a716-446655440000",
      "created_at": "2026-01-12T00:00:00.000Z",
      "encrypted_metadata": "base64_string",
      "iv": "base64_iv",
      "encrypted_key": "base64_key",
      "role": "OWNER"
    }
  ],
  "sharedFiles": [
    {
      "link_id": 456,
      "file_id": 789,
      "file_uuid": "660e8400-e29b-41d4-a716-446655440001",
      "created_at": "2026-01-11T00:00:00.000Z",
      "encrypted_metadata": "base64_string",
      "iv": "base64_iv",
      "encrypted_key": "base64_key",
      "role": "SHARED"
    }
  ]
}
```

**Error Responses:**

- `401`: Unauthorized
- `500`: Database error

---

### 4.4 Get Download URL

**Endpoint**: `GET /api/download-url/:fileId`  
**Authentication**: Required  
**Description**: Generate presigned S3 URL for file download

**URL Parameters:**

- `fileId`: File ID to download

**Success Response** (200):

```json
{
  "downloadUrl": "https://bucket.s3.amazonaws.com/uuid?X-Amz-Algorithm=..."
}
```

**Usage:**

1. Client fetches encrypted file from `downloadUrl`
2. Client decrypts file using stored encryption key
3. Client presents decrypted file to user

**Error Responses:**

- `401`: Unauthorized
- `403`: Not authorized or file not found
- `500`: Server error

---

### 4.5 Delete File

**Endpoint**: `POST /api/delete-file`  
**Authentication**: Required  
**Description**: Soft delete a file (owner only)

**Request Body:**

```json
{
  "fileId": 123
}
```

**Success Response** (200):

```json
{
  "message": "File deleted"
}
```

**Error Responses:**

- `401`: Unauthorized
- `403`: Unauthorized or file not found
- `500`: Server error

---

## 5. Share Endpoints

### 5.1 Create Share Link

**Endpoint**: `POST /api/share`  
**Authentication**: Required  
**Description**: Generate one-time shareable link for a file

**Request Body:**

```json
{
  "fileId": 123,
  "recipientEmail": "recipient@example.com",
  "encryptedFileKeyForLink": "base64_encrypted_key",
  "encryptedMetadataForLink": "base64_encrypted_metadata",
  "metadataIv": "base64_iv",
  "linkKey": "random_256bit_key_in_hex"
}
```

**Success Response** (200):

```json
{
  "message": "Secure link generated. Found user ID: 456"
}
```

**Note**: Share link is sent to recipient's email:

```
http://localhost:3000/?token=<random_token>&key=<link_key>
```

**Error Responses:**

- `401`: Unauthorized
- `404`: Recipient user not found
- `500`: Server error

---

### 5.2 Access Share Link

**Endpoint**: `POST /api/access-share`  
**Authentication**: None  
**Description**: Access a shared file using one-time token

**Request Body:**

```json
{
  "token": "random_token_from_url"
}
```

**Success Response** (200):

```json
{
  "encryptedFileKey": "base64_key",
  "encryptedMetadata": "base64_metadata",
  "metadataIv": "base64_iv",
  "downloadUrl": "https://bucket.s3.amazonaws.com/..."
}
```

**Note**: Link is automatically burned (marked as used) after access

**Error Responses:**

- `403`: Invalid Link
- `410`: Link already used or expired
- `500`: Server error

---

### 5.3 Delete Shared Link

**Endpoint**: `DELETE /api/share/:linkId`  
**Authentication**: Required  
**Description**: Remove a shared link (recipient only)

**URL Parameters:**

- `linkId`: Link ID to delete

**Success Response** (200):

```json
{
  "message": "Access removed"
}
```

**Error Responses:**

- `401`: Unauthorized
- `403`: Unauthorized or not found
- `500`: Server error

---

## 6. Admin Endpoints

### 6.1 Admin Login (Step 1)

**Endpoint**: `POST /api/admin/login`  
**Authentication**: None  
**Description**: Initiate admin login and send OTP

**Request Body:**

```json
{
  "username": "admin",
  "password": "admin_password"
}
```

**Success Response** (200):

```json
{
  "message": "OTP verification required",
  "email": "admin@securevault.com",
  "maskedEmail": "ad***@securevault.com",
  "requiresOTP": true
}
```

**Note**: OTP is sent to admin email and printed to console

**Error Responses:**

- `401`: Invalid credentials
- `500`: Server error

---

### 6.2 Admin OTP Verification (Step 2)

**Endpoint**: `POST /api/admin/verify-otp`  
**Authentication**: None  
**Description**: Verify OTP and complete admin login

**Request Body:**

```json
{
  "email": "admin@securevault.com",
  "otp": "123456"
}
```

**Success Response** (200):

```json
{
  "message": "Admin authenticated",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "admin": {
    "username": "admin",
    "email": "admin@securevault.com"
  }
}
```

**Error Responses:**

- `400`: Missing OTP or email
- `401`: Invalid or expired OTP
- `500`: Server error

---

### 6.3 Get All Users

**Endpoint**: `GET /api/admin/users`  
**Authentication**: Admin Required  
**Description**: Retrieve list of all users

**Headers:**

```http
Authorization: Bearer <admin_jwt_token>
```

**Success Response** (200):

```json
{
  "users": [
    {
      "user_id": 1,
      "username": "john_doe",
      "email": "john@example.com",
      "created_at": "2026-01-01T00:00:00.000Z",
      "file_count": 5
    }
  ]
}
```

**Error Responses:**

- `401`: Admin authentication required
- `403`: Invalid admin token
- `500`: Server error

---

### 6.4 Get System Statistics

**Endpoint**: `GET /api/admin/stats`  
**Authentication**: Admin Required  
**Description**: Get system-wide statistics

**Success Response** (200):

```json
{
  "totalUsers": 150,
  "totalFiles": 1250,
  "activeShares": 45,
  "todayUploads": 23,
  "storageUsed": "5.2 GB"
}
```

**Error Responses:**

- `401`: Admin authentication required
- `500`: Server error

---

### 6.5 Get Audit Logs

**Endpoint**: `GET /api/admin/audit-logs`  
**Authentication**: Admin Required  
**Description**: Retrieve system audit logs

**Query Parameters:**

- `limit`: Number of logs (default: 50)
- `offset`: Pagination offset (default: 0)

**Success Response** (200):

```json
{
  "logs": [
    {
      "log_id": 1234,
      "action": "UPLOAD_COMPLETED",
      "details": "File uploaded",
      "timestamp": "2026-01-12T00:00:00.000Z",
      "username": "john_doe",
      "email": "john@example.com"
    }
  ]
}
```

**Error Responses:**

- `401`: Admin authentication required
- `500`: Server error

---

### 6.6 Suspend User

**Endpoint**: `POST /api/admin/users/:userId/suspend`  
**Authentication**: Admin Required  
**Description**: Suspend a user account

**URL Parameters:**

- `userId`: User ID to suspend

**Success Response** (200):

```json
{
  "message": "User suspended successfully"
}
```

**Error Responses:**

- `401`: Admin authentication required
- `404`: User not found
- `500`: Server error

---

### 6.7 Delete User

**Endpoint**: `DELETE /api/admin/users/:userId`  
**Authentication**: Admin Required  
**Description**: Permanently delete a user and their files

**URL Parameters:**

- `userId`: User ID to delete

**Success Response** (200):

```json
{
  "message": "User deleted successfully"
}
```

**Error Responses:**

- `401`: Admin authentication required
- `404`: User not found
- `500`: Server error

---

## 7. Error Handling

### HTTP Status Codes

| Code  | Meaning               | Description                   |
| ----- | --------------------- | ----------------------------- |
| `200` | OK                    | Request successful            |
| `201` | Created               | Resource created successfully |
| `400` | Bad Request           | Invalid request parameters    |
| `401` | Unauthorized          | Authentication required       |
| `403` | Forbidden             | Insufficient permissions      |
| `404` | Not Found             | Resource not found            |
| `410` | Gone                  | Resource expired or used      |
| `500` | Internal Server Error | Server error                  |

### Common Error Messages

```json
{
  "message": "Missing credentials",
  "error": "Email and password are required"
}
```

```json
{
  "message": "Invalid Credentials",
  "error": "Email or password is incorrect"
}
```

```json
{
  "message": "Unauthorized",
  "error": "JWT token is missing or invalid"
}
```

---

## 🔒 Security Considerations

### Rate Limiting

Implement rate limiting on sensitive endpoints:

- Login: 5 attempts per 15 minutes
- Register: 3 attempts per hour
- OTP: 3 attempts per 5 minutes

### CORS Configuration

```javascript
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
```

### Input Validation

All inputs are validated and sanitized:

- Email: RFC 5322 compliant
- Passwords: Minimum 8 characters
- PINs: 4 or 6 digits only
- File UUIDs: Valid UUID v4 format

---

**This API documentation provides complete reference for integrating with SecureVault.**
