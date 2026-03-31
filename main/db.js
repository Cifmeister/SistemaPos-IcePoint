const { app } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Determine database path depending on environment
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const dbPath = isDev 
  ? path.join(__dirname, '..', 'database.sqlite')
  : path.join(app.getPath('userData'), 'database.sqlite');

const db = new Database(dbPath, { verbose: isDev ? console.log : null });

/**
 * Initializes the database schema, migrations, and default seeds sequentially.
 * This prevents race conditions where queries are executed before tables exist.
 */
function initDB() {
  console.log('--- Initializing Database Schema ---');

  // 1. Core Schema Creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE,
      barcodes TEXT, -- JSON array of barcodes
      name TEXT NOT NULL,
      cost_price REAL NOT NULL,
      selling_price REAL NOT NULL,
      margin REAL NOT NULL,
      stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL,
      category_id INTEGER,
      category_name TEXT,
      is_variable_price INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pin TEXT NOT NULL UNIQUE,
      can_void_sales INTEGER DEFAULT 0,
      can_modify_prices INTEGER DEFAULT 0,
      can_manage_inventory INTEGER DEFAULT 0,
      hourly_wage REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cash_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      opening_balance REAL NOT NULL,
      system_cash REAL DEFAULT 0,
      system_card REAL DEFAULT 0,
      system_transfer REAL DEFAULT 0,
      physical_cash REAL,
      physical_card REAL,
      discrepancy_cash REAL,
      discrepancy_card REAL,
      status TEXT DEFAULT 'OPEN',
      synced INTEGER DEFAULT 0,
      FOREIGN KEY (staff_id) REFERENCES staff(id)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL,
      total REAL NOT NULL,
      cashier_id INTEGER NOT NULL,
      shift_id INTEGER,
      status TEXT DEFAULT 'COMPLETED',
      voided_at TEXT,
      voided_by INTEGER,
      discount_total REAL DEFAULT 0,
      notes TEXT DEFAULT '',
      FOREIGN KEY (cashier_id) REFERENCES staff(id),
      FOREIGN KEY (shift_id) REFERENCES cash_shifts(id)
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      original_price REAL,
      discount_amount REAL DEFAULT 0,
      discount_type TEXT,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sale_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      payment_method_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id)
    );

    CREATE TABLE IF NOT EXISTS fiados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      total_amount REAL NOT NULL,
      status TEXT DEFAULT 'PENDING',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS fiado_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fiado_id INTEGER NOT NULL,
      shift_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fiado_id) REFERENCES fiados(id),
      FOREIGN KEY (shift_id) REFERENCES cash_shifts(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      net_total REAL NOT NULL DEFAULT 0,
      tax_total REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      document_url TEXT,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      cost_price REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      reason TEXT NOT NULL,
      date TEXT NOT NULL,
      staff_id INTEGER NOT NULL,
      notes TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (staff_id) REFERENCES staff(id)
    );

    CREATE TABLE IF NOT EXISTS wastage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      reason TEXT NOT NULL,
      unit_cost REAL NOT NULL,
      total_loss REAL NOT NULL,
      date TEXT NOT NULL,
      staff_id INTEGER NOT NULL,
      notes TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (staff_id) REFERENCES staff(id)
    );

    CREATE TABLE IF NOT EXISTS cfd_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      type TEXT DEFAULT 'image',
      display_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL,
      type TEXT NOT NULL, -- 'IN', 'OUT'
      source TEXT NOT NULL, -- 'SALE', 'MANUAL_ENTRY', 'MANUAL_EXIT', 'PURCHASE', 'FIADO_PAYMENT'
      amount REAL NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      sale_id INTEGER,
      staff_id INTEGER,
      FOREIGN KEY (shift_id) REFERENCES cash_shifts(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (staff_id) REFERENCES staff(id)
    );
  `);

  console.log('[Init] Tablas base creadas.');

  // 3. Database Migrations (To handle schema updates on existing installs)
  try {
    // Añadimos las columnas de anulación a la tabla 'sales' si no existen
    db.exec("ALTER TABLE sales ADD COLUMN voided_at TEXT");
    db.exec("ALTER TABLE sales ADD COLUMN voided_by INTEGER");
    db.exec("ALTER TABLE sales ADD COLUMN notes TEXT DEFAULT ''");
    console.log('[Migration] Columnas de anulación y notas añadidas con éxito a la tabla sales.');
  } catch (err) {
    if (err.message.includes('duplicate column name')) {
      console.log('[Migration] Algunas columnas ya existen en sales. Continuando...');
    } else {
      console.error('[Migration Error] Error al migrar tabla sales:', err.message);
    }
  }

  // Migración: Asegurar que existe el método de pago 'Fiado'
  try {
    const fiadoExists = db.prepare("SELECT COUNT(*) as count FROM payment_methods WHERE name = 'Fiado'").get().count;
    if (fiadoExists === 0) {
      db.prepare("INSERT INTO payment_methods (name) VALUES ('Fiado')").run();
      console.log('[Migration] Método de pago "Fiado" añadido con éxito.');
    }
  } catch (err) {
    console.error('[Migration Error] Error al añadir método de pago "Fiado":', err.message);
  }

  // 2. Default Seeds (Only if empty)
  // Seeds Settings
  const defaultSettings = {
    ticket_company_name: '',
    ticket_header: '',
    ticket_footer: '',
    printer_interface: 'LPT1',
    printer_width: '80',
    cfd_logo_url: 'file:///C:/Users/Arturo%20Cifuentes/.gemini/antigravity/brain/4b64da0b-375d-4a33-ad3a-e540fb94f983/cfd_logo_premium_1773331206901.png',
    cfd_idle_url: 'file:///C:/Users/Arturo%20Cifuentes/.gemini/antigravity/brain/4b64da0b-375d-4a33-ad3a-e540fb94f983/cfd_idle_screen_1773331170093.png',
    cfd_promo_url: 'file:///C:/Users/Arturo%20Cifuentes/.gemini/antigravity/brain/4b64da0b-375d-4a33-ad3a-e540fb94f983/cfd_promo_banner_1773331189778.png',
    cfd_welcome_msg: '¡Bienvenidos a Ice Point!',
    cfd_goodbye_msg: '¡Gracias por su compra, vuelva pronto!',
    cfd_footer_text: 'Horario: Lun-Sáb 09:00 - 21:00 | Contacto: +56 9 1234 5678',
    cfd_bg_color: '#0f172a',
    cfd_text_color: '#ffffff',
    cfd_accent_color: '#3b82f6',
    cfd_carousel_interval: '5'
  };

  const currentSettingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get().count;
  if (currentSettingsCount === 0) {
    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    Object.entries(defaultSettings).forEach(([key, value]) => {
      insertSetting.run(key, value);
    });
    console.log('[Init] Configuraciones por defecto agregadas.');
  }

  // Seed Admin
  const adminCount = db.prepare("SELECT COUNT(*) as count FROM staff WHERE role = 'admin'").get().count;
  if (adminCount === 0) {
    db.prepare("INSERT INTO staff (name, role, pin, can_void_sales, can_modify_prices, can_manage_inventory) VALUES (?, ?, ?, 1, 1, 1)").run('Master Admin', 'admin', '1234');
    console.log('[Init] Admin master creado.');
  }

  // Seed Payment Methods
  const pmCount = db.prepare("SELECT COUNT(*) as count FROM payment_methods").get().count;
  if (pmCount === 0) {
    const insertPM = db.prepare("INSERT INTO payment_methods (name) VALUES (?)");
    ['Efectivo', 'Tarjeta de Débito', 'Tarjeta de Crédito', 'Transferencia'].forEach(pm => insertPM.run(pm));
    console.log('[Init] Métodos de pago creados.');
  }

  // Seed Media
  const mediaCount = db.prepare('SELECT COUNT(*) as count FROM cfd_media').get().count;
  if (mediaCount === 0) {
    db.prepare('INSERT INTO cfd_media (url, display_order) VALUES (?, ?)').run(
      'file:///C:/Users/Arturo%20Cifuentes/.gemini/antigravity/brain/4b64da0b-375d-4a33-ad3a-e540fb94f983/cfd_idle_screen_1773331170093.png',
      0
    );
    console.log('[Init] Multimedia CFD inicial agregada.');
  }

  // Seed Products (Dev only)
  if (isDev) {
    const prodCount = db.prepare("SELECT COUNT(*) as count FROM products").get().count;
    if (prodCount === 0) {
      const insertProduct = db.prepare("INSERT INTO products (barcode, name, cost_price, selling_price, margin, stock, min_stock, unit, barcodes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      insertProduct.run('7801234567890', 'Hamburguesa Congelada 1KG', 2500, 4000, 1500, 50, 10, 'UN', JSON.stringify(['7801234567890']));
      console.log('[Init] Productos de prueba agregados.');
    }
  }

  console.log('--- Database Initialization Complete ---');
}

// Execute initialization
initDB();

module.exports = { db, dbPath };
