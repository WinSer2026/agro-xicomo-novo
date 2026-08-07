import React, { useState, useEffect } from 'react';
import { dbService } from '../utils/firebaseDB';
import { Sale, SystemSettings, Product } from '../types';
import { downloadInvoiceA4, downloadDuplicatedInvoiceA4, downloadThermalReceipt, downloadReceiptA4 } from '../utils/pdfGenerator';
import { generateNextReceiptNumber } from '../utils/sequenceHelper';

interface FaturasModuleProps {
  currentUser?: { username: string; role: string; roles?: string[] } | null;
}

export default function FaturasModule({ currentUser }: FaturasModuleProps) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [faturasSearch, setFaturasSearch] = useState('');
  const [faturasFilter, setFaturasFilter] = useState<'Todas' | 'Pendente' | 'Paga' | 'Cancelada'>('Todas');

  // Preview / Print state
  const [invoiceToPrint, setInvoiceToPrint] = useState<Sale | null>(null);
  const [printType, setPrintType] = useState<'A4' | 'Thermal' | 'DoubleA5' | 'ReciboA4' | 'Proforma' | null>(null);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [isProcessing, setIsProcessing] = useState(false);

  // Custom confirmation modal to bypass standard window.confirm which is blocked by sandboxed iframes
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [securityModal, setSecurityModal] = useState<{
    show: boolean;
    action: 'cancel' | 'restore';
    sale: Sale | null;
    password: string;
    error: string;
  }>({ show: false, action: 'cancel', sale: null, password: '', error: '' });

  const askConfirmation = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({
      show: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmModal(null);
      }
    });
  };

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => {
      setToastMessage('');
    }, 4000);
  };

  useEffect(() => {
    loadData();

    const handleDbUpdate = (e: any) => {
      const updatedTable = e.detail?.table;
      if (!updatedTable || updatedTable === 'all' || updatedTable === 'sales' || updatedTable === 'settings' || updatedTable === 'products') {
        loadData();
      }
    };
    window.addEventListener('db-update', handleDbUpdate);
    return () => window.removeEventListener('db-update', handleDbUpdate);
  }, []);

  const loadData = async () => {
    try {
      await dbService.init();
      // Load sales
      const saleList = await dbService.getSales();
      // Sort sales by date descending (newest on top)
      const sorted = [...saleList].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setSales(sorted);

      // Load settings
      const globalSettings = await dbService.getSettings();
      setSettings(globalSettings);
    } catch (err) {
      console.error('Error loading invoices data:', err);
      showToast('Erro ao carregar dados de facturação.', 'error');
    }
  };

  const handleClearAllHistory = () => {
    askConfirmation(
      'Eliminar Histórico de Teste (Vendas, Facturas e Recibos)',
      'Tem a certeza absoluta que deseja eliminar todo o histórico de vendas, facturas e recibos de teste? O sistema ficará limpo e pronto para iniciar o uso com dados reais de produção.',
      async () => {
        try {
          await dbService.clearSystemData();
          await loadData();
          showToast('Histórico de vendas, facturas e recibos eliminado com sucesso! Pronto para produção.', 'success');
        } catch (err) {
          console.error(err);
          showToast('Erro ao limpar histórico.', 'error');
        }
      }
    );
  };

  const handlePayInvoice = (sale: Sale) => {
    if (isProcessing) return;
    askConfirmation(
      'Liquidar Fatura',
      `Deseja realmente registar o pagamento da fatura ${sale.invoiceNumber} no valor de ${sale.total.toLocaleString()} MT? Esta ação irá alterar o estado do documento para "Paga" e emitir o recibo.`,
      async () => {
        if (isProcessing) return;
        setIsProcessing(true);
        try {
          const allSales = await dbService.getSales();
          const receiptNum = generateNextReceiptNumber(allSales, 'ReciboA4');
          const updatedSale: Sale = { ...sale, status: 'Paga', receiptNumber: receiptNum };
          await dbService.addSale(updatedSale);
          await loadData();
          
          // Auto print and download receipt PDF on A4
          setInvoiceToPrint(updatedSale);
          setPrintType('ReciboA4');
          downloadInvoicePDF(updatedSale, 'ReciboA4');
          
          showToast(`Factura ${sale.invoiceNumber} paga! Recibo impresso e descarregado em A4.`, 'success');
        } catch (err) {
          console.error(err);
          showToast('Erro ao liquidar factura.', 'error');
        } finally {
          setIsProcessing(false);
        }
      }
    );
  };

  const handleCancelInvoice = (sale: Sale) => {
    setSecurityModal({
      show: true,
      action: 'cancel',
      sale,
      password: '',
      error: ''
    });
  };

  const handleRestoreInvoice = (sale: Sale) => {
    setSecurityModal({
      show: true,
      action: 'restore',
      sale,
      password: '',
      error: ''
    });
  };

  const handleExecuteSecurityAction = async () => {
    if (isProcessing) return;
    const sale = securityModal.sale;
    if (!sale) return;

    const targetPw = settings?.stockPasswordHash || '05082';
    if (securityModal.password !== targetPw) {
      setSecurityModal(prev => ({ ...prev, error: 'Palavra-passe de autorização incorreta.' }));
      return;
    }

    setIsProcessing(true);
    try {
      if (securityModal.action === 'cancel') {
        // 1. Revert stock if it was FaturaDefinitiva and status wasn't already Cancelada
        if (sale.status !== 'Cancelada' && (!sale.documentType || sale.documentType === 'FaturaDefinitiva')) {
          const products = await dbService.getProducts();
          const productsToUpdate: Product[] = [];
          for (const item of sale.items) {
            const prod = products.find(p => p.id === item.productId);
            if (prod && !prod.isService) {
              const hasConversion = !!(prod.parentUnit && prod.conversionRate && prod.conversionRate > 1);
              if (hasConversion) {
                if (item.sellingUnit === 'Bulk') {
                  const qtyToAdd = item.quantity;
                  prod.stockQtyBulk = (prod.stockQtyBulk || 0) + qtyToAdd;
                  const equivalentBaseQty = qtyToAdd * (prod.conversionRate || 1);
                  prod.stockQty = prod.stockQty + equivalentBaseQty;
                } else {
                  const qtyToAdd = item.quantity;
                  prod.stockQtyRetail = (prod.stockQtyRetail || 0) + qtyToAdd;
                  prod.stockQty = prod.stockQty + qtyToAdd;
                }
              } else {
                prod.stockQty = prod.stockQty + item.quantity;
              }
              productsToUpdate.push(prod);
            }
          }
          if (productsToUpdate.length > 0) {
            await dbService.saveProducts(productsToUpdate);
          }
        }

        // 2. Update sale status to Cancelada
        const updatedSale: Sale = { ...sale, status: 'Cancelada' };
        await dbService.addSale(updatedSale);

        // 3. Log Audit
        await dbService.addAuditLog({
          id: 'log-' + Date.now(),
          timestamp: new Date().toISOString(),
          username: currentUser?.username || 'Gestor',
          ipAddress: '127.0.0.1',
          action: 'Anulação de Venda (Autorizada)',
          status: 'Sucesso',
          details: `Venda ${sale.invoiceNumber} anulada com palavra-passe de autorização.`
        });

        setSecurityModal({ show: false, action: 'cancel', sale: null, password: '', error: '' });
        await loadData();
        showToast(`Venda ${sale.invoiceNumber} anulada e stock estornado com sucesso!`, 'success');

      } else if (securityModal.action === 'restore') {
        // Revert stock back (reduce stock) if the previous status was Cancelada and it is FaturaDefinitiva
        if (sale.status === 'Cancelada' && (!sale.documentType || sale.documentType === 'FaturaDefinitiva')) {
          const products = await dbService.getProducts();
          const productsToUpdate: Product[] = [];
          for (const item of sale.items) {
            const prod = products.find(p => p.id === item.productId);
            if (prod && !prod.isService) {
              const hasConversion = !!(prod.parentUnit && prod.conversionRate && prod.conversionRate > 1);
              if (hasConversion) {
                if (item.sellingUnit === 'Bulk') {
                  const qtyToReduce = item.quantity;
                  prod.stockQtyBulk = Math.max(0, (prod.stockQtyBulk || 0) - qtyToReduce);
                  const equivalentBaseQty = qtyToReduce * (prod.conversionRate || 1);
                  prod.stockQty = Math.max(0, prod.stockQty - equivalentBaseQty);
                } else {
                  const qtyToReduce = item.quantity;
                  prod.stockQtyRetail = Math.max(0, (prod.stockQtyRetail || 0) - qtyToReduce);
                  prod.stockQty = Math.max(0, prod.stockQty - qtyToReduce);
                }
              } else {
                prod.stockQty = Math.max(0, prod.stockQty - item.quantity);
              }
              productsToUpdate.push(prod);
            }
          }
          if (productsToUpdate.length > 0) {
            await dbService.saveProducts(productsToUpdate);
          }
        }

        const updatedSale: Sale = { ...sale, status: 'Pendente' };
        await dbService.addSale(updatedSale);

        await dbService.addAuditLog({
          id: 'log-' + Date.now(),
          timestamp: new Date().toISOString(),
          username: currentUser?.username || 'Gestor',
          ipAddress: '127.0.0.1',
          action: 'Restauração de Venda (Autorizada)',
          status: 'Sucesso',
          details: `Factura ${sale.invoiceNumber} restaurada para o estado Pendente com palavra-passe de autorização.`
        });

        setSecurityModal({ show: false, action: 'restore', sale: null, password: '', error: '' });
        await loadData();
        showToast(`Factura ${sale.invoiceNumber} restaurada para o estado Pendente com sucesso!`, 'success');
      }
    } catch (err) {
      console.error(err);
      setSecurityModal(prev => ({ ...prev, error: 'Erro ao executar a ação de segurança.' }));
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadInvoicePDF = (sale: Sale, format: 'A4' | 'Thermal' | 'DoubleA5' | 'ReciboA4') => {
    const s = settings || { companyName: 'AGRO - XICOMO & SERVI\u00c7OS, LDA', companyNuit: '401976590' } as SystemSettings;
    if (format === 'Thermal') {
      downloadThermalReceipt(sale, s);
    } else if (format === 'DoubleA5') {
      downloadDuplicatedInvoiceA4(sale, s);
    } else if (format === 'ReciboA4') {
      downloadReceiptA4(sale, s);
    } else {
      downloadInvoiceA4(sale, s, false);
    }
  };

  // Filtering invoices based on user queries and selected status tab
  const filteredSales = sales.filter(s => {
    if (faturasFilter !== 'Todas' && s.status?.toLowerCase() !== faturasFilter.toLowerCase()) {
      return false;
    }
    if (faturasSearch.trim()) {
      const query = faturasSearch.toLowerCase();
      const matchInvoice = s.invoiceNumber?.toLowerCase().includes(query);
      const matchCustomer = s.customerName?.toLowerCase().includes(query);
      const matchOperator = s.operatorName?.toLowerCase().includes(query) || s.operatorId?.toLowerCase().includes(query);
      const matchPayment = s.paymentMethod?.toLowerCase().includes(query);
      const matchNuit = s.customerNuit?.toLowerCase().includes(query);
      const matchTotal = s.total?.toString().includes(query);
      const matchItem = s.items?.some(i => i.productName?.toLowerCase().includes(query));

      return Boolean(matchInvoice || matchCustomer || matchOperator || matchPayment || matchNuit || matchTotal || matchItem);
    }
    return true;
  });

  // Calculate invoice statistical metrics for a beautiful dashboard header
  const totalInvoiced = sales.filter(s => s.status !== 'Cancelada').reduce((sum, s) => sum + s.total, 0);
  const paidInvoiced = sales.filter(s => s.status === 'Paga').reduce((sum, s) => sum + s.total, 0);
  const pendingInvoiced = sales.filter(s => s.status === 'Pendente').reduce((sum, s) => sum + s.total, 0);
  const canceledInvoiced = sales.filter(s => s.status === 'Cancelada').reduce((sum, s) => sum + s.total, 0);

  return (
    <div className="space-y-6" id="faturas_module_container">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className={`fixed bottom-6 right-6 z-50 p-4 rounded-xl shadow-2xl flex items-center gap-3 border transition-all animate-bounce ${
          toastType === 'success' ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-red-600 text-white border-red-700'
        }`}>
          <span className="material-symbols-outlined">
            {toastType === 'success' ? 'check_circle' : 'warning'}
          </span>
          <span className="text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Module Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-600">receipt_long</span>
            Gestão de Facturas
          </h2>
          <p className="text-xs text-slate-500">
            Consulte, liquide, emita e imprima segundas vias de facturas e recibos de vendas do sistema.
          </p>
        </div>
      </div>

      {/* Invoice Dashboard Header Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
            <span className="material-symbols-outlined text-[22px]">payments</span>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Total Facturado</p>
            <p className="text-lg font-black text-slate-800 truncate font-mono mt-0.5">
              {totalInvoiced.toLocaleString()} MT
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
            <span className="material-symbols-outlined text-[22px]">check_circle</span>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Total Pago (Liquidado)</p>
            <p className="text-lg font-black text-emerald-700 truncate font-mono mt-0.5">
              {paidInvoiced.toLocaleString()} MT
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
            <span className="material-symbols-outlined text-[22px]">hourglass_empty</span>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Pendente (Crédito)</p>
            <p className="text-lg font-black text-amber-700 truncate font-mono mt-0.5">
              {pendingInvoiced.toLocaleString()} MT
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 shrink-0">
            <span className="material-symbols-outlined text-[22px]">cancel</span>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Cancelado</p>
            <p className="text-lg font-black text-red-700 truncate font-mono mt-0.5">
              {canceledInvoiced.toLocaleString()} MT
            </p>
          </div>
        </div>
      </div>

      {/* Main Filter and Invoice Grid Search area */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          {/* Quick filter status tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs font-bold w-full lg:w-auto custom-scrollbar">
            {(['Todas', 'Pendente', 'Paga', 'Cancelada'] as const).map(tab => {
              const count = sales.filter(s => {
                if (tab === 'Todas') return true;
                return s.status === tab;
              }).length;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFaturasFilter(tab)}
                  className={`px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                    faturasFilter === tab
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {tab === 'Todas' ? 'Todas' : tab === 'Pendente' ? 'Pendentes' : tab === 'Paga' ? 'Pagas' : 'Canceladas'} ({count})
                </button>
              );
            })}
          </div>

          {/* Search bar inputs */}
          <div className="relative w-full lg:max-w-md">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-[20px]">search</span>
            <input
              type="text"
              placeholder="Pesquise por Número de Factura ou Nome do Cliente..."
              value={faturasSearch}
              onChange={(e) => setFaturasSearch(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white text-slate-800"
            />
          </div>
        </div>

        {/* Detailed Scrollable Invoices Table/Grid */}
        <div className="overflow-x-auto border border-slate-150 rounded-xl">
          <table className="w-full text-left border-collapse text-[10.5px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-150 text-slate-500 uppercase text-[9px] font-black tracking-wider">
                <th className="p-2">Nº Factura</th>
                <th className="p-2">Cliente</th>
                <th className="p-2">Data de Emissão</th>
                <th className="p-2">Meio de Pagamento</th>
                <th className="p-2 text-right">Valor Total</th>
                <th className="p-2 text-center">Estado</th>
                <th className="p-2 text-right">Acções Operacionais</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 bg-white">
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-slate-400 italic text-[11px]">
                    Nenhuma factura localizada com os critérios actuais.
                  </td>
                </tr>
              ) : (
                filteredSales.map(sale => {
                  return (
                    <tr key={sale.id} className="hover:bg-slate-50/50 transition-colors">
                      {/* Invoice Number */}
                      <td className="p-2 font-mono font-black text-slate-700 text-[10.5px]">{sale.invoiceNumber}</td>
                      
                      {/* Customer Name */}
                      <td className="p-2">
                        <p className="font-bold text-slate-800 text-[10.5px]">{sale.customerName}</p>
                        <p className="text-[9.5px] text-slate-400">Op: {sale.operatorName}</p>
                      </td>

                      {/* Date */}
                      <td className="p-2 text-slate-500 text-[10px]">
                        {new Date(sale.date).toLocaleDateString('pt-MZ', { day: '2-digit', month: '2-digit', year: 'numeric' })} • {new Date(sale.date).toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' })}
                      </td>

                      {/* Payment Method */}
                      <td className="p-2">
                        <span className="font-semibold text-slate-600 bg-slate-100 border border-slate-150 px-1.5 py-0.5 rounded text-[9.5px]">
                          {sale.paymentMethod}
                        </span>
                      </td>

                      {/* Total Price */}
                      <td className="p-2 text-right font-black text-slate-900 font-mono text-[11px]">
                        {sale.total.toLocaleString()} MT
                      </td>

                      {/* Status Badges */}
                      <td className="p-2 text-center">
                        <span className={`text-[8.5px] font-black uppercase px-2 py-0.5 rounded-full border ${
                          sale.status === 'Paga'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-150'
                            : sale.status === 'Pendente'
                              ? 'bg-amber-50 text-amber-700 border-amber-150'
                              : 'bg-rose-50 text-rose-700 border-rose-150'
                        }`}>
                          {sale.status === 'Paga' ? 'PAGA' : sale.status === 'Pendente' ? 'PENDENTE' : 'CANCELADA'}
                        </span>
                      </td>

                      {/* Operations */}
                      <td className="p-2 text-right">
                        <div className="flex justify-end gap-1 flex-wrap">
                          {/* Liquidate payment buttons */}
                          {sale.status === 'Pendente' && (
                            <button
                              type="button"
                              onClick={() => handlePayInvoice(sale)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[9.5px] uppercase px-1.5 py-0.5 rounded shadow-2xs flex items-center gap-0.5 cursor-pointer transition-colors"
                              title="Liquidar / Pagar factura pendente"
                            >
                              <span className="material-symbols-outlined text-[11px]">payments</span>
                              Pagar
                            </button>
                          )}

                          {/* Secondary view/print/cancel triggers */}
                          {sale.status !== 'Cancelada' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setInvoiceToPrint(sale);
                                  setPrintType('A4');
                                }}
                                className="bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-[9.5px] px-1.5 py-0.5 rounded cursor-pointer"
                                title="Visualizar e Imprimir Fatura A4"
                              >
                                Fatura A4
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setInvoiceToPrint(sale);
                                  setPrintType('Proforma');
                                }}
                                className="bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-[9.5px] px-1.5 py-0.5 rounded cursor-pointer"
                                title="Visualizar e Imprimir Fatura Proforma A4"
                              >
                                F. Proforma
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setInvoiceToPrint(sale);
                                  setPrintType('Thermal');
                                }}
                                className="bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-[9.5px] px-1.5 py-0.5 rounded cursor-pointer"
                                title="Visualizar e Imprimir Recibo POS"
                              >
                                POS
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setInvoiceToPrint(sale);
                                  setPrintType('ReciboA4');
                                }}
                                className="bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-[9.5px] px-1.5 py-0.5 rounded cursor-pointer"
                                title="Visualizar e Imprimir Recibo A4"
                              >
                                Recibo A4
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCancelInvoice(sale)}
                                className="bg-rose-50 border border-rose-100 hover:bg-rose-100 text-rose-600 font-bold text-[9.5px] px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                                title="Cancelar Factura definitivamente"
                              >
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRestoreInvoice(sale)}
                              className="bg-blue-50 border border-blue-100 hover:bg-blue-100 text-blue-600 font-bold text-[9.5px] uppercase px-2 py-0.5 rounded cursor-pointer transition-colors"
                              title="Restaurar Factura Cancelada de volta a Pendente"
                            >
                              Restaurar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Print Preview Overlay Modal --- */}
      {invoiceToPrint && printType && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-8 overflow-hidden flex flex-col">
            {/* Modal Actions */}
            <div className="bg-slate-900 p-4 border-b border-slate-800 flex justify-between items-center text-white">
              <span className="font-bold flex items-center gap-2 text-sm uppercase tracking-wide">
                <span className="material-symbols-outlined text-emerald-500">print</span>
                Visualização de Emissão de Fatura / Recibo
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const s = settings || { companyName: 'AGRO - XICOMO & SERVI\u00c7OS, LDA', companyNuit: '401976590' } as any;
                    if (printType === 'Thermal') {
                      downloadThermalReceipt(invoiceToPrint, s);
                    } else if (printType === 'A4') {
                      downloadInvoiceA4(invoiceToPrint, s, false, invoiceToPrint.paymentMethod === 'Crédito' ? 'FACTURA A CRÉDITO' : 'FACTURA DEFINITIVA');
                    } else if (printType === 'Proforma') {
                      downloadInvoiceA4(invoiceToPrint, s, false, 'FACTURA PROFORMA');
                    } else if (printType === 'ReciboA4') {
                      downloadInvoiceA4(invoiceToPrint, s, true);
                    } else if (printType === 'DoubleA5') {
                      downloadDuplicatedInvoiceA4(invoiceToPrint, s);
                    }
                  }}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl hover:opacity-95 transition-all shadow-sm cursor-pointer flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">download</span>
                  Descarregar PDF
                </button>
                <button
                  onClick={() => {
                    setInvoiceToPrint(null);
                    setPrintType(null);
                  }}
                  className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>

            {/* Document Layouts */}
            <div className="p-8 bg-slate-100 flex justify-center custom-scrollbar overflow-y-auto max-h-[650px]">
              
              {/* 1. Standard A4 Commercial Invoice Layout */}
              {(printType === 'A4' || printType === 'Proforma') && (() => {
                const chunks: typeof invoiceToPrint.items[] = [];
                const limit = 8;
                for (let i = 0; i < invoiceToPrint.items.length; i += limit) {
                  chunks.push(invoiceToPrint.items.slice(i, i + limit));
                }
                return (
                  <div className="flex flex-col gap-8 w-full items-center" id="a4_invoice">
                    {chunks.map((chunk, pageIdx) => {
                      const isFirst = pageIdx === 0;
                      const isLast = pageIdx === chunks.length - 1;
                      return (
                        <div
                          key={pageIdx}
                          className="bg-white p-8 w-[210mm] min-h-[297mm] shadow-lg border border-gray-300 text-gray-800 text-xs font-sans flex flex-col justify-between print:m-0 print:border-none print:shadow-none print:w-full print:min-h-0"
                          style={{ pageBreakAfter: pageIdx < chunks.length - 1 ? 'always' : 'avoid' }}
                        >
                          <div>
                            {isFirst ? (
                              <div className="flex justify-between items-start border-b border-gray-200 pb-5 mb-5">
                                <div className="space-y-1">
                                  {settings?.logoUrl && (
                                    <img src={settings.logoUrl} alt="Logo" className="w-[6cm] h-[4.5cm] object-contain rounded mb-2 block animate-fade-in" />
                                  )}
                                  <h2 className="text-lg font-black text-emerald-800 uppercase">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS,EI'}</h2>
                                  <p className="text-[10px] text-gray-500 font-semibold">SISTEMA INTEGRADO DE FATURAÇÃO COMERCIAL</p>
                                  <p className="text-gray-600 text-[10px]">Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'}</p>
                                  <div className="text-[10px] text-gray-600 space-y-0.5 mt-1 border-t border-gray-100 pt-1">
                                    {settings?.email && <p><strong>Email:</strong> {settings.email}</p>}
                                    <p><strong>Contacto:</strong> {[settings?.vodacom1, settings?.movitel1].filter(Boolean).join(' / ') || '84 94 23 241'}</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="bg-emerald-800 text-white px-5 py-2 rounded text-sm font-black uppercase tracking-wider shadow-sm">
                                    {printType === 'Proforma' 
                                      ? 'FACTURA PROFORMA' 
                                      : (invoiceToPrint.paymentMethod === 'Crédito' ? 'FACTURA A CRÉDITO' : 'FACTURA DEFINITIVA')}
                                  </div>
                                  <p className="text-gray-700 mt-2 font-mono font-bold text-xs">Nº: {invoiceToPrint.invoiceNumber}</p>
                                  <p className="text-gray-500 font-mono text-[10px]">Emissão: {new Date(invoiceToPrint.date).toLocaleString('pt-MZ')}</p>
                                  <p className="text-gray-500 text-[10px] mt-0.5">Forma de Pagamento: Transferência Bancária</p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-4">
                                <div className="space-y-0.5">
                                  <h2 className="text-sm font-black text-emerald-800 uppercase">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS,EI'}</h2>
                                  <p className="text-[9px] text-gray-500">FATURA - CONTINUAÇÃO (Pág {pageIdx + 1}/{chunks.length})</p>
                                </div>
                                <div className="text-right font-mono text-[9px] text-gray-500">
                                  Nº: {invoiceToPrint.invoiceNumber} | Data: {new Date(invoiceToPrint.date).toLocaleDateString('pt-MZ')}
                                </div>
                              </div>
                            )}

                            {isFirst && (
                              <div className="grid grid-cols-2 gap-6 bg-gray-50 p-4 rounded-lg border border-gray-200 mb-5">
                                <div className="space-y-1">
                                  <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">FATURADO A:</p>
                                  <p className="font-black text-gray-800 text-sm">{invoiceToPrint.customerName || 'Cliente Geral'}</p>
                                  <p className="text-gray-600 text-[10px]"><strong>Endereço:</strong> {invoiceToPrint.customerAddress || 'Província de Maputo, Moçambique'}</p>
                                  <p className="text-gray-600 text-[10px]"><strong>NUIT:</strong> {invoiceToPrint.customerNuit || 'Consumidor Final'}</p>
                                </div>
                                <div className="text-right space-y-1">
                                  <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">OPERADOR:</p>
                                  <p className="font-bold text-gray-800">{invoiceToPrint.operatorName || 'Mazive'}</p>
                                  <p className="text-gray-500 text-[10px]">Sessão Offline Validada</p>
                                </div>
                              </div>
                            )}

                            <table className="w-full text-left border-collapse mb-6 text-xs rounded-lg overflow-hidden border border-gray-200">
                              <thead>
                                <tr className="bg-slate-100 text-slate-800 font-bold border-b border-gray-200">
                                  <th className="p-2.5">Item / Artigo</th>
                                  <th className="p-2.5 text-right">Qtd</th>
                                  <th className="p-2.5">Unidade</th>
                                  <th className="p-2.5 text-right">P. Unitário</th>
                                  <th className="p-2.5 text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {chunk.map((item, idx) => (
                                  <tr key={idx} className={idx % 2 === 1 ? "bg-slate-50/50" : "bg-white"}>
                                    <td className="p-2.5 font-semibold text-gray-800">{item.name}</td>
                                    <td className="p-2.5 text-right font-mono text-blue-700 font-bold">{item.quantity}</td>
                                    <td className="p-2.5 text-gray-600">{item.unit || 'UN'}</td>
                                    <td className="p-2.5 text-right font-mono">{item.unitPrice.toLocaleString('pt-MZ')} MT</td>
                                    <td className="p-2.5 text-right font-bold font-mono">{item.totalPrice.toLocaleString('pt-MZ')} MT</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div>
                            {isLast ? (
                              <>
                                <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-4 mb-6">
                                  {/* Coordenadas Bancarias */}
                                  <div className="bg-slate-50 p-3 rounded border border-gray-200 text-[10px] space-y-1">
                                    <p className="font-bold text-emerald-800 uppercase tracking-wide">COORDENADAS BANCÁRIAS PARA TRANSFERÊNCIA:</p>
                                    <p className="text-gray-700 font-medium">1. {settings?.banco || 'First Capital Bank, S.A.'} | Conta: {settings?.numero_conta || '99466610001'} | NIB: {settings?.nib || '001000000099466610196'}</p>
                                    {(settings as any)?.banco2 && (
                                      <p className="text-gray-700 font-medium">2. {(settings as any).banco2} | Conta: {(settings as any).numero_conta2} | NIB: {(settings as any).nib2}</p>
                                    )}
                                  </div>

                                  {/* Totais */}
                                  <div className="text-right space-y-1 text-xs text-gray-600 self-end">
                                    <div className="flex justify-between">
                                      <span>Subtotal:</span>
                                      <span className="font-bold font-mono">{invoiceToPrint.subtotal.toLocaleString('pt-MZ')} MT</span>
                                    </div>
                                    <div className="flex justify-between text-red-500">
                                      <span>Desconto:</span>
                                      <span className="font-bold font-mono">-{invoiceToPrint.discount.toLocaleString('pt-MZ')} MT</span>
                                    </div>
                                    <div className="flex justify-between text-gray-600">
                                      <span>IVA:</span>
                                      <span className="font-bold font-mono">{invoiceToPrint.includeIva ? `${(invoiceToPrint.ivaAmount || 0).toLocaleString('pt-MZ')} MT` : 'IVA INCLUSO'}</span>
                                    </div>
                                    <div className="flex justify-between text-sm font-black text-emerald-800 border-t border-gray-300 pt-1.5">
                                      <span>Total Líquido:</span>
                                      <span className="font-mono text-base">{invoiceToPrint.total.toLocaleString('pt-MZ')} MT</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="border-t border-gray-200 pt-3 text-center space-y-0.5 bg-gray-50 p-3 rounded-lg">
                                  <p className="font-black text-gray-800 text-[11px] uppercase tracking-wide">
                                    {settings?.companyName || 'AGRO - XICOMO & SERVIÇOS,EI'}
                                  </p>
                                  <p className="text-[9px] text-gray-500">
                                    Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'} • Email: {settings?.email || 'agroxicomo1@gmail.com'}
                                  </p>
                                  <p className="text-[8px] text-gray-400 uppercase tracking-widest pt-1">
                                    Processado por Computador • Impresso via AgroGestão ERP
                                  </p>
                                </div>
                              </>
                            ) : (
                              <div className="border-t border-gray-200 pt-4 flex justify-between items-center text-[10px] text-gray-400 italic">
                                <span>Fatura Comercial Nº: {invoiceToPrint.invoiceNumber}</span>
                                <span className="font-semibold text-emerald-700">Continua na página seguinte... (Pág {pageIdx + 1} de {chunks.length})</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* 2. Recibo A4 Layout */}
              {printType === 'ReciboA4' && (() => {
                const chunks: typeof invoiceToPrint.items[] = [];
                const limit = 8;
                for (let i = 0; i < invoiceToPrint.items.length; i += limit) {
                  chunks.push(invoiceToPrint.items.slice(i, i + limit));
                }
                return (
                  <div className="flex flex-col gap-8 w-full items-center" id="a4_recibo">
                    {chunks.map((chunk, pageIdx) => {
                      const isFirst = pageIdx === 0;
                      const isLast = pageIdx === chunks.length - 1;
                      return (
                        <div
                          key={pageIdx}
                          className="bg-white p-8 w-[210mm] min-h-[297mm] shadow-lg border border-gray-300 text-gray-800 text-xs font-sans flex flex-col justify-between print:m-0 print:border-none print:shadow-none print:w-full print:min-h-0"
                          style={{ pageBreakAfter: pageIdx < chunks.length - 1 ? 'always' : 'avoid' }}
                        >
                          <div>
                            {isFirst ? (
                              <div className="flex justify-between items-start border-b border-gray-200 pb-6 mb-6">
                                <div className="space-y-1">
                                  {settings?.logoUrl && (
                                    <img src={settings.logoUrl} alt="Logo" className="w-[6.5cm] h-[4cm] object-contain rounded mb-2 block animate-fade-in" />
                                  )}
                                  <h2 className="text-xl font-black text-emerald-800 uppercase">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}</h2>
                                  <p className="text-[10px] text-gray-500 font-semibold mt-1">SISTEMA INTEGRADO DE FATURAÇÃO COMERCIAL</p>
                                  <p className="text-gray-600">Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'}</p>
                                </div>
                                
                                <div className="text-right space-y-1.5">
                                  <div className="bg-emerald-600 text-white px-5 py-2 rounded text-base font-black tracking-wide inline-block uppercase shadow-sm">
                                    RECIBO
                                  </div>
                                  <p className="text-gray-700 font-bold font-mono text-sm pt-2">
                                    Recibo Nº: {invoiceToPrint.receiptNumber || (invoiceToPrint.invoiceNumber.startsWith('Fact-') ? invoiceToPrint.invoiceNumber.replace('Fact-', 'Rec-') : invoiceToPrint.invoiceNumber.startsWith('FAC-') ? invoiceToPrint.invoiceNumber.replace('FAC-', 'REC-') : `Rec-${new Date().getFullYear()}-${invoiceToPrint.invoiceNumber}`)}
                                  </p>
                                  <p className="text-gray-500 font-medium text-[10px]">
                                    Referente à Fatura Nº: <span className="font-bold font-mono text-gray-800">{invoiceToPrint.invoiceNumber}</span>
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-4">
                                <div className="space-y-0.5">
                                  <h2 className="text-sm font-black text-emerald-800 uppercase">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}</h2>
                                  <p className="text-[9px] text-gray-500">RECIBO - CONTINUAÇÃO (Pág {pageIdx + 1}/{chunks.length})</p>
                                </div>
                                <div className="text-right font-mono text-[9px] text-gray-500">
                                  Ref Fatura Nº: {invoiceToPrint.invoiceNumber}
                                </div>
                              </div>
                            )}

                            {isFirst && (
                              <div className="grid grid-cols-2 gap-6 bg-gray-50 p-5 rounded-lg border border-gray-200 mb-6">
                                <div className="space-y-1">
                                  <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Dados do Cliente</p>
                                  <p className="font-black text-gray-800 text-sm">{invoiceToPrint.customerName}</p>
                                  <p className="text-gray-600 text-[10px]"><strong>Localização:</strong> Maputo, Moçambique</p>
                                </div>
                                <div className="text-right space-y-1">
                                  <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Dados do Operador</p>
                                  <p className="font-bold text-gray-800">{invoiceToPrint.operatorName || 'Operador Autorizado'}</p>
                                </div>
                              </div>
                            )}

                            <table className="w-full text-left border-collapse mb-8 text-xs rounded-lg overflow-hidden">
                              <thead>
                                <tr className="bg-slate-800 text-white font-bold">
                                  <th className="p-3 rounded-l">Item / Serviço</th>
                                  <th className="p-3 text-right">Qtd</th>
                                  <th className="p-3">Unidade</th>
                                  <th className="p-3 text-right">P. Unitário (MT)</th>
                                  <th className="p-3 text-right rounded-r">Total (MT)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {chunk.map((item, idx) => (
                                  <tr key={idx} className="hover:bg-gray-50">
                                    <td className="p-3 font-semibold text-gray-800">{item.name}</td>
                                    <td className="p-3 text-right font-mono">{item.quantity}</td>
                                    <td className="p-3 text-gray-600">{item.unit || 'UN'}</td>
                                    <td className="p-3 text-right font-mono">{item.unitPrice.toLocaleString()}</td>
                                    <td className="p-3 text-right font-bold font-mono">{item.totalPrice.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div>
                            {isLast ? (
                              <>
                                <div className="flex justify-between items-center border-t border-gray-200 pt-6 mb-8">
                                  <div className="text-[11px] text-gray-500 italic max-w-lg leading-relaxed">
                                    *Este recibo serve como prova oficial de liquidação total da fatura acima referenciada.
                                  </div>
                                  <div className="w-64 text-right space-y-1.5 text-xs text-gray-600">
                                    <div className="flex justify-between">
                                      <span>Subtotal:</span>
                                      <span className="font-bold font-mono">{invoiceToPrint.subtotal.toLocaleString()} MT</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Desconto:</span>
                                      <span className="font-bold font-mono text-red-500">-{invoiceToPrint.discount.toLocaleString()} MT</span>
                                    </div>
                                    <div className="flex justify-between text-sm font-black text-gray-900 border-t border-gray-200 pt-2">
                                      <span>Total Pago:</span>
                                      <span className="text-emerald-700 font-mono text-base">{invoiceToPrint.total.toLocaleString()} MT</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="border-t border-gray-200 pt-6 text-center space-y-1 bg-gray-50 p-4 rounded-lg">
                                  <p className="font-black text-gray-800 text-xs uppercase tracking-wide">
                                    {settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}
                                  </p>
                                  <p className="text-[9px] text-gray-500">
                                    Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'}
                                  </p>
                                </div>
                              </>
                            ) : (
                              <div className="border-t border-gray-200 pt-4 flex justify-between items-center text-[10px] text-gray-400 italic">
                                <span>Recibo Nº: {invoiceToPrint.receiptNumber || (invoiceToPrint.invoiceNumber.startsWith('Fact-') ? invoiceToPrint.invoiceNumber.replace('Fact-', 'Rec-') : invoiceToPrint.invoiceNumber.startsWith('FAC-') ? invoiceToPrint.invoiceNumber.replace('FAC-', 'REC-') : invoiceToPrint.invoiceNumber)}</span>
                                <span className="font-semibold text-emerald-700">Continua na página seguinte... (Pág {pageIdx + 1} de {chunks.length})</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* 3. Thermal Receipt Layout */}
              {printType === 'Thermal' && (
                <div className="bg-white p-4 w-[72mm] shadow-none text-black text-[9px] font-mono leading-tight space-y-3 mx-auto" id="thermal_receipt">
                  {/* Header */}
                  <div className="text-center space-y-1">
                    {settings?.logoUrl ? (
                      <img src={settings.logoUrl} alt="Logo" className="max-h-10 object-contain bg-white mx-auto mb-1 block" />
                    ) : null}
                    <h3 className="text-[11px] font-black uppercase tracking-wide">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}</h3>
                    <p className="text-[8px] text-gray-700">Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'}</p>
                    <div className="text-[8px] text-gray-600 space-y-0.5">
                      {settings?.email && <p>Email: {settings.email}</p>}
                      <p>Vodacom: {[settings?.vodacom1, settings?.vodacom2, settings?.vodacom3].filter(Boolean).join(' / ') || '+258 84 123 4567'}</p>
                      <p>Movitel: {[settings?.movitel1, settings?.movitel2, settings?.movitel3].filter(Boolean).join(' / ') || '+258 86 123 4567'}</p>
                    </div>
                  </div>

                  {/* Document Title Bar */}
                  <div className="border-y-2 border-double border-gray-400 py-1.5 text-center font-black uppercase text-[10px] tracking-wider text-gray-900 bg-gray-50/50">
                    Recibo de Pagamento POS
                  </div>

                  {/* Metadata */}
                  <div className="space-y-0.5 text-[8px] text-gray-700">
                    <div className="flex justify-between">
                      <span className="font-bold">FATURA Nº:</span>
                      <span className="font-mono font-black">{invoiceToPrint.invoiceNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>DATA:</span>
                      <span>{new Date(invoiceToPrint.date).toLocaleString('pt-MZ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>OPERADOR:</span>
                      <span className="uppercase">{invoiceToPrint.operatorName}</span>
                    </div>
                    <div className="flex justify-between border-t border-dotted border-gray-300 pt-0.5 mt-0.5">
                      <span className="font-bold">CLIENTE:</span>
                      <span className="uppercase font-semibold">{invoiceToPrint.customerName}</span>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-b border-dashed border-gray-400 my-1"></div>

                  {/* Items list */}
                  <div className="space-y-2">
                    <div className="font-bold uppercase text-[8px] text-gray-500 flex justify-between">
                      <span>Artigo / Qtd x Preço</span>
                      <span>Total (MT)</span>
                    </div>
                    
                    <div className="space-y-2">
                      {invoiceToPrint.items.map((item, idx) => (
                        <div key={idx} className="space-y-0.5">
                          <div className="font-bold text-gray-900 uppercase text-[8.5px] leading-tight">{item.name}</div>
                          <div className="flex justify-between text-[8px] text-gray-600 font-mono">
                            <span>{item.quantity} {item.unit} x {item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                            <span className="font-bold font-mono text-gray-900">{item.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-b border-dashed border-gray-400 my-1"></div>

                  {/* Calculations */}
                  <div className="space-y-1 text-[8.5px]">
                    <div className="flex justify-between">
                      <span>SUBTOTAL:</span>
                      <span className="font-mono">{invoiceToPrint.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                    </div>
                    
                    {invoiceToPrint.discount > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>DESCONTO:</span>
                        <span className="font-mono">-{invoiceToPrint.discount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                      </div>
                    )}

                    {invoiceToPrint.includeIva && (
                      <div className="flex justify-between text-gray-600 text-[8px]">
                        <span>IVA INCLUÍDO (16%):</span>
                        <span className="font-mono">{(invoiceToPrint.ivaAmount || (invoiceToPrint.total * 0.16)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                      </div>
                    )}

                    <div className="flex justify-between font-black text-[11px] border-t border-dashed border-gray-400 pt-1.5 mt-1 text-black">
                      <span>TOTAL PAGO:</span>
                      <span className="font-mono">{invoiceToPrint.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                    </div>

                    <div className="flex justify-between text-[8px] text-gray-700 pt-0.5 border-t border-dotted border-gray-300 mt-1">
                      <span>FORMA PAGAMENTO:</span>
                      <span className="uppercase font-bold text-gray-900">{invoiceToPrint.paymentMethod || 'Dinheiro'}</span>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="border-t border-dashed border-gray-400 pt-3 text-center space-y-1 text-[8px] text-gray-500 uppercase">
                    <p className="font-bold text-gray-800">Obrigado pela sua preferência!</p>
                    <p className="font-bold text-gray-700 italic text-[8.5px] mt-0.5">"Validade até à reposição de stock"</p>
                    <div className="pt-2 text-[7px] text-gray-400 font-mono space-y-0.5">
                      <p>Processado por Software AgroGestão</p>
                      <p className="tracking-widest font-black text-[6px]">|||| | ||||| ||| |||||| |||| | ||</p>
                    </div>
                  </div>
                </div>
              )}

              {/* 4. Double A5 in A4 Sheet Layout */}
              {printType === 'DoubleA5' && (
                <div className="bg-white p-8 w-[210mm] min-h-[297mm] shadow-lg border border-gray-300 text-gray-800 text-[10px] font-sans flex flex-col justify-between" id="double_a5_invoice">
                  {/* Top A5 Section */}
                  <div className="h-[135mm] border-b-2 border-dashed border-slate-400 pb-8 flex flex-col justify-between">
                    <div>
                      {/* Header */}
                      <div className="flex justify-between items-start pb-4 mb-4 border-b border-gray-200">
                        <div className="space-y-0.5">
                          <h2 className="text-sm font-black text-emerald-800 uppercase">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}</h2>
                          <p className="text-[8px] text-gray-500">Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'}</p>
                        </div>
                        <div className="text-right">
                          <div className="bg-slate-100 text-slate-800 px-3 py-1 rounded text-xs font-black uppercase">
                            VIA DE FACTURA (ORIGINAL)
                          </div>
                          <p className="text-gray-500 font-mono text-[9px] mt-1">Nº: {invoiceToPrint.invoiceNumber}</p>
                        </div>
                      </div>

                      {/* Customer info */}
                      <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 mb-4 grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[8px] font-black uppercase text-gray-400">Cliente</p>
                          <p className="font-bold text-gray-800">{invoiceToPrint.customerName}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[8px] font-black uppercase text-gray-400">Data</p>
                          <p className="font-mono text-gray-700">{new Date(invoiceToPrint.date).toLocaleString('pt-MZ')}</p>
                        </div>
                      </div>

                      {/* Items */}
                      <table className="w-full text-left text-[9px] mb-4">
                        <thead>
                          <tr className="bg-slate-800 text-white font-bold">
                            <th className="p-2">Item</th>
                            <th className="p-2 text-right">Qtd</th>
                            <th className="p-2 text-right">P. Unitário</th>
                            <th className="p-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {invoiceToPrint.items.map((item, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="p-2 font-semibold text-gray-800">{item.name}</td>
                              <td className="p-2 text-right font-mono">{item.quantity}</td>
                              <td className="p-2 text-right font-mono">{item.unitPrice.toLocaleString()}</td>
                              <td className="p-2 text-right font-bold font-mono">{item.totalPrice.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-between items-center pt-2">
                      <p className="text-[8px] text-gray-400">Processado via ERP</p>
                      <div className="w-48 text-right font-mono text-[9px] space-y-0.5">
                        <div className="flex justify-between">
                          <span>SUBTOTAL:</span>
                          <span>{invoiceToPrint.subtotal.toLocaleString()} MT</span>
                        </div>
                        <div className="flex justify-between text-red-500">
                          <span>DESCONTO:</span>
                          <span>-{invoiceToPrint.discount.toLocaleString()} MT</span>
                        </div>
                        <div className="flex justify-between font-black text-xs text-slate-800 border-t border-gray-200 pt-1">
                          <span>TOTAL GERAL:</span>
                          <span>{invoiceToPrint.total.toLocaleString()} MT</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bottom A5 Section (Copy) */}
                  <div className="h-[135mm] pt-8 flex flex-col justify-between">
                    <div>
                      {/* Header */}
                      <div className="flex justify-between items-start pb-4 mb-4 border-b border-gray-200">
                        <div className="space-y-0.5">
                          <h2 className="text-sm font-black text-emerald-800 uppercase">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}</h2>
                          <p className="text-[8px] text-gray-500">Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'}</p>
                        </div>
                        <div className="text-right">
                          <div className="bg-slate-100 text-slate-800 px-3 py-1 rounded text-xs font-black uppercase">
                            VIA DE FACTURA (CÓPIA)
                          </div>
                          <p className="text-gray-500 font-mono text-[9px] mt-1">Nº: {invoiceToPrint.invoiceNumber}</p>
                        </div>
                      </div>

                      {/* Customer info */}
                      <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 mb-4 grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[8px] font-black uppercase text-gray-400">Cliente</p>
                          <p className="font-bold text-gray-800">{invoiceToPrint.customerName}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[8px] font-black uppercase text-gray-400">Data</p>
                          <p className="font-mono text-gray-700">{new Date(invoiceToPrint.date).toLocaleString('pt-MZ')}</p>
                        </div>
                      </div>

                      {/* Items */}
                      <table className="w-full text-left text-[9px] mb-4">
                        <thead>
                          <tr className="bg-slate-800 text-white font-bold">
                            <th className="p-2">Item</th>
                            <th className="p-2 text-right">Qtd</th>
                            <th className="p-2 text-right">P. Unitário</th>
                            <th className="p-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {invoiceToPrint.items.map((item, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="p-2 font-semibold text-gray-800">{item.name}</td>
                              <td className="p-2 text-right font-mono">{item.quantity}</td>
                              <td className="p-2 text-right font-mono">{item.unitPrice.toLocaleString()}</td>
                              <td className="p-2 text-right font-bold font-mono">{item.totalPrice.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-between items-center pt-2">
                      <p className="text-[8px] text-gray-400">Processado via ERP</p>
                      <div className="w-48 text-right font-mono text-[9px] space-y-0.5">
                        <div className="flex justify-between">
                          <span>SUBTOTAL:</span>
                          <span>{invoiceToPrint.subtotal.toLocaleString()} MT</span>
                        </div>
                        <div className="flex justify-between text-red-500">
                          <span>DESCONTO:</span>
                          <span>-{invoiceToPrint.discount.toLocaleString()} MT</span>
                        </div>
                        <div className="flex justify-between font-black text-xs text-slate-800 border-t border-gray-200 pt-1">
                          <span>TOTAL GERAL:</span>
                          <span>{invoiceToPrint.total.toLocaleString()} MT</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation Modal */}
      {confirmModal?.show && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden border border-red-100">
            <div className="bg-gradient-to-r from-red-600 to-red-700 p-4 text-white font-bold flex justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined">warning</span>
                {confirmModal.title}
              </span>
              <button onClick={() => setConfirmModal(null)} className="text-white hover:opacity-80">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                {confirmModal.message}
              </p>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmModal(null)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmModal.onConfirm}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer"
                >
                  Confirmar Operação
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Security Action Validation Modal (Anulação / Restauração protegidas por senha de gestor) */}
      {securityModal.show && securityModal.sale && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-200">
            <div className={`p-4 text-white font-bold flex justify-between items-center ${
              securityModal.action === 'cancel' ? 'bg-gradient-to-r from-red-600 to-red-700' : 'bg-gradient-to-r from-blue-600 to-blue-700'
            }`}>
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">gpp_maybe</span>
                {securityModal.action === 'cancel' ? 'Autorização de Gestor: Anular Venda' : 'Autorização de Gestor: Restaurar Venda'}
              </span>
              <button onClick={() => setSecurityModal({ show: false, action: 'cancel', sale: null, password: '', error: '' })} className="text-white hover:opacity-80">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="p-6 space-y-4 text-xs">
              <div className={`p-3 rounded-lg border space-y-1 ${
                securityModal.action === 'cancel' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'
              }`}>
                <p className={`font-bold text-[11px] ${securityModal.action === 'cancel' ? 'text-red-800' : 'text-blue-800'}`}>
                  {securityModal.action === 'cancel' ? 'Atenção - Anulação e Estorno de Stock' : 'Restauração de Documento de Venda'}
                </p>
                <p className={`leading-relaxed text-[11px] ${securityModal.action === 'cancel' ? 'text-red-700' : 'text-blue-700'}`}>
                  Está prestes a {securityModal.action === 'cancel' ? 'anular' : 'restaurar'} a venda <strong className="font-bold">{securityModal.sale.invoiceNumber}</strong> (Cliente: {securityModal.sale.customerName}, Valor: {securityModal.sale.total.toLocaleString()} MT).
                </p>
                {securityModal.action === 'cancel' && (
                  <p className="text-red-700 leading-relaxed text-[11px] font-semibold">
                    Esta ação estornará automaticamente todas as quantidades de produtos vendidos de volta para o inventário físico.
                  </p>
                )}
              </div>

              {securityModal.error && (
                <div className="p-2.5 bg-rose-50 text-rose-700 border border-rose-200 rounded font-bold text-center">
                  {securityModal.error}
                </div>
              )}

              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase text-gray-500">
                  Palavra-passe de Autorização do Gestor
                </label>
                <form onSubmit={(e) => { e.preventDefault(); handleExecuteSecurityAction(); }} autoComplete="off" noValidate>
                  <input
                    type="password"
                    name="sec_mgr_pass_input"
                    id="sec_mgr_pass_input"
                    autoComplete="new-password"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    data-lpignore="true"
                    data-form-type="other"
                    aria-autocomplete="none"
                    placeholder="Palavra-passe de autorização"
                    value={securityModal.password}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSecurityModal(prev => ({ ...prev, password: val, error: '' }));
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-center font-bold text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                  />
                </form>
                <p className="text-[10px] text-gray-400 text-center mt-1">
                  Operação protegida. Insira a palavra-passe do gestor.
                </p>
              </div>

              <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setSecurityModal({ show: false, action: 'cancel', sale: null, password: '', error: '' })}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold transition-all cursor-pointer text-[11px]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleExecuteSecurityAction}
                  className={`px-4 py-2 text-white rounded-lg font-bold transition-all shadow-sm cursor-pointer text-[11px] ${
                    securityModal.action === 'cancel' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {securityModal.action === 'cancel' ? 'Autorizar e Anular Venda' : 'Autorizar e Restaurar Venda'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
