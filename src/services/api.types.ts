import type { Product, Supplier, Staff, Shift, PaymentMethod, PurchaseInvoice, PurchaseItem, SaleRecord } from '../types';

export interface AppAPI {
  // Productos e Inventario
  getProducts: () => Promise<Product[]>;
  addProduct: (product: Product) => Promise<number>;
  updateProduct: (product: Product) => Promise<boolean>;
  deleteProduct: (id: number) => Promise<boolean>;
  getProductByBarcode: (barcode: string) => Promise<Product | null>;
  
  // Categorías
  getCategories: () => Promise<any[]>;
  addCategory: (name: string) => Promise<number>;
  updateCategory: (id: number, name: string) => Promise<boolean>;
  deleteCategory: (id: number) => Promise<boolean>;

  // Proveedores
  getSuppliers: () => Promise<Supplier[]>;
  addSupplier: (s: Supplier) => Promise<number>;
  updateSupplier: (s: Supplier) => Promise<boolean>;
  deleteSupplier: (id: number) => Promise<boolean>;

  // Compras
  getPurchases: () => Promise<PurchaseInvoice[]>;
  getPurchaseItems: (invoiceId: number) => Promise<PurchaseItem[]>;
  addPurchaseWithItems: (data: { 
    supplierId: number; 
    date: string; 
    items: (PurchaseItem & { net_unit_cost: number })[]; 
    netTotal: number; 
    taxTotal: number; 
    total: number 
  }) => Promise<number>;

  // Personal y Turnos
  getStaff: () => Promise<Staff[]>;
  addStaff: (staff: Staff) => Promise<number>;
  updateStaff: (staff: Staff) => Promise<boolean>;
  deleteStaff: (id: number) => Promise<boolean>;
  verifyPin: (pin: string) => Promise<Staff | null>;
  clockIn: (staffId: number) => Promise<number>;
  clockOut: (staffId: number) => Promise<boolean>;
  checkActiveShift: (staffId: number) => Promise<{ hasOpenShift: boolean, shift?: any, error?: string }>;
  getShifts: (params?: { startDate?: string; endDate?: string; staffId?: number | 'ALL' }) => Promise<Shift[]>;

  // Arqueo y Cierre de Caja (Shifts)
  getActiveShift: (staffId: number) => Promise<any>;
  getGlobalActiveShift: () => Promise<any>;
  openShift: (data: { staff_id: number; staff_name?: string; opening_balance: number }) => Promise<number | { error: string, activeCashierName: string }>;
  getShiftSummary: (shiftId: number) => Promise<{ cash: number; card: number; transfer: number }>;
  closeShift: (data: { shift_id: number; staff_name?: string; physical_cash: number; physical_card: number }) => Promise<boolean>;
  forceCloseShift: (adminId: number) => Promise<{ success: boolean; error?: string }>;
  getShiftHistory: () => Promise<any[]>;
  getBackofficeClosures: (startDate: string, endDate: string) => Promise<any[]>;
  
  // Auditoría de Caja
  getCashMovements: (shiftId: number) => Promise<any[]>;
  addCashMovement: (data: { shiftId: number, type: 'IN' | 'OUT', source: string, amount: number, description?: string, staff_id: number }) => Promise<any>;
  getCashAuditSummary: (shiftId: number) => Promise<{ opening_balance: number, inflows: number, outflows: number, expected_cash: number }>;

  // Pagos y Ventas
  getPaymentMethods: () => Promise<PaymentMethod[]>;
  addPaymentMethod: (name: string) => Promise<number>;
  updatePaymentMethod: (pm: PaymentMethod) => Promise<boolean>;
  deletePaymentMethod: (id: number) => Promise<boolean>;
  getPendingFiados: () => Promise<any[]>;
  payFiado: (data: { fiado_id: number, amount: number, payment_method: string, current_shift_id: number }) => Promise<number>;
  saveSale: (saleData: any) => Promise<number>;
  getNextSaleId: () => Promise<number>;

  // Ajustes y Hardware
  getSettings: () => Promise<Record<string, string>>;
  getPrinters: () => Promise<any[]>;
  updateSetting: (key: string, value: string) => Promise<boolean>;
  testPrinter: (interfaceName: string, width: string, saleData?: any) => Promise<boolean>;
  printReceipt: (saleData: any) => Promise<boolean>;

  // Reportes y Analítica
  getDailyReport: (params?: { shiftId?: number }) => Promise<any>;
  onDailyReportUpdate: (callback: (data: any) => void, params?: { shiftId?: number }) => () => void;
  getAttendanceReport: (params: { startDate: string; endDate: string }) => Promise<any[]>;
  getSalesHistory: (params?: { startDate?: string; endDate?: string }) => Promise<SaleRecord[]>;
  getSalesSummary: (params?: { startDate?: string; endDate?: string }) => Promise<{ count: number, totalRevenue: number }>;
  getSalesAnalytics: (params: { period: 'day'|'week'|'month'|'year'; startDate: string; endDate: string }) => Promise<any>;
  getBestSellers: (params: { startDate: string; endDate: string }) => Promise<any[]>;
  getProductHistory: (params: { productId: number; startDate: string; endDate: string }) => Promise<any>;
  getKardex: (params: { productId?: number; startDate: string; endDate: string }) => Promise<any[]>;
  
  // Mermas
  recordStockAdjustment: (params: any) => Promise<{ success: boolean }>;
  getWastageAnalytics: (params: { startDate: string; endDate: string }) => Promise<any>;
  recordWastage: (params: any) => Promise<{ success: boolean }>;

  // Utilidades
  backupDatabase: () => Promise<string | null>;
  clearSalesHistory: (options?: { restoreStock: boolean }) => Promise<boolean>;
  clearCatalog: () => Promise<boolean>;
  factoryReset: () => Promise<boolean>;

  // Dual Screen
  updateCartDisplay: (data: any) => void;
  openCustomerWindow: () => void;
  onCartUpdate: (callback: (data: any) => void) => () => void;

  // CFD Media
  getCfdMedia: () => Promise<any[]>;
  getCfdImages: () => Promise<any[]>;
  openMediaFolder: () => Promise<boolean>;
  addCfdMedia: (data: any) => Promise<number | string>;
  deleteCfdMedia: (id: number | string) => Promise<boolean>;
  updateCfdMediaOrder: (items: any[]) => Promise<boolean>;
  selectMediaFile: () => Promise<string | null>;
  uploadMediaFile: (sourcePath: string | File) => Promise<string>;
  selectAndUploadMedia: () => Promise<string | null>;
  getSyncStatus: () => Promise<number>;
  onSaleSaved: (callback: (id: number) => void) => () => void;
  onCatalogUpdated: (callback: () => void) => () => void;
  clearSyncQueue: () => Promise<boolean>;
  forceSyncService: () => Promise<boolean>;
}
