import { useState, useEffect, useMemo, Fragment } from 'react';
import { BarChart3, TrendingUp, DollarSign, Package, RefreshCw, ChevronDown, ChevronUp, Receipt, RotateCcw, AlertCircle, ShieldCheck, History as HistoryIcon, PlusCircle } from 'lucide-react';
import { formatCurrency } from './utils';
import type { SaleRecord } from './types';
import { getApiDriver } from './services/api';
// Eliminamos el const api global para evitar binding temprano

type ReportTab = 'sales' | 'history' | 'inventory' | 'audit';

interface ReportsProps {
  currentUser?: any;
}

export default function Reports({ currentUser }: ReportsProps) {
  const api = getApiDriver();
  const [activeTab, setActiveTab] = useState<ReportTab>('sales');

  // Daily report state
  const [metrics, setMetrics] = useState({
    totalSales: 0, transactionsCount: 0, grossProfit: 0, lowStockCount: 0, salesByHour: new Array(24).fill(0)
  });
  const [isLoading, setIsLoading] = useState(false);

  // History state
  const [historyPeriod, setHistoryPeriod] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('today');
  
  const getLocalDateString = (date: Date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [dateRange, setDateRange] = useState({
    startDate: getLocalDateString(),
    endDate: getLocalDateString()
  });

  const [historySummary, setHistorySummary] = useState({ totalRevenue: 0, count: 0 });
  const [salesHistory, setSalesHistory] = useState<SaleRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [expandedSale, setExpandedSale] = useState<number | null>(null);

  const filteredSalesHistory = useMemo(() => {
    return Array.isArray(salesHistory) ? salesHistory : [];
  }, [salesHistory]);

   // Audit state
   const [auditSummary, setAuditSummary] = useState({ opening_balance: 0, inflows: 0, outflows: 0, expected_cash: 0 });
   const [auditMovements, setAuditMovements] = useState<any[]>([]);
   const [shiftsHistory, setShiftsHistory] = useState<any[]>([]);
   const [selectedShiftId, setSelectedShiftId] = useState<number | null>(null);
   const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [movementModal, setMovementModal] = useState<{
    isOpen: boolean;
    type: 'IN' | 'OUT';
    amount: string;
    description: string;
  }>({
    isOpen: false,
    type: 'IN',
    amount: '',
    description: ''
  });
  
  // Inventory Valuation state
  const [valProducts, setValProducts] = useState<any[]>([]);
  const [valSearch, setValSearch] = useState('');
  const [isLoadingVal, setIsLoadingVal] = useState(false);

  // Void Sale State
  const [voidModal, setVoidModal] = useState<{
    isOpen: boolean;
    saleId: number | null;
    restock: boolean;
    refund: boolean;
  }>({
    isOpen: false,
    saleId: null,
    restock: true,
    refund: true
  });
  const [pinModal, setPinModal] = useState<{ isOpen: boolean; pin: string; error: string; onAuthorized: () => void } | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);

  const fetchDailyReport = async () => {
    setIsLoading(true);
    try {
      if (api?.getDailyReport) {
        const shiftId = currentUser?.activeShift?.id;
        const data = await api.getDailyReport({ shiftId });
        setMetrics(data);
      }
    } finally { setIsLoading(false); }
  };

  const fetchHistory = async (start: string, end: string) => {
    setIsLoadingHistory(true);
    try {
      if (api?.getSalesHistory) {
        console.log(`[Reports] Fetching history from ${start} to ${end}`);
        const [history, summary] = await Promise.all([
          api.getSalesHistory({ startDate: start, endDate: end }),
          api.getSalesSummary({ startDate: start, endDate: end })
        ]);
        setSalesHistory(history || []);
        setHistorySummary(summary || { totalRevenue: 0, count: 0 });
      }
    } catch (error: any) {
      console.error('Error fetching history:', error);
      setSalesHistory([]);
    } finally { 
      setIsLoadingHistory(false); 
    }
  };

  const fetchInventoryValuation = async () => {
    setIsLoadingVal(true);
    try {
      if (api?.getProducts) {
        const data = await api.getProducts();
        setValProducts(data || []);
      }
    } finally { setIsLoadingVal(false); }
  };

  const fetchShiftsForAudit = async () => {
    try {
      if (api?.getShiftHistory) {
        const data = await api.getShiftHistory();
        setShiftsHistory(data || []);
      }
    } catch (error) {
      console.error('Error fetching shift history:', error);
    }
  };

  const fetchAuditData = async (specificShiftId?: number) => {
    const shiftId = specificShiftId || selectedShiftId || currentUser?.activeShift?.id;
    if (!shiftId) return;
    
    setIsLoadingAudit(true);
    try {
      if (window.electronAPI.getCashAuditSummary) {
        const [summary, movements] = await Promise.all([
          window.electronAPI.getCashAuditSummary(Number(shiftId)),
          window.electronAPI.getCashMovements(Number(shiftId))
        ]);
        setAuditSummary(summary || { opening_balance: 0, inflows: 0, outflows: 0, expected_cash: 0 });
        setAuditMovements(movements || []);
      }
    } catch (error) {
      console.error('Error fetching audit data:', error);
    } finally {
      setIsLoadingAudit(false);
    }
  };

  const handleManualMovement = async () => {
    const shiftId = currentUser?.activeShift?.id;
    if (!shiftId || !movementModal.amount) return;

    try {
      await window.electronAPI.addCashMovement({
        shiftId,
        type: movementModal.type,
        source: movementModal.type === 'IN' ? 'MANUAL_ENTRY' : 'MANUAL_EXIT',
        amount: parseFloat(movementModal.amount),
        description: movementModal.description,
        staff_id: currentUser.id
      });
      setMovementModal({ ...movementModal, isOpen: false, amount: '', description: '' });
      fetchAuditData();
    } catch (error) {
      console.error('Error adding manual movement:', error);
    }
  };

  const handleVoidSale = async (saleId: number, restock: boolean, refund: boolean, voidedBy: number) => {
    setIsVoiding(true);
    try {
      if (window.electronAPI.voidSale) {
        const success = await window.electronAPI.voidSale({ saleId, restock, refund, voidedBy });
        if (success) {
          fetchHistory(dateRange.startDate, dateRange.endDate);
          setVoidModal({ ...voidModal, isOpen: false });
        }
      }
    } catch (error) {
      console.error('Error voiding sale:', error);
    } finally {
      setIsVoiding(false);
    }
  };

  const checkAdminPin = async (pin: string, onAuthorized: () => void) => {
    try {
      const staff = await window.electronAPI.verifyPin(pin);
      if (staff && staff.role === 'admin') {
        setPinModal(null);
        onAuthorized();
      } else {
        setPinModal(prev => prev ? { ...prev, error: 'PIN de administrador inválido' } : null);
      }
    } catch (e) {
      setPinModal(prev => prev ? { ...prev, error: 'Error al verificar PIN' } : null);
    }
  };

  // 1. Cargas iniciales al cambiar de pestaña o fecha
  useEffect(() => {
    if (activeTab === 'sales') {
      fetchDailyReport();
    } else if (activeTab === 'history') {
      fetchHistory(dateRange.startDate, dateRange.endDate);
    } else if (activeTab === 'inventory') {
      fetchInventoryValuation();
    } else if (activeTab === 'audit') {
      fetchShiftsForAudit();
      const currentShiftId = currentUser?.activeShift?.id;
      if (!selectedShiftId && currentShiftId) {
        setSelectedShiftId(currentShiftId);
        fetchAuditData(currentShiftId);
      } else if (selectedShiftId) {
        fetchAuditData(selectedShiftId);
      }
    }
  }, [activeTab, dateRange, currentUser?.activeShift?.id, selectedShiftId]);

  // 2. Suscripciones en tiempo real (solo si el driver lo soporta)
  useEffect(() => {
    let unsubscribeDaily: (() => void) | null = null;
    let unsubscribeSales: (() => void) | null = null;

    if (api.onDailyReportUpdate) {
      unsubscribeDaily = api.onDailyReportUpdate((data) => {
        setMetrics(data);
      }, { shiftId: currentUser?.activeShift?.id });
    }

    if (api.onSaleSaved) {
      unsubscribeSales = api.onSaleSaved(() => {
        // Refrescar según donde estemos
        if (activeTab === 'sales') fetchDailyReport();
        if (activeTab === 'history' && dateRange.endDate === getLocalDateString()) {
          fetchHistory(dateRange.startDate, dateRange.endDate);
        }
      });
    }

    return () => {
      if (unsubscribeDaily) unsubscribeDaily();
      if (unsubscribeSales) unsubscribeSales();
    };
  }, [activeTab, dateRange]);


  const summaryBoxes = [
    { title: 'Ventas del Día', value: formatCurrency(metrics?.totalSales || 0), icon: DollarSign, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    { title: 'Transacciones', value: String(metrics?.transactionsCount || '0'), icon: TrendingUp, color: 'text-blue-500', bg: 'bg-blue-50' },
    { title: 'Ganancia Bruta', value: formatCurrency(metrics?.grossProfit || 0), icon: BarChart3, color: 'text-purple-500', bg: 'bg-purple-50' },
    { title: 'Alertas Stock', value: String(metrics?.lowStockCount || '0'), icon: Package, color: 'text-rose-500', bg: 'bg-rose-50' },
  ];

  const tabs: { id: ReportTab; label: string }[] = [
    { id: 'sales', label: '📊 Cierre de Caja' },
    { id: 'history', label: '🧾 Historial de Ventas' },
    { id: 'inventory', label: '📦 Valorización Inventario' },
    { id: 'audit', label: '🛡️ Auditoría de Caja' },
  ];

  return (
    <div className="flex flex-col space-y-4">
      {/* Tabs */}
      <div className="flex justify-between items-center bg-white rounded-xl shadow-sm border border-gray-100 p-2 gap-2">
        <div className="flex gap-2">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                activeTab === tab.id ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:bg-slate-100'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
        <button 
          onClick={() => activeTab === 'history' ? fetchHistory(dateRange.startDate, dateRange.endDate) : fetchDailyReport()} 
          disabled={isLoading || isLoadingHistory}
          className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 px-4 py-2 rounded-lg font-medium transition-colors text-sm"
        >
          <RefreshCw size={16} className={(isLoading || isLoadingHistory) ? 'animate-spin' : ''} />
          {(isLoading || isLoadingHistory) ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {/* ---- TAB: CIERRE DE CAJA ---- */}
      {activeTab === 'sales' && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {summaryBoxes.map((box, idx) => (
              <div key={idx} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
                <div className={`p-4 rounded-xl ${box.bg} ${box.color}`}><box.icon size={28} /></div>
                <div>
                  <p className="text-sm text-gray-500 font-medium">{box.title}</p>
                  <p className="text-2xl font-bold text-gray-800">{box.value}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col min-h-[320px]">
            <div className="flex-1 flex items-end justify-between px-8 pt-10 pb-4 space-x-2">
              {(metrics?.salesByHour || []).slice(8, 21).map((h, i) => {
                const max = Math.max(...(metrics?.salesByHour || []).slice(8, 21), 1);
                const pct = (h / max) * 100;
                return (
                  <div key={i} className="flex flex-col items-center w-full">
                    <div className="w-full bg-blue-100 rounded-t-sm hover:bg-blue-300 transition-colors relative group cursor-pointer" style={{ height: `${Math.max(pct, 2)}%` }}>
                      <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap">{formatCurrency(h)}</div>
                    </div>
                    <span className="text-xs text-gray-400 mt-2 font-medium">{i + 8}h</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ---- TAB: HISTORIAL DE VENTAS ---- */}
      {activeTab === 'history' && (
        <div className="flex flex-col gap-6">
          {/* Selector de Período */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
             <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                   <Receipt size={24} className="text-blue-600" />
                   <h3 className="text-lg font-black text-slate-800 uppercase tracking-tighter">Historial Financiero</h3>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-xl">
                   {[
                     { id: 'today', label: 'Hoy' },
                     { id: 'week', label: 'Semana' },
                     { id: 'month', label: 'Mes' },
                     { id: 'year', label: 'Año' },
                     { id: 'custom', label: 'Personalizado' }
                   ].map(p => (
                     <button 
                        key={p.id}
                        onClick={() => {
                          setHistoryPeriod(p.id as any);
                          const now = new Date();
                          let start = new Date();
                          
                          if (p.id === 'today') { /* ya es hoy */ }
                          else if (p.id === 'week') {
                            start.setDate(now.getDate() - 7);
                          } else if (p.id === 'month') {
                            start.setMonth(now.getMonth() - 1);
                          } else if (p.id === 'year') {
                            start.setFullYear(now.getFullYear() - 1);
                          }
                          
                          if (p.id !== 'custom') {
                            setDateRange({ startDate: getLocalDateString(start), endDate: getLocalDateString(now) });
                          }
                        }}
                        className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${historyPeriod === p.id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                     >
                       {p.label}
                     </button>
                   ))}
                </div>
             </div>

             {historyPeriod === 'custom' && (
                <div className="flex items-center gap-4 animate-in fade-in slide-in-from-top-2">
                   <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-2 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 uppercase ml-2">Desde:</span>
                      <input type="date" value={dateRange.startDate} onChange={e => setDateRange({...dateRange, startDate: e.target.value})} className="bg-transparent border-none text-sm font-bold focus:ring-0" />
                   </div>
                   <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-2 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 uppercase ml-2">Hasta:</span>
                      <input type="date" value={dateRange.endDate} onChange={e => setDateRange({...dateRange, endDate: e.target.value})} className="bg-transparent border-none text-sm font-bold focus:ring-0" />
                   </div>
                   <button 
                     onClick={() => fetchHistory(dateRange.startDate, dateRange.endDate)}
                     className="px-6 py-3 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
                   >
                     Aplicar Filtro
                   </button>
                </div>
             )}
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-3 gap-6">
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                <div className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl">
                   <DollarSign size={32} />
                </div>
                <div>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Total Ventas</p>
                   <p className="text-3xl font-black text-slate-800">{formatCurrency(historySummary.totalRevenue)}</p>
                </div>
             </div>
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl">
                   <Receipt size={32} />
                </div>
                <div>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Boletas Emitidas</p>
                   <p className="text-3xl font-black text-slate-800">{historySummary.count}</p>
                </div>
             </div>
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                <div className="p-4 bg-purple-50 text-purple-600 rounded-2xl">
                   <TrendingUp size={32} />
                </div>
                <div>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Ticket Promedio</p>
                   <p className="text-3xl font-black text-slate-800">
                      {formatCurrency(historySummary.count > 0 ? historySummary.totalRevenue / historySummary.count : 0)}
                   </p>
                </div>
             </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-gray-200 text-sm font-semibold text-gray-600">
                <tr>
                  <th className="p-4">Hora</th>
                  <th className="p-4">Cajero</th>
                  <th className="p-4">Pagado con</th>
                  <th className="p-4 text-right">Total</th>
                  <th className="p-4 text-center">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredSalesHistory.map(sale => {
                  const isVoided = sale.status === 'VOIDED';
                  return (
                    <Fragment key={sale.id}>
                      <tr 
                        onClick={() => setExpandedSale(expandedSale === sale.id ? null : sale.id)}
                        className={`hover:bg-slate-50 transition-colors cursor-pointer ${isVoided ? 'bg-slate-50 opacity-60' : ''}`}
                      >
                         <td className="p-4 font-mono text-sm text-gray-600">
                            <div className="flex flex-col">
                               <span>
                                 {(() => {
                                   const timePart = sale.time?.includes('T') ? sale.time.split('T')[1] : sale.time?.split(' ')[1];
                                   return timePart?.slice(0, 5) ?? '—';
                                 })()}
                               </span>
                               {isVoided && <span className="text-[9px] font-black text-rose-500 uppercase tracking-tighter">ANULADA</span>}
                            </div>
                         </td>
                        <td className={`p-4 font-semibold text-gray-800 ${isVoided ? 'line-through decoration-rose-500/50' : ''}`}>{sale.cashier_name}</td>
                        <td className="p-4 text-sm text-gray-500">
                          {sale.payments?.map((p: any) => `${p.method_name} ${formatCurrency(p.amount)}`).join(' + ') || '—'}
                        </td>
                        <td className={`p-4 text-right font-bold text-gray-800 ${isVoided ? 'text-slate-400' : ''}`}>{formatCurrency(sale.total)}</td>
                        <td className="p-4 text-center">
                          <div className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1 mx-auto justify-center">
                            {expandedSale === sale.id ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                            {expandedSale === sale.id ? 'Cerrar' : 'Items'}
                          </div>
                        </td>
                      </tr>
                      {expandedSale === sale.id && sale.items && (
                        <tr key={`items-${sale.id}`}>
                          <td colSpan={5} className="bg-blue-50/50 px-8 py-4 border-y border-blue-100/50">
                            <div className="flex justify-between items-start mb-4">
                              <div className="flex flex-col gap-1">
                                <h4 className="text-xs font-black text-blue-800 uppercase tracking-[0.2em]">Detalle de Artículos</h4>
                                <div className="text-[10px] font-bold text-slate-500 uppercase">
                                  Pagado con: {sale.payments?.map((p: any) => `${p.method_name} (${formatCurrency(p.amount)})`).join(' + ') || '—'}
                                </div>
                              </div>
                              {!isVoided && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setVoidModal({ isOpen: true, saleId: sale.id, restock: true, refund: true });
                                  }}
                                  className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition-all font-black uppercase text-[10px] tracking-widest border border-rose-200"
                                >
                                  <RotateCcw size={14} /> Anular Venta
                                </button>
                              )}
                            </div>
                            <table className="w-full text-sm">
                              <thead><tr className="text-slate-500 font-semibold"><th className="py-1 text-left">Producto</th><th className="py-1 text-right">Cant.</th><th className="py-1 text-right">Precio Unit.</th><th className="py-1 text-right">Subtotal</th></tr></thead>
                              <tbody>
                                {sale.items.map((item: any, i: number) => (
                                  <tr key={i} className="border-t border-blue-100">
                                    <td className="py-1.5 text-gray-700">{item.product_name}</td>
                                    <td className="py-1.5 text-right text-gray-600">{item.quantity} {item.unit}</td>
                                    <td className="py-1.5 text-right text-gray-600">{formatCurrency(item.unit_price)}</td>
                                    <td className="py-1.5 text-right font-semibold">{formatCurrency(item.subtotal)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {isVoided && (
                               <div className="mt-4 p-3 bg-white border border-rose-100 rounded-xl flex items-center gap-3">
                                  <AlertCircle size={18} className="text-rose-500" />
                                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-tight">
                                     Esta venta fue anulada el {sale.voided_at || '—'}. {sale.voided_by ? `Autorizado por ID: ${sale.voided_by}` : ''}
                                  </div>
                               </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {filteredSalesHistory.length === 0 && !isLoadingHistory && (
                  <tr><td colSpan={5} className="p-12 text-center text-gray-400">
                    <Receipt size={40} className="mx-auto mb-2 opacity-30"/>
                    No hay ventas en esta fecha.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- TAB: VALORIZACIÓN INVENTARIO ---- */}
      {activeTab === 'inventory' && (
        <div className="flex flex-col gap-4">
          {/* Valorización KPIs */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { 
                title: 'Valor Costo Total', 
                value: formatCurrency(valProducts.reduce((s, p) => s + (p.cost_price * p.stock), 0)), 
                desc: 'Inversión actual en bodega',
                icon: Package, color: 'text-blue-500', bg: 'bg-blue-50' 
              },
              { 
                title: 'Valor Venta Potencial', 
                value: formatCurrency(valProducts.reduce((s, p) => s + (p.selling_price * p.stock), 0)), 
                desc: 'Ingreso proyectado al agotar stock',
                icon: DollarSign, color: 'text-emerald-500', bg: 'bg-emerald-50' 
              },
              { 
                title: 'Utilidad Bruta Latente', 
                value: formatCurrency(valProducts.reduce((s, p) => s + ((p.selling_price - p.cost_price) * p.stock), 0)), 
                desc: 'Utilidad bruta por realizar',
                icon: TrendingUp, color: 'text-purple-500', bg: 'bg-purple-50' 
              },
            ].map((box, idx) => (
              <div key={idx} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
                <div className={`p-4 rounded-xl ${box.bg} ${box.color}`}><box.icon size={28} /></div>
                <div>
                  <p className="text-sm text-gray-500 font-medium">{box.title}</p>
                  <p className="text-2xl font-bold text-gray-800">{box.value}</p>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase mt-1">{box.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Search Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col">
             <div className="flex justify-between items-center mb-4">
                <input 
                  type="text" 
                  placeholder="Filtrar por nombre..." 
                  value={valSearch}
                  onChange={e => setValSearch(e.target.value)}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-sm w-80 focus:ring-2 focus:ring-blue-500"
                />
                <div className="text-xs font-bold text-slate-400 uppercase">
                  {valProducts.length} Productos en Inventario
                </div>
             </div>

             <div className="">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                    <tr>
                      <th className="p-3">Producto</th>
                      <th className="p-3 text-right">Stock</th>
                      <th className="p-3 text-right">Costo Unit.</th>
                      <th className="p-3 text-right">Venta Unit.</th>
                      <th className="p-3 text-right">Total Costo</th>
                      <th className="p-3 text-right">Total Venta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {valProducts.filter(p => p.name.toLowerCase().includes(valSearch.toLowerCase())).map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="p-3 font-semibold text-slate-700">{p.name}</td>
                        <td className="p-3 text-right font-bold text-slate-600">{p.stock}</td>
                        <td className="p-3 text-right text-slate-500">{formatCurrency(p.cost_price)}</td>
                        <td className="p-3 text-right text-slate-500">{formatCurrency(p.selling_price)}</td>
                        <td className="p-3 text-right font-semibold">{formatCurrency(p.cost_price * p.stock)}</td>
                        <td className="p-3 text-right font-bold text-blue-600">{formatCurrency(p.selling_price * p.stock)}</td>
                      </tr>
                    ))}
                    {valProducts.length === 0 && !isLoadingVal && (
                      <tr><td colSpan={6} className="p-12 text-center text-gray-400">No hay productos en inventario.</td></tr>
                    )}
                  </tbody>
                </table>
             </div>
          </div>
         </div>
      )}

      {/* ---- TAB: AUDITORÍA DE CAJA (CARTOLA) ---- */}
      {activeTab === 'audit' && (
        <div className="flex flex-col gap-6 animate-in fade-in duration-300">
           {/* Selector de Turno */}
           <div className="bg-white p-4 rounded-[2rem] shadow-sm border border-slate-100 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                 <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl"><HistoryIcon size={20} /></div>
                 <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Auditar Turno</p>
                    <select 
                      value={selectedShiftId || ''} 
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        setSelectedShiftId(id);
                      }}
                      className="text-sm font-bold text-slate-700 bg-transparent border-none p-0 focus:ring-0 cursor-pointer"
                    >
                       <option value="">Seleccionar turno...</option>
                       {shiftsHistory.map(s => (
                         <option key={s.id} value={s.id}>
                           Turno #{s.id} - {new Date(s.opened_at).toLocaleDateString()} {new Date(s.opened_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} ({s.staff_name || 'Cajero'}) {s.status === 'OPEN' ? '[ABIERTO]' : ''}
                         </option>
                       ))}
                    </select>
                 </div>
              </div>
              
              {selectedShiftId === currentUser?.activeShift?.id && (
                <button 
                  onClick={() => setMovementModal({ ...movementModal, isOpen: true, type: 'IN' })}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
                >
                  <PlusCircle size={16} />
                  Registrar Movimiento manual
                </button>
              )}
           </div>

           {/* Resumen de Auditoría */}
           <div className="grid grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
                 <div className="p-3 bg-slate-50 text-slate-400 w-fit rounded-xl mb-4"><Package size={24} /></div>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Apertura</p>
                 <p className="text-xl font-black text-slate-800">{formatCurrency(auditSummary.opening_balance)}</p>
              </div>
              <div className="bg-emerald-50/50 p-6 rounded-[2rem] shadow-sm border border-emerald-100/50">
                 <div className="p-3 bg-emerald-500 text-white w-fit rounded-xl mb-4 shadow-lg shadow-emerald-100"><TrendingUp size={24} /></div>
                 <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest leading-none mb-1">Ingresos (+)</p>
                 <p className="text-xl font-black text-emerald-700">{formatCurrency(auditSummary.inflows)}</p>
              </div>
              <div className="bg-rose-50/30 p-6 rounded-[2rem] shadow-sm border border-rose-100/30">
                 <div className="p-3 bg-rose-500 text-white w-fit rounded-xl mb-4 shadow-lg shadow-rose-100"><RotateCcw size={24} className="rotate-180" /></div>
                 <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest leading-none mb-1">Egresos (-)</p>
                 <p className="text-xl font-black text-rose-700">{formatCurrency(auditSummary.outflows)}</p>
              </div>
              <div className="bg-slate-900 p-6 rounded-[2rem] shadow-xl text-white">
                 <div className="p-3 bg-slate-800 text-emerald-400 w-fit rounded-xl mb-4"><ShieldCheck size={24} /></div>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Esperado en Caja</p>
                 <p className="text-xl font-black text-emerald-400">{formatCurrency(auditSummary.expected_cash)}</p>
              </div>
           </div>

           {/* Lista de Movimientos */}
           <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden flex flex-col">
              <div className="p-6 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
                 <div>
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Cartola de Caja</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Turno Actual: #{currentUser?.activeShift?.id || '—'}</p>
                 </div>
                 <div className="flex gap-2">
                    <button 
                      onClick={() => setMovementModal({ isOpen: true, type: 'IN', amount: '', description: '' })}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 active:scale-95"
                    >
                      + Ingreso Manual
                    </button>
                    <button 
                      onClick={() => setMovementModal({ isOpen: true, type: 'OUT', amount: '', description: '' })}
                      className="px-4 py-2 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 transition-all shadow-lg shadow-rose-100 active:scale-95"
                    >
                      - Retiro / Egreso
                    </button>
                 </div>
              </div>

              <div className="overflow-x-auto">
                 <table className="w-full text-left">
                    <thead className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                       <tr>
                          <th className="px-6 py-4">Fecha/Hora</th>
                          <th className="px-6 py-4">Tipo</th>
                          <th className="px-6 py-4">Origen</th>
                          <th className="px-6 py-4">Descripción</th>
                          <th className="px-6 py-4 text-right">Monto</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                       {auditMovements.map((move, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                             <td className="px-6 py-4 text-xs font-mono text-slate-500">{move.created_at}</td>
                             <td className="px-6 py-4">
                                <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${move.type === 'IN' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                   {move.type === 'IN' ? 'Ingreso' : 'Egreso'}
                                </span>
                             </td>
                             <td className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">{move.source}</td>
                             <td className="px-6 py-4 text-xs text-slate-700 font-semibold">{move.description || '—'}</td>
                             <td className={`px-6 py-4 text-right font-black ${move.type === 'IN' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {move.type === 'IN' ? '+' : '-'}{formatCurrency(move.amount)}
                             </td>
                          </tr>
                       ))}
                       {auditMovements.length === 0 && !isLoadingAudit && (
                          <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400 font-bold uppercase tracking-widest text-xs opacity-50">No hay movimientos registrados en este turno</td></tr>
                       )}
                    </tbody>
                 </table>
              </div>
           </div>
        </div>
      )}

      {/* Modal Movimiento Manual */}
      {movementModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[300]">
           <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95">
              <div className={`p-8 text-white text-center ${movementModal.type === 'IN' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                 <h3 className="text-xl font-black uppercase tracking-tight">
                    {movementModal.type === 'IN' ? 'Registrar Ingreso' : 'Registrar Salida'}
                 </h3>
                 <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mt-1">Movimiento Manual de Efectivo</p>
              </div>
              <div className="p-8 space-y-4">
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Monto de Efectivo</label>
                    <input 
                      type="number" 
                      autoFocus
                      value={movementModal.amount}
                      onChange={e => setMovementModal({ ...movementModal, amount: e.target.value })}
                      placeholder="0.00"
                      className="w-full px-4 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-xl font-black focus:border-slate-300 focus:bg-white outline-none transition-all"
                    />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Descripción / Motivo</label>
                    <textarea 
                      value={movementModal.description}
                      onChange={e => setMovementModal({ ...movementModal, description: e.target.value })}
                      placeholder="Ej: Pago de panadería, Sencillo..."
                      rows={3}
                      className="w-full px-4 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-semibold focus:border-slate-300 focus:bg-white outline-none transition-all resize-none"
                    />
                 </div>
                 
                 <div className="flex gap-2 pt-4">
                    <button onClick={() => setMovementModal({ ...movementModal, isOpen: false })} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs tracking-widest">Cerrar</button>
                    <button 
                      onClick={handleManualMovement}
                      className={`flex-1 py-4 rounded-2xl text-white font-black uppercase text-xs tracking-widest shadow-lg transition-all active:scale-95 ${movementModal.type === 'IN' ? 'bg-emerald-600 shadow-emerald-100' : 'bg-rose-600 shadow-rose-100'}`}
                    >
                      Guardar
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Modal Confirmación Anulación */}
      {voidModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[300]">
           <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95">
              <div className="bg-rose-600 p-8 text-white text-center">
                 <RotateCcw size={48} className="mx-auto mb-2 opacity-80 animate-spin-slow" />
                 <h3 className="text-xl font-black uppercase tracking-tight">Anular Venta #{voidModal.saleId}</h3>
                 <p className="text-rose-100 text-xs font-bold opacity-80 mt-1 uppercase tracking-widest">Esta acción no se puede deshacer</p>
              </div>
              <div className="p-8 space-y-6">
                 <div className="space-y-4">
                    <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl cursor-pointer hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-200">
                       <input type="checkbox" checked={voidModal.refund} onChange={e => setVoidModal({...voidModal, refund: e.target.checked})} className="w-5 h-5 rounded border-slate-300 text-rose-600 focus:ring-rose-500" />
                       <div>
                          <p className="text-sm font-black text-slate-800 uppercase tracking-tighter">Registrar Reembolso</p>
                          <p className="text-[10px] text-slate-400 font-bold leading-tight">Registra la salida de dinero de la caja</p>
                       </div>
                    </label>

                    <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl cursor-pointer hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-200">
                       <input type="checkbox" checked={voidModal.restock} onChange={e => setVoidModal({...voidModal, restock: e.target.checked})} className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                       <div>
                          <p className="text-sm font-black text-slate-800 uppercase tracking-tighter">Reintegrar Stock</p>
                          <p className="text-[10px] text-slate-400 font-bold leading-tight">Devuelve los productos al inventario</p>
                       </div>
                    </label>
                 </div>
                 
                 <div className="flex gap-3">
                    <button onClick={() => setVoidModal({ ...voidModal, isOpen: false })} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs tracking-widest">Cerrar</button>
                    <button 
                      onClick={() => {
                        setPinModal({
                          isOpen: true,
                          pin: '',
                          error: '',
                          onAuthorized: () => {
                            if (voidModal.saleId) {
                              handleVoidSale(voidModal.saleId, voidModal.restock, voidModal.refund, 1); // ID temporal 1 del admin
                            }
                          }
                        });
                      }} 
                      disabled={isVoiding}
                      className="flex-1 py-4 bg-rose-600 text-white rounded-2xl font-black shadow-lg shadow-rose-200 uppercase text-xs tracking-widest active:scale-95 transition-all"
                    >
                      {isVoiding ? 'Anulando...' : 'Confirmar'}
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* Modal PIN Administrador */}
      {pinModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[400]">
           <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-[320px] overflow-hidden animate-in zoom-in-95">
              <div className="bg-slate-800 p-8 text-white text-center">
                 <ShieldCheck size={40} className="mx-auto mb-2 text-emerald-400" />
                 <h3 className="text-xl font-black uppercase tracking-tight">Pin de Autorización</h3>
                 <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1">Requerido para Anulación</p>
              </div>
              <div className="p-8 space-y-6">
                 <div className="relative">
                    <input 
                      type="password" 
                      maxLength={4} 
                      value={pinModal.pin}
                      onChange={e => setPinModal({ ...pinModal, pin: e.target.value, error: '' })}
                      placeholder="••••"
                      className="w-full text-center text-4xl font-mono font-black py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-blue-500 focus:bg-white transition-all outline-none"
                    />
                    {pinModal.error && <p className="text-rose-500 text-[10px] font-black uppercase text-center mt-2 animate-bounce">{pinModal.error}</p>}
                 </div>
                 <div className="flex gap-2">
                    <button onClick={() => setPinModal(null)} className="flex-1 py-3 font-black text-slate-400 uppercase text-[10px] tracking-widest">Cancelar</button>
                    <button 
                      onClick={() => checkAdminPin(pinModal.pin, pinModal.onAuthorized)}
                      className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-100 active:scale-95 transition-all"
                    >
                      Verificar
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
