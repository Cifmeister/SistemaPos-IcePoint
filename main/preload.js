const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipcRenderer', {
  send: (channel, data) => {
    const validChannels = ['sync-cart-to-cfd', 'open-customer-window'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  invoke: (channel, ...args) => {
    // Exponer invoke de forma segura si es necesario, o genérica para depuración
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, func) => {
    const validChannels = ['update-cfd-cart'];
    if (validChannels.includes(channel)) {
      // Limpiar listeners previos para evitar duplicados
      ipcRenderer.removeAllListeners(channel);
      ipcRenderer.on(channel, (event, ...args) => func(event, ...args));
    }
  }
});


contextBridge.exposeInMainWorld('electronAPI', {
  getProducts: () => ipcRenderer.invoke('get-products'),
  addProduct: (product) => ipcRenderer.invoke('add-product', product),
  updateProduct: (product) => ipcRenderer.invoke('update-product', product),
  deleteProduct: (id) => ipcRenderer.invoke('delete-product', id),
  getProductByBarcode: (barcode) => ipcRenderer.invoke('get-product-by-barcode', barcode),
  getCategories: () => ipcRenderer.invoke('get-categories'),
  addCategory: (name) => ipcRenderer.invoke('add-category', name),
  updateCategory: (id, name) => ipcRenderer.invoke('update-category', { id, name }),
  deleteCategory: (id) => ipcRenderer.invoke('delete-category', id),
  getSuppliers: () => ipcRenderer.invoke('get-suppliers'),
  addSupplier: (supplier) => ipcRenderer.invoke('add-supplier', supplier),
  updateSupplier: (supplier) => ipcRenderer.invoke('update-supplier', supplier),
  deleteSupplier: (id) => ipcRenderer.invoke('delete-supplier', id),
  getPurchases: () => ipcRenderer.invoke('get-purchases'),
  getPurchaseItems: (invoiceId) => ipcRenderer.invoke('get-purchase-items', invoiceId),
  addPurchaseWithItems: (data) => ipcRenderer.invoke('add-purchase-with-items', data),
  getStaff: () => ipcRenderer.invoke('get-staff'),
  addStaff: (staff) => ipcRenderer.invoke('add-staff', staff),
  updateStaff: (staff) => ipcRenderer.invoke('update-staff', staff),
  deleteStaff: (id) => ipcRenderer.invoke('delete-staff', id),
  verifyPin: (pin) => ipcRenderer.invoke('verify-pin', pin),

  clockIn: (staffId) => ipcRenderer.invoke('clock-in', staffId),
  clockOut: (staffId) => ipcRenderer.invoke('clock-out', staffId),
  checkActiveShift: (staffId) => ipcRenderer.invoke('check-active-shift', staffId),
  getShifts: (params) => ipcRenderer.invoke('get-shifts', params),
  getPaymentMethods: () => ipcRenderer.invoke('get-payment-methods'),
  addPaymentMethod: (name) => ipcRenderer.invoke('add-payment-method', name),
  updatePaymentMethod: (pm) => ipcRenderer.invoke('update-payment-method', pm),
  deletePaymentMethod: (id) => ipcRenderer.invoke('delete-payment-method', id),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  updateSetting: (key, value) => ipcRenderer.invoke('update-setting', { key, value }),
  testPrinter: (interfaceName, width, saleData) => ipcRenderer.invoke('test-printer', { interfaceName, width, saleData }),
  printReceipt: (saleData) => ipcRenderer.invoke('print-receipt', saleData),
  saveSale: (saleData) => ipcRenderer.invoke('save-sale', saleData),
  getNextSaleId: () => ipcRenderer.invoke('get-next-sale-id'),
  getDailyReport: (params) => ipcRenderer.invoke('get-daily-report', params),
  getAttendanceReport: (params) => ipcRenderer.invoke('get-attendance-report', params),
  getSalesHistory: (params) => ipcRenderer.invoke('get-sales-history', params),
  getSalesSummary: (params) => ipcRenderer.invoke('get-sales-summary', params),
  getSalesAnalytics: (params) => ipcRenderer.invoke('get-sales-analytics', params),
  getBestSellers: (params) => ipcRenderer.invoke('get-best-sellers', params),
  getProductHistory: (params) => ipcRenderer.invoke('get-product-history', params),
  getKardex: (params) => ipcRenderer.invoke('get-kardex', params),
  recordStockAdjustment: (params) => ipcRenderer.invoke('record-stock-adjustment', params),
  recordWastage: (data) => ipcRenderer.invoke('record-wastage', data),
  getWastageAnalytics: (range) => ipcRenderer.invoke('get-wastage-analytics', range),
  voidSale: (params) => ipcRenderer.invoke('void-sale', params),

  // Shifts & Cash Closing
  getActiveShift: (staffId) => ipcRenderer.invoke('get-active-shift', staffId),
  getGlobalActiveShift: () => ipcRenderer.invoke('get-global-active-shift'),
  openShift: (data) => ipcRenderer.invoke('open-shift', data),
  getShiftSummary: (shiftId) => ipcRenderer.invoke('get-shift-summary', shiftId),
  closeShift: (data) => ipcRenderer.invoke('close-shift', data),
  forceCloseShift: (adminId) => ipcRenderer.invoke('force-close-shift', adminId),
  getShiftHistory: () => ipcRenderer.invoke('get-shift-history'),
  getBackofficeClosures: (start, end) => ipcRenderer.invoke('get-backoffice-closures', start, end),
  
  // Cash Audit
  getCashMovements: (shiftId) => ipcRenderer.invoke('get-cash-movements', shiftId),
  addCashMovement: (data) => ipcRenderer.invoke('add-cash-movement', data),
  getCashAuditSummary: (shiftId) => ipcRenderer.invoke('get-cash-audit-summary', shiftId),

  getPendingFiados: () => ipcRenderer.invoke('get-pending-fiados'),
  payFiado: (data) => ipcRenderer.invoke('pay-fiado', data),

  backupDatabase: () => ipcRenderer.invoke('backup-database'),


  // Pantalla cliente
  updateCartDisplay: (data) => ipcRenderer.send('sync-cart-to-cfd', data),
  openCustomerWindow: () => ipcRenderer.send('open-customer-window'),
  onCartUpdate: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('update-cfd-cart', handler);
    return () => ipcRenderer.removeListener('update-cfd-cart', handler);
  },

  // CFD Media & Editor
  getCfdMedia: () => ipcRenderer.invoke('get-cfd-media'),
  addCfdMedia: (data) => ipcRenderer.invoke('add-cfd-media', data),
  deleteCfdMedia: (id) => ipcRenderer.invoke('delete-cfd-media', id),
  updateCfdMediaOrder: (items) => ipcRenderer.invoke('update-cfd-media-order', items),
  selectMediaFile: () => ipcRenderer.invoke('select-media-file'),
  uploadMediaFile: (sourcePath) => ipcRenderer.invoke('upload-media-file', sourcePath),
  selectAndUploadMedia: () => ipcRenderer.invoke('select-and-upload-media'),
  getCfdImages: () => ipcRenderer.invoke('get-cfd-images'),
  openMediaFolder: () => ipcRenderer.invoke('open-media-folder'),
  getSyncStatus: () => ipcRenderer.invoke('get-sync-status'),
  onSaleSaved: (callback) => {
    const handler = (event, id) => callback(id);
    ipcRenderer.on('sale-saved', handler);
    return () => ipcRenderer.removeListener('sale-saved', handler);
  },
  onCatalogUpdated: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('catalog-updated', handler);
    return () => ipcRenderer.removeListener('catalog-updated', handler);
  },
  clearSyncQueue: () => ipcRenderer.invoke('clear-sync-queue'),
  forceSyncService: () => ipcRenderer.invoke('force-sync-service'),
  clearSalesHistory: () => ipcRenderer.invoke('clear-sales-history'),
  clearCatalog: () => ipcRenderer.invoke('clear-catalog'),
  factoryReset: () => ipcRenderer.invoke('factory-reset')
});
