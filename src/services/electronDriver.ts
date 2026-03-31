import type { AppAPI } from './api.types';

// Esta implementación simplemente delega todas las llamadas a window.electronAPI
// Permite que la aplicación mantenga compatibilidad 100% con la base de SQLite local
// cuando se ejecuta dentro del contenedor de Electron.

export const electronDriver: AppAPI = {
  getProducts: () => window.electronAPI.getProducts(),
  addProduct: (product) => window.electronAPI.addProduct(product),
  updateProduct: (product) => window.electronAPI.updateProduct(product),
  deleteProduct: (id) => window.electronAPI.deleteProduct(id as number),
  getProductByBarcode: (barcode) => window.electronAPI.getProductByBarcode(barcode),
  
  getCategories: () => window.electronAPI.getCategories(),
  addCategory: (name) => window.electronAPI.addCategory(name),
  updateCategory: (id, name) => window.electronAPI.updateCategory(id as number, name),
  deleteCategory: (id) => window.electronAPI.deleteCategory(id as number),

  getSuppliers: () => window.electronAPI.getSuppliers(),
  addSupplier: (s) => window.electronAPI.addSupplier(s),
  updateSupplier: (s) => window.electronAPI.updateSupplier(s),
  deleteSupplier: (id) => window.electronAPI.deleteSupplier(id as number),

  getPurchases: () => window.electronAPI.getPurchases(),
  getPurchaseItems: (id) => window.electronAPI.getPurchaseItems(id),
  addPurchaseWithItems: (data) => window.electronAPI.addPurchaseWithItems(data),

  getStaff: () => window.electronAPI.getStaff(),
  addStaff: (s) => window.electronAPI.addStaff(s),
  updateStaff: (s) => window.electronAPI.updateStaff(s),
  deleteStaff: (id) => window.electronAPI.deleteStaff(id as number),
  verifyPin: (pin) => window.electronAPI.verifyPin(pin),
  clockIn: (id) => window.electronAPI.clockIn(id),
  clockOut: (id) => window.electronAPI.clockOut(id),
  checkActiveShift: (id) => window.electronAPI.checkActiveShift(id),
  getShifts: (params) => window.electronAPI.getShifts(params),
  getActiveShift: (id) => window.electronAPI.getActiveShift(id),
  getGlobalActiveShift: () => window.electronAPI.getGlobalActiveShift(),
  openShift: (data) => window.electronAPI.openShift(data),
  getShiftSummary: (id) => window.electronAPI.getShiftSummary(id),
  closeShift: (data) => window.electronAPI.closeShift(data),
  forceCloseShift: (id) => window.electronAPI.forceCloseShift(id),
  getShiftHistory: () => window.electronAPI.getShiftHistory(),
  getBackofficeClosures: (start, end) => window.electronAPI.getBackofficeClosures(start, end),
  getCashMovements: (id) => window.electronAPI.getCashMovements(id),
  addCashMovement: (d) => window.electronAPI.addCashMovement(d),
  getCashAuditSummary: (id) => window.electronAPI.getCashAuditSummary(id),
  getPendingFiados: () => window.electronAPI.getPendingFiados(),
  payFiado: (data) => window.electronAPI.payFiado(data),

  getPaymentMethods: () => window.electronAPI.getPaymentMethods(),
  addPaymentMethod: (n) => window.electronAPI.addPaymentMethod(n),
  updatePaymentMethod: (pm) => window.electronAPI.updatePaymentMethod(pm),
  deletePaymentMethod: (id) => window.electronAPI.deletePaymentMethod(id as number),
  saveSale: (data) => window.electronAPI.saveSale(data),
  getNextSaleId: () => window.electronAPI.getNextSaleId(),

  getSettings: () => window.electronAPI.getSettings(),
  getPrinters: () => window.electronAPI.getPrinters(),
  updateSetting: (k, v) => window.electronAPI.updateSetting(k, v),
  testPrinter: (interfaceName: string, width: string, saleData?: any) => {
    if (!window.electronAPI) return Promise.resolve(true);
    return window.electronAPI.testPrinter(interfaceName, width, saleData);
  },
  printReceipt: (d) => window.electronAPI.printReceipt(d),

  getDailyReport: (params) => window.electronAPI.getDailyReport(params),
  onDailyReportUpdate: (callback, params) => {
    // En Electron, usamos el evento onSaleSaved para gatillar un refresh manual del reporte
    return window.electronAPI.onSaleSaved(async () => {
      const data = await window.electronAPI.getDailyReport(params);
      callback(data);
    });
  },
  getAttendanceReport: (p) => window.electronAPI.getAttendanceReport(p),
  getSalesHistory: (p) => window.electronAPI.getSalesHistory(p || { startDate: '', endDate: '' }),
  getSalesSummary: (p) => window.electronAPI.getSalesSummary(p || { startDate: '', endDate: '' }),
  getSalesAnalytics: (p) => window.electronAPI.getSalesAnalytics(p),
  getBestSellers: (p) => window.electronAPI.getBestSellers(p),
  getProductHistory: (p) => window.electronAPI.getProductHistory(p),
  getKardex: (p) => window.electronAPI.getKardex(p),
  
  recordStockAdjustment: (p) => window.electronAPI.recordStockAdjustment(p),
  getWastageAnalytics: (p) => window.electronAPI.getWastageAnalytics(p),
  recordWastage: (p) => window.electronAPI.recordWastage(p),

  backupDatabase: () => window.electronAPI.backupDatabase(),
  clearSalesHistory: (options) => window.electronAPI.clearSalesHistory(options),
  clearCatalog: () => window.electronAPI.clearCatalog(),
  factoryReset: () => window.electronAPI.factoryReset(),

  updateCartDisplay: (d) => window.electronAPI.updateCartDisplay(d),
  openCustomerWindow: () => window.electronAPI.openCustomerWindow(),
  onCartUpdate: (c) => window.electronAPI.onCartUpdate(c),

  getCfdMedia: () => window.electronAPI.getCfdMedia(),
  getCfdImages: () => window.electronAPI.getCfdImages(),
  openMediaFolder: () => window.electronAPI.openMediaFolder(),
  addCfdMedia: (d) => window.electronAPI.addCfdMedia(d),
  deleteCfdMedia: (id) => window.electronAPI.deleteCfdMedia(id),
  updateCfdMediaOrder: (items) => window.electronAPI.updateCfdMediaOrder(items),
  selectMediaFile: () => window.electronAPI.selectMediaFile(),
  uploadMediaFile: (s) => window.electronAPI.uploadMediaFile(s as string),
  selectAndUploadMedia: () => window.electronAPI.selectAndUploadMedia(),
  getSyncStatus: () => window.electronAPI.getSyncStatus(),
  onSaleSaved: (c) => window.electronAPI.onSaleSaved(c),
  onCatalogUpdated: (c) => window.electronAPI.onCatalogUpdated(c),
  clearSyncQueue: () => window.electronAPI.clearSyncQueue(),
  forceSyncService: () => window.electronAPI.forceSyncService(),
};
