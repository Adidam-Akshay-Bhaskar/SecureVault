# SecureVault: Personal Data Sanctuary

A hyper-secured, frictionless data enclave designed for absolute privacy and "neat and clean" seamless operations.

## Architecture

* **Frontend**: Vanilla Javascript, HTML5, CSS3 with an Ultra-Premium "Direct Access" Dashboard Protocol
* **Backend**: Node.js, Express, PostgreSQL
* **Security Layer**: bcrypt, Web Crypto API, JWT Authentication
* **Storage**: Encrypted AWS S3 stream integration

## Features

1. **Seamless File Manifestation**: Direct format rendering within the browser enclave. Support includes: `.docx, .pdf, .xlsx, .zip, .html, .py` explicitly bypassing any download requests.
2. **Dynamic UI/UX Architecture**: A fluid, responsive interface engineered for high-visibility terminal use and robust keyboard accessibility.
3. **Advanced Access Provisioning**: Time-decaying shared secure links with burn-after-read logic.

## Configuration & Usage

Prerequisites: Node.js, PostgreSQL and an AWS S3 Bucket.

1. Navigate to the `/backend` directory: `cd backend`
2. Run installation: `npm install`
3. Prepare `.env` variables (e.g., `DB_HOST`, `JWT_SECRET`, `S3_` configurations)
4. Start node server: `npm run dev`

### Frontend Launch
Utilize a local HTTP server inside the `/frontend` directory to interface with the active backend engine securely.

---
*Engineered by AKSHAY*
