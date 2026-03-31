const { ipcMain, dialog, app } = require('electron');
const { db, dbPath } = require('./db');
const fs = require('fs');
const path = require('path');

function setupIpcHandlers(forceSync, getMainWindow) {
  console.log('--- Initializing IPC Handlers ---');
  // --- Products & Inventory ---
  ipcMain.handle('get-products', () => {
    const products = db.prepare('SELECT * FROM products ORDER BY name ASC').all();
    return products.map(p => ({
      ...p,
      barcodes: p.barcodes ? JSON.parse(p.barcodes) : [p.barcode]
    }));
  });

  ipcMain.handle('add-product', (event, product) => {
    const barcodesJson = JSON.stringify(product.barcodes || [product.barcode]);
    const stmt = db.prepare('INSERT INTO products (barcode, barcodes, name, category_id, category_name, cost_price, selling_price, margin, stock, min_stock, unit, is_variable_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const info = stmt.run(
      product.barcode,
      barcodesJson,
      product.name, 
      product.category_id || null,
      product.category_name || null,
      product.cost_price, 
      product.selling_price, 
      product.selling_price > 0 ? ((product.selling_price - product.cost_price) / product.selling_price) * 100 : 0, 
      product.stock, 
      product.min_stock, 
      product.unit, 
      product.is_variable_price ? 1 : 0
    );
    const productId = info.lastInsertRowid;

    // --- Sync Queue ---
    db.prepare(`
      INSERT INTO sync_queue (collection_name, data, created_at)
      VALUES ('products', ?, ?)
    `).run(JSON.stringify({ ...product, id: productId, barcodes: product.barcodes || [product.barcode] }), new Date().toISOString());

    if (forceSync) forceSync();
    return productId;
  });

  ipcMain.handle('update-product', (event, product) => {
    const barcodesJson = JSON.stringify(product.barcodes || [product.barcode]);
    const stmt = db.prepare('UPDATE products SET barcode=?, barcodes=?, name=?, category_id=?, category_name=?, cost_price=?, selling_price=?, margin=?, stock=?, min_stock=?, unit=?, is_variable_price=? WHERE id=?');
    stmt.run(
      product.barcode,
      barcodesJson,
      product.name, 
      product.category_id || null,
      product.category_name || null,
      product.cost_price, 
      product.selling_price, 
      product.selling_price > 0 ? ((product.selling_price - product.cost_price) / product.selling_price) * 100 : 0, 
      product.stock, 
      product.min_stock, 
      product.unit, 
      product.is_variable_price ? 1 : 0, 
      product.id
    );

    // --- Sync Queue ---
    db.prepare(`
      INSERT INTO sync_queue (collection_name, data, created_at)
      VALUES ('products', ?, ?)
    `).run(JSON.stringify(product), new Date().toISOString());

    if (forceSync) forceSync();
    return true;
  });

  ipcMain.handle('delete-product', (event, id) => {
    const product = db.prepare('SELECT barcode FROM products WHERE id=?').get(id);
    if (product) {
      db.prepare('DELETE FROM products WHERE id=?').run(id);
      
      // --- Sync Queue (Mark as deleted in Cloud) ---
      db.prepare(`
        INSERT INTO sync_queue (collection_name, data, created_at)
        VALUES ('products_delete', ?, ?)
      `).run(JSON.stringify({ id: id }), new Date().toISOString());
      
      if (forceSync) forceSync();
    }
    return true;
  });

  ipcMain.handle('get-product-by-barcode', (event, barcode) => {
    barcode = barcode.trim();
    
    // 1. Intentar búsqueda exacta en barcode principal o dentro del array de barcodes (JSON)
    // Usamos json_each para buscar dentro del array serializado
    let product = db.prepare(`
      SELECT * FROM products 
      WHERE barcode = ? 
      OR EXISTS (SELECT 1 FROM json_each(products.barcodes) WHERE value = ?)
    `).get(barcode, barcode);

    if (product) {
      return {
        ...product,
        barcodes: product.barcodes ? JSON.parse(product.barcodes) : [product.barcode]
      };
    }

    // 2. Si no hay coincidencia exacta y empieza con prefijo de balanza "23"
    // Estructura: 23 (Prefijo) + XXXXX (SKU 5 dígitos) + YYYYY (Precio 5 dígitos) + Z (DV)
    if (barcode.length === 13 && barcode.startsWith('23')) {
      const itemCode = barcode.substring(2, 7); // XXXXX (índices 2 al 6)
      const priceString = barcode.substring(7, 12); // YYYYY (índices 7 al 11)
      
      // En balanza el SKU suele ser el barcode principal de 5 dígitos
      const foundProduct = db.prepare('SELECT * FROM products WHERE barcode=?').get(itemCode);
      
      if (foundProduct && foundProduct.is_variable_price === 1) {
        const finalPrice = parseInt(priceString, 10);
        const basePrice = foundProduct.selling_price;
        const calculatedQuantity = basePrice > 0 ? parseFloat((finalPrice / basePrice).toFixed(3)) : 0;
        
        return {
          ...foundProduct,
          unit_price: basePrice,
          quantity: calculatedQuantity,
          subtotal: finalPrice,
          is_variable: true 
        };
      }
    }

    return null;
  });
  
  // --- Categories ---
  ipcMain.handle('get-categories', () => {
    return db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
  });

  ipcMain.handle('add-category', (event, name) => {
    const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    const id = info.lastInsertRowid;
    
    // Registrar para sincronización
    db.prepare(`
      INSERT INTO sync_queue (collection_name, data, created_at)
      VALUES ('categories', ?, datetime('now', 'localtime'))
    `).run(JSON.stringify({ id, name }));

    return id;
  });

  ipcMain.handle('update-category', (event, { id, name }) => {
    db.prepare('UPDATE categories SET name=? WHERE id=?').run(name, id);
    // Actualizar denormalización en productos
    db.prepare('UPDATE products SET category_name=? WHERE category_id=?').run(name, id);
    
    // Registrar para sincronización
    db.prepare(`
      INSERT INTO sync_queue (collection_name, data, created_at)
      VALUES ('categories', ?, datetime('now', 'localtime'))
    `).run(JSON.stringify({ id, name }));

    return true;
  });

  ipcMain.handle('delete-category', (event, id) => {
    // Primero desvinculamos los productos
    db.prepare('UPDATE products SET category_id=NULL, category_name=NULL WHERE category_id=?').run(id);
    db.prepare('DELETE FROM categories WHERE id=?').run(id);

    // Registrar para sincronización (borrado)
    db.prepare(`
      INSERT INTO sync_queue (collection_name, data, created_at)
      VALUES ('categories_delete', ?, datetime('now', 'localtime'))
    `).run(JSON.stringify({ id }));

    return true;
  });

  // --- Suppliers ---
  ipcMain.handle('get-suppliers', () => {
    return db.prepare('SELECT * FROM suppliers ORDER BY name ASC').all();
  });

  ipcMain.handle('add-supplier', (event, supplier) => {
    const info = db.prepare('INSERT INTO suppliers (name, contact, notes) VALUES (?, ?, ?)').run(supplier.name, supplier.contact, supplier.notes);
    return info.lastInsertRowid;
  });

  ipcMain.handle('update-supplier', (event, supplier) => {
    db.prepare('UPDATE suppliers SET name=?, contact=?, notes=? WHERE id=?').run(supplier.name, supplier.contact, supplier.notes, supplier.id);
    return true;
  });

  ipcMain.handle('delete-supplier', (event, id) => {
    db.prepare('DELETE FROM suppliers WHERE id=?').run(id);
    return true;
  });

  // --- Purchases ---
  ipcMain.handle('get-purchases', () => {
    return db.prepare(`
      SELECT pi.*, s.name as supplier_name
      FROM purchase_invoices pi
      JOIN suppliers s ON pi.supplier_id = s.id
      ORDER BY pi.date DESC LIMIT 200
    `).all();
  });

  ipcMain.handle('get-purchase-items', (event, invoiceId) => {
    return db.prepare(`
      SELECT pitem.*, p.name as product_name, p.unit
      FROM purchase_items pitem
      JOIN products p ON pitem.product_id = p.id
      WHERE pitem.invoice_id = ?
    `).all(invoiceId);
  });

  ipcMain.handle('add-purchase-with-items', (event, { supplierId, date, items, netTotal, taxTotal, total }) => {
    const savePurchase = db.transaction((purchaseItems) => {
      const invoiceInfo = db.prepare('INSERT INTO purchase_invoices (supplier_id, date, net_total, tax_total, total) VALUES (?, ?, ?, ?, ?)').run(supplierId, date, netTotal || 0, taxTotal || 0, total);
      const invoiceId = invoiceInfo.lastInsertRowid;
      const itemInsert = db.prepare('INSERT INTO purchase_items (invoice_id, product_id, quantity, cost_price) VALUES (?, ?, ?, ?)');
      const stockUpdate = db.prepare('UPDATE products SET stock = stock + ?, cost_price = ? WHERE id = ?');
      for (const item of purchaseItems) {
        // Guardamos el costo neto en el ítem y actualizamos el costo en inventario SIEMPRE como NETO
        itemInsert.run(invoiceId, item.product_id, item.quantity, item.net_unit_cost || item.cost_price);
        stockUpdate.run(item.quantity, item.net_unit_cost || item.cost_price, item.product_id);
      }
      return invoiceId;
    });
    return savePurchase(items);
  });

  // --- Payment Methods ---
  ipcMain.handle('get-payment-methods', () => {
    return db.prepare('SELECT * FROM payment_methods ORDER BY id ASC').all(); // show all even inactive for Admin
  });

  ipcMain.handle('add-payment-method', (event, name) => {
    const info = db.prepare('INSERT INTO payment_methods (name) VALUES (?)').run(name);
    return info.lastInsertRowid;
  });

  ipcMain.handle('update-payment-method', (event, { id, name, is_active }) => {
    db.prepare('UPDATE payment_methods SET name=?, is_active=? WHERE id=?').run(name, is_active ? 1 : 0, id);
    return true;
  });

  ipcMain.handle('delete-payment-method', (event, id) => {
    // Only delete if it hasn't been used in sales to preserve referential integrity, otherwise soft delete
    const inUse = db.prepare('SELECT COUNT(*) as count FROM sale_payments WHERE payment_method_id=?').get(id);
    if (inUse.count > 0) {
      db.prepare('UPDATE payment_methods SET is_active=0 WHERE id=?').run(id);
    } else {
      db.prepare('DELETE FROM payment_methods WHERE id=?').run(id);
    }
    return true;
  });

  // --- Staff ---
  ipcMain.handle('get-staff', () => {
    return db.prepare('SELECT * FROM staff ORDER BY name ASC').all();
  });

  ipcMain.handle('add-staff', (event, staff) => {
    const stmt = db.prepare('INSERT INTO staff (name, role, pin, can_void_sales, can_modify_prices, can_manage_inventory, hourly_wage) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const info = stmt.run(staff.name, staff.role, staff.pin, staff.can_void_sales ? 1 : 0, staff.can_modify_prices ? 1 : 0, staff.can_manage_inventory ? 1 : 0, staff.hourly_wage || 0);
    return info.lastInsertRowid;
  });

  ipcMain.handle('update-staff', (event, staff) => {
    const stmt = db.prepare('UPDATE staff SET name=?, role=?, pin=?, can_void_sales=?, can_modify_prices=?, can_manage_inventory=?, hourly_wage=? WHERE id=?');
    stmt.run(staff.name, staff.role, staff.pin, staff.can_void_sales ? 1 : 0, staff.can_modify_prices ? 1 : 0, staff.can_manage_inventory ? 1 : 0, staff.hourly_wage || 0, staff.id);
    return true;
  });

  ipcMain.handle('delete-staff', (event, id) => {
    db.prepare('DELETE FROM staff WHERE id=?').run(id);
    return true;
  });

  ipcMain.handle('verify-pin', (event, pin) => {
    const user = db.prepare('SELECT * FROM staff WHERE pin=?').get(pin);
    return user || null;
  });

  // --- Shifts (Asistencia) ---

  ipcMain.handle('clock-in', (event, staff_id) => {
    const active = db.prepare('SELECT * FROM shifts WHERE staff_id=? AND end_time IS NULL').get(staff_id);
    if (active) throw new Error('Ya existe un turno activo.');
    const info = db.prepare("INSERT INTO shifts (staff_id, start_time) VALUES (?, datetime('now', 'localtime'))").run(staff_id);
    return info.lastInsertRowid;
  });

  ipcMain.handle('clock-out', (event, staff_id) => {
    const active = db.prepare('SELECT * FROM shifts WHERE staff_id=? AND end_time IS NULL').get(staff_id);
    if (!active) throw new Error('No hay turnos activos para este usuario.');
    db.prepare("UPDATE shifts SET end_time=datetime('now', 'localtime') WHERE id=?").run(active.id);
    return true;
  });


  // --- Sales ---
  ipcMain.handle('get-next-sale-id', () => {
    try {
      const result = db.prepare('SELECT MAX(id) as maxId FROM sales').get();
      return (result?.maxId || 0) + 1;
    } catch (err) {
      console.error('[IPC] Error getting next sale ID:', err);
      return 1;
    }
  });

  ipcMain.handle('save-sale', (event, { items, payments, cashier_id, shift_id, discount_total, payment_method, customer_name, notes }) => {
    const total = items.reduce((sum, item) => sum + item.subtotal, 0); // Este total ya descuenta los items
    const finalSaleTotal = discount_total ? Math.max(0, total - discount_total) : total;
    let saleId = null;

    // Use transaction logic for saving sale
    const saveTransaction = db.transaction((saleItems, salePayments, pMethod, cName) => {
      // Usar tiempo local para consistencia en reportes locales
      const saleTime = db.prepare("SELECT datetime('now', 'localtime') as now").get().now;
      console.log('[DEBUG] Guardando venta en SQLite:', { saleTime, total: finalSaleTotal, cashier_id, notes });
      const saleInsert = db.prepare("INSERT INTO sales (time, total, cashier_id, shift_id, discount_total, notes) VALUES (?, ?, ?, ?, ?, ?)");
      const info = saleInsert.run(saleTime, finalSaleTotal, cashier_id, shift_id || null, discount_total || 0, notes || '');
      saleId = info.lastInsertRowid;
      console.log('[DEBUG] Venta insertada con ID:', saleId);

      const itemInsert = db.prepare('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, original_price, discount_amount, discount_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const stockUpdate = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');

      // Process items
      for (const item of saleItems) {
        itemInsert.run(
          saleId, 
          item.product_id, 
          item.quantity, 
          item.unit_price, 
          item.subtotal,
          item.original_price || item.unit_price,
          item.discount_amount || 0,
          item.discount_type || null
        );
        stockUpdate.run(item.quantity, item.product_id);
      }

      // INTERCEPTOR DE FIADOS (PEGAR DESPUÉS DE GUARDAR LA VENTA PRINCIPAL)
      const metodo = payment_method || (payments && payments[0]?.name?.toLowerCase());

      if (metodo === 'fiado' || pMethod === 'fiado') {
        console.log(`[BACKEND FIADOS] Procesando fiado para cliente: ${customer_name}`);
        try {
          // 1. Asegurar que la tabla existe (por si olvidaste crearla en el initDB)
          db.prepare(`
            CREATE TABLE IF NOT EXISTS fiados (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              sale_id INTEGER NOT NULL,
              customer_name TEXT NOT NULL,
              total_amount REAL NOT NULL,
              status TEXT DEFAULT 'PENDING',
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
          `).run();

          // 2. Insertar la deuda
          db.prepare(`INSERT INTO fiados (sale_id, customer_name, total_amount, status) VALUES (?, ?, ?, 'PENDING')`)
            .run(saleId, customer_name || 'Desconocido', finalSaleTotal);
          
          console.log(`[EXITO] Fiado registrado para ${customer_name} por $${finalSaleTotal}`);
        } catch (dbError) {
          console.error('[BACKEND FIADOS CRÍTICO] Error al guardar la deuda:', dbError);
        }
      } else {
        if (salePayments && salePayments.length > 0) {
          const paymentInsert = db.prepare('INSERT INTO sale_payments (sale_id, payment_method_id, amount) VALUES (?, ?, ?)');
          for (const payment of salePayments) {
            if (payment.amount > 0) {
              paymentInsert.run(saleId, payment.payment_method_id, payment.amount);
            }
          }
        }
      }

      // --- Sync Queue Integration ---
      const syncData = {
        localId: saleId,
        time: saleTime,
        total: finalSaleTotal,
        discount_total: discount_total || 0,
        cashier_id: cashier_id,
        shift_id: shift_id || null,
        payment_method: pMethod,
        customer_name: cName,
        notes: notes || '',
        items: saleItems,
        payments: salePayments
      };

      db.prepare(`
        INSERT INTO sync_queue (collection_name, data, created_at)
        VALUES ('sales', ?, ?)
      `).run(JSON.stringify(syncData), saleTime);
    });

    saveTransaction(items, payments, payment_method, customer_name);
    if (forceSync) forceSync();
    
    // Notify frontend of a new sale
    const win = getMainWindow();
    if (win) {
      win.webContents.send('sale-saved', saleId);
    }
    
    return saleId;
  });

  // --- Reports ---
  ipcMain.handle('get-daily-report', (event, { shiftId } = {}) => {
    let salesQuery = "SELECT * FROM sales";
    let salesParams = [];
    
    // Si se pasa shiftId, filtramos por ese turno. 
    // Si no, por defecto buscamos las ventas de HOY (comportamiento tradicional)
    if (shiftId) {
      salesQuery += " WHERE shift_id = ?";
      salesParams.push(shiftId);
    } else {
      const today = db.prepare("SELECT date('now', 'localtime') as date").get().date;
      salesQuery += " WHERE date(time) = date(?)";
      salesParams.push(today);
    }

    const sales = db.prepare(salesQuery).all(...salesParams);
    
    const totalSales = sales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
    const transactionsCount = sales.length;

    // Ganancia bruta: necesitamos los items de estas ventas
    const saleIds = sales.map(s => s.id);
    let grossProfit = 0;
    if (saleIds.length > 0) {
      const placeholders = saleIds.map(() => '?').join(',');
      const items = db.prepare(`
        SELECT si.subtotal, si.quantity, p.cost_price 
        FROM sale_items si 
        JOIN products p ON si.product_id = p.id
        WHERE si.sale_id IN (${placeholders})
      `).all(...saleIds);
      grossProfit = items.reduce((sum, item) => sum + (Number(item.subtotal) - (Number(item.cost_price) * Number(item.quantity))), 0);
    }

    const lowStockCountRes = db.prepare(`SELECT COUNT(*) as count FROM products WHERE stock <= min_stock AND min_stock > 0`).get();

    // Gráfico por horas
    const salesByHour = new Array(24).fill(0);
    const todayStr = db.prepare("SELECT date('now', 'localtime') as date").get().date;
    
    // Para el gráfico, si tenemos shiftId, usamos las ventas del turno. Si no, las de hoy.
    const hourlyQuery = shiftId 
      ? `SELECT strftime('%H', time) as hour, SUM(total) as total FROM sales WHERE shift_id = ? GROUP BY hour`
      : `SELECT strftime('%H', time) as hour, SUM(total) as total FROM sales WHERE date(time) = date(?) GROUP BY hour`;
    
    const hourlyQueryResult = db.prepare(hourlyQuery).all(shiftId || todayStr);

    for (const row of hourlyQueryResult) {
      const h = parseInt(row.hour, 10);
      if (h >= 0 && h < 24) salesByHour[h] = Number(row.total) || 0;
    }
    
    return {
      totalSales,
      transactionsCount,
      grossProfit,
      lowStockCount: lowStockCountRes.count,
      salesByHour
    };
  });

  // --- Settings & Printer ---
  const printer = require('./printer');

  ipcMain.handle('get-settings', () => {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  });

  ipcMain.handle('update-setting', (event, { key, value }) => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
    return true;
  });

  ipcMain.handle('test-printer', async (event, { interfaceName, width, saleData }) => {
    return await printer.testPrinter(interfaceName, width, saleData);
  });

  ipcMain.handle('get-printers', async () => {
    const win = getMainWindow();
    if (!win) return [];
    return await win.webContents.getPrintersAsync();
  });

  ipcMain.handle('print-receipt', async (event, saleData) => {
    await printer.printReceipt(saleData);
    return true;
  });

  // --- Phase 17: Attendance Report ---
  ipcMain.handle('get-attendance-report', (event, { startDate, endDate }) => {
    const rows = db.prepare(`
      SELECT 
        st.name,
        st.role,
        sh.id,
        sh.start_time,
        sh.end_time,
        ROUND(
          (julianday(COALESCE(sh.end_time, datetime('now', 'localtime'))) - julianday(sh.start_time)) * 24,
          2
        ) as hours_worked
      FROM shifts sh
      JOIN staff st ON sh.staff_id = st.id
      WHERE sh.start_time >= ? AND sh.start_time < ?
      ORDER BY sh.start_time DESC
    `).all(startDate, endDate);
    return rows;
  });



  // --- Phase 20: Backup Database ---
  ipcMain.handle('backup-database', async () => {
    const { dialog } = require('electron');
    const today = new Date().toISOString().slice(0, 10);
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Guardar Respaldo de Base de Datos',
      defaultPath: `pos_backup_${today}.sqlite`,
      filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }],
    });
    if (!canceled && filePath) {
      fs.copyFileSync(dbPath, filePath);
      return filePath;
    }
    return null;
  });

  // --- Phase 21: Analytics ---

  ipcMain.handle('get-sales-analytics', (event, { period, startDate, endDate }) => {
    let groupExpr;
    if (period === 'day') groupExpr = "strftime('%H', s.time)";
    else if (period === 'week') groupExpr = "strftime('%Y-%W', s.time)";
    else if (period === 'month') groupExpr = "strftime('%Y-%m-%d', s.time)";
    else groupExpr = "strftime('%Y-%m', s.time)"; // year

    const rows = db.prepare(`
      SELECT 
        ${groupExpr} as period_label,
        COUNT(*) as transaction_count,
        SUM(s.total) as total_revenue,
        SUM(
          (SELECT SUM(si.quantity * (si.unit_price - p.cost_price))
           FROM sale_items si JOIN products p ON si.product_id = p.id
           WHERE si.sale_id = s.id)
        ) as gross_profit
      FROM sales s
      WHERE s.time >= ? AND s.time < ?
      GROUP BY period_label
      ORDER BY period_label ASC
    `).all(startDate, endDate);

    const kpi = db.prepare(`
      SELECT
        COUNT(*) as transaction_count,
        SUM(s.total) as total_revenue,
        SUM(
          (SELECT SUM(si.quantity * (si.unit_price - p.cost_price))
           FROM sale_items si JOIN products p ON si.product_id = p.id
           WHERE si.sale_id = s.id)
        ) as gross_profit,
        AVG(s.total) as avg_ticket
      FROM sales s
      WHERE s.time >= ? AND s.time < ?
    `).get(startDate, endDate);

    return { chart: rows, kpi };
  });

  ipcMain.handle('get-best-sellers', (event, { startDate, endDate }) => {
    return db.prepare(`
      SELECT
        p.id,
        p.name,
        p.unit,
        p.cost_price,
        ROUND(SUM(si.quantity), 2) as total_qty,
        ROUND(SUM(si.subtotal), 0) as total_revenue,
        ROUND(SUM(si.quantity * (si.unit_price - p.cost_price)), 0) as total_profit,
        ROUND(AVG(si.unit_price), 0) as avg_price,
        COUNT(DISTINCT si.sale_id) as sale_count
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE s.time >= ? AND s.time < ?
      GROUP BY p.id
      ORDER BY total_qty DESC
      LIMIT 30
    `).all(startDate, endDate);
  });

  ipcMain.handle('get-product-history', (event, { productId, startDate, endDate }) => {
    const rows = db.prepare(`
      SELECT
        s.time,
        si.quantity,
        si.unit_price,
        si.subtotal,
        ROUND(si.unit_price - p.cost_price, 0) as unit_profit,
        st.name as cashier_name
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      JOIN staff st ON s.cashier_id = st.id
      WHERE si.product_id = ? AND s.time >= ? AND s.time < ?
      ORDER BY s.time DESC
    `).all(productId, startDate, endDate);

    const summary = db.prepare(`
      SELECT
        p.name, p.cost_price, p.unit,
        ROUND(SUM(si.quantity), 2) as total_qty,
        ROUND(SUM(si.subtotal), 0) as total_revenue,
        ROUND(AVG(si.unit_price), 0) as avg_price,
        ROUND(SUM(si.quantity * (si.unit_price - p.cost_price)), 0) as total_profit
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      JOIN sales s ON si.sale_id = s.id
      WHERE si.product_id = ? AND s.time >= ? AND s.time < ?
      GROUP BY p.id
    `).get(productId, startDate, endDate);

    return { rows, summary };
  });

  ipcMain.handle('get-kardex', (event, { productId, startDate, endDate }) => {
    const productFilter = productId ? productId : null;

    const entries = db.prepare(`
      SELECT
        pi.date as movement_date,
        'Entrada' as direction,
        'Compra a Proveedor' as type,
        p.name as product_name,
        s.name as counterpart,
        pitem.quantity,
        pitem.cost_price as unit_value,
        ROUND(pitem.quantity * pitem.cost_price, 0) as total_value
      FROM purchase_items pitem
      JOIN purchase_invoices pi ON pitem.invoice_id = pi.id
      JOIN products p ON pitem.product_id = p.id
      JOIN suppliers s ON pi.supplier_id = s.id
      WHERE (? IS NULL OR pitem.product_id = ?)
        AND pi.date >= ? AND pi.date <= ?
    `).all(productFilter, productFilter, startDate, endDate);

    const exits = db.prepare(`
      SELECT
        sa.time as movement_date,
        'Salida' as direction,
        'Venta' as type,
        p.name as product_name,
        st.name as counterpart,
        si.quantity,
        si.unit_price as unit_value,
        si.subtotal as total_value
      FROM sale_items si
      JOIN sales sa ON si.sale_id = sa.id
      JOIN products p ON si.product_id = p.id
      JOIN staff st ON sa.cashier_id = st.id
      WHERE (? IS NULL OR si.product_id = ?)
        AND sa.time >= ? AND sa.time < ?
    `).all(productFilter, productFilter, startDate, endDate);

    const adjustments = db.prepare(`
      SELECT
        ad.date as movement_date,
        CASE WHEN ad.quantity >= 0 THEN 'Entrada' ELSE 'Salida' END as direction,
        'Ajuste: ' || ad.reason as type,
        p.name as product_name,
        st.name as counterpart,
        ABS(ad.quantity) as quantity,
        0 as unit_value,
        0 as total_value
      FROM stock_adjustments ad
      JOIN products p ON ad.product_id = p.id
      JOIN staff st ON ad.staff_id = st.id
      WHERE (? IS NULL OR ad.product_id = ?)
        AND ad.date >= ? AND ad.date <= ?
    `).all(productFilter, productFilter, startDate, endDate);


    const combined = [...entries, ...exits, ...adjustments].sort((a, b) =>
      new Date(b.movement_date).getTime() - new Date(a.movement_date).getTime()
    );
    return combined;
  });

  ipcMain.handle('record-stock-adjustment', (event, { productId, quantity, reason, staffId, notes }) => {
    const date = new Date().toISOString();
    
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO stock_adjustments (product_id, quantity, reason, date, staff_id, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(productId, quantity, reason, date, staffId, notes);

      db.prepare(`UPDATE products SET stock = stock + ? WHERE id = ?`).run(quantity, productId);

      // Enqueue sync
      db.prepare(`
        INSERT INTO sync_queue (collection_name, data, created_at)
        VALUES ('adjustments', ?, ?)
      `).run(JSON.stringify({ product_id: productId, quantity, reason, date, staff_id: staffId, notes }), date);
    });

    transaction();
    if (forceSync) forceSync();
    return { success: true };
  });

  // --- Phase 28: Wastage (Mermas) ---
  ipcMain.handle('record-wastage', (event, { productId, quantity, reason, staffId, notes }) => {
    try {
      console.log('Recording wastage:', { productId, quantity, reason, staffId });
      const product = db.prepare('SELECT cost_price FROM products WHERE id = ?').get(productId);
      if (!product) throw new Error('Producto no encontrado');

      const unitCost = product.cost_price;
      const totalLoss = parseFloat((unitCost * quantity).toFixed(2));
      const date = new Date().toISOString();

      const transaction = db.transaction(() => {
        // 1. Log wastage
        db.prepare(`
          INSERT INTO wastage_logs (product_id, quantity, reason, unit_cost, total_loss, date, staff_id, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(productId, quantity, reason, unitCost, totalLoss, date, staffId, notes);

        // 2. Adjust stock
        db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ?`).run(quantity, productId);

        // 3. Enqueue sync
        db.prepare(`
          INSERT INTO sync_queue (collection_name, data, created_at)
          VALUES ('wastage', ?, ?)
        `).run(JSON.stringify({ product_id: productId, quantity, reason, unit_cost: unitCost, total_loss: totalLoss, date, staff_id: staffId, notes }), date);
      });

      transaction();
      if (forceSync) forceSync();
      console.log('Wastage recorded successfully');
      return { success: true };
    } catch (error) {
      console.error('Error in record-wastage:', error);
      throw error;
    }
  });

  ipcMain.handle('get-wastage-analytics', (event, { startDate, endDate }) => {
    const rows = db.prepare(`
      SELECT 
        reason,
        SUM(total_loss) as total_loss,
        SUM(quantity) as total_qty,
        COUNT(*) as event_count
      FROM wastage_logs
      WHERE date >= ? AND date < ?
      GROUP BY reason
      ORDER BY total_loss DESC
    `).all(startDate, endDate);

    const history = db.prepare(`
      SELECT 
        w.*, p.name as product_name, st.name as staff_name
      FROM wastage_logs w
      JOIN products p ON w.product_id = p.id
      JOIN staff st ON w.staff_id = st.id
      WHERE w.date >= ? AND w.date < ?
      ORDER BY w.date DESC
      LIMIT 100
    `).all(startDate, endDate);

    return { summary: rows, history };
  });


  // --- Phase 28: CFD Media ---
  ipcMain.handle('get-cfd-media', () => {
    return db.prepare('SELECT * FROM cfd_media ORDER BY display_order ASC').all();
  });

  ipcMain.handle('add-cfd-media', (event, { url, type, order }) => {
    const info = db.prepare('INSERT INTO cfd_media (url, type, display_order) VALUES (?, ?, ?)').run(url, type || 'image', order || 0);
    return info.lastInsertRowid;
  });

  ipcMain.handle('delete-cfd-media', async (event, id) => {
    try {
      const media = db.prepare('SELECT url FROM cfd_media WHERE id = ?').get(id);
      if (media && media.url.startsWith('media://')) {
        const fileName = media.url.replace('media://', '');
        const decodedName = decodeURIComponent(fileName);
        const mediaDir = path.join(app.getPath('userData'), 'cfd_media');
        
        let finalPath;
        if (path.isAbsolute(decodedName) || (process.platform === 'win32' && /^[a-zA-Z]:/.test(decodedName))) {
          finalPath = path.normalize(decodedName);
        } else {
          finalPath = path.join(mediaDir, decodedName);
        }

        if (fs.existsSync(finalPath)) {
          fs.promises.unlink(finalPath).catch(err => console.error('Error deleting file:', err));
        }
      }
      db.prepare('DELETE FROM cfd_media WHERE id = ?').run(id);
      return true;
    } catch (error) {
      console.error('Error deleting media record:', error);
      return false;
    }
  });

  ipcMain.handle('update-cfd-media-order', (event, items) => {
    const update = db.prepare('UPDATE cfd_media SET display_order = ? WHERE id = ?');
    const transaction = db.transaction((list) => {
      for (const item of list) {
        update.run(item.display_order, item.id);
      }
    });
    transaction(items);
    return true;
  });

  // --- Local Media Management (Arquitectura Drop Folder) ---
  const mediaPath = path.join(app.getPath('documents'), 'BajoCero_Pantalla');
  
  // Asegurar que la carpeta existe
  if (!fs.existsSync(mediaPath)) {
    fs.mkdirSync(mediaPath, { recursive: true });
    console.log('[Media] Carpeta Drop Folder creada en:', mediaPath);
  }

  ipcMain.handle('get-cfd-images', async () => {
    try {
      const files = fs.readdirSync(mediaPath);
      const images = files
        .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
        .map(file => {
          const filePath = path.join(mediaPath, file);
          const buffer = fs.readFileSync(filePath);
          const ext = path.extname(file).substring(1).toLowerCase();
          const base64 = buffer.toString('base64');
          return {
            id: file,
            url: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${base64}`,
            type: 'image'
          };
        });
      return images;
    } catch (error) {
      console.error('Error leyendo carpeta de medios:', error);
      return [];
    }
  });

  ipcMain.handle('open-media-folder', () => {
    const { shell } = require('electron');
    shell.openPath(mediaPath);
    return true;
  });

  ipcMain.handle('select-and-upload-media', async () => {
    // Obsoleto pero se mantiene para no romper el driver inmediatamente
    return null;
  });

  // Antiguos manejadores (Mantenidos temporalmente para compatibilidad)
  ipcMain.handle('select-media-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Seleccionar Imagen o Video para Carrusel',
      filters: [
        { name: 'Multimedia', extensions: ['jpg', 'png', 'jpeg', 'mp4'] }
      ],
      properties: ['openFile']
    });
    if (canceled) return null;
    return filePaths[0];
  });

  ipcMain.handle('upload-media-file', async (event, sourcePath) => {
    try {
      // Validar que el archivo de origen existe
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`El archivo de origen no existe: ${sourcePath}`);
      }

      const mediaFolder = path.join(app.getPath('userData'), 'cfd_media');
      if (!fs.existsSync(mediaFolder)) {
        fs.mkdirSync(mediaFolder, { recursive: true });
      }

      const fileName = `${Date.now()}_${path.basename(sourcePath).replace(/\s+/g, '_')}`;
      const destPath = path.join(mediaFolder, fileName);
      
      console.log('[Upload] Guardando Media CFD en:', destPath);
      fs.copyFileSync(sourcePath, destPath);

      // Verificamos que se haya copiado
      if (!fs.existsSync(destPath)) {
        throw new Error('Fallo crítico al copiar el archivo a destino.');
      }

      // Devolvemos la ruta con el protocolo personalizado
      return `media://${fileName}`;
    } catch (error) {
      console.error('Error en upload-media-file:', error);
      throw new Error(`Error al procesar multimedia: ${error.message}`);
    }
  });

  ipcMain.handle('get-sync-status', () => {
    try {
      const res = db.prepare('SELECT COUNT(*) as count FROM sync_queue WHERE synced = 0').get();
      return res.count || 0;
    } catch (error) {
      console.error('Error fetching sync status:', error.message);
      return 0;
    }
  });

  // --- Shifts & Cash Closing ---
  ipcMain.handle('check-active-shift', (event, staff_id) => {
    try {
      console.log(`[Turnos Main] Verificando turno activo para StaffID: ${staff_id}`);
      // Regla de negocio: UPPER para evitar fallos de case sensitivity y filtrado estricto por staff_id
      const query = `
        SELECT cs.*, st.name as staff_name, st.hourly_wage 
        FROM cash_shifts cs
        JOIN staff st ON cs.staff_id = st.id
        WHERE UPPER(cs.status) = 'OPEN' AND cs.staff_id = ? 
        LIMIT 1
      `;
      const activeShift = db.prepare(query).get(staff_id);
      
      return { 
        hasOpenShift: !!activeShift, 
        shift: activeShift || null 
      };
    } catch (error) {
      console.error('[DB] Error crítico verificando turno activo:', error);
      // Fail closed: Si hay error, asumimos que NO hay turno abierto para forzar apertura/validación
      return { hasOpenShift: false, error: error.message };
    }
  });

  ipcMain.handle('get-active-shift', (event, staff_id) => {
    return db.prepare("SELECT * FROM cash_shifts WHERE staff_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1").get(staff_id);
  });

  ipcMain.handle('get-shifts', (event, { startDate, endDate, staffId } = {}) => {
    try {
      let query = `
        SELECT cs.*, st.name as staff_name, st.hourly_wage 
        FROM cash_shifts cs
        LEFT JOIN staff st ON cs.staff_id = st.id
        WHERE 1=1
      `;
      const params = [];

      if (startDate && endDate) {
        query += " AND date(cs.opened_at) BETWEEN date(?) AND date(?)";
        params.push(startDate, endDate);
      }

      if (staffId && staffId !== 'ALL') {
        query += " AND cs.staff_id = ?";
        params.push(staffId);
      }

      query += " ORDER BY cs.opened_at DESC";
      
      console.log(`[Turnos Main] Ejecutando búsqueda Payroll. StaffId: ${staffId || 'Todos'} | Fechas: ${startDate} - ${endDate}`);
      return db.prepare(query).all(...params);
    } catch (error) {
      console.error('[Turnos Main] Error en get-shifts:', error);
      return [];
    }
  });

  ipcMain.handle('get-backoffice-closures', (event, startDate, endDate) => {
    try {
      let query = `
        SELECT 
          cs.id, 
          cs.opened_at, 
          cs.closed_at, 
          cs.opening_balance, 
          cs.system_cash, 
          cs.physical_cash, 
          cs.discrepancy_cash,
          cs.system_card,
          cs.physical_card,
          cs.discrepancy_card,
          cs.system_transfer,
          cs.status,
          st.name as staff_name,
          st.name as cashier_name
        FROM cash_shifts cs
        LEFT JOIN staff st ON cs.staff_id = st.id
        WHERE UPPER(cs.status) = 'CLOSED'
      `;
      const params = [];

      if (startDate && endDate) {
        query += " AND date(cs.opened_at) BETWEEN date(?) AND date(?)";
        params.push(startDate, endDate);
      }

      query += " ORDER BY cs.closed_at DESC LIMIT 100";
      
      console.log(`[Backoffice Main] Consultando cierres. Rango: ${startDate || 'N/A'} - ${endDate || 'N/A'}`);
      return db.prepare(query).all(...params);
    } catch (error) {
      console.error('[Backoffice Main] Error en get-backoffice-closures:', error);
      return [];
    }
  });

  ipcMain.handle('get-global-active-shift', () => {
    return db.prepare(`
      SELECT cs.*, st.name as staff_name 
      FROM cash_shifts cs 
      JOIN staff st ON cs.staff_id = st.id 
      WHERE cs.status = 'OPEN' 
      LIMIT 1
    `).get() || null;
  });

  ipcMain.handle('open-shift', (event, { staff_id, opening_balance }) => {
    try {
      // 1. Verificación de conflicto global (REQUERIMIENTO DE ALTA CRITICIDAD)
      const existingShift = db.prepare(`
        SELECT cs.*, st.name as staff_name 
        FROM cash_shifts cs 
        JOIN staff st ON cs.staff_id = st.id 
        WHERE cs.status = 'OPEN' 
        LIMIT 1
      `).get();

      if (existingShift) {
        console.warn(`[Turnos Main] Conflicto de apertura: Caja ya abierta por ${existingShift.staff_name}`);
        return { 
          error: 'GLOBAL_SHIFT_CONFLICT', 
          activeCashierName: existingShift.staff_name 
        };
      }

      // 2. Proceder con la apertura si no hay conflictos
      const now = db.prepare("SELECT datetime('now', 'localtime') as now").get().now;
      const result = db.prepare(`
        INSERT INTO cash_shifts (staff_id, opened_at, opening_balance, status)
        VALUES (?, ?, ?, 'OPEN')
      `).run(staff_id, now, opening_balance);
      
      const shiftId = result.lastInsertRowid;
      const staff = db.prepare("SELECT name FROM staff WHERE id = ?").get(staff_id);
      const staffName = staff ? staff.name : `Cajero ${staff_id}`;

      // 3. Sync to Cloud
      db.prepare(`
        INSERT INTO sync_queue (collection_name, data, created_at)
        VALUES ('cash_shifts', ?, ?)
      `).run(JSON.stringify({ 
        id: shiftId, 
        staff_id, 
        staff_name: staffName, 
        opened_at: now, 
        opening_balance, 
        status: 'OPEN' 
      }), now);
      
      return shiftId;
    } catch (error) {
      console.error('[Turnos Main] Error abriendo turno:', error);
      throw error;
    }
  });

  ipcMain.handle('get-shift-summary', (event, shift_id) => {
    const shift = db.prepare("SELECT * FROM cash_shifts WHERE id = ?").get(shift_id);
    if (!shift) return null;

    const payments = db.prepare(`
      SELECT pm.name as method, SUM(sp.amount) as total
      FROM sale_payments sp
      JOIN sales s ON sp.sale_id = s.id
      JOIN payment_methods pm ON sp.payment_method_id = pm.id
      WHERE s.shift_id = ?
      GROUP BY pm.name
    `).all(shift_id);

    const fiadoPayments = db.prepare(`
      SELECT payment_method as method, SUM(amount) as total
      FROM fiado_payments
      WHERE shift_id = ?
      GROUP BY payment_method
    `).all(shift_id);

    const summary = {
      cash: 0,
      card: 0,
      transfer: 0
    };

    const processPaymentRow = (p) => {
      const name = p.method.toLowerCase();
      if (name.includes('efectivo') || name.includes('cash')) summary.cash += p.total;
      else if (name.includes('tarjeta') || name.includes('card')) summary.card += p.total;
      else if (name.includes('transferencia') || name.includes('transfer')) summary.transfer += p.total;
    };

    payments.forEach(processPaymentRow);
    fiadoPayments.forEach(processPaymentRow);

    return summary;
  });

  ipcMain.handle('close-shift', async (event, { shift_id, physical_cash, physical_card }) => {
    try {
      const now = db.prepare("SELECT datetime('now', 'localtime') as now").get().now;
      
      // 1. Get system totals
      const payments = db.prepare(`
        SELECT pm.name as method, SUM(sp.amount) as total
        FROM sale_payments sp
        JOIN sales s ON sp.sale_id = s.id
        JOIN payment_methods pm ON sp.payment_method_id = pm.id
        WHERE s.shift_id = ?
        GROUP BY pm.name
      `).all(shift_id);

      const fiadoPayments = db.prepare(`
        SELECT payment_method as method, SUM(amount) as total
        FROM fiado_payments
        WHERE shift_id = ?
        GROUP BY payment_method
      `).all(shift_id);

      let systemCash = 0;
      let systemCard = 0;
      let systemTransfer = 0;

      const processPaymentRow = (p) => {
        const name = p.method.toLowerCase();
        if (name.includes('efectivo') || name.includes('cash')) systemCash += p.total;
        else if (name.includes('tarjeta') || name.includes('card')) systemCard += p.total;
        else if (name.includes('transferencia') || name.includes('transfer')) systemTransfer += p.total;
      };

      payments.forEach(processPaymentRow);
      fiadoPayments.forEach(processPaymentRow);

      const shift = db.prepare("SELECT opening_balance FROM cash_shifts WHERE id = ?").get(shift_id);
      const expectedCash = (shift.opening_balance || 0) + systemCash;
      const discrepancy_cash = physical_cash - expectedCash;
      const discrepancy_card = physical_card - systemCard;

      // 2. Update local DB
      db.prepare(`
        UPDATE cash_shifts 
        SET closed_at = ?, 
            system_cash = ?, system_card = ?, system_transfer = ?,
            physical_cash = ?, physical_card = ?,
            discrepancy_cash = ?, discrepancy_card = ?,
            status = 'CLOSED'
        WHERE id = ?
      `).run(now, systemCash, systemCard, systemTransfer, physical_cash, physical_card, discrepancy_cash, discrepancy_card, shift_id);

      // 3. Obtener el turno de SQLite CON el nombre del empleado
      const fullShift = db.prepare(`
        SELECT cs.*, st.name as staff_name 
        FROM cash_shifts cs
        LEFT JOIN staff st ON cs.staff_id = st.id
        WHERE cs.id = ?
      `).get(shift_id);

      // Armar el payload asegurando que el nombre vaya como string
      const payloadToFirebase = {
        ...fullShift,
        staff_id: fullShift.staff_id,
        staff_name: fullShift.staff_name || 'Nombre Desconocido',
        synced_at: new Date().toISOString()
      };

      console.log('[SYNC] Subiendo a la cola de Firebase payload completo:', payloadToFirebase);

      db.prepare(`
        INSERT INTO sync_queue (collection_name, data, created_at)
        VALUES ('cash_shifts_update', ?, ?)
      `).run(JSON.stringify(payloadToFirebase), now);

      // 4. Print Report Z
      try {
        const { printReportZ } = require('./printer');
        
        const staff = db.prepare("SELECT name FROM staff WHERE id = ?").get(fullShift.staff_id);
        
        // Get detailed sales count
        const salesCount = db.prepare("SELECT COUNT(*) as count FROM sales WHERE shift_id = ?").get(shift_id).count;
        
        // Get wastage for the shift
        const wastage = db.prepare(`
          SELECT SUM(total_loss) as total FROM wastage_logs 
          WHERE date >= ? AND date <= ?
        `).get(fullShift.opened_at, now).total || 0;

        await printReportZ({
          ...fullShift,
          cashier_name: staff ? staff.name : 'Unknown',
          sales_count: salesCount,
          wastage_total: wastage,
          payments_summary: payments
        });
      } catch (printErr) {
        console.error('Error printing Report Z:', printErr);
      }

      return true;
    } catch (error) {
      console.error('Error closing shift:', error);
      throw error;
    }
  });


  ipcMain.handle('force-close-shift', async (event, adminId) => {
    try {
      console.log(`[Turnos Main] Admin ${adminId} solicitando cierre forzado de emergencia...`);
      const activeShift = db.prepare("SELECT * FROM cash_shifts WHERE status = 'OPEN' LIMIT 1").get();
      
      if (!activeShift) {
        console.log('[Turnos Main] Intento de cierre forzado pero no hay turnos abiertos.');
        return { success: true };
      }

      const now = db.prepare("SELECT datetime('now', 'localtime') as now").get().now;
      
      db.prepare(`
        UPDATE cash_shifts 
        SET status = 'CLOSED', 
            closed_at = ?, 
            system_cash = 0, system_card = 0, system_transfer = 0,
            physical_cash = 0, physical_card = 0,
            discrepancy_cash = 0, discrepancy_card = 0,
            force_closed_by = ?
        WHERE id = ?
      `).run(now, adminId, activeShift.id);

      console.log(`[Turnos Main] Turno ${activeShift.id} cerrado forzosamente por Admin ${adminId}`);
      return { success: true };
    } catch (error) {
      console.error('[Turnos Main] Error en force-close-shift:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-shift-history', () => {
    return db.prepare(`
      SELECT cs.*, st.name as staff_name 
      FROM cash_shifts cs
      JOIN staff st ON cs.staff_id = st.id
      ORDER BY cs.opened_at DESC
      LIMIT 100
    `).all();
  });

  // --- Cash Audit & Movements ---
  ipcMain.handle('get-cash-movements', (event, shiftId) => {
    return db.prepare(`
      SELECT cm.*, st.name as staff_name, s.time as sale_time
      FROM cash_movements cm
      LEFT JOIN staff st ON cm.staff_id = st.id
      LEFT JOIN sales s ON cm.sale_id = s.id
      WHERE cm.shift_id = ?
      ORDER BY cm.created_at DESC
    `).all(shiftId);
  });

  ipcMain.handle('add-cash-movement', (event, { shiftId, type, source, amount, description, staffId }) => {
    const now = db.prepare("SELECT datetime('now', 'localtime') as now").get().now;
    return db.prepare(`
      INSERT INTO cash_movements (shift_id, type, source, amount, description, staff_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(shiftId, type, source, amount, description, staffId, now);
  });

  ipcMain.handle('get-cash-audit-summary', (event, shiftId) => {
    const shift = db.prepare("SELECT opening_balance FROM cash_shifts WHERE id = ?").get(shiftId);
    if (!shift) return null;

    const inflows = db.prepare("SELECT SUM(amount) as total FROM cash_movements WHERE shift_id = ? AND type = 'IN'").get(shiftId).total || 0;
    const outflows = db.prepare("SELECT SUM(amount) as total FROM cash_movements WHERE shift_id = ? AND type = 'OUT'").get(shiftId).total || 0;
    
    return {
      opening_balance: shift.opening_balance,
      inflows,
      outflows,
      expected_cash: shift.opening_balance + inflows - outflows
    };
  });

  // --- Emergency Sync Management ---
  ipcMain.handle('clear-sync-queue', () => {
    try {
      db.prepare('DELETE FROM sync_queue WHERE synced = 0').run();
      return true;
    } catch (error) {
      console.error('Error clearing sync queue:', error);
      return false;
    }
  });

  ipcMain.handle('force-sync-service', () => {
    if (forceSync) {
      forceSync();
      return true;
    }
    return false;
  });

  // --- Fiados Management ---
  ipcMain.handle('get-pending-fiados', (event) => {
    return db.prepare(`
      SELECT f.*, 
             s.time as sale_time,
             (f.total_amount - IFNULL(SUM(fp.amount), 0)) as balance
      FROM fiados f
      LEFT JOIN fiado_payments fp ON f.id = fp.fiado_id
      LEFT JOIN sales s ON f.sale_id = s.id
      WHERE f.status = 'PENDING'
      GROUP BY f.id
      HAVING balance > 0
      ORDER BY f.created_at DESC
    `).all();
  });

  ipcMain.handle('pay-fiado', (event, { fiado_id, amount, payment_method, current_shift_id }) => {
    const payTransaction = db.transaction(() => {
      // Acción 1: Insertar en fiado_payments
      const insertPayment = db.prepare('INSERT INTO fiado_payments (fiado_id, shift_id, amount, payment_method) VALUES (?, ?, ?, ?)');
      insertPayment.run(fiado_id, current_shift_id, amount, payment_method);

      // Acción 3: Verificar y cerrar deuda
      const currentBalance = db.prepare(`
        SELECT f.total_amount - IFNULL(SUM(fp.amount), 0) as balance
        FROM fiados f
        LEFT JOIN fiado_payments fp ON f.id = fp.fiado_id
        WHERE f.id = ?
        GROUP BY f.id
      `).get(fiado_id).balance;

      if (currentBalance <= 0) {
        db.prepare("UPDATE fiados SET status = 'PAID' WHERE id = ?").run(fiado_id);
      }

      // --- NEW: Record Cash Movement for Audit ---
      if (payment_method && payment_method.toLowerCase().includes('efectivo')) {
        const now = db.prepare("SELECT datetime('now', 'localtime') as now").get().now;
        db.prepare(`
          INSERT INTO cash_movements (shift_id, type, source, amount, description, staff_id, created_at)
          VALUES (?, 'IN', 'FIADO_PAYMENT', ?, ?, (SELECT staff_id FROM cash_shifts WHERE id = ?), ?)
        `).run(current_shift_id, amount, `Pago Fiado: ${fiado_id}`, current_shift_id, now);
      }

      return currentBalance;
    });

    return payTransaction();
  });

  ipcMain.handle('void-sale', (event, { saleId, restock, refund, voidedBy }) => {
    try {
      const voidTransaction = db.transaction(() => {
        // 1. Marcar la venta como anulada
        const voidTime = db.prepare("SELECT datetime('now', 'localtime') as now").get().now;
        db.prepare(`
          UPDATE sales SET status = 'VOIDED', voided_at = ?, voided_by = ? WHERE id = ?
        `).run(voidTime, voidedBy || null, saleId);

        // 2. Si se solicita restock, reintegrar productos al inventario
        if (restock) {
          const items = db.prepare('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?').all(saleId);
          const updateStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
          for (const item of items) {
            updateStock.run(item.quantity, item.product_id);
          }
        }

        // 3. Si existe un fiado vinculado, marcarlo como VOIDED
        db.prepare("UPDATE fiados SET status = 'VOIDED' WHERE sale_id = ?").run(saleId);

        // 4. Registrar en sync_queue para la nube
        db.prepare(`
          INSERT INTO sync_queue (collection_name, data, created_at)
          VALUES ('sales_void', ?, ?)
        `).run(JSON.stringify({ saleId, restock, refund, voidedBy, voided_at: voidTime }), voidTime);

        return true;
      });

      return voidTransaction();
    } catch (error) {
      console.error('[DB ERR] void-sale:', error);
      return false;
    }
  });

  // --- Reports & Analytics ---
  ipcMain.handle('get-sales-history', (event, { startDate, endDate } = {}) => {
    try {
      let query = `
        SELECT s.*, st.name as cashier_name
        FROM sales s
        LEFT JOIN staff st ON s.cashier_id = st.id
        WHERE 1=1
      `;
      const params = [];

      if (startDate && endDate) {
        query += " AND date(s.time) BETWEEN date(?) AND date(?)";
        params.push(startDate, endDate);
      } else {
        // Por defecto, últimos 30 días si no se especifica
        query += " AND date(s.time) >= date('now', '-30 days')";
      }

      query += " ORDER BY s.time DESC LIMIT 500";
      
      const sales = db.prepare(query).all(...params);

      // Enriquecer con items (incluyendo nombres reales) y pagos para la vista detalle
      return sales.map(sale => {
        const items = db.prepare(`
          SELECT si.*, p.name as product_name, p.unit
          FROM sale_items si
          LEFT JOIN products p ON si.product_id = p.id
          WHERE si.sale_id = ?
        `).all(sale.id);

        const payments = db.prepare(`
          SELECT sp.*, pm.name as method_name 
          FROM sale_payments sp
          JOIN payment_methods pm ON sp.payment_method_id = pm.id
          WHERE sp.sale_id = ?
        `).all(sale.id);

        return { ...sale, items, payments };
      });
    } catch (error) {
      console.error('[DB ERR] get-sales-history:', error);
      return [];
    }
  });

  ipcMain.handle('get-sales-summary', (event, { startDate, endDate } = {}) => {
    try {
      let query = "SELECT COUNT(*) as count, SUM(total) as totalRevenue FROM sales WHERE status != 'VOIDED'";
      const params = [];

      if (startDate && endDate) {
        query += " AND date(time) BETWEEN date(?) AND date(?)";
        params.push(startDate, endDate);
      }

      const res = db.prepare(query).get(...params);
      return {
        count: res.count || 0,
        totalRevenue: res.totalRevenue || 0
      };
    } catch (error) {
      console.error('[DB ERR] get-sales-summary:', error);
      return { count: 0, totalRevenue: 0 };
    }
  });

  // --- Maintenance & Purge ---
  ipcMain.handle('clear-sales-history', (event, { restoreStock } = {}) => {
    try {
      const purgeTransaction = db.transaction(() => {
        if (restoreStock) {
          // Si el usuario marcó reintegrar stock antes de borrar
          const items = db.prepare('SELECT product_id, quantity FROM sale_items').all();
          const updateStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
          for (const item of items) {
            updateStock.run(item.quantity, item.product_id);
          }
        }

        db.prepare('DELETE FROM sale_items').run();
        db.prepare('DELETE FROM sale_payments').run();
        db.prepare('DELETE FROM fiado_payments').run();
        db.prepare('DELETE FROM fiados').run();
        db.prepare('DELETE FROM sales').run();
        db.prepare('DELETE FROM cash_shifts').run(); // Limpiar también turnos para un reset financiero total
        
        // Resetear secuencias de ID (opcional en SQLite pero recomendable)
        db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('sales', 'sale_items', 'cash_shifts', 'fiados')").run();
      });

      purgeTransaction();
      console.log('[MAINTENANCE] Historial de ventas purgado con éxito.');
      return true;
    } catch (error) {
      console.error('[MAINTENANCE ERR] Error al purgar historial:', error);
      throw error;
    }
  });

  ipcMain.handle('clear-catalog', () => {
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM products').run();
        db.prepare('DELETE FROM categories').run();
        db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('products', 'categories')").run();
      })();
      return true;
    } catch (error) {
      console.error('[MAINTENANCE ERR] Error al purgar catálogo:', error);
      throw error;
    }
  });

  ipcMain.handle('factory-reset', async () => {
    try {
      console.log('[FACTORY RESET] Iniciando secuencia de borrado...');
      
      // 1. Cerrar la conexión actual a la base de datos (VITAL para evitar bloqueos EBUSY)
      if (db) {
        db.close(); 
      }

      // 2. Localizar y borrar el archivo físico de SQLite
      console.log(`[FACTORY RESET] Intentando borrar: ${dbPath}`);
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.log('[FACTORY RESET] Archivo SQLite eliminado con éxito.');
      }

      // 3. Reiniciar la aplicación para que initDB() cree un archivo nuevo en blanco
      app.relaunch();
      app.exit(0);

      return true;
    } catch (error) {
      console.error('[FACTORY RESET CRÍTICO] Error al restablecer:', error);
      throw error;
    }
  });
}

module.exports = { setupIpcHandlers };
