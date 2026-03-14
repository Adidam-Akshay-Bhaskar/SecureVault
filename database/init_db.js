const path = require('path');
// Allow finding modules in ../server/node_modules
module.paths.push(path.join(__dirname, '../backend/node_modules'));

require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD || ""), 
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 5432,
    ssl: { rejectUnauthorized: false }
});

client.connect((err) => {
    if (err) {
        console.error('Error connecting to PostgreSQL:', err);
        return;
    }
    console.log('Connected to PostgreSQL database.');

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    client.query(schemaSql, (err, results) => {
        if (err) {
            console.error('Error executing schema:', err);
        } else {
            console.log('Database schema initialization successful.');
        }
        client.end();
    });
});
