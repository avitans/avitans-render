const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const fs = require('fs');

const app = express();
const port = 3000;

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
const db = new sqlite3.Database('./database.sqlite');

// multer setup for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const name = file.fieldname + '-' + Date.now() + ext;
    cb(null, name);
  }
});
const upload = multer({ storage: storage });

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});


app.post('/api/clients', express.json(), (req, res) => {
  const { name, phone } = req.body;
  db.run("INSERT INTO clients (name, phone) VALUES (?, ?)", [name, phone], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.get('/api/clients', (req, res) => {
  db.all("SELECT * FROM clients", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/seamstresses', (req, res) => {
  db.all("SELECT * FROM seamstresses", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});


app.post('/api/client/:id/payment', express.json(), (req, res) => {
  const clientId = req.params.id;
  const { amount, description, method } = req.body;
  const date = new Date().toISOString().split('T')[0];

  db.run("INSERT INTO ledger (client_id, date, description || '', amount) VALUES (?, ?, ?, ?)",
    [clientId, date, description, parseFloat(amount)],
    err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

app.get('/api/client/:id', (req, res) => {
  const clientId = req.params.id;
  db.get("SELECT * FROM clients WHERE id = ?", [clientId], (err, client) => {
    if (err || !client) return res.status(404).json({ error: "Client not found" });

    db.all("SELECT * FROM ledger WHERE client_id = ? ORDER BY date", [clientId], (err2, ledger) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ ...client, ledger });
    });
  });
});

app.post('/api/orders', upload.fields([
  { name: 'fabric_photo', maxCount: 1 },
  { name: 'style_photo', maxCount: 1 }
]), (req, res) => {
  const { client_id, seamstress_id, status } = req.body;
  const date = new Date().toISOString().split('T')[0];
  const fabric_photo = req.files['fabric_photo']?.[0]?.filename || '';
  const style_photo = req.files['style_photo']?.[0]?.filename || '';

  db.run(`INSERT INTO orders (client_id, date, fabric_photo, style_photo, status, seamstress_id)
          VALUES (?, ?, ?, ?, ?, ?)`,
    [client_id, date, fabric_photo, style_photo, status, seamstress_id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });

      // אם סטטוס הוא מוכן – נרשום חיוב בלדג'ר
      if (status === 'מוכן') {
        db.run(`INSERT INTO ledger (client_id, date, description || '', amount)
                VALUES (?, ?, ?, ?)`,
          [client_id, date, 'חיוב על הזמנה', -3000]); // ניתן לשנות את הסכום בהמשך
      }

      res.json({ success: true });
    });
});

app.get('/api/orders', (req, res) => {
  const sql = `
    SELECT o.id, o.date, o.status, o.fabric_photo, o.style_photo,
           c.name AS client_name, s.name AS seamstress_name
    FROM orders o
    JOIN clients c ON o.client_id = c.id
    JOIN seamstresses s ON o.seamstress_id = s.id
    ORDER BY o.date DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/orders/:id/status', express.json(), (req, res) => {
  const orderId = req.params.id;
  const newStatus = req.body.status;
  const date = new Date().toISOString().split('T')[0];

  db.run("UPDATE orders SET status = ? WHERE id = ?", [newStatus, orderId], function(err) {
    if (err) return res.status(500).json({ error: err.message });

    // get client_id for the order
    db.get("SELECT client_id FROM orders WHERE id = ?", [orderId], (err2, row) => {
      if (err2 || !row) return res.json({ success: true });

      // אם סטטוס 'מוכן' – נוסיף חיוב
      if (newStatus === 'מוכן') {
        db.run("INSERT INTO ledger (client_id, date, description || '', amount) VALUES (?, ?, ?, ?)",
          [row.client_id, date, 'חיוב על הזמנה', -3000]);
      }

      res.json({ success: true });
    });
  });
});

app.get('/api/orders/:id', (req, res) => {
  const orderId = req.params.id;
  const sql = `
    SELECT o.*, c.name AS client_name, s.name AS seamstress_name
    FROM orders o
    JOIN clients c ON o.client_id = c.id
    JOIN seamstresses s ON o.seamstress_id = s.id
    WHERE o.id = ?
  `;
  db.get(sql, [orderId], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Order not found" });
    res.json(row);
  });
});

app.post('/api/orders/:id/update', express.json(), (req, res) => {
  const orderId = req.params.id;
  const { status, price } = req.body;
  const date = new Date().toISOString().split('T')[0];

  db.run("UPDATE orders SET status = ?, price = ? WHERE id = ?", [status, price, orderId], function(err) {
    if (err) return res.status(500).json({ error: err.message });

    db.get("SELECT client_id FROM orders WHERE id = ?", [orderId], (err2, row) => {
      if (err2 || !row) return res.json({ success: true });

      if (status === 'מוכן') {
        db.run("INSERT INTO ledger (client_id, date, description || '', amount) VALUES (?, ?, ?, ?)",
          [row.client_id, date, 'חיוב על הזמנה', -price]);
      }

      res.json({ success: true });
    });
  });
});


app.get('/api/orders/:id/images', (req, res) => {
  db.all("SELECT * FROM order_images WHERE order_id = ?", [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/orders/:id/history', (req, res) => {
  db.all("SELECT * FROM order_status_history WHERE order_id = ? ORDER BY date DESC", [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/orders/:id/upload', upload.single('image'), (req, res) => {
  const date = new Date().toISOString().split('T')[0];
  db.run("INSERT INTO order_images (order_id, filename, date) VALUES (?, ?, ?)",
    [req.params.id, req.file.filename, date],
    err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

app.post('/api/orders/:id/update', express.json(), (req, res) => {
  const orderId = req.params.id;
  const { status, price } = req.body;
  const date = new Date().toISOString().split('T')[0];

  db.run("UPDATE orders SET status = ?, price = ? WHERE id = ?", [status, price, orderId], function(err) {
    if (err) return res.status(500).json({ error: err.message });

    db.get("SELECT client_id FROM orders WHERE id = ?", [orderId], (err2, row) => {
      if (err2 || !row) return res.json({ success: true });

      db.run("INSERT INTO order_status_history (order_id, status, date) VALUES (?, ?, ?)", [orderId, status, date]);

      if (status === 'מוכן') {
        db.run("INSERT INTO ledger (client_id, date, description || '', amount) VALUES (?, ?, ?, ?)",
          [row.client_id, date, 'חיוב על הזמנה', -price]);
      }

      res.json({ success: true });
    });
  });
});

app.listen(port, () => {
  console.log(`המערכת רצה על http://localhost:${port}`);
});
