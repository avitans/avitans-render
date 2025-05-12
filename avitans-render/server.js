const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Middleware
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Backup
const backupPath = path.join(__dirname, 'backup', 'database-copy.sqlite');
fs.copyFileSync(dbPath, backupPath);
console.log('Backup created at backup/database-copy.sqlite');

// Init DB
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER, seamstress_name TEXT, status TEXT, price REAL, date TEXT, fabric_photo TEXT, style_photo TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER, date TEXT, description TEXT, amount REAL)");
  db.run("CREATE TABLE IF NOT EXISTS order_images (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, filename TEXT, date TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS seamstresses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
});

app.listen(port, () => {
  console.log('Server running on http://localhost:' + port);
});