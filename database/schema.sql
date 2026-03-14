-- ==========================================
-- SecureVault Database Schema (PostgreSQL for Supabase/Neon)
-- Complete database structure including users, files
-- ==========================================

-- Create tables directly (public schema is default in Postgres)

-- ==========================================
-- USER TABLES
-- ==========================================

CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    security_pin_hash VARCHAR(255),
    profile_photo TEXT,
    theme_preference VARCHAR(50) DEFAULT 'theme-light',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files (
    file_id SERIAL PRIMARY KEY,
    file_uuid UUID UNIQUE NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    file_type VARCHAR(50),
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS file_metadata (
    file_id INTEGER PRIMARY KEY REFERENCES files(file_id) ON DELETE CASCADE,
    encrypted_metadata BYTEA NOT NULL,
    iv VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS file_keys (
    file_id INTEGER PRIMARY KEY REFERENCES files(file_id) ON DELETE CASCADE,
    encrypted_key TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shared_links (
    link_id SERIAL PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    recipient_email VARCHAR(255),
    token_hash VARCHAR(64) NOT NULL,
    encrypted_file_key TEXT NOT NULL,
    encrypted_metadata BYTEA,
    iv VARCHAR(255),
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    log_id SERIAL PRIMARY KEY,
    user_id INTEGER, 
    file_id INTEGER,
    action VARCHAR(255) NOT NULL,
    details TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
