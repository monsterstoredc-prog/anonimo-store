// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const DB_FILE = path.join(__dirname, 'db.sqlite');
if (!fs.existsSync(DB_FILE)) {
  console.error('Banco não encontrado. Rode npm run migrate antes.');
  process.exit(1);
}

const db = new sqlite3.Database(DB_FILE);
const app = express();

app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(rateLimit({ windowMs: 10*1000, max: 200 }));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ykaro@157';
const BASE_URL = process.env.BASE_URL || '';

function slugify(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }

// serve frontend
app.use('/', express.static(path.join(__dirname, 'public')));

// --- Public API ---
app.get('/api/packs', (req, res) => {
  db.all('SELECT id, name, slug, price, description, image FROM packs', [], (err, rows) => {
    if(err) return res.status(500).json({ error: 'db error' });
    res.json(rows);
  });
});

app.get('/api/packs/:id', (req, res) => {
  db.get('SELECT * FROM packs WHERE id = ?', [req.params.id], (err, row) => {
    if(err) return res.status(500).json({ error: 'db error' });
    if(!row) return res.status(404).json({ error: 'Pack não encontrado' });
    res.json(row);
  });
});

app.post('/api/orders', (req, res) => {
  const { pack_id, customer_name, customer_email } = req.body;
  if(!pack_id || !customer_name || !customer_email) return res.status(400).json({ error: 'Dados incompletos' });

  db.get('SELECT * FROM packs WHERE id = ?', [pack_id], (err, pack) => {
    if(err) return res.status(500).json({ error: 'db error' });
    if(!pack) return res.status(404).json({ error: 'Pack not found' });

    const amount = pack.price;
    const stmt = db.prepare('INSERT INTO orders (pack_id, customer_name, customer_email, amount, status) VALUES (?, ?, ?, ?, ?)');
    stmt.run(pack_id, customer_name, customer_email, amount, 'awaiting_payment', function(err){
      if(err) return res.status(500).json({ error: 'db error' });
      const orderId = this.lastID;

      // Placeholder Sunize integration (simulado) - substituir depois
      const paymentId = `SIM-${orderId}-${Date.now()}`;
      const pixQr = `pix-qrcode-placeholder://PAY:${paymentId}`;

      db.run('UPDATE orders SET sunize_payment_id = ?, pix_qr = ? WHERE id = ?', [paymentId, pixQr, orderId], (err) => {
        if(err) console.warn('erro update order', err);
        res.json({ orderId, paymentId, pixQr, amount });
      });
    });
  });
});

app.get('/api/orders/:id', (req, res) => {
  db.get('SELECT * FROM orders WHERE id = ?', [req.params.id], (err, row) => {
    if(err) return res.status(500).json({ error: 'db error' });
    if(!row) return res.status(404).json({ error: 'Pedido não encontrado' });
    res.json(row);
  });
});

// webhook Sunize (ajustar validação conforme doc da Sunize)
app.post('/webhook/sunize', (req, res) => {
  const event = req.body;
  console.log('webhook recebida', event);
  // Exemplo genérico: event = { type: 'payment.paid', data: { payment_id: 'SIM-...' } }
  try {
    if(event && (event.type === 'payment.paid' || event.type === 'payment.succeeded')) {
      const pid = event.data && (event.data.payment_id || event.data.id || event.data.reference);
      if(!pid) return res.status(400).send('no id');
      db.get('SELECT * FROM orders WHERE sunize_payment_id = ?', [pid], (err, order) => {
        if(err) return res.status(500).send('err');
        if(!order) return res.status(404).send('order not found');

        db.run('UPDATE orders SET status = ?, delivered_at = CURRENT_TIMESTAMP WHERE id = ?', ['delivered', order.id], (err) => {
          if(err) console.warn('erro update delivered', err);
          // opcional: enviar email com conteúdo do pack (pack.content)
          db.get('SELECT * FROM packs WHERE id = ?', [order.pack_id], (err, pack) => {
            if(!err && pack) {
              // aqui você pode implementar nodemailer para enviar pack.content ao cliente
              console.log(`Entrega: enviar para ${order.customer_email} -> ${pack.content}`);
            }
          });
          return res.status(200).send('ok');
        });
      });
    } else {
      return res.status(200).send('ignored');
    }
  } catch(e) {
    console.error(e);
    return res.status(500).send('error');
  }
});

// --- Admin ---
function requireAdmin(req, res, next){
  const pass = req.headers['x-admin-pass'] || req.query.admin_pass || req.body.admin_pass;
  if(pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/admin/api/packs', requireAdmin, (req, res) => {
  db.all('SELECT * FROM packs ORDER BY created_at DESC', [], (err, rows) => {
    if(err) return res.status(500).json({ error: 'db error' });
    res.json(rows);
  });
});

app.post('/admin/api/packs', requireAdmin, (req, res) => {
  const { name, price, description, content, image } = req.body;
  if(!name || price === undefined) return res.status(400).json({ error: 'dados' });
  const slug = slugify(name);
  const stmt = db.prepare('INSERT INTO packs (name, slug, price, description, content, image) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run(name, slug, price, description || '', content || '', image || '', function(err){
    if(err) return res.status(500).json({ error: 'db error' });
    res.json({ id: this.lastID });
  });
});

app.put('/admin/api/packs/:id', requireAdmin, (req, res) => {
  const { name, price, description, content, image } = req.body;
  const fields = [];
  const vals = [];
  if(name){ fields.push('name = ?'); vals.push(name); fields.push('slug = ?'); vals.push(slugify(name)); }
  if(price !== undefined){ fields.push('price = ?'); vals.push(price); }
  if(description !== undefined){ fields.push('description = ?'); vals.push(description); }
  if(content !== undefined){ fields.push('content = ?'); vals.push(content); }
  if(image !== undefined){ fields.push('image = ?'); vals.push(image); }
  if(fields.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
  vals.push(req.params.id);
  const sql = `UPDATE packs SET ${fields.join(', ')} WHERE id = ?`;
  db.run(sql, vals, function(err){
    if(err) return res.status(500).json({ error: 'db error' });
    res.json({ ok: true });
  });
});

app.delete('/admin/api/packs/:id', requireAdmin, (req, res) => {
  db.run('DELETE FROM packs WHERE id = ?', [req.params.id], function(err){
    if(err) return res.status(500).json({ error: 'db error' });
    res.json({ ok: true });
  });
});

app.get('/admin/api/orders', requireAdmin, (req, res) => {
  const sql = `SELECT o.*, p.name as pack_name FROM orders o LEFT JOIN packs p ON p.id = o.pack_id ORDER BY o.created_at DESC`;
  db.all(sql, [], (err, rows) => {
    if(err) return res.status(500).json({ error: 'db error' });
    res.json(rows);
  });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
