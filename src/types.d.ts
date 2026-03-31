export interface Product {
  id?: number;
  barcode: string;
  barcodes?: string[]; // Array de códigos alternativos
  name: string;
  cost_price: number;
  selling_price: number;
  margin: number;
  stock: number;
  min_stock: number;
  unit: string;
  is_variable?: boolean;
  is_variable_price?: boolean;
  // Campos dinámicos para balanza y descuentos
  unit_price?: number;
  quantity?: number;
  subtotal?: number;
  original_price?: number;
  discount_amount?: number;
  discount_type?: 'PERCENTAGE' | 'FIXED';
  final_price?: number;
  discount_authorized_by?: number; // ID del usuario que autorizó el descuento
}

export interface Supplier {
  id?: number;
  name: string;
  contact: string;
  notes: string;
}

export interface Staff {
  id?: number;
  name: string;
  role: string;
  pin: string;
  can_void_sales?: boolean;
  can_modify_prices?: boolean;
  can_manage_inventory?: boolean;
  hourly_wage?: number;
}

export interface Shift {
  id: number;
  staff_id: number;
  staff_name?: string;
  start_time: string; // Mantenido por compatibilidad
  end_time?: string;   // Mantenido por compatibilidad
  opened_at?: string;  // Nuevo (Caja)
  closed_at?: string;  // Nuevo (Caja)
  status?: string;
  hourly_wage?: number;
}

export interface PaymentMethod {
  id: number;
  name: string;
  is_active: number;
}

export interface PurchaseInvoice {
  id: number;
  supplier_id: number;
  supplier_name?: string;
  date: string;
  net_total?: number;
  tax_total?: number;
  total: number;
}

export interface PurchaseItem {
  id?: number;
  invoice_id?: number;
  product_id: number;
  product_name?: string;
  quantity: number;
  cost_price: number; // Generalmente bruto o precio de referencia
  net_unit_cost?: number; // Costo neto real
  unit?: string;
}

export interface SaleRecord {
  id: number;
  time: string;
  total: number;
  cashier_id: number;
  cashier_name?: string;
  items?: any[];
  payments?: any[];
  status?: 'COMPLETED' | 'VOIDED';
  voided_at?: string;
  voided_by?: number;
}

declare global {
  interface Window {
    electronAPI: {
      getProducts: () => Promise<Product[]>;
      addProduct: (product: Product) => Promise<number>;
      updateProduct: (product: Product) => Promise<boolean>;
      deleteProduct: (id: number) => Promise<boolean>;
      getProductByBarcode: (barcode: string) => Promise<Product | null>;
      
      getCategories: () => Promise<any[]>;
      addCategory: (name: string) => Promise<number>;
      updateCategory: (id: number, name: string) => Promise<boolean>;
      deleteCategory: (id: number) => Promise<boolean>;
      
      getSuppliers: () => Promise<Supplier[]>;
      addSupplier: (s: Supplier) => Promise<number>;
      updateSupplier: (s: Supplier) => Promise<boolean>;
      deleteSupplier: (id: number) => Promise<boolean>;
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
      
      getStaff: () => Promise<Staff[]>;
      addStaff: (staff: Staff) => Promise<number>;
      updateStaff: (staff: Staff) => Promise<boolean>;
      deleteStaff: (id: number) => Promise<boolean>;
      verifyPin: (pin: string) => Promise<Staff | null>;

      clockIn: (staffId: number) => Promise<number>;
      clockOut: (staffId: number) => Promise<boolean>;
      checkActiveShift: (staffId: number) => Promise<{ hasOpenShift: boolean, shift?: Shift | null, error?: string }>;
      getShifts: (params?: { startDate?: string; endDate?: string; staffId?: number | 'ALL' }) => Promise<Shift[]>;
      
      // Shifts & Closing
      getActiveShift: (staffId: number) => Promise<any>;
      openShift: (data: { staff_id: number; staff_name?: string; opening_balance: number }) => Promise<number | { error: string, activeCashierName: string }>;
      getGlobalActiveShift: () => Promise<any>;
      getShiftSummary: (shiftId: number) => Promise<{ cash: number; card: number; transfer: number }>;
      closeShift: (data: { shift_id: number; staff_name?: string; physical_cash: number; physical_card: number }) => Promise<boolean>;
      forceCloseShift: (adminId: number) => Promise<{ success: boolean; error?: string }>;
      getShiftHistory: () => Promise<any[]>;
      getBackofficeClosures: (startDate: string, endDate: string) => Promise<any[]>;
      
      // Auditoría de Caja
      getCashMovements: (shiftId: number) => Promise<any[]>;
      addCashMovement: (data: { shiftId: number, type: 'IN' | 'OUT', source: string, amount: number, description?: string, staff_id: number }) => Promise<any>;
      getCashAuditSummary: (shiftId: number) => Promise<{ opening_balance: number, inflows: number, outflows: number, expected_cash: number }>;

      getPaymentMethods: () => Promise<PaymentMethod[]>;
      addPaymentMethod: (name: string) => Promise<number>;
      updatePaymentMethod: (pm: PaymentMethod) => Promise<boolean>;
      deletePaymentMethod: (id: number) => Promise<boolean>;
      getPendingFiados: () => Promise<any[]>;
      payFiado: (data: { fiado_id: number, amount: number, payment_method: string, current_shift_id: number }) => Promise<number>;
      
      getSettings: () => Promise<Record<string, string>>;
      getPrinters: () => Promise<any[]>;
      updateSetting: (key: string, value: string) => Promise<boolean>;
      testPrinter: (interfaceName: string, width: string, saleData?: any) => Promise<boolean>;
      printReceipt: (saleData: any) => Promise<boolean>;

      saveSale: (saleData: any) => Promise<number>;
      getNextSaleId: () => Promise<number>;
      getDailyReport: (params?: { shiftId?: number }) => Promise<{
        totalSales: number;
        transactionsCount: number;
        grossProfit: number;
        lowStockCount: number;
        salesByHour: number[];
      }>;
      getAttendanceReport: (params: { startDate: string; endDate: string }) => Promise<any[]>;
      getSalesHistory: (params: { startDate: string; endDate: string }) => Promise<SaleRecord[]>;
      getSalesSummary: (params: { startDate: string; endDate: string }) => Promise<{ count: number, totalRevenue: number }>;
      backupDatabase: () => Promise<string | null>;
      getSalesAnalytics: (params: { period: 'day'|'week'|'month'|'year'; startDate: string; endDate: string }) => Promise<{ chart: any[]; kpi: any }>;
      getBestSellers: (params: { startDate: string; endDate: string }) => Promise<any[]>;
      getProductHistory: (params: { productId: number; startDate: string; endDate: string }) => Promise<{ rows: any[]; summary: any }>;
      getKardex: (params: { productId?: number; startDate: string; endDate: string }) => Promise<any[]>;
      recordStockAdjustment: (params: { productId: number; quantity: number; reason: string; staffId: number; notes: string }) => Promise<{ success: boolean }>;
      
      getWastageAnalytics: (params: { startDate: string; endDate: string }) => Promise<{ summary: any[]; history: any[] }>;
      recordWastage: (params: { productId: number; quantity: number; reason: string; staffId: number; notes: string }) => Promise<{ success: boolean }>;
      
      voidSale: (params: { saleId: number; restock: boolean; refund: boolean; voidedBy: number }) => Promise<boolean>;

      clearSalesHistory: (options?: { restoreStock: boolean }) => Promise<boolean>;
      clearCatalog: () => Promise<boolean>;
      factoryReset: () => Promise<boolean>;

      updateCartDisplay: (data: { 
        cart: any[], 
        total: number,
        paymentStatus?: { isFinished: boolean, totalPaid: number, changeDue: number }
      }) => void;
      openCustomerWindow: () => void;
      onCartUpdate: (callback: (data: { 
        cart: any[], 
        total: number,
        paymentStatus?: { isFinished: boolean, totalPaid: number, changeDue: number }
      }) => void) => () => void;

      // CFD Media & Editor
      getCfdMedia: () => Promise<any[]>;
      addCfdMedia: (data: { url: string, type: string, display_order: number }) => Promise<number | string>;
      deleteCfdMedia: (id: number | string) => Promise<boolean>;
      updateCfdMediaOrder: (items: any[]) => Promise<boolean>;
      selectMediaFile: () => Promise<string | null>;
      uploadMediaFile: (sourcePath: string) => Promise<string>;
      selectAndUploadMedia: () => Promise<string | null>;
      getCfdImages: () => Promise<any[]>;
      openMediaFolder: () => Promise<boolean>;
      getSyncStatus: () => Promise<number>;
      onSaleSaved: (callback: (id: number) => void) => () => void;
      onCatalogUpdated: (callback: () => void) => () => void;
      clearSyncQueue: () => Promise<boolean>;
      forceSyncService: () => Promise<boolean>;
    }
  }
}
