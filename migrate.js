// migrate.js
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const dbFile = './db.sqlite';

if (fs.existsSync(dbFile)) {
  console.log('DB já existe, pulando criação.');
  process.exit(0);
}

const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`
    CREATE TABLE packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      price INTEGER NOT NULL,
      description TEXT,
      content TEXT,
      image TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id INTEGER,
      customer_name TEXT,
      customer_email TEXT,
      status TEXT DEFAULT 'pending',
      amount INTEGER,
      sunize_payment_id TEXT,
      pix_qr TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      delivered_at DATETIME,
      FOREIGN KEY(pack_id) REFERENCES packs(id)
    );
  `);

  const insert = db.prepare('INSERT INTO packs (name, slug, price, description, content, image) VALUES (?, ?, ?, ?, ?, ?)');

  // preços em centavos
  insert.run('Pack Inicial', 'pack-inicial', 1290, 'Pack inicial com conteúdo básico.', 'https://www.workupload.com/example-pack-inicial', '');
  insert.run('Pack Avançado', 'pack-avancado', 2290, 'Pack avançado com extras.', 'https://www.workupload.com/example-pack-avancado', '');
  insert.run('Pack Premium', 'pack-premium', 4890, 'Pack premium com conteúdo completo.', 'https://www.workupload.com/example-pack-premium', '');
  insert.run('Pack Premium Plus', 'pack-premium-plus', 6390, 'Pack premium plus — completo e VIP.', 'https://www.workupload.com/example-pack-premiumplus', '');

  insert.finalize();
  console.log('Migração completa e packs iniciais criados.');
});

db.close();
