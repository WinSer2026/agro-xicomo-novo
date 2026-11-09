import React, { useState, useEffect, useRef } from 'react';
import { jsPDF } from 'jspdf';
import { dbService, type FirestorePageCursor, type SalesSummary } from '../utils/firebaseDB';
import { isFinancialSale, saleStatusLabel } from '../utils/saleStatus';
import { verifyAuthorizationPassword } from '../utils/authorization';
import { Sale, SystemSettings } from '../types';
import { downloadInvoiceA4, downloadDuplicatedInvoiceA4, downloadThermalReceipt, downloadReceiptA4 } from '../utils/pdfGenerator';
import { generateNextReceiptNumber } from '../utils/sequenceHelper';
import { DateRangeFilter } from './DateRangeFilter';
import { DateRangePreset, getDateRangeFromPreset, isDateInRange, formatDatePT } from '../utils/dateRangeHelper';
import { runPostCommitTask } from '../utils/postCommit';
import * as XLSX from 'xlsx';

interface FaturasModuleProps {
  currentUser?: { username: string; role: string; roles?: string[] } | null;
}

export default function FaturasModule({ currentUser }: FaturasModuleProps) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [faturasSearch, setFaturasSearch] = useState('');
  const [faturasFilter, setFaturasFilter] = useState<'Todas' | 'Pendente' | 'Crédito' | 'Paga' | 'Proforma' | 'Cancelada'>('Todas');

  // Date Range Filter states
  const defaultRange = getDateRangeFromPreset('Este Mês');
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [datePreset, setDatePreset] = useState<DateRangePreset>('Este Mês');

  // The invoice list is deliberately bounded. Totals come from Firestore
  // aggregates, while "Carregar mais" advances with an opaque query cursor.
  const [nextSalesCursor, setNextSalesCursor] = useState<FirestorePageCursor | null>(null);
  const [hasMoreSales, setHasMoreSales] = useState(false);
  const [isLoadingSales, setIsLoadingSales] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [salesRefreshKey, setSalesRefreshKey] = useState(0);
  const salesRequestVersion = useRef(0);

  // Preview / Print state
  const [invoiceToPrint, setInvoiceToPrint] = useState<Sale | null>(null);
  const [printType, setPrintType] = useState<'A4' | 'Thermal' | 'DoubleA5' | 'ReciboA4' | 'Proforma' | null>(null);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning'>('success');
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

  const showToast = (msg: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => {
      setToastMessage('');
    }, 4000);
  };

  const getCurrentSalesQuery = () => ({
    startDate,
    endDate,
    status: faturasFilter === 'Todas' ? undefined : faturasFilter
  });

  const loadData = async (notifyOnError = true) => {
    const requestVersion = ++salesRequestVersion.current;
    setIsLoadingSales(true);

    try {
      await dbService.init();
      const queryOptions = getCurrentSalesQuery();
      const [salesPage, globalSettings, summary] = await Promise.all([
        dbService.getSalesPage({ ...queryOptions, pageSize: 30 }),
        dbService.getSettings(),
        // A summary is helpful, but a temporary aggregate/offline error must
        // never hide an otherwise available invoice page.
        dbService.getSalesSummary({ startDate, endDate }).catch(error => {
          console.warn('[FaturasModule] Could not refresh sales summary:', error);
          return null;
        })
      ]);

      if (requestVersion !== salesRequestVersion.current) return;
      setSales(salesPage.items);
      setNextSalesCursor(salesPage.nextCursor);
      setHasMoreSales(salesPage.hasMore);
      setSettings(globalSettings);
      setSalesSummary(summary);
    } catch (err) {
      console.error('Error loading invoices data:', err);
      if (notifyOnError) {
        showToast('Erro ao carregar dados de facturação.', 'error');
        return;
      }
      // Post-commit callers need the rejection so they can keep the successful
      // operation visible and treat only the refresh as non-critical.
      throw err;
    } finally {
      if (requestVersion === salesRequestVersion.current) {
        setIsLoadingSales(false);
      }
    }
  };

  const loadMoreSales = async () => {
    if (isLoadingSales || !hasMoreSales || !nextSalesCursor) return;

    const requestVersion = salesRequestVersion.current;
    setIsLoadingSales(true);
    try {
      const salesPage = await dbService.getSalesPage({
        ...getCurrentSalesQuery(),
        cursor: nextSalesCursor,
        pageSize: 30
      });
      if (requestVersion !== salesRequestVersion.current) return;

      setSales(previous => {
        const seenIds = new Set(previous.map(sale => sale.id));
        return [...previous, ...salesPage.items.filter(sale => !seenIds.has(sale.id))];
      });
      setNextSalesCursor(salesPage.nextCursor);
      setHasMoreSales(salesPage.hasMore);
    } catch (error) {
      console.error('[FaturasModule] Could not load another invoice page:', error);
      showToast('Não foi possível carregar mais facturas. Tente novamente.', 'warning');
    } finally {
      if (requestVersion === salesRequestVersion.current) {
        setIsLoadingSales(false);
      }
    }
  };

  useEffect(() => {
    void loadData();
    // Changing period or status always starts a brand-new cursor chain.
  }, [startDate, endDate, faturasFilter, salesRefreshKey]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handleDbUpdate = (e: any) => {
      const updatedTable = e.detail?.table;
      if (!updatedTable || updatedTable === 'all' || updatedTable === 'sales' || updatedTable === 'settings' || updatedTable === 'products') {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          setSalesRefreshKey(value => value + 1);
        }, 150);
      }
    };
    window.addEventListener('db-update', handleDbUpdate);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('db-update', handleDbUpdate);
    };
  }, []);

  const handleClearAllHistory = () => {
    askConfirmation(
      'Eliminar Histórico de Teste (Vendas, Facturas e Recibos)',
      'Tem a certeza absoluta que deseja eliminar todo o histórico de vendas, facturas e recibos de teste? O sistema ficará limpo e pronto para iniciar o uso com dados reais de produção.',
      async () => {
        try {
          await dbService.clearSystemData();
          await runPostCommitTask({
            label: 'atualizar a lista após limpar o histórico',
            task: () => loadData(false)
          });
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
        let paymentSaved = false;
        try {
          const allSales = await dbService.getSales();
          const candidate = generateNextReceiptNumber(allSales, 'ReciboA4');
          const receiptNum = await dbService.nextDocumentNumber(
            'ReciboA4',
            new Date().getFullYear(),
            parseInt(candidate.slice(candidate.lastIndexOf('-') + 1), 10) - 1 || 0
          );
          const updatedSale: Sale = { ...sale, status: 'Paga', receiptNumber: receiptNum };
          await dbService.addSale(updatedSale);
          paymentSaved = true;

          setInvoiceToPrint(updatedSale);
          setPrintType('ReciboA4');
          const receiptGenerated = await runPostCommitTask({
            label: 'gerar o recibo da fatura liquidada',
            task: () => downloadInvoicePDF(updatedSale, 'ReciboA4')
          });
          await runPostCommitTask({
            label: 'atualizar as faturas depois da liquidação',
            task: () => loadData(false)
          });

          if (receiptGenerated) {
            showToast(`Factura ${sale.invoiceNumber} paga com sucesso! Recibo gerado em A4.`, 'success');
          } else {
            showToast(`Factura ${sale.invoiceNumber} foi liquidada com sucesso. Pode reimprimir o recibo pelo histórico.`, 'warning');
          }
        } catch (err) {
          console.error('Error paying invoice:', err);
          if (paymentSaved) {
            showToast(`A factura ${sale.invoiceNumber} foi liquidada com sucesso. Consulte o histórico antes de repetir a operação.`, 'warning');
          } else {
            showToast('Erro ao liquidar factura.', 'error');
          }
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

    const inputPw = (securityModal.password || '').trim();
    const isValidPassword = await verifyAuthorizationPassword(inputPw, settings);
    if (!isValidPassword) {
      setSecurityModal(prev => ({ ...prev, error: 'Palavra-passe de autorização incorreta.' }));
      return;
    }

    setIsProcessing(true);
    setSecurityModal(prev => ({ ...prev, error: '' }));
    let actionPersisted = false;

    try {
      if (securityModal.action === 'cancel') {
        if (sale.status !== 'Cancelada' && (!sale.documentType || sale.documentType === 'FaturaDefinitiva')) {
          const products = await dbService.getProducts();
          const restockItems: any[] = [];
          for (const item of (sale.items || [])) {
            if (!item) continue;
            const prod = products.find(p => String(p.id) === String(item.productId));
            if (!prod || prod.isService) continue;

            const hasConversion = Boolean(prod.parentUnit && prod.conversionRate && Number(prod.conversionRate) > 1);
            const qtyToAdd = Number(item.quantity) || 0;
            if (qtyToAdd <= 0) continue;
            if (hasConversion && item.sellingUnit === 'Bulk') {
              restockItems.push({
                productId: String(prod.id),
                hasConversion: true,
                sellingUnit: 'Bulk',
                qtyToAdd,
                equivalentBaseQty: qtyToAdd * (Number(prod.conversionRate) || 1)
              });
            } else if (hasConversion) {
              restockItems.push({ productId: String(prod.id), hasConversion: true, sellingUnit: 'Retail', qtyToAdd });
            } else {
              restockItems.push({ productId: String(prod.id), hasConversion: false, qtyToAdd });
            }
          }
          await dbService.cancelSaleWithStockRestoration(
            { ...sale, previousStatus: sale.status as Sale['previousStatus'] },
            restockItems
          );
        } else {
          await dbService.addSale({
            ...sale,
            id: String(sale.id || Date.now()),
            status: 'Cancelada',
            previousStatus: sale.status as Sale['previousStatus']
          });
        }

        actionPersisted = true;
        setSecurityModal({ show: false, action: 'cancel', sale: null, password: '', error: '' });
        void dbService.addAuditLog({
          id: 'log-' + Date.now(),
          timestamp: new Date().toISOString(),
          username: currentUser?.username || 'Gestor',
          ipAddress: '127.0.0.1',
          action: 'Anulação de Venda (Autorizada)',
          status: 'Sucesso',
          details: `Venda ${sale.invoiceNumber} anulada com palavra-passe de autorização.`
        });
        void runPostCommitTask({
          label: 'atualizar as faturas depois da anulação',
          task: () => loadData(false)
        });
        showToast(`Venda ${sale.invoiceNumber} anulada e stock estornado com sucesso!`, 'success');
      } else {
        // Restaurar devolve a fatura ao estado que tinha antes do cancelamento
        // (hoje guardado em `previousStatus`); 'Pendente' é apenas o legado.
        const restoredStatus: Sale['status'] =
          sale.previousStatus === 'Paga' || sale.previousStatus === 'Crédito' || sale.previousStatus === 'Pendente'
            ? sale.previousStatus
            : 'Pendente';
        const updatedSale: Sale = {
          ...sale,
          id: String(sale.id || Date.now()),
          status: restoredStatus,
          previousStatus: undefined
        };
        if (sale.status === 'Cancelada' && (!sale.documentType || sale.documentType === 'FaturaDefinitiva')) {
          const products = await dbService.getProducts();
          const deductionItems: any[] = [];
          for (const item of (sale.items || [])) {
            if (!item) continue;
            const prod = products.find(p => String(p.id) === String(item.productId));
            if (!prod || prod.isService) continue;

            const hasConversion = Boolean(prod.parentUnit && prod.conversionRate && Number(prod.conversionRate) > 1);
            const qtyToReduce = Number(item.quantity) || 0;
            if (qtyToReduce <= 0) continue;
            if (hasConversion && item.sellingUnit === 'Bulk') {
              deductionItems.push({
                productId: String(prod.id),
                hasConversion: true,
                sellingUnit: 'Bulk',
                qtyToReduce,
                equivalentBaseQty: qtyToReduce * (Number(prod.conversionRate) || 1)
              });
            } else if (hasConversion) {
              deductionItems.push({ productId: String(prod.id), hasConversion: true, sellingUnit: 'Retail', qtyToReduce });
            } else {
              deductionItems.push({ productId: String(prod.id), hasConversion: false, qtyToReduce });
            }
          }
          await dbService.addSaleWithStockDeduction(updatedSale, deductionItems);
        } else {
          await dbService.addSale(updatedSale);
        }

        actionPersisted = true;
        setSecurityModal({ show: false, action: 'restore', sale: null, password: '', error: '' });
        void dbService.addAuditLog({
          id: 'log-' + Date.now(),
          timestamp: new Date().toISOString(),
          username: currentUser?.username || 'Gestor',
          ipAddress: '127.0.0.1',
          action: 'Restauração de Venda (Autorizada)',
          status: 'Sucesso',
          details: `Factura ${sale.invoiceNumber} restaurada para o estado Pendente com palavra-passe de autorização.`
        });
        void runPostCommitTask({
          label: 'atualizar as faturas depois da restauração',
          task: () => loadData(false)
        });
        showToast(`Factura ${sale.invoiceNumber} restaurada para o estado Pendente com sucesso!`, 'success');
      }
    } catch (err: any) {
      console.error('[FaturasModule] Error in handleExecuteSecurityAction:', err);
      if (actionPersisted) {
        setSecurityModal({ show: false, action: 'cancel', sale: null, password: '', error: '' });
        showToast('A ação foi gravada com sucesso. Alguns dados visuais serão atualizados em seguida.', 'warning');
      } else {
        const errMsg = err?.message || 'Falha ao processar a operação.';
        setSecurityModal(prev => ({ ...prev, show: true, error: `Erro ao executar a ação de segurança: ${errMsg}` }));
      }
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

  // The period/status constraints now run in Firestore. Free-text matching is
  // intentionally applied to the currently loaded page; an export explicitly
  // fetches all matching pages so it is never limited to what is visible.
  const matchesInvoiceSearch = (sale: Sale, rawSearch = faturasSearch) => {
    const search = rawSearch.trim().toLowerCase();
    if (!search) return true;

    const matchInvoice = sale.invoiceNumber?.toLowerCase().includes(search);
    const matchCustomer = sale.customerName?.toLowerCase().includes(search);
    const matchOperator = sale.operatorName?.toLowerCase().includes(search) || sale.operatorId?.toLowerCase().includes(search);
    const matchPayment = sale.paymentMethod?.toLowerCase().includes(search);
    const matchNuit = sale.customerNuit?.toLowerCase().includes(search);
    const matchTotal = sale.total?.toString().includes(search);
    const matchItem = sale.items?.some(item => (item.name || (item as any).productName || '').toLowerCase().includes(search));

    return Boolean(matchInvoice || matchCustomer || matchOperator || matchPayment || matchNuit || matchTotal || matchItem);
  };

  const filteredSales = sales.filter(sale => {
    // These redundant guards avoid showing a stale previous page while the
    // server query for a newly selected period/status is in flight.
    if (!isDateInRange(sale.date, startDate, endDate)) return false;
    if (faturasFilter !== 'Todas' && sale.status !== faturasFilter) return false;
    return matchesInvoiceSearch(sale);
  });

  const sumByStatus = (status: Sale['status']) =>
    sales.filter(sale => sale.status === status).reduce((sum, sale) => sum + sale.total, 0);
  const countByStatus = (status: Sale['status']) => sales.filter(sale => sale.status === status).length;

  const pageSummary: SalesSummary = {
    totalInvoiced: sales.filter(isFinancialSale).reduce((sum, sale) => sum + sale.total, 0),
    paidInvoiced: sumByStatus('Paga'),
    pendingInvoiced: sumByStatus('Pendente'),
    creditInvoiced: sumByStatus('Crédito'),
    debtInvoiced: sumByStatus('Pendente') + sumByStatus('Crédito'),
    proformaInvoiced: sumByStatus('Proforma'),
    canceledInvoiced: sumByStatus('Cancelada'),
    totalCount: sales.length,
    paidCount: countByStatus('Paga'),
    pendingCount: countByStatus('Pendente'),
    creditCount: countByStatus('Crédito'),
    debtCount: countByStatus('Pendente') + countByStatus('Crédito'),
    proformaCount: countByStatus('Proforma'),
    canceledCount: countByStatus('Cancelada')
  };
  const periodSummary = salesSummary || pageSummary;

  // Preserve the former behaviour of the cards when a status tab is active,
  // but calculate from the server aggregate instead of only the current page.
  const totalInvoiced = faturasFilter === 'Todas'
    ? periodSummary.totalInvoiced
    : faturasFilter === 'Paga'
      ? periodSummary.paidInvoiced
      : faturasFilter === 'Pendente'
        ? periodSummary.pendingInvoiced
        : faturasFilter === 'Crédito'
          ? periodSummary.creditInvoiced
          : faturasFilter === 'Proforma'
            ? periodSummary.proformaInvoiced
            : 0;
  const paidInvoiced = faturasFilter === 'Todas' || faturasFilter === 'Paga' ? periodSummary.paidInvoiced : 0;
  const pendingInvoiced = faturasFilter === 'Todas' || faturasFilter === 'Pendente' ? periodSummary.pendingInvoiced : 0;
  // O cartão "Pendente (Crédito)" mostra a dívida real: Pendente + Crédito.
  const debtInvoiced = periodSummary.debtInvoiced;
  const canceledInvoiced = faturasFilter === 'Todas' || faturasFilter === 'Cancelada' ? periodSummary.canceledInvoiced : 0;
  const activeQueryCount = faturasFilter === 'Todas'
    ? periodSummary.totalCount
    : faturasFilter === 'Paga'
      ? periodSummary.paidCount
      : faturasFilter === 'Pendente'
        ? periodSummary.pendingCount
        : faturasFilter === 'Crédito'
          ? periodSummary.creditCount
          : faturasFilter === 'Proforma'
            ? periodSummary.proformaCount
            : periodSummary.canceledCount;

  const getSalesForExport = async () => {
    const allSales = await dbService.getSalesForPeriod(getCurrentSalesQuery());
    return allSales.filter(sale => matchesInvoiceSearch(sale));
  };

  const handleExportInvoicesExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const exportSales = await getSalesForExport();
      const data = exportSales.map(sale => ({
        'Nº Factura': sale.invoiceNumber,
        'Data': formatDatePT(sale.date),
        'Cliente': sale.customerName || 'Consumidor Final',
        'NUIT': sale.customerNuit || '999999999',
        'Operador': sale.operatorName || 'Caixa',
        'Método Pagamento': sale.paymentMethod,
        'Total (MT)': sale.total,
        'Estado': sale.status
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Facturas');
      XLSX.writeFile(wb, `Relatorio_Facturas_${startDate}_a_${endDate}.xlsx`);
      showToast(`Planilha de Facturas exportada com ${exportSales.length} registo(s).`);
    } catch (error) {
      console.error('[FaturasModule] Invoice Excel export failed:', error);
      showToast('Não foi possível exportar a planilha de facturas.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportInvoicesPDF = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const exportSales = await getSalesForExport();
      const exportTotal = exportSales
        .filter(sale => sale.status !== 'Cancelada')
        .reduce((sum, sale) => sum + sale.total, 0);
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const cName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';
      const nuit = settings?.companyNuit || '401976590';

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(0, 106, 78);
      doc.text('MAPA RESUMO DE FACTURAÇÃO', 15, 20);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`${cName} • NUIT: ${nuit}`, 15, 25);
      doc.text(`Período: ${formatDatePT(startDate)} até ${formatDatePT(endDate)} • Total Facturado: ${exportTotal.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT`, 15, 29);

      doc.setDrawColor(0, 106, 78);
      doc.line(15, 33, 195, 33);

      let y = 43;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('Nº FACTURA', 15, y);
      doc.text('DATA', 45, y);
      doc.text('CLIENTE', 75, y);
      doc.text('MÉTODO', 130, y);
      doc.text('TOTAL (MT)', 160, y);
      doc.text('ESTADO', 185, y);

      y += 6;
      doc.setFont('helvetica', 'normal');
      exportSales.forEach(sale => {
        if (y > 275) { doc.addPage(); y = 20; }
        doc.text(sale.invoiceNumber || '', 15, y);
        doc.text(formatDatePT(sale.date), 45, y);
        doc.text((sale.customerName || 'Consumidor Final').substring(0, 25), 75, y);
        doc.text((sale.paymentMethod || '').substring(0, 12), 130, y);
        doc.text(sale.total.toLocaleString('pt-PT', { minimumFractionDigits: 2 }), 160, y);
        doc.text(sale.status || '', 185, y);
        y += 6;
      });

      doc.save(`Mapa_Facturacao_${startDate}_a_${endDate}.pdf`);
      showToast(`Mapa de Facturação descarregado com ${exportSales.length} registo(s).`);
    } catch (error) {
      console.error('[FaturasModule] Invoice PDF export failed:', error);
      showToast('Não foi possível exportar o mapa de facturação.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6" id="faturas_module_container">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className={`fixed bottom-6 right-6 z-50 p-4 rounded-xl shadow-2xl flex items-center gap-3 border transition-all animate-bounce ${
          toastType === 'success'
            ? 'bg-emerald-600 text-white border-emerald-700'
            : toastType === 'warning'
              ? 'bg-amber-500 text-slate-950 border-amber-600'
              : 'bg-red-600 text-white border-red-700'
        }`}>
          <span className="material-symbols-outlined">
            {toastType === 'success' ? 'check_circle' : toastType === 'warning' ? 'info' : 'warning'}
          </span>
          <span className="text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Module Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
          <span className="material-symbols-outlined text-emerald-600">receipt_long</span>
          Gestão de Facturas
        </h2>
      </div>

      {/* Date Range Filter */}
      <DateRangeFilter
        startDate={startDate}
        endDate={endDate}
        preset={datePreset}
        onRangeChange={(start, end, preset) => {
          setStartDate(start);
          setEndDate(end);
          setDatePreset(preset);
        }}
        onExportPDF={handleExportInvoicesPDF}
        onExportExcel={handleExportInvoicesExcel}
      />

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
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Em dívida (Pendente + Crédito)</p>
            <p className="text-lg font-black text-amber-700 truncate font-mono mt-0.5">
              {debtInvoiced.toLocaleString()} MT
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
            {(['Todas', 'Pendente', 'Crédito', 'Paga', 'Proforma', 'Cancelada'] as const).map(tab => {
              const count = tab === 'Todas'
                ? periodSummary.totalCount
                : tab === 'Paga'
                  ? periodSummary.paidCount
                  : tab === 'Pendente'
                    ? periodSummary.pendingCount
                    : tab === 'Crédito'
                      ? periodSummary.creditCount
                      : tab === 'Proforma'
                        ? periodSummary.proformaCount
                        : periodSummary.canceledCount;
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
                  {tab === 'Todas' ? 'Todas' : tab === 'Pendente' ? 'Pendentes' : tab === 'Crédito' ? 'A Crédito' : tab === 'Paga' ? 'Pagas' : tab === 'Proforma' ? 'Proformas' : 'Canceladas'} ({count})
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

        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
          <span>
            {isLoadingSales
              ? 'A atualizar facturas…'
              : `${sales.length} de ${activeQueryCount} factura(s) carregada(s) para esta consulta.`}
          </span>
          {(faturasSearch.trim() || isExporting) && (
            <span className="font-semibold text-amber-700">
              {isExporting ? 'A preparar exportação completa do período…' : 'A pesquisa textual filtra as facturas já carregadas; a exportação pesquisa o período inteiro.'}
            </span>
          )}
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
                              : sale.status === 'Crédito'
                                ? 'bg-orange-50 text-orange-700 border-orange-150'
                                : sale.status === 'Proforma'
                                  ? 'bg-slate-100 text-slate-600 border-slate-200'
                                  : 'bg-rose-50 text-rose-700 border-rose-150'
                        }`}>
                          {saleStatusLabel(sale)}
                        </span>
                      </td>

                      {/* Operations */}
                      <td className="p-2 text-right">
                        <div className="flex justify-end gap-1 flex-wrap">
                          {/* Liquidate payment buttons */}
                          {(sale.status === 'Pendente' || sale.status === 'Crédito') && (
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

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
          <p className="text-[10px] text-slate-400 text-center sm:text-left">
            A lista é carregada por páginas de 30 facturas. Os totais e contagens acima referem-se ao período completo.
          </p>
          {hasMoreSales && (
            <button
              type="button"
              onClick={() => void loadMoreSales()}
              disabled={isLoadingSales}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 disabled:cursor-wait border border-emerald-200 text-emerald-800 rounded-lg text-xs font-black transition-colors"
            >
              <span className={`material-symbols-outlined text-[16px] ${isLoadingSales ? 'animate-spin' : ''}`}>expand_more</span>
              {isLoadingSales ? 'A carregar…' : 'Carregar mais facturas'}
            </button>
          )}
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
                                      <span className="font-bold font-mono">{invoiceToPrint.includeIva ? `${(invoiceToPrint.ivaAmount ?? ((invoiceToPrint.subtotal - invoiceToPrint.discount) * 0.16)).toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT` : 'Sem IVA'}</span>
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
                                    Recibo Nº: {invoiceToPrint.receiptNumber || 'S/N (não liquidado)'}
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
                                <span>Recibo Nº: {invoiceToPrint.receiptNumber || 'S/N (não liquidado)'}</span>
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
                        <span>IVA (16%):</span>
                        <span className="font-mono">{(invoiceToPrint.ivaAmount ?? ((invoiceToPrint.subtotal - invoiceToPrint.discount) * 0.16)).toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
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
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden border border-gray-200">
            <div className={`p-3.5 text-white font-bold flex justify-between items-center ${
              securityModal.action === 'cancel' ? 'bg-gradient-to-r from-red-600 to-red-700' : 'bg-gradient-to-r from-blue-600 to-blue-700'
            }`}>
              <span className="flex items-center gap-2 text-sm">
                <span className="material-symbols-outlined text-[18px]">gpp_maybe</span>
                {securityModal.action === 'cancel' ? 'Anular Venda' : 'Restaurar Venda'}
              </span>
              <button onClick={() => setSecurityModal({ show: false, action: 'cancel', sale: null, password: '', error: '' })} className="text-white hover:opacity-80 cursor-pointer">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            
            <div className="p-4 space-y-3 text-xs">
              <div className={`p-2.5 rounded-lg border text-center ${
                securityModal.action === 'cancel' ? 'bg-red-50 border-red-200 text-red-900' : 'bg-blue-50 border-blue-200 text-blue-900'
              }`}>
                <p className="font-bold text-xs">
                  {securityModal.sale.invoiceNumber} • {securityModal.sale.customerName || 'Cliente Geral'}
                </p>
                <p className="text-[11px] font-semibold text-slate-600 mt-0.5">
                  Valor: <strong className="font-bold text-slate-800">{securityModal.sale.total.toLocaleString()} MT</strong>
                </p>
                {securityModal.action === 'cancel' && (
                  <p className="text-[10px] text-red-700 mt-1">
                    O stock será estornado de volta ao inventário.
                  </p>
                )}
              </div>

              {securityModal.error && (
                <div className="p-2 bg-rose-50 text-rose-700 border border-rose-200 rounded font-bold text-center text-[11px]">
                  {securityModal.error}
                </div>
              )}

              <div className="space-y-1">
                <label className="block text-[10px] font-black uppercase text-gray-500">
                  Senha de Autorização
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
                    placeholder="Código de Gestor / Técnico"
                    value={securityModal.password}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSecurityModal(prev => ({ ...prev, password: val, error: '' }));
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-center font-bold text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                  />
                </form>
              </div>

              <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setSecurityModal({ show: false, action: 'cancel', sale: null, password: '', error: '' })}
                  className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold transition-all cursor-pointer text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleExecuteSecurityAction}
                  className={`px-3.5 py-1.5 text-white rounded-lg font-bold transition-all shadow-sm cursor-pointer text-xs ${
                    securityModal.action === 'cancel' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {securityModal.action === 'cancel' ? 'Confirmar Anulação' : 'Confirmar Restauração'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
