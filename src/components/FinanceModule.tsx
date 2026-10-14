import React, { useState, useEffect, useRef } from 'react';
import { dbService } from '../utils/firebaseDB';
import Toast from './Toast';
import { getUnitCost, getBaseUnitQuantity } from '../utils/priceHelper';
import { Sale, LossRecord, Product, AuditLog, SystemSettings, ProductTransformation, PayrollPayment } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { exportToPDF, exportToExcel, ReportData } from '../utils/reportExporter';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { DateRangeFilter } from './DateRangeFilter';
import { DateRangePreset, getDateRangeFromPreset, isDateInRange, formatDatePT } from '../utils/dateRangeHelper';
import { REPORT_CATEGORIES, matchCategory } from '../utils/categoryHelper';
import { filterSalesForReport, loadFinanceData, FinanceData, FinanceReportPeriod } from '../utils/financeData';

const FINANCE_SECTION_LABELS: Record<keyof FinanceData, string> = {
  sales: 'vendas', losses: 'perdas', products: 'produtos', auditLogs: 'auditoria',
  settings: 'definições', transformations: 'transformações', payrollPayments: 'salários'
};

export default function FinanceModule() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [losses, setLosses] = useState<LossRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [transformations, setTransformations] = useState<ProductTransformation[]>([]);
  const [payrollPayments, setPayrollPayments] = useState<PayrollPayment[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [isLoadingSales, setIsLoadingSales] = useState(true);
  const [hasLoadedSales, setHasLoadedSales] = useState(false);
  const [loadFailures, setLoadFailures] = useState<(keyof FinanceData)[]>([]);
  const loadRequestRef = useRef(0);

  // Start with the full ledger: retroactive/historic sales may not fall in the current month.
  const defaultRange = getDateRangeFromPreset('Todo o Histórico');
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [datePreset, setDatePreset] = useState<DateRangePreset>('Todo o Histórico');
  
  // Sub-tabs in Accounting & Finance
  const [activeSubTab, setActiveSubTab] = useState<'dashboard' | 'reports' | 'ledger' | 'transformacoes' | 'alerts' | 'auditoria'>('dashboard');
  
  // POS Reports Compilation States
  const [reportPeriod, setReportPeriod] = useState<FinanceReportPeriod>('Todo o Histórico');
  const [compiledPeriod, setCompiledPeriod] = useState<FinanceReportPeriod>('Todo o Histórico');

  useEffect(() => {
    void loadFinancials();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handleDbUpdate = (e: any) => {
      const updatedTable = e.detail?.table;
      if (
        !updatedTable ||
        updatedTable === 'all' ||
        updatedTable === 'sales' ||
        updatedTable === 'losses' ||
        updatedTable === 'products' ||
        updatedTable === 'audit_logs' ||
        updatedTable === 'settings' ||
        updatedTable === 'transformations' ||
        updatedTable === 'payroll_payments'
      ) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          void loadFinancials();
        }, 150);
      }
    };
    window.addEventListener('db-update', handleDbUpdate);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('db-update', handleDbUpdate);
      loadRequestRef.current++; // ignore reads that finish after unmount
    };
  }, []);

  const loadFinancials = async () => {
    const request = ++loadRequestRef.current;
    setIsLoadingSales(true);
    setLoadFailures([]);
    try {
      // Paginated direct read surfaces Firestore errors (the generic getSales
      // cache returns [] on failure). Each section updates as soon as it arrives.
      const failures = await loadFinanceData(dbService, part => {
        if (request !== loadRequestRef.current) return;
        if (part.sales) {
          setSales(part.sales);
          setHasLoadedSales(true);
          setIsLoadingSales(false);
        }
        if (part.losses) setLosses(part.losses);
        if (part.products) setProducts(part.products);
        if (part.auditLogs) setAuditLogs(part.auditLogs);
        if (part.settings) setSettings(part.settings);
        if (part.transformations) setTransformations(part.transformations);
        if (part.payrollPayments) setPayrollPayments(part.payrollPayments);
      }, failedSection => {
        if (request !== loadRequestRef.current) return;
        setLoadFailures(previous => previous.includes(failedSection) ? previous : [...previous, failedSection]);
        if (failedSection === 'sales') setIsLoadingSales(false);
      });
      if (request === loadRequestRef.current) {
        setLoadFailures(failures);
        setIsLoadingSales(false);
      }
    } catch (error) {
      console.error('[Finance] Erro ao iniciar a leitura:', error);
      if (request === loadRequestRef.current) {
        setLoadFailures(['sales']);
        setIsLoadingSales(false);
      }
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // 1. Math formulas for calculations based on active Date Range (Parte 5 & Parte 7)
  const filteredSales = sales.filter(s => s.status !== 'Cancelada' && isDateInRange(s.date, startDate, endDate));
  const filteredLosses = losses.filter(l => isDateInRange(l.date, startDate, endDate));
  const filteredTransformations = transformations.filter(t => t.status !== 'Cancelada' && isDateInRange(t.date || t.createdAt, startDate, endDate));
  const filteredPayroll = payrollPayments.filter(p => isDateInRange(p.paymentDate || (p.month + '-01'), startDate, endDate));

  const totalGrossSales = filteredSales.reduce((acc, s) => acc + s.total, 0);
  const totalLossesVal = filteredLosses.reduce((acc, l) => acc + l.costValue, 0);
  const totalPayrollVal = filteredPayroll.reduce((acc, p) => acc + p.finalNetWage, 0);

  // Calculate actual buying cost using permanent snapshot costPrice on sale items (Parte 3 - 3.1.3)
  const totalCost = filteredSales.reduce((acc, sale) => {
    return acc + (sale.items || []).reduce((sum, item) => {
      const prod = products.find(p => p.id === item.productId);
      const buyPrice = item.costPrice ?? item.buyingPrice ?? (prod ? getUnitCost(prod, item.sellingUnit) : undefined) ?? (item.unitPrice * 0.6);
      return sum + (buyPrice * item.quantity);
    }, 0);
  }, 0);

  const totalProfit = Math.max(0, totalGrossSales - totalCost);
  const netCommercialMargin = Math.max(0, totalGrossSales - totalCost - totalLossesVal - totalPayrollVal);
  const stockAlerts = products.filter(p => p.stockQty <= 10);
  const avgTicket = filteredSales.length > 0 ? (totalGrossSales / filteredSales.length) : 0;
  const pendingSyncCount = filteredSales.filter(s => !s.synced).length;

  // Transformation Accounting Totals (Parte 4 - 4.4)
  const trfOriginalCost = filteredTransformations.reduce((sum, t) => sum + t.originalTotalCost, 0);
  const trfResultingCost = filteredTransformations.reduce((sum, t) => sum + (t.items || []).reduce((s, it) => s + (it.quantity * it.calculatedUnitCost), 0), 0);
  const trfLossesVal = filteredTransformations.reduce((sum, t) => sum + t.lossValue, 0);

  // Actual sales for the latest six months with transactions (never fabricated values).
  const latestSaleTime = filteredSales.reduce((latest, sale) => {
    const time = new Date(sale.date).getTime();
    return Number.isFinite(time) ? Math.max(latest, time) : latest;
  }, 0);
  const chartEnd = latestSaleTime ? new Date(latestSaleTime) : new Date();
  const monthlySales = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(chartEnd.getFullYear(), chartEnd.getMonth() - 5 + index, 1);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return {
      key: monthKey,
      month: date.toLocaleDateString('pt-MZ', { month: 'short', year: '2-digit' }),
      amount: filteredSales.filter(s => s.date?.startsWith(monthKey)).reduce((sum, s) => sum + s.total, 0)
    };
  });

  const maxMonthlyAmount = Math.max(1, ...monthlySales.map(month => month.amount));
  const getFilteredSalesForReport = (period: FinanceReportPeriod) => filterSalesForReport(filteredSales, period);

  const reportSales = getFilteredSalesForReport(compiledPeriod);
  const reportGrossSales = reportSales.reduce((acc, s) => acc + s.total, 0);
  const reportCost = reportSales.reduce((acc, sale) => {
    return acc + (sale.items || []).reduce((sum, item) => {
      const prod = products.find(p => p.id === item.productId);
      const buyPrice = item.costPrice ?? item.buyingPrice ?? (prod ? getUnitCost(prod, item.sellingUnit) : undefined) ?? (item.unitPrice * 0.6);
      return sum + (buyPrice * item.quantity);
    }, 0);
  }, 0);
  const reportProfit = Math.max(0, reportGrossSales - reportCost);
  const reportTransCount = reportSales.length;
  const reportMargin = reportGrossSales > 0 ? ((reportProfit / reportGrossSales) * 100) : 0;

  const handleCompileReport = () => {
    setCompiledPeriod(reportPeriod);
    showToast(`Relatório do POS compilado para o período: ${reportPeriod}!`);
  };

  const handleExportFinanceDashboardExcel = () => {
    const workbook = XLSX.utils.book_new();
    
    // Sheet 1: POS Overview
    const summaryData = [
      { Métrica: 'Período do Relatório', Valor: compiledPeriod },
      { Métrica: 'Faturação Bruta', Valor: `${reportGrossSales.toLocaleString()} MT` },
      { Métrica: 'Lucro Estimado', Valor: `${reportProfit.toLocaleString()} MT` },
      { Métrica: 'Total de Transações', Valor: reportTransCount },
      { Métrica: 'Margem Operacional', Valor: `${reportMargin.toFixed(1)}%` },
      { Métrica: 'Data de Emissão', Valor: new Date().toLocaleString('pt-MZ') }
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, wsSummary, 'Resumo Executivo');

    // Sheet 2: Product Performance
    const productData = products.map(p => {
      const soldQty = reportSales.reduce((sum, sale) => {
        const item = (sale.items || []).find(it => it.productId === p.id);
        return sum + (item ? getBaseUnitQuantity(p, item.quantity, item.sellingUnit) : 0);
      }, 0);
      return {
        'Produto/Serviço': p.name,
        'Categoria': p.category,
        'Stock Atual': p.stockQty,
        'Preço Compra': p.buyingPrice,
        'Preço Venda': p.sellingPrice,
        'Quantidade Vendida': soldQty,
        'Total Faturado (MT)': soldQty * p.sellingPrice,
        'Lucro Estimado (MT)': soldQty * (p.sellingPrice - p.buyingPrice)
      };
    });
    const wsProducts = XLSX.utils.json_to_sheet(productData);
    XLSX.utils.book_append_sheet(workbook, wsProducts, 'Vendas por Produto');

    // Sheet 3: Category Analysis
    const categoryData = REPORT_CATEGORIES.map(cat => {
      const totalAmt = reportSales.reduce((sum, sale) => {
        return sum + (sale.items || []).reduce((itemSum, item) => {
          const p = products.find(prod => prod.id === item.productId);
          const pCat = item.category || p?.category || 'Outro';
          if (matchCategory(pCat, cat.key)) {
            return itemSum + (item.unitPrice * item.quantity);
          }
          return itemSum;
        }, 0);
      }, 0);
      return {
        'Categoria': cat.label,
        'Faturação Total (MT)': totalAmt
      };
    });
    const wsCategories = XLSX.utils.json_to_sheet(categoryData);
    XLSX.utils.book_append_sheet(workbook, wsCategories, 'Faturação por Categoria');

    XLSX.writeFile(workbook, `Dashboard_Financeiro_AgroXicomo_${compiledPeriod}_${Date.now()}.xlsx`);
    showToast('Dashboard Financeiro Excel Descarregado!');
  };

  const handleExportReportCSV = () => {
    let csv = `RELATORIO_POS_PERIODO_${compiledPeriod.toUpperCase()}\n`;
    csv += `Faturacao Bruta,Lucro Estimado,Transacoes Feitas,Margem Operacional\n`;
    csv += `${reportGrossSales},${reportProfit},${reportTransCount},${reportMargin.toFixed(1)}%\n\n`;

    const salesForPeriod = reportSales;
    const totalMpesa = salesForPeriod.filter(s => s.paymentMethod.toLowerCase().includes('m-pesa') || s.paymentMethod.toLowerCase().includes('mpesa')).reduce((acc, s) => acc + s.total, 0);
    const totalEmola = salesForPeriod.filter(s => s.paymentMethod.toLowerCase().includes('e-mola') || s.paymentMethod.toLowerCase().includes('emola')).reduce((acc, s) => acc + s.total, 0);
    const totalBank = salesForPeriod.filter(s => s.paymentMethod.toLowerCase().includes('transfer') || s.paymentMethod.toLowerCase().includes('banco') || s.paymentMethod.toLowerCase().includes('iban')).reduce((acc, s) => acc + s.total, 0);
    const totalCash = salesForPeriod.filter(s => s.paymentMethod.toLowerCase().includes('num') || s.paymentMethod.toLowerCase().includes('dinheiro') || s.paymentMethod.toLowerCase().includes('caixa') || s.paymentMethod.toLowerCase() === 'dinheiro' || s.paymentMethod.toLowerCase() === 'numerário').reduce((acc, s) => acc + s.total, 0);

    csv += `DETALHAMENTO DE MEIOS DE PAGAMENTO\n`;
    csv += `M-Pesa,E-Mola,Transferencia Bancaria,Numerario (Dinheiro Vivo)\n`;
    csv += `${totalMpesa},${totalEmola},${totalBank},${totalCash}\n\n`;
    
    csv += `DESEMPENHO INDIVIDUAL DE PRODUTOS\n`;
    csv += `PRODUTO/SERVICO,STOCK ANTERIOR,PRECO COMPRA,PRECO VENDA,VENDIDO,FATURADO,LUCRO EST.\n`;
    products.forEach(p => {
      const soldQty = reportSales.reduce((sum, sale) => {
        const item = (sale.items || []).find(it => it.productId === p.id);
        return sum + (item ? item.quantity : 0);
      }, 0);
      const stockAnterior = p.stockQty + soldQty;
      csv += `"${p.name}",${stockAnterior},${p.buyingPrice},${p.sellingPrice},${soldQty},${soldQty * p.sellingPrice},${soldQty * (p.sellingPrice - p.buyingPrice)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Relatorio_POS_AgroXicomo_${compiledPeriod}_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Planilha CSV de Relatório Periódico Descarregada!');
  };

  const handleExportFinancePDF = () => {
    handleExportReportPDF();
  };

  const handleExportReportPDF = () => {
    const title = `Relatorio_Oficial_POS_AgroXicomo_${compiledPeriod}_${Date.now()}.pdf`;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const cName = settings?.companyName || 'AGRO - XICOMO & SERVI\u00c7OS, LDA';
    const nuit = settings?.companyNuit || '401976590';

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(0, 106, 78);
    doc.text('RELATÓRIO OFICIAL PERIÓDICO DO POS', 15, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`${cName} • NUIT: ${nuit}`, 15, 25);
    doc.text(`Período do Relatório: ${compiledPeriod} • Gerado em: ${new Date().toLocaleString('pt-MZ')}`, 15, 29);

    doc.setDrawColor(0, 106, 78);
    doc.setLineWidth(1);
    doc.line(15, 33, 195, 33);

    // Summary Box
    doc.saveGraphicsState();
    doc.setFillColor(240, 253, 244);
    doc.rect(15, 37, 180, 20, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('FATURAÇÃO BRUTA', 20, 43);
    doc.text('LUCRO ESTIMADO', 65, 43);
    doc.text('TRANSAÇÕES', 115, 43);
    doc.text('MARGEM OPERACIONAL', 155, 43);

    doc.setFontSize(11);
    doc.setTextColor(0, 106, 78);
    doc.text(`${reportGrossSales.toLocaleString('pt-MZ')} MT`, 20, 51);
    doc.setTextColor(30, 58, 138);
    doc.text(`${reportProfit.toLocaleString('pt-MZ')} MT`, 65, 51);
    doc.setTextColor(51, 65, 85);
    doc.text(`${reportTransCount} Vendas`, 115, 51);
    doc.setTextColor(180, 83, 9);
    doc.text(`${reportMargin.toFixed(1)}%`, 155, 51);

    // Table: Product Performance
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 106, 78);
    doc.text('DESEMPENHO DE VENDAS POR PRODUTO / SERVIÇO', 15, 65);

    let currentY = 70;
    doc.saveGraphicsState();
    doc.setFillColor(0, 106, 78);
    doc.rect(15, currentY, 180, 7, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('#', 17, currentY + 5);
    doc.text('PRODUTO / SERVIÇO', 23, currentY + 5);
    doc.text('STOCK ANT.', 88, currentY + 5, { align: 'right' });
    doc.text('P. COMPRA', 108, currentY + 5, { align: 'right' });
    doc.text('P. VENDA', 128, currentY + 5, { align: 'right' });
    doc.text('VENDIDO', 148, currentY + 5, { align: 'right' });
    doc.text('FATURADO', 172, currentY + 5, { align: 'right' });
    doc.text('LUCRO', 193, currentY + 5, { align: 'right' });

    currentY += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);

    products.forEach((p, idx) => {
      const soldQty = reportSales.reduce((sum, sale) => {
        const item = (sale.items || []).find(it => it.productId === p.id);
        return sum + (item ? item.quantity : 0);
      }, 0);
      const stockAnterior = p.stockQty + soldQty;
      const faturado = soldQty * p.sellingPrice;
      const lucro = soldQty * (p.sellingPrice - p.buyingPrice);

      if (currentY > 265) {
        doc.addPage();
        currentY = 20;
        // Repeat table header
        doc.saveGraphicsState();
        doc.setFillColor(0, 106, 78);
        doc.rect(15, currentY, 180, 7, 'F');
        doc.restoreGraphicsState();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(255, 255, 255);
        doc.text('#', 17, currentY + 5);
        doc.text('PRODUTO / SERVIÇO', 23, currentY + 5);
        doc.text('STOCK ANT.', 88, currentY + 5, { align: 'right' });
        doc.text('P. COMPRA', 108, currentY + 5, { align: 'right' });
        doc.text('P. VENDA', 128, currentY + 5, { align: 'right' });
        doc.text('VENDIDO', 148, currentY + 5, { align: 'right' });
        doc.text('FATURADO', 172, currentY + 5, { align: 'right' });
        doc.text('LUCRO', 193, currentY + 5, { align: 'right' });
        currentY += 7;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(51, 65, 85);
      }

      if (idx % 2 === 1) {
        doc.saveGraphicsState();
        doc.setFillColor(248, 250, 252);
        doc.rect(15, currentY, 180, 6, 'F');
        doc.restoreGraphicsState();
      }

      doc.text((idx + 1).toString(), 17, currentY + 4);
      doc.text(p.name.length > 32 ? p.name.substring(0, 30) + '...' : p.name, 23, currentY + 4);
      doc.text(`${stockAnterior} ${p.baseUnit}`, 88, currentY + 4, { align: 'right' });
      doc.text(`${p.buyingPrice.toLocaleString('pt-MZ')} MT`, 108, currentY + 4, { align: 'right' });
      doc.text(`${p.sellingPrice.toLocaleString('pt-MZ')} MT`, 128, currentY + 4, { align: 'right' });
      doc.text(`${soldQty} ${p.baseUnit}`, 148, currentY + 4, { align: 'right' });
      doc.text(`${faturado.toLocaleString('pt-MZ')} MT`, 172, currentY + 4, { align: 'right' });
      doc.text(`${lucro.toLocaleString('pt-MZ')} MT`, 193, currentY + 4, { align: 'right' });

      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.5);
      doc.line(15, currentY + 6, 195, currentY + 6);

      currentY += 6;
    });

    // Categories Table
    if (currentY > 220) {
      doc.addPage();
      currentY = 20;
    } else {
      currentY += 10;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 106, 78);
    doc.text('FATURAÇÃO POR CATEGORIA', 15, currentY);

    currentY += 5;
    doc.saveGraphicsState();
    doc.setFillColor(0, 106, 78);
    doc.rect(15, currentY, 180, 7, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('CATEGORIA', 17, currentY + 5);
    doc.text('FATURADO', 193, currentY + 5, { align: 'right' });

    currentY += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);

    const categories = REPORT_CATEGORIES;
    let totalCatAmt = 0;
    categories.forEach((cat, idx) => {
      const totalAmt = reportSales.reduce((sum, sale) => {
        return sum + (sale.items || []).reduce((itemSum, item) => {
          const p = products.find(prod => prod.id === item.productId);
          const pCat = item.category || p?.category || 'Outro';
          if (matchCategory(pCat, cat.key)) {
            return itemSum + (item.unitPrice * item.quantity);
          }
          return itemSum;
        }, 0);
      }, 0);
      totalCatAmt += totalAmt;

      if (idx % 2 === 1) {
        doc.saveGraphicsState();
        doc.setFillColor(248, 250, 252);
        doc.rect(15, currentY, 180, 6, 'F');
        doc.restoreGraphicsState();
      }

      doc.setFont('helvetica', 'bold');
      doc.text(cat.label, 17, currentY + 4);
      doc.setFont('helvetica', 'normal');
      doc.text(`${totalAmt.toLocaleString('pt-MZ')} MT`, 193, currentY + 4, { align: 'right' });

      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.5);
      doc.line(15, currentY + 6, 195, currentY + 6);
      currentY += 6;
    });

    // Add Signature Lines and Footer Note
    if (currentY > 230) {
      doc.addPage();
      currentY = 20;
    } else {
      currentY += 15;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Assinatura do Responsável de Contabilidade', 50, currentY + 15, { align: 'center' });
    doc.line(20, currentY + 10, 80, currentY + 10);

    doc.text('Assinatura da Direção Financeira', 150, currentY + 15, { align: 'center' });
    doc.line(120, currentY + 10, 180, currentY + 10);

    doc.save(title);
    showToast('Relatório Oficial de Período PDF Descarregado!');
  };

  const handleExportBalancetePDF = async () => {
    const totalCOGS = reportCost; // CMV
    const totalQuebras = reportSales.length > 0 ? (totalLossesVal * (reportSales.length / Math.max(sales.length, 1))) : 0;
    const activeProductsVal = products.reduce((acc, p) => acc + (p.stockQty * p.buyingPrice), 0);

    const accounts = [
      { code: '1.1.1.01', name: 'Caixa Geral (Dinheiro em POS)', debit: reportGrossSales * 0.4, credit: totalCOGS * 0.2 },
      { code: '1.1.2.01', name: 'Bancos Moçambique C/C', debit: reportGrossSales * 0.6, credit: totalCOGS * 0.8 + totalQuebras },
      { code: '1.2.1.01', name: 'Inventário de Mercadorias (Stock)', debit: activeProductsVal, credit: totalCOGS },
      { code: '2.1.1.01', name: 'Fornecedores de Insumos', debit: 0, credit: activeProductsVal * 0.5 },
      { code: '5.1.1.01', name: 'Capital Social Registado', debit: 0, credit: activeProductsVal * 0.5 },
      { code: '6.1.1.01', name: 'Custo das Mercadorias Vendidas (CMV)', debit: totalCOGS, credit: 0 },
      { code: '6.2.1.01', name: 'Perdas por Quebras e Reclamações', debit: totalQuebras, credit: 0 },
      { code: '7.1.1.01', name: 'Proveitos / Vendas de Insumos', debit: 0, credit: reportGrossSales }
    ];

    const data: ReportData = {
      title: 'Balancete de Verificação Comercial',
      subtitle: `Período Fiscal: ${compiledPeriod}`,
      fileName: `Balancete_${compiledPeriod}_${Date.now()}`,
      columns: [
        { header: 'Código', dataKey: 'code' },
        { header: 'Conta Razão', dataKey: 'name' },
        { header: 'Débito (MT)', dataKey: 'debit' },
        { header: 'Crédito (MT)', dataKey: 'credit' },
        { header: 'Saldo Líquido', dataKey: 'balance' }
      ],
      rows: accounts.map(acc => ({
        ...acc,
        debit: acc.debit.toLocaleString(),
        credit: acc.credit.toLocaleString(),
        balance: (acc.debit - acc.credit).toLocaleString()
      }))
    };

    await exportToPDF(data, settings);
    showToast('Balancete PDF descarregado!');
  };

  // --- REPORT EXPORT ENGINE ---
  const handleExportCSVLedger = () => {
    const data: ReportData = {
      title: 'Livro de Vendas (Ledger)',
      fileName: `Vendas_Excel_${Date.now()}`,
      columns: [
        { header: 'Fatura Nº', dataKey: 'invoiceNumber' },
        { header: 'Data', dataKey: 'date' },
        { header: 'Cliente', dataKey: 'customerName' },
        { header: 'Subtotal (MT)', dataKey: 'subtotal' },
        { header: 'Desconto (MT)', dataKey: 'discount' },
        { header: 'Total (MT)', dataKey: 'total' },
        { header: 'Método Pagamento', dataKey: 'paymentMethod' }
      ],
      rows: sales.map(s => ({
        ...s,
        date: new Date(s.date).toLocaleDateString(),
        subtotal: s.subtotal.toLocaleString(),
        discount: s.discount.toLocaleString(),
        total: s.total.toLocaleString()
      }))
    };
    exportToExcel(data);
    showToast('Excel Ledger descarregado!');
  };

  const handleExportPDFLedger = async () => {
    const data: ReportData = {
      title: 'Livro de Vendas Detalhado (Ledger)',
      subtitle: `Total Transações: ${sales.length}`,
      fileName: `Vendas_PDF_${Date.now()}`,
      columns: [
        { header: 'Fatura Nº', dataKey: 'invoiceNumber' },
        { header: 'Data', dataKey: 'date' },
        { header: 'Cliente', dataKey: 'customerName' },
        { header: 'Método', dataKey: 'paymentMethod' },
        { header: 'Total (MT)', dataKey: 'total' }
      ],
      rows: sales.map(s => ({
        ...s,
        date: new Date(s.date).toLocaleDateString(),
        total: s.total.toLocaleString()
      }))
    };
    await exportToPDF(data, settings);
    showToast('Relatório de Vendas PDF descarregado!');
  };

  const handleExportAuditPDF = async () => {
    // A clicked export is intentionally complete, even though the preview list
    // is paginated to protect normal Finance-module loading.
    const reportLogs = await dbService.getAuditLogsForPeriod();
    const title = `Relatorio_Auditoria_Seguranca_ERP_${Date.now()}.pdf`;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(185, 28, 28);
    doc.text('RELATÓRIO DE AUDITORIA DE CIBERSEGURANÇA', 15, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('AGRO - XICOMO & SERVIÇOS, LDA • NUIT: 401976590', 15, 25);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-MZ')}`, 15, 29);

    doc.setDrawColor(185, 28, 28);
    doc.setLineWidth(1);
    doc.line(15, 33, 195, 33);

    // Summary Box
    doc.saveGraphicsState();
    doc.setFillColor(254, 242, 242);
    doc.rect(15, 37, 180, 20, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('REGISTOS TOTAIS', 20, 43);
    doc.text('TENTATIVAS FALHADAS', 75, 43);
    doc.text('ESTADO DE INTEGRIDADE', 135, 43);

    doc.setFontSize(11);
    doc.setTextColor(185, 28, 28);
    doc.text(`${reportLogs.length} Registos`, 20, 51);
    doc.text(`${reportLogs.filter(l => l.status === 'Falha').length}`, 75, 51);
    doc.setTextColor(5, 150, 105);
    doc.text('HASH IMUTÁVEL ATIVO', 135, 51);

    // Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(185, 28, 28);
    doc.text('REGISTOS GERAIS DE AUDITORIA', 15, 65);

    let currentY = 70;
    doc.saveGraphicsState();
    doc.setFillColor(185, 28, 28);
    doc.rect(15, currentY, 180, 7, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('#', 17, currentY + 5);
    doc.text('DATA/HORA', 23, currentY + 5);
    doc.text('UTILIZADOR', 60, currentY + 5);
    doc.text('IP ADDRESS', 90, currentY + 5);
    doc.text('OPERAÇÃO', 115, currentY + 5);
    doc.text('ESTADO', 155, currentY + 5);
    doc.text('DETALHES', 170, currentY + 5);

    currentY += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);

    reportLogs.forEach((l, idx) => {
      if (currentY > 265) {
        doc.addPage();
        currentY = 20;
        // Header
        doc.saveGraphicsState();
        doc.setFillColor(185, 28, 28);
        doc.rect(15, currentY, 180, 7, 'F');
        doc.restoreGraphicsState();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(255, 255, 255);
        doc.text('#', 17, currentY + 5);
        doc.text('DATA/HORA', 23, currentY + 5);
        doc.text('UTILIZADOR', 60, currentY + 5);
        doc.text('IP ADDRESS', 90, currentY + 5);
        doc.text('OPERAÇÃO', 115, currentY + 5);
        doc.text('ESTADO', 155, currentY + 5);
        doc.text('DETALHES', 170, currentY + 5);
        currentY += 7;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(51, 65, 85);
      }

      if (idx % 2 === 1) {
        doc.saveGraphicsState();
        doc.setFillColor(248, 250, 252);
        doc.rect(15, currentY, 180, 6, 'F');
        doc.restoreGraphicsState();
      }

      doc.text((idx + 1).toString(), 17, currentY + 4);
      doc.text(new Date(l.timestamp).toLocaleString('pt-MZ'), 23, currentY + 4);
      doc.text(l.username, 60, currentY + 4);
      doc.text(l.ipAddress, 90, currentY + 4);
      doc.text(l.action.length > 20 ? l.action.substring(0, 18) + '...' : l.action, 115, currentY + 4);
      
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(l.status === 'Sucesso' ? 5 : 185, l.status === 'Sucesso' ? 150 : 28, l.status === 'Sucesso' ? 105 : 28);
      doc.text(l.status, 155, currentY + 4);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);

      doc.text(l.details.length > 15 ? l.details.substring(0, 13) + '...' : l.details, 170, currentY + 4);

      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.5);
      doc.line(15, currentY + 6, 195, currentY + 6);
      currentY += 6;
    });

    doc.save(title);
    showToast('Relatório de Auditoria Cibersegurança PDF Descarregado!');
  };

  const handleExportStockAlertsPDF = () => {
    const title = `Relatorio_Alertas_Criticos_Stock_${Date.now()}.pdf`;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(220, 38, 38);
    doc.text('RELATÓRIO DE RUTURAS E ALERTAS DE STOCK CRÍTICOS', 15, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('AGRO - XICOMO & SERVIÇOS, LDA • NUIT: 401976590', 15, 25);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-MZ')}`, 15, 29);

    doc.setDrawColor(220, 38, 38);
    doc.setLineWidth(1);
    doc.line(15, 33, 195, 33);

    // Summary Box
    doc.saveGraphicsState();
    doc.setFillColor(254, 242, 242);
    doc.rect(15, 37, 180, 20, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('PRODUTOS CRÍTICOS', 20, 43);
    doc.text('CRITÉRIO DE ALERTA', 75, 43);
    doc.text('VALOR IMOBILIZADO', 135, 43);

    doc.setFontSize(11);
    doc.setTextColor(220, 38, 38);
    doc.text(`${stockAlerts.length} Artigos`, 20, 51);
    doc.text('Stock <= 10 unidades', 75, 51);
    doc.setTextColor(21, 128, 61);
    doc.text(`${stockAlerts.reduce((acc, p) => acc + (p.stockQty * p.buyingPrice), 0).toLocaleString('pt-MZ')} MT`, 135, 51);

    // Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(220, 38, 38);
    doc.text('PRODUTOS EM NÍVEL CRÍTICO / RUTURA', 15, 65);

    let currentY = 70;
    doc.saveGraphicsState();
    doc.setFillColor(220, 38, 38);
    doc.rect(15, currentY, 180, 7, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('#', 17, currentY + 5);
    doc.text('NOME DO PRODUTO', 23, currentY + 5);
    doc.text('CÓD / SKU', 85, currentY + 5);
    doc.text('CATEGORIA', 115, currentY + 5);
    doc.text('QUANTIDADE', 145, currentY + 5, { align: 'right' });
    doc.text('VALOR INVENTÁRIO', 193, currentY + 5, { align: 'right' });

    currentY += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);

    if (stockAlerts.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.text('Nenhum produto em nível crítico de stock de momento.', 105, currentY + 10, { align: 'center' });
    } else {
      stockAlerts.forEach((p, idx) => {
        if (currentY > 265) {
          doc.addPage();
          currentY = 20;
          doc.saveGraphicsState();
          doc.setFillColor(220, 38, 38);
          doc.rect(15, currentY, 180, 7, 'F');
          doc.restoreGraphicsState();
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor(255, 255, 255);
          doc.text('#', 17, currentY + 5);
          doc.text('NOME DO PRODUTO', 23, currentY + 5);
          doc.text('CÓD / SKU', 85, currentY + 5);
          doc.text('CATEGORIA', 115, currentY + 5);
          doc.text('QUANTIDADE', 145, currentY + 5, { align: 'right' });
          doc.text('VALOR INVENTÁRIO', 193, currentY + 5, { align: 'right' });
          currentY += 7;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(51, 65, 85);
        }

        if (idx % 2 === 1) {
          doc.saveGraphicsState();
          doc.setFillColor(248, 250, 252);
          doc.rect(15, currentY, 180, 6, 'F');
          doc.restoreGraphicsState();
        }

        doc.text((idx + 1).toString(), 17, currentY + 4);
        doc.text(p.name, 23, currentY + 4);
        doc.text(p.code, 85, currentY + 4);
        doc.text(p.category || 'N/A', 115, currentY + 4);
        
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(220, 38, 38);
        doc.text(`${p.stockQty} ${p.baseUnit}`, 145, currentY + 4, { align: 'right' });
        doc.setTextColor(51, 65, 85);
        doc.setFont('helvetica', 'normal');
        
        doc.text(`${(p.stockQty * p.buyingPrice).toLocaleString('pt-MZ')} MT`, 193, currentY + 4, { align: 'right' });

        doc.setDrawColor(241, 245, 249);
        doc.setLineWidth(0.5);
        doc.line(15, currentY + 6, 195, currentY + 6);
        currentY += 6;
      });
    }

    doc.save(title);
    showToast('Alertas de Stock Críticos PDF Descarregado!');
  };

  // The ledger charts use actual transactions in the selected date range.
  const chartData = monthlySales.map(month => ({
    name: month.month,
    Vendas: month.amount,
    Perdas: filteredLosses.filter(loss => loss.date?.startsWith(month.key)).reduce((sum, loss) => sum + loss.costValue, 0)
  }));

  // Export Sales Ledger Ledger to CSV file format
  const handleExportSalesLedger = () => {
    let csv = "ID Venda,Fatura,Data,Cliente,Subtotal,Desconto,Total Pago,Metodo Pagamento,Sincronizado Supabase\n";
    sales.forEach(s => {
      csv += `"${s.id}","${s.invoiceNumber}","${s.date}","${s.customerName}",${s.subtotal},${s.discount},${s.total},"${s.paymentMethod}",${s.synced}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `LIVRO_DIARIO_VENDAS_${new Date().getFullYear()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export Sales Ledger (Livro Diário) to a beautiful PDF layout
  const handleExportSalesLedgerPDF = () => {
    const title = `Livro_Diario_Vendas_Ledger_${Date.now()}.pdf`;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const cName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(0, 106, 78);
    doc.text('LIVRO DIÁRIO DE VENDAS (SALES LEDGER)', 15, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`${cName} • NUIT: 401976590`, 15, 25);
    doc.text(`Emitido em: ${new Date().toLocaleString('pt-MZ')}`, 15, 29);

    doc.setDrawColor(0, 106, 78);
    doc.setLineWidth(1);
    doc.line(15, 33, 195, 33);

    let totalSubtotal = 0;
    let totalDiscount = 0;
    let totalPaid = 0;

    sales.forEach(s => {
      totalSubtotal += s.subtotal;
      totalDiscount += s.discount;
      totalPaid += s.total;
    });

    // Summary Box
    doc.saveGraphicsState();
    doc.setFillColor(240, 253, 244);
    doc.rect(15, 37, 180, 20, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('TOTAL DE TRANSAÇÕES', 20, 43);
    doc.text('SUBTOTAL ACUMULADO', 65, 43);
    doc.text('TOTAL DESCONTOS', 120, 43);
    doc.text('TOTAL LÍQUIDO PAGO', 160, 43);

    doc.setFontSize(10);
    doc.setTextColor(0, 106, 78);
    doc.text(`${sales.length} Registos`, 20, 51);
    doc.text(`${totalSubtotal.toLocaleString('pt-MZ')} MT`, 65, 51);
    doc.setTextColor(190, 18, 60);
    doc.text(`-${totalDiscount.toLocaleString('pt-MZ')} MT`, 120, 51);
    doc.setFontSize(11);
    doc.setTextColor(21, 128, 61);
    doc.text(`${totalPaid.toLocaleString('pt-MZ')} MT`, 160, 51);

    // Table Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(0, 106, 78);
    doc.text('REGISTOS DETALHADOS DAS VENDAS', 15, 65);

    let currentY = 70;
    doc.saveGraphicsState();
    doc.setFillColor(0, 106, 78);
    doc.rect(15, currentY, 180, 7, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text('#', 17, currentY + 5);
    doc.text('DATA / HORA', 23, currentY + 5);
    doc.text('FATURA Nº', 55, currentY + 5);
    doc.text('CLIENTE / ADQUIRENTE', 85, currentY + 5);
    doc.text('PAGAMENTO', 130, currentY + 5);
    doc.text('DESCONTO', 160, currentY + 5, { align: 'right' });
    doc.text('TOTAL PAGO', 193, currentY + 5, { align: 'right' });

    currentY += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);

    sales.forEach((s, idx) => {
      if (currentY > 260) {
        doc.addPage();
        currentY = 20;
        doc.saveGraphicsState();
        doc.setFillColor(0, 106, 78);
        doc.rect(15, currentY, 180, 7, 'F');
        doc.restoreGraphicsState();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(255, 255, 255);
        doc.text('#', 17, currentY + 5);
        doc.text('DATA / HORA', 23, currentY + 5);
        doc.text('FATURA Nº', 55, currentY + 5);
        doc.text('CLIENTE / ADQUIRENTE', 85, currentY + 5);
        doc.text('PAGAMENTO', 130, currentY + 5);
        doc.text('DESCONTO', 160, currentY + 5, { align: 'right' });
        doc.text('TOTAL PAGO', 193, currentY + 5, { align: 'right' });
        currentY += 7;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(51, 65, 85);
      }

      if (idx % 2 === 1) {
        doc.saveGraphicsState();
        doc.setFillColor(248, 250, 252);
        doc.rect(15, currentY, 180, 6, 'F');
        doc.restoreGraphicsState();
      }

      doc.text((idx + 1).toString(), 17, currentY + 4);
      doc.text(new Date(s.date).toLocaleDateString('pt-MZ') + ' ' + new Date(s.date).toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' }), 23, currentY + 4);
      doc.setFont('helvetica', 'bold');
      doc.text(s.invoiceNumber, 55, currentY + 4);
      doc.setFont('helvetica', 'normal');
      doc.text(s.customerName.length > 25 ? s.customerName.substring(0, 24) + '...' : s.customerName, 85, currentY + 4);
      doc.text(s.paymentMethod.toUpperCase(), 130, currentY + 4);
      doc.setTextColor(190, 18, 60);
      doc.text(s.discount > 0 ? `-${s.discount.toLocaleString('pt-MZ')} MT` : '0.00 MT', 160, currentY + 4, { align: 'right' });
      doc.setTextColor(0, 106, 78);
      doc.setFont('helvetica', 'bold');
      doc.text(`${s.total.toLocaleString('pt-MZ')} MT`, 193, currentY + 4, { align: 'right' });
      doc.setTextColor(51, 65, 85);
      doc.setFont('helvetica', 'normal');

      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.5);
      doc.line(15, currentY + 6, 195, currentY + 6);
      currentY += 6;
    });

    // Totais row in Table
    doc.saveGraphicsState();
    doc.setFillColor(241, 245, 249);
    doc.rect(15, currentY, 180, 7, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.text('TOTAIS ACUMULADOS', 17, currentY + 5);
    doc.setTextColor(190, 18, 60);
    doc.text(`-${totalDiscount.toLocaleString('pt-MZ')} MT`, 160, currentY + 5, { align: 'right' });
    doc.setTextColor(0, 106, 78);
    doc.text(`${totalPaid.toLocaleString('pt-MZ')} MT`, 193, currentY + 5, { align: 'right' });

    doc.save(title);
    showToast('Livro Diário de Vendas PDF Descarregado!');
  };

  return (
    <div className="space-y-6" id="finance_module">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <h3 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
          <span className="material-symbols-outlined text-emerald-600">account_balance_wallet</span>
          Contabilidade & Finanças
        </h3>
      </div>

      {isLoadingSales && !hasLoadedSales && (
        <p role="status" className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-600">
          A carregar os resultados financeiros...
        </p>
      )}
      {loadFailures.length > 0 && (
        <div role="alert" className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-900 flex flex-wrap items-center justify-between gap-3">
          <span>
            Não foi possível carregar {loadFailures.map(key => FINANCE_SECTION_LABELS[key]).join(', ')}.
            {loadFailures.includes('sales') ? ' Os valores de vendas podem estar desatualizados.' : ' As outras secções continuam disponíveis.'}
          </span>
          <button type="button" onClick={() => { void loadFinancials(); }} className="font-bold underline hover:text-amber-700">Tentar novamente</button>
        </div>
      )}

      {/* Modern Compact Sub-Tab Segmented Blocks */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <button
          type="button"
          onClick={() => setActiveSubTab('dashboard')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
            activeSubTab === 'dashboard'
              ? 'bg-emerald-600 text-white border-emerald-700 shadow-md ring-2 ring-emerald-500/20'
              : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50'
          }`}
        >
          <span className={`material-symbols-outlined text-[17px] ${activeSubTab === 'dashboard' ? 'text-white' : 'text-emerald-600'}`}>dashboard</span>
          <span>Resultados (DRE)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('reports')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
            activeSubTab === 'reports'
              ? 'bg-blue-600 text-white border-blue-700 shadow-md ring-2 ring-blue-500/20'
              : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50/50'
          }`}
        >
          <span className={`material-symbols-outlined text-[17px] ${activeSubTab === 'reports' ? 'text-white' : 'text-blue-600'}`}>receipt_long</span>
          <span>Relatórios POS</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('transformacoes')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
            activeSubTab === 'transformacoes'
              ? 'bg-purple-600 text-white border-purple-700 shadow-md ring-2 ring-purple-500/20'
              : 'bg-white text-slate-700 border-slate-200 hover:border-purple-300 hover:bg-purple-50/50'
          }`}
        >
          <span className={`material-symbols-outlined text-[17px] ${activeSubTab === 'transformacoes' ? 'text-white' : 'text-purple-600'}`}>call_split</span>
          <span>Transformações</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('ledger')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
            activeSubTab === 'ledger'
              ? 'bg-teal-600 text-white border-teal-700 shadow-md ring-2 ring-teal-500/20'
              : 'bg-white text-slate-700 border-slate-200 hover:border-teal-300 hover:bg-teal-50/50'
          }`}
        >
          <span className={`material-symbols-outlined text-[17px] ${activeSubTab === 'ledger' ? 'text-white' : 'text-teal-600'}`}>analytics</span>
          <span>Livro de Caixa</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('alerts')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
            activeSubTab === 'alerts'
              ? 'bg-amber-600 text-white border-amber-700 shadow-md ring-2 ring-amber-500/20'
              : 'bg-white text-slate-700 border-slate-200 hover:border-amber-300 hover:bg-amber-50/50'
          }`}
        >
          <span className={`material-symbols-outlined text-[17px] ${activeSubTab === 'alerts' ? 'text-white' : 'text-amber-600'}`}>warning</span>
          <span>Alertas Stock</span>
          {stockAlerts.length > 0 && (
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
              activeSubTab === 'alerts' ? 'bg-white text-amber-700' : 'bg-amber-100 text-amber-800'
            }`}>
              {stockAlerts.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('auditoria')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
            activeSubTab === 'auditoria'
              ? 'bg-slate-800 text-white border-slate-900 shadow-md ring-2 ring-slate-700/20'
              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400 hover:bg-slate-100'
          }`}
        >
          <span className={`material-symbols-outlined text-[17px] ${activeSubTab === 'auditoria' ? 'text-white' : 'text-slate-700'}`}>security</span>
          <span>Segurança</span>
        </button>
      </div>

      {/* Date Range Filter for Financial Analysis */}
      <DateRangeFilter
        title="Período de Análise Financeira & Contabilística"
        showAllHistory
        startDate={startDate}
        endDate={endDate}
        preset={datePreset}
        onRangeChange={(start, end, preset) => {
          setStartDate(start);
          setEndDate(end);
          setDatePreset(preset);
        }}
        onExportPDF={handleExportFinancePDF}
        onExportExcel={handleExportFinanceDashboardExcel}
      />
      {!isLoadingSales && hasLoadedSales && !loadFailures.includes('sales') && sales.length === 0 && (
        <p className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-900">
          Ainda não há vendas registadas. Os resultados financeiros serão apresentados quando houver transações.
        </p>
      )}
      {!isLoadingSales && hasLoadedSales && !loadFailures.includes('sales') && sales.length > 0 && filteredSales.length === 0 && activeSubTab === 'dashboard' && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-900 flex flex-wrap justify-between gap-2">
          <span>Não há vendas no período selecionado.</span>
          <button type="button" onClick={() => {
            setStartDate(''); setEndDate(''); setDatePreset('Todo o Histórico');
          }} className="font-bold underline hover:text-blue-700">Ver todo o histórico</button>
        </div>
      )}

      {/* --- SUB-TAB 1: PAINEL DE DESEMPENHO (DASHBOARD - IMAGE 2) --- */}
      {activeSubTab === 'dashboard' && hasLoadedSales && (
        <div className="space-y-6">
          {/* Top Row: 4 KPI Bento Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Faturação Bruta */}
            <div className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="bg-emerald-50 text-emerald-700 p-3.5 rounded-2xl flex items-center justify-center">
                <span className="material-symbols-outlined text-[28px] font-black">attach_money</span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-black text-gray-400 tracking-wider">Faturação Bruta</span>
                <p className="text-2xl font-black text-slate-800 font-mono">{(totalGrossSales || 0).toLocaleString('pt-MZ')} MT</p>
                <div className="text-[10px] text-emerald-600 font-bold flex items-center gap-0.5">
                  <span className="material-symbols-outlined text-[12px] font-black">trending_up</span>
                  {filteredSales.length} vendas no período
                </div>
              </div>
            </div>

            {/* Card 2: Margem Lucro Est. */}
            <div className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="bg-teal-50 text-teal-700 p-3.5 rounded-2xl flex items-center justify-center">
                <span className="material-symbols-outlined text-[28px] font-black">trending_up</span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-black text-gray-400 tracking-wider">Margem Lucro Est.</span>
                <p className="text-2xl font-black text-slate-800 font-mono">{(totalProfit || 0).toLocaleString('pt-MZ')} MT</p>
                <div className="text-[10px] text-gray-400 font-medium">Após custo dos produtos vendidos</div>
              </div>
            </div>

            {/* Card 3: Falta de Stock */}
            <div className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="bg-amber-50 text-amber-700 p-3.5 rounded-2xl flex items-center justify-center">
                <span className="material-symbols-outlined text-[28px] font-black">warning</span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-black text-gray-400 tracking-wider">Falta de Stock</span>
                <p className="text-2xl font-black text-slate-800 font-mono">{stockAlerts.length} Alertas</p>
                <div className="text-[10px] text-gray-400 font-medium">Insumos abaixo do nível de segurança.</div>
              </div>
            </div>

            {/* Card 4: Faturas Pendentes */}
            <div className="bg-white p-5 border border-slate-100 rounded-2xl shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="bg-blue-50 text-blue-700 p-3.5 rounded-2xl flex items-center justify-center">
                <span className="material-symbols-outlined text-[28px] font-black">description</span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-black text-gray-400 tracking-wider">Faturas Pendentes</span>
                <p className="text-2xl font-black text-slate-800 font-mono">
                  {filteredSales.filter(s => s.status === 'Pendente' || s.status === 'Crédito').length} Faturas
                </p>
                <div className="text-[10px] text-gray-400 font-medium">Faturas à espera de liquidação.</div>
              </div>
            </div>
          </div>

          {/* Middle Row: Tendência de Vendas Diárias & Vendas por Categoria */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Column 1: Tendência de Vendas Diárias (lg:col-span-2) */}
            <div className="lg:col-span-2 bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-4">
              <div>
                <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-600">calendar_month</span>
                  Tendência de Vendas Diárias
                </h4>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Fluxo financeiro cobrado nos últimos 7 dias operacionais.
                </p>
              </div>

              {/* Dynamic Weekday Bars Graph */}
              <div className="h-64 flex items-end justify-between px-4 pb-2 border-b border-slate-100 pt-6">
                {(() => {
                  const daysOfWeek = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
                  
                  // Monday to Sunday sales calculation
                  const getDailySales = () => {
                    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
                    const result = [
                      { name: 'Seg', amount: 0 },
                      { name: 'Ter', amount: 0 },
                      { name: 'Qua', amount: 0 },
                      { name: 'Qui', amount: 0 },
                      { name: 'Sex', amount: 0 },
                      { name: 'Sáb', amount: 0 },
                      { name: 'Dom', amount: 0 }
                    ];
                    
                    for (let i = 0; i < 7; i++) {
                      const d = new Date();
                      d.setDate(d.getDate() - i);
                      const dayName = days[d.getDay()];
                      
                      const daySales = filteredSales.filter(s => {
                        const saleDate = new Date(s.date);
                        return saleDate.getDate() === d.getDate() &&
                               saleDate.getMonth() === d.getMonth() &&
                               saleDate.getFullYear() === d.getFullYear();
                      });
                      const total = daySales.reduce((sum, s) => sum + s.total, 0);
                      
                      const found = result.find(r => r.name === dayName);
                      if (found) {
                        found.amount += total;
                      }
                    }
                    return result;
                  };

                  const actualValues = getDailySales();
                  const maxAmt = Math.max(...actualValues.map(v => v.amount), 1);

                  return actualValues.map(val => {
                    const heightPct = (val.amount / maxAmt) * 100;
                    return (
                      <div key={val.name} className="flex flex-col items-center group relative w-12 h-full justify-end">
                        {/* Hover Tooltip */}
                        <div className="absolute -top-8 bg-slate-800 text-white text-[9px] px-2 py-1 rounded shadow opacity-0 group-hover:opacity-100 transition-opacity z-10 font-mono">
                          {`${val.amount.toLocaleString('pt-MZ')} MT`}
                        </div>
                        
                        {/* Filled Capsule */}
                        <div className="w-8 bg-slate-50 rounded-t-xl flex flex-col justify-end overflow-hidden h-[90%] border border-slate-100">
                          <div 
                            style={{ height: `${heightPct}%` }}
                            className="w-full bg-[#006A4E] rounded-t-xl transition-all duration-1000 ease-out hover:opacity-90"
                          />
                        </div>

                        {/* Weekday Label */}
                        <span className="text-[10px] font-bold text-slate-500 mt-2">{val.name}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Column 2: Vendas por Categoria (lg:col-span-1) */}
            <div className="lg:col-span-1 bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-4">
              <div>
                <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-600">pie_chart</span>
                  Vendas por Categoria
                </h4>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Distribuição financeira das vendas agrícolas.
                </p>
              </div>

              {/* Centered Donut Hole SVG Chart */}
              {(() => {
                const getCategoryBreakdown = () => {
                  const breakdown: Record<string, number> = {};
                  filteredSales.forEach(sale => {
                    (sale.items || []).forEach(item => {
                      const prod = products.find(p => p.id === item.productId);
                      const cat = item.category || prod?.category || 'Outro';
                      const amount = item.totalPrice ?? (item.unitPrice * item.quantity);
                      
                      const matchedCat = REPORT_CATEGORIES.find(c => matchCategory(cat, c.key)) || REPORT_CATEGORIES[REPORT_CATEGORIES.length - 1];
                      breakdown[matchedCat.key] = (breakdown[matchedCat.key] || 0) + amount;
                    });
                  });
                  return breakdown;
                };

                const catData = getCategoryBreakdown();
                const totalCatAmt = Object.values(catData).reduce((a, b) => a + b, 0);
                const getCatPercent = (key: string) => totalCatAmt > 0
                  ? Math.round(((catData[key] || 0) / totalCatAmt) * 100)
                  : 0;

                const quimicosPct = getCatPercent('quimicos');
                const sementesPct = getCatPercent('sementes');
                const adubosPct = getCatPercent('adubos');
                const ferramentasPct = getCatPercent('ferramentas');
                const outrosPct = Math.max(0, 100 - (quimicosPct + sementesPct + adubosPct + ferramentasPct));

                const radius = 35;
                const circ = 2 * Math.PI * radius;

                const strokeQuimicos = (quimicosPct / 100) * circ;
                const strokeSementes = (sementesPct / 100) * circ;
                const strokeAdubos = (adubosPct / 100) * circ;
                const strokeFerramentas = (ferramentasPct / 100) * circ;
                const strokeOutros = (outrosPct / 100) * circ;

                const offsetQuimicos = 0;
                const offsetSementes = strokeQuimicos;
                const offsetAdubos = strokeQuimicos + strokeSementes;
                const offsetFerramentas = strokeQuimicos + strokeSementes + strokeAdubos;
                const offsetOutros = strokeQuimicos + strokeSementes + strokeAdubos + strokeFerramentas;

                return (
                  <div className="flex flex-col items-center space-y-6 pt-4">
                    {/* Ring Container */}
                    <div className="relative flex items-center justify-center">
                      <svg width="140" height="140" viewBox="0 0 100 100" className="transform -rotate-90">
                        {/* Underlay ring */}
                        <circle cx="50" cy="50" r={radius} fill="transparent" stroke="#F1F5F9" strokeWidth="12" />
                        
                        {/* Químicos Segment (Purple) */}
                        {quimicosPct > 0 && (
                          <circle
                            cx="50"
                            cy="50"
                            r={radius}
                            fill="transparent"
                            stroke="#7C3AED"
                            strokeWidth="12"
                            strokeDasharray={`${strokeQuimicos} ${circ}`}
                            strokeDashoffset={-offsetQuimicos}
                            className="transition-all duration-1000 ease-out"
                          />
                        )}

                        {/* Sementes Segment (Emerald) */}
                        {sementesPct > 0 && (
                          <circle
                            cx="50"
                            cy="50"
                            r={radius}
                            fill="transparent"
                            stroke="#10B981"
                            strokeWidth="12"
                            strokeDasharray={`${strokeSementes} ${circ}`}
                            strokeDashoffset={-offsetSementes}
                            className="transition-all duration-1000 ease-out"
                          />
                        )}

                        {/* Adubos Segment (Amber) */}
                        {adubosPct > 0 && (
                          <circle
                            cx="50"
                            cy="50"
                            r={radius}
                            fill="transparent"
                            stroke="#F59E0B"
                            strokeWidth="12"
                            strokeDasharray={`${strokeAdubos} ${circ}`}
                            strokeDashoffset={-offsetAdubos}
                            className="transition-all duration-1000 ease-out"
                          />
                        )}

                        {/* Ferramentas Segment (Blue) */}
                        {ferramentasPct > 0 && (
                          <circle
                            cx="50"
                            cy="50"
                            r={radius}
                            fill="transparent"
                            stroke="#3B82F6"
                            strokeWidth="12"
                            strokeDasharray={`${strokeFerramentas} ${circ}`}
                            strokeDashoffset={-offsetFerramentas}
                            className="transition-all duration-1000 ease-out"
                          />
                        )}

                        {/* Outros Segment (Slate) */}
                        {outrosPct > 0 && (
                          <circle
                            cx="50"
                            cy="50"
                            r={radius}
                            fill="transparent"
                            stroke="#64748B"
                            strokeWidth="12"
                            strokeDasharray={`${strokeOutros} ${circ}`}
                            strokeDashoffset={-offsetOutros}
                            className="transition-all duration-1000 ease-out"
                          />
                        )}
                      </svg>

                      {/* Inside label */}
                      <div className="absolute flex flex-col items-center justify-center text-center">
                        <span className="text-[9px] uppercase font-bold text-gray-400 tracking-widest">{totalCatAmt > 0 ? 'Catálogo' : 'Sem vendas'}</span>
                        <span className="text-xs font-black text-slate-800">{totalCatAmt > 0 ? 'Mix Agrícola' : 'no período'}</span>
                      </div>
                    </div>

                    {/* Horizontal Legend Below */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 w-full text-center text-[10px] font-black uppercase text-gray-600 border-t border-slate-100 pt-4">
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#7C3AED] block" />
                          <span>Químicos</span>
                        </div>
                        <span className="font-mono text-slate-800 text-[11px] font-black mt-1">{quimicosPct}%</span>
                      </div>

                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] block" />
                          <span>Sementes</span>
                        </div>
                        <span className="font-mono text-slate-800 text-[11px] font-black mt-1">{sementesPct}%</span>
                      </div>

                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B] block" />
                          <span>Adubos</span>
                        </div>
                        <span className="font-mono text-slate-800 text-[11px] font-black mt-1">{adubosPct}%</span>
                      </div>

                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6] block" />
                          <span>Ferramentas</span>
                        </div>
                        <span className="font-mono text-slate-800 text-[11px] font-black mt-1">{ferramentasPct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Bottom Row: Comparativo de Vendas por Produto (Top 5 Mais Vendidos) */}
          <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-4">
            <div>
              <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">bar_chart</span>
                Comparativo de Vendas por Produto (Top 5 Mais Vendidos)
              </h4>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Volume financeiro total faturado por item no catálogo.
              </p>
            </div>

            {/* Top 5 Products List */}
            <div className="space-y-4">
              {(() => {
                const getTopProducts = () => {
                  const prodSales: { [key: string]: { qty: number, total: number, name: string, unit: string } } = {};
                  filteredSales.forEach(sale => {
                    (sale.items || []).forEach(item => {
                      if (!prodSales[item.productId]) {
                        const prod = products.find(p => p.id === item.productId);
                        prodSales[item.productId] = {
                          qty: 0,
                          total: 0,
                          name: item.name,
                          unit: prod ? prod.baseUnit : 'Unidade'
                        };
                      }
                      prodSales[item.productId].qty += item.quantity;
                      prodSales[item.productId].total += item.totalPrice ?? (item.unitPrice * item.quantity);
                    });
                  });
                  
                  return Object.values(prodSales).sort((a, b) => b.total - a.total).slice(0, 5);
                };

                const topProds = getTopProducts();
                if (topProds.length === 0) return <p className="text-xs text-slate-500">Sem vendas de produtos neste período.</p>;
                const maxVal = Math.max(...topProds.map(p => p.total), 1);

                return topProds.map(prod => {
                  const widthPct = (prod.total / maxVal) * 100;
                  return (
                    <div key={prod.name} className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="font-extrabold text-slate-700">{prod.name}</span>
                        <span className="font-mono text-slate-900 font-bold">
                          {prod.total.toLocaleString('pt-MZ')} MT {prod.qty > 0 && `(${prod.qty} ${prod.unit})`}
                        </span>
                      </div>
                      <div className="w-full bg-slate-50 rounded-full h-2.5 overflow-hidden border border-slate-100">
                        <div 
                          style={{ width: `${widthPct}%` }}
                          className="bg-[#006A4E] h-full rounded-full transition-all duration-1000 ease-out"
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* --- SUB-TAB 2: GERAÇÃO DE RELATÓRIOS PERIÓDICOS DO POS (IMAGE 1) --- */}
      {activeSubTab === 'reports' && hasLoadedSales && (
        <div className="space-y-6">
          {/* Main compilation panel */}
          <div className="bg-white border border-slate-150 rounded-2xl p-6 shadow-sm space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h4 className="text-base font-bold text-slate-800 tracking-tight">Geração de Relatórios Periódicos do POS</h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  Consulte todo o histórico ou selecione um período recente para compilar as vendas e prestar contas.
                </p>
              </div>

              {/* Compilation Selection controls */}
              <div className="flex items-center gap-2 self-start md:self-auto">
                <select
                  value={reportPeriod}
                  onChange={(e) => setReportPeriod(e.target.value as FinanceReportPeriod)}
                  className="bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none"
                >
                  <option value="Todo o Histórico">Todo o Histórico</option>
                  <option value="Diário">Relatório Diário</option>
                  <option value="Semanal">Relatório Semanal</option>
                  <option value="Mensal">Relatório Mensal</option>
                  <option value="Trimestral">Relatório Trimestral</option>
                  <option value="Semestral">Relatório Semestral</option>
                  <option value="Anual">Relatório Anual</option>
                </select>
                <button
                  onClick={handleCompileReport}
                  className="bg-[#006A4E] text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-[#005a42] flex items-center gap-1.5 shadow transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">sync_alt</span>
                  Compilar
                </button>
              </div>
            </div>

            {/* Compiled KPIs Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">Faturação Bruta ({compiledPeriod})</span>
                <p className="text-xl font-mono font-black text-slate-800 mt-1">{(reportGrossSales || 0).toLocaleString('pt-MZ')} MT</p>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">Lucro Estimado</span>
                <p className="text-xl font-mono font-black text-emerald-700 mt-1">{(reportProfit || 0).toLocaleString('pt-MZ')} MT</p>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">Transações Feitas</span>
                <p className="text-xl font-mono font-black text-blue-700 mt-1">{reportTransCount} Vendas</p>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">Margem Operacional</span>
                <p className="text-xl font-mono font-black text-amber-700 mt-1">{reportMargin.toFixed(1)}%</p>
              </div>
            </div>

            {/* Document and Sheet Export action buttons */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={handleExportFinanceDashboardExcel}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold rounded-lg transition-colors border border-emerald-200"
              >
                <span className="material-symbols-outlined text-[18px]">dashboard_customize</span>
                Exportar Dashboard Excel (.xlsx)
              </button>
              <button
                onClick={handleExportReportPDF}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                Imprimir Relatório Oficial (PDF)
              </button>
              <button
                onClick={handleExportBalancetePDF}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-900 hover:bg-indigo-950 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                Imprimir Balancete (PDF)
              </button>
            </div>
          </div>

          {/* Grid: Totais por Período Fiscal & Desempenho por Produto / Serviço */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Box (lg:col-span-5): TOTAIS DE VENDA POR PERÍODO FISCAL */}
            <div className="lg:col-span-5 bg-white border border-slate-150 rounded-2xl p-5 shadow-sm space-y-4">
              <h5 className="text-xs font-black text-slate-800 uppercase tracking-widest border-b border-slate-100 pb-2">
                Totais de Venda por Período Fiscal
              </h5>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-2">Intervalo de Vendas</th>
                      <th className="p-2 text-right">Faturação Comercial</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    <tr className="bg-emerald-50/60">
                      <td className="p-2.5 font-extrabold text-emerald-800">Período selecionado (filtro acima)</td>
                      <td className="p-2.5 text-right font-mono font-black text-emerald-800">
                        {getFilteredSalesForReport('Todo o Histórico').reduce((acc, s) => acc + s.total, 0).toLocaleString('pt-MZ')} MT
                      </td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-slate-700">Diário (24 Horas)</td>
                      <td className="p-2.5 text-right font-mono text-slate-900">
                        {getFilteredSalesForReport('Diário').reduce((acc, s) => acc + s.total, 0).toLocaleString('pt-MZ')} MT
                      </td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-slate-700">Semanal (7 Dias)</td>
                      <td className="p-2.5 text-right font-mono text-slate-900">
                        {getFilteredSalesForReport('Semanal').reduce((acc, s) => acc + s.total, 0).toLocaleString('pt-MZ')} MT
                      </td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-slate-700">Mensal (30 Dias)</td>
                      <td className="p-2.5 text-right font-mono text-slate-900">
                        {getFilteredSalesForReport('Mensal').reduce((acc, s) => acc + s.total, 0).toLocaleString('pt-MZ')} MT
                      </td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-slate-700">Trimestral (90 Dias)</td>
                      <td className="p-2.5 text-right font-mono text-slate-900">
                        {getFilteredSalesForReport('Trimestral').reduce((acc, s) => acc + s.total, 0).toLocaleString('pt-MZ')} MT
                      </td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-slate-700">Semestral (180 Dias)</td>
                      <td className="p-2.5 text-right font-mono text-slate-900">
                        {getFilteredSalesForReport('Semestral').reduce((acc, s) => acc + s.total, 0).toLocaleString('pt-MZ')} MT
                      </td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-slate-700">Anual (365 Dias)</td>
                      <td className="p-2.5 text-right font-mono text-slate-900">
                        {getFilteredSalesForReport('Anual').reduce((acc, s) => acc + s.total, 0).toLocaleString('pt-MZ')} MT
                      </td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-slate-700">Trienal (3 Anos)</td>
                      <td className="p-2.5 text-right font-mono text-slate-900">
                        {sales.filter(s => {
                          const diff = Date.now() - new Date(s.date).getTime();
                          return diff <= 3 * 365 * 24 * 3600 * 1000;
                        }).reduce((acc, s) => acc + s.total, 0).toLocaleString('pt-MZ')} MT
                      </td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-bold text-slate-700">Quinquenal (5 Anos)</td>
                      <td className="p-2.5 text-right font-mono text-slate-900">
                        {sales.filter(s => {
                          const diff = Date.now() - new Date(s.date).getTime();
                          return diff <= 5 * 365 * 24 * 3600 * 1000;
                        }).reduce((acc, s) => acc + s.total, 0).toLocaleString('pt-MZ')} MT
                      </td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="p-2.5 font-extrabold text-[#006A4E]">Decenal (10 Anos)</td>
                      <td className="p-2.5 text-right font-mono font-black text-[#006A4E]">
                        {sales.filter(s => {
                          const diff = Date.now() - new Date(s.date).getTime();
                          return diff <= 10 * 365 * 24 * 3600 * 1000;
                        }).reduce((acc, s) => acc + s.total, 0).toLocaleString('pt-MZ')} MT
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-gray-400 italic">
                * Totalizador multi-ano calculated em tempo-real.
              </p>
            </div>

            {/* Right Box (lg:col-span-7): DESEMPENHO DE VENDAS POR PRODUTO / SERVIÇO */}
            <div className="lg:col-span-7 bg-white border border-slate-150 rounded-2xl p-5 shadow-sm space-y-4">
              <h5 className="text-xs font-black text-slate-800 uppercase tracking-widest border-b border-slate-100 pb-2">
                Desempenho de Vendas por Produto / Serviço
              </h5>

              <div className="overflow-y-auto max-h-[350px] custom-scrollbar border border-slate-100 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="p-2">Produto/Serviço</th>
                      <th className="p-2 text-right">Preço Compra</th>
                      <th className="p-2 text-right">Preço Venda</th>
                      <th className="p-2 text-center">Comprado</th>
                      <th className="p-2 text-center">Vendido</th>
                      <th className="p-2 text-right">Faturado</th>
                      <th className="p-2 text-right">Lucro Est.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[11px]">
                    {products.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-4 text-center text-gray-400 italic">Nenhum produto cadastrado</td>
                      </tr>
                    ) : (
                      products.map(p => {
                        const soldQty = reportSales.reduce((sum, sale) => {
                          const item = (sale.items || []).find(it => it.productId === p.id);
                          return sum + (item ? getBaseUnitQuantity(p, item.quantity, item.sellingUnit) : 0);
                        }, 0);
                        // Produtos vendidos em saco e em quilo: relatório sempre na unidade base (kg)
                        const unitCost = getUnitCost(p, 'Retail');
                        const faturado = soldQty * p.sellingPrice;
                        const lucro = soldQty * (p.sellingPrice - unitCost);
                        // Comprado can be simulated as catalog stockQty + soldQty historically
                        const totalComprado = p.stockQty + soldQty;

                        return (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="p-2 font-bold text-slate-800 max-w-[120px] truncate" title={p.name}>{p.name}</td>
                            <td className="p-2 text-right font-mono text-gray-500">{p.buyingPrice.toLocaleString()} MT</td>
                            <td className="p-2 text-right font-mono text-gray-800 font-bold">{p.sellingPrice.toLocaleString()} MT</td>
                            <td className="p-2 text-center font-mono">{totalComprado}</td>
                            <td className="p-2 text-center font-mono font-extrabold text-[#006A4E]">{soldQty}</td>
                            <td className="p-2 text-right font-mono text-slate-900 font-bold">{faturado.toLocaleString()} MT</td>
                            <td className="p-2 text-right font-mono text-blue-700 font-bold">{lucro.toLocaleString()} MT</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Bottom Row: Faturação por Categoria & Histórico de Vendas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bottom Left: FATURAÇÃO POR CATEGORIA */}
            <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-sm space-y-4">
              <h5 className="text-xs font-black text-slate-800 uppercase tracking-widest border-b border-slate-100 pb-2">
                Faturação por Categoria
              </h5>

              <div className="space-y-4 text-xs font-semibold">
                {(() => {
                  let sumAllCats = 0;
                  const calculatedCats = REPORT_CATEGORIES.map(cat => {
                    const totalAmt = reportSales.reduce((sum, sale) => {
                      return sum + (sale.items || []).reduce((itemSum, item) => {
                        const p = products.find(prod => prod.id === item.productId);
                        const pCat = item.category || p?.category || 'Outro';
                        if (matchCategory(pCat, cat.key)) {
                          return itemSum + (item.unitPrice * item.quantity);
                        }
                        return itemSum;
                      }, 0);
                    }, 0);
                    sumAllCats += totalAmt;
                    return { ...cat, amount: totalAmt };
                  });

                  return (
                    <div className="space-y-3.5">
                      {calculatedCats.map(cat => {
                        const widthPct = sumAllCats > 0 ? Math.max(1, (cat.amount / sumAllCats) * 100) : 0;
                        const pctStr = sumAllCats > 0 ? ((cat.amount / sumAllCats) * 100).toFixed(1) : '0.0';
                        return (
                          <div key={cat.key} className="space-y-1">
                            <div className="flex justify-between text-[11px]">
                              <span className="text-gray-700 font-black flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: cat.color }} />
                                {cat.label}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-400 font-bold">({pctStr}%)</span>
                                <span className="font-mono text-slate-800 font-black">{cat.amount.toLocaleString('pt-MZ')} MT</span>
                              </div>
                            </div>
                            <div className="w-full bg-slate-100 h-2 rounded-full border border-slate-200 overflow-hidden">
                              <div
                                style={{ width: `${widthPct}%`, backgroundColor: cat.color }}
                                className="h-full rounded-full transition-all duration-700"
                              />
                            </div>
                          </div>
                        );
                      })}

                      <div className="flex justify-between text-xs font-black border-t border-slate-100 pt-3 text-slate-800">
                        <span>SOMA DAS CATEGORIAS</span>
                        <span className="font-mono text-emerald-800 font-black">{sumAllCats.toLocaleString('pt-MZ')} MT</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Bottom Right: HISTÓRICO INDIVIDUAL DAS VENDAS */}
            <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-sm space-y-4">
              <h5 className="text-xs font-black text-slate-800 uppercase tracking-widest border-b border-slate-100 pb-2">
                Histórico Individual das Vendas ({reportSales.length} Vendas no Período)
              </h5>

              <div className="overflow-y-auto max-h-[280px] custom-scrollbar border border-slate-100 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="p-2">Ref Venda</th>
                      <th className="p-2">Data</th>
                      <th className="p-2">Operador</th>
                      <th className="p-2">Método</th>
                      <th className="p-2 text-right">Total Cobrado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportSales.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-gray-400 italic">Nenhuma venda compilada para este período</td>
                      </tr>
                    ) : (
                      reportSales.map(s => (
                        <tr key={s.id} className="hover:bg-slate-50 text-[11px]">
                          <td className="p-2 font-mono font-bold text-[#006A4E]">{s.invoiceNumber}</td>
                          <td className="p-2 text-gray-500">{new Date(s.date).toLocaleDateString('pt-MZ')}</td>
                          <td className="p-2 text-slate-700">{s.customerName || 'Consumidor Final'}</td>
                          <td className="p-2 uppercase text-[9px] font-bold">{s.paymentMethod}</td>
                          <td className="p-2 text-right font-mono font-bold text-slate-900">{s.total.toLocaleString()} MT</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- SUB-TAB: CONTABILIDADE DE TRANSFORMAÇÕES (PARTE 4 - 4.4) --- */}
      {activeSubTab === 'transformacoes' && (
        <div className="space-y-6">
          {/* Top Bento Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 border border-slate-200 rounded-2xl shadow-sm space-y-1">
              <span className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Custo Original Consumido</span>
              <p className="text-xl font-black text-slate-900 font-mono mt-1">
                {trfOriginalCost.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
              </p>
              <p className="text-[10px] text-slate-400">Saída de stock original</p>
            </div>

            <div className="bg-white p-5 border border-emerald-200 rounded-2xl shadow-sm space-y-1">
              <span className="text-[10px] uppercase font-black text-emerald-700 tracking-wider">Valor em Pacotes Criados</span>
              <p className="text-xl font-black text-emerald-800 font-mono mt-1">
                {trfResultingCost.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
              </p>
              <p className="text-[10px] text-emerald-600">Entrada de stock fracionado</p>
            </div>

            <div className="bg-white p-5 border border-amber-200 rounded-2xl shadow-sm space-y-1">
              <span className="text-[10px] uppercase font-black text-amber-800 tracking-wider">Perdas em Transformação</span>
              <p className="text-xl font-black text-amber-900 font-mono mt-1">
                {trfLossesVal.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
              </p>
              <p className="text-[10px] text-amber-700">Custos operacionais de quebra</p>
            </div>

            <div className="bg-emerald-50 p-5 border border-emerald-200 rounded-2xl shadow-sm space-y-1">
              <span className="text-[10px] uppercase font-black text-emerald-800 tracking-wider">Balanço Contabilístico</span>
              <p className="text-xl font-black text-emerald-950 font-mono mt-1">0.00 MT</p>
              <p className="text-[10px] font-bold text-emerald-700">NEUTRALIDADE FINANCEIRA ✓</p>
            </div>
          </div>

          {/* Explanation Banner */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 text-xs text-slate-700 space-y-2">
            <h4 className="font-black text-slate-900 text-sm flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-700 text-[20px]">account_balance</span>
              Princípio Contabilístico da Transformação de Produtos
            </h4>
            <p className="leading-relaxed">
              O processo de transformação (ex: fracionamento de sacos de 50kg em pacotes de 1kg ou 5kg) é uma <strong>operação interna de neutralidade financeira</strong>. O valor patrimonial do stock mantém-se invariável: o custo de aquisição do artigo original é transferido proporcionalmente para os novos artigos empacotados. As eventuais perdas de peso no manuseamento são reconhecidas pontualmente como quebras de inventário.
            </p>
          </div>

          {/* Transformations Table */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-gray-150 pb-3">
              <h4 className="font-black text-gray-800 text-xs sm:text-sm uppercase tracking-tight">
                Transformações Registadas no Período ({filteredTransformations.length})
              </h4>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-emerald-800/10 text-emerald-950 font-black border-b border-emerald-200 text-[10px] uppercase">
                    <th className="p-3">Código</th>
                    <th className="p-3">Data</th>
                    <th className="p-3">Artigo Original</th>
                    <th className="p-3 text-right">Qtd Original</th>
                    <th className="p-3 text-right">Custo Original (MT)</th>
                    <th className="p-3 text-center">Pacotes Gerados</th>
                    <th className="p-3 text-right">Valor Criado (MT)</th>
                    <th className="p-3 text-right">Perda (MT)</th>
                    <th className="p-3 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-150 text-slate-700">
                  {filteredTransformations.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-gray-400 italic">
                        Nenhuma transformação registada no período selecionado.
                      </td>
                    </tr>
                  ) : (
                    filteredTransformations.map(t => {
                      const createdVal = (t.items || []).reduce((s, it) => s + (it.quantity * it.calculatedUnitCost), 0);
                      const isCancelled = t.status === 'Cancelada';
                      return (
                        <tr key={t.id} className="hover:bg-emerald-50/50">
                          <td className="p-3 font-mono font-black text-slate-900">{t.code}</td>
                          <td className="p-3 font-medium">{formatDatePT(t.date)}</td>
                          <td className="p-3 font-bold text-slate-900">{t.originalProductName}</td>
                          <td className="p-3 text-right font-mono font-bold">{t.originalQuantity} {t.originalUnit}</td>
                          <td className="p-3 text-right font-mono font-black text-slate-900">
                            {t.originalTotalCost.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
                          </td>
                          <td className="p-3 text-center font-bold text-emerald-800">
                            {(t.items || []).reduce((s, it) => s + it.quantity, 0)} unidades
                          </td>
                          <td className="p-3 text-right font-mono font-black text-emerald-900">
                            {createdVal.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-amber-900">
                            {t.lossValue > 0 ? `${t.lossValue.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT` : '-'}
                          </td>
                          <td className="p-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                              isCancelled ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {t.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --- SUB-TAB 3: LIVRO DE VENDAS & GRÁFICOS (LEDGER) --- */}
      {activeSubTab === 'ledger' && hasLoadedSales && (
        <div className="space-y-6">
          {/* Financial Bento Cards Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm space-y-1.5">
              <span className="text-[10px] uppercase font-black text-gray-400">Faturação Total</span>
              <p className="text-xl font-black text-emerald-600 font-mono">{(totalGrossSales || 0).toLocaleString()} MT</p>
              <div className="text-[9px] text-gray-400">Total acumulado em caixa</div>
            </div>

            <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm space-y-1.5">
              <span className="text-[10px] uppercase font-black text-gray-400">Lucro Estimado</span>
              <p className="text-xl font-black text-blue-600 font-mono">{(totalProfit || 0).toLocaleString()} MT</p>
              <div className="text-[9px] text-gray-400">Faturação menos custos</div>
            </div>

            <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm space-y-1.5">
              <span className="text-[10px] uppercase font-black text-gray-400">Ticket Médio</span>
              <p className="text-xl font-black text-indigo-600 font-mono">{(avgTicket || 0).toLocaleString('pt-MZ', { maximumFractionDigits: 1 })} MT</p>
              <div className="text-[9px] text-gray-400">Valor médio por venda</div>
            </div>

            <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm space-y-1.5">
              <span className="text-[10px] uppercase font-black text-gray-400">Total Prejuízo</span>
              <p className="text-xl font-black text-red-600 font-mono">-{totalLossesVal.toLocaleString()} MT</p>
              <div className="text-[9px] text-gray-400">Quebras e vencidos</div>
            </div>

            <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm space-y-1.5">
              <span className="text-[10px] uppercase font-black text-gray-400">Sincronização</span>
              <p className="text-xl font-black text-orange-500 font-mono">{pendingSyncCount} pendentes</p>
              <div className="text-[9px] text-gray-400">Faturas locais sem nuvem</div>
            </div>
          </div>

          {/* Visual Analytics Graphs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm space-y-4">
              <p className="font-bold text-gray-800 text-sm">Faturação Comercial (últimos 6 meses com atividade)</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} tickLine={false} />
                    <YAxis stroke="#9CA3AF" fontSize={11} tickLine={false} />
                    <Tooltip formatter={(value) => `${Number(value).toLocaleString()} MT`} />
                    <Line type="monotone" dataKey="Vendas" stroke="#006A4E" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm space-y-4">
              <p className="font-bold text-gray-800 text-sm">Relação Comercial: Faturação vs Perdas (últimos 6 meses)</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} tickLine={false} />
                    <YAxis stroke="#9CA3AF" fontSize={11} tickLine={false} />
                    <Tooltip formatter={(value) => `${Number(value).toLocaleString()} MT`} />
                    <Legend />
                    <Bar dataKey="Vendas" fill="#006A4E" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Perdas" fill="#DC2626" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Tendência Comercial (Histórico de Exercício) */}
          <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h4 className="font-bold text-gray-800 text-sm">Tendência Comercial (Histórico de Exercício)</h4>
                <p className="text-xs text-gray-500">Histórico de faturação mensal e download de relatórios comerciais consolidados.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleExportCSVLedger} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs font-bold text-gray-600 flex items-center gap-1 transition-colors">
                  <span className="material-symbols-outlined text-[16px]">grid_on</span> Exportar Excel
                </button>
                <button onClick={handleExportPDFLedger} className="px-3 py-1.5 bg-primary text-white hover:opacity-90 rounded text-xs font-bold flex items-center gap-1 transition-opacity">
                  <span className="material-symbols-outlined text-[16px]">download_2</span> Descarregar PDF
                </button>
              </div>
            </div>

            {/* Bar charts built in tailwind */}
            <div className="h-64 flex items-end justify-between pt-6 border-b border-gray-100 gap-2">
              {monthlySales.map(m => {
                const height = m.amount > 0 ? Math.max(4, (m.amount / maxMonthlyAmount) * 160) : 0;
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-2">
                    <div className="text-[10px] font-mono font-bold text-gray-400">{Math.round(m.amount).toLocaleString()} MT</div>
                    <div className="w-full bg-[#006A4E] rounded-t-lg transition-all duration-700" style={{ height: `${height}px` }}></div>
                    <div className="text-xs font-black text-gray-600 border-t border-gray-100 pt-2 w-full text-center bg-gray-50">{m.month}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sales Transactions Book Table (Ledger) */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-headline-md text-headline-md text-gray-800 font-bold">Livro Diário de Vendas (Ledger)</h4>
                <p className="text-xs text-gray-500">Histórico cronológico de transações fiscais liquidadas.</p>
              </div>

              <div className="flex gap-2 self-start">
                <button
                  onClick={handleExportSalesLedger}
                  className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  Exportar Diário (CSV)
                </button>
                <button
                  onClick={handleExportSalesLedgerPDF}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[#006A4E] text-white hover:opacity-90 rounded text-xs font-bold transition-opacity"
                >
                  <span className="material-symbols-outlined text-[18px]">download_2</span>
                  Descarregar Diário (PDF)
                </button>
              </div>
            </div>

            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                  <tr>
                    <th className="p-3">Data</th>
                    <th className="p-3">Documento / Fatura</th>
                    <th className="p-3">Adquirente / Cliente</th>
                    <th className="p-3">Método Liquidação</th>
                    <th className="p-3 text-right">Subtotal</th>
                    <th className="p-3 text-right">Desconto</th>
                    <th className="p-3 text-right">Total Pago</th>
                    <th className="p-3 text-center">Estado Sinc.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium">
                  {sales.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-gray-400 italic">Nenhuma transação lançada no diário</td>
                    </tr>
                  ) : (
                    [...sales].reverse().map(s => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="p-3 font-mono text-[11px]">{new Date(s.date).toLocaleString()}</td>
                        <td className="p-3 font-bold font-mono text-[#006A4E]">{s.invoiceNumber}</td>
                        <td className="p-3 font-semibold text-gray-800">{s.customerName}</td>
                        <td className="p-3 uppercase font-black text-gray-600">{s.paymentMethod}</td>
                        <td className="p-3 text-right font-mono">{s.subtotal.toLocaleString()} MT</td>
                        <td className="p-3 text-right font-mono text-red-500">-{s.discount.toLocaleString()} MT</td>
                        <td className="p-3 text-right font-bold font-mono text-[#006A4E]">{s.total.toLocaleString()} MT</td>
                        <td className="p-3 text-center">
                          {s.synced ? (
                            <span className="bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded text-[10px] uppercase">Online</span>
                          ) : (
                            <span className="bg-yellow-100 text-yellow-800 font-bold px-2 py-0.5 rounded text-[10px] uppercase">Local</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --- SUB-TAB 4: RUTURAS E ALERTAS DE STOCK CRÍTICOS --- */}
      {activeSubTab === 'alerts' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h4 className="font-headline-md text-headline-md text-red-600 font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-[24px]">warning</span>
                Ruturas e Alertas de Stock (Críticos)
              </h4>
              <p className="text-xs text-gray-500">
                Produtos abaixo do limite crítico de 10 unidades que requerem reabastecimento financeiro urgente.
              </p>
            </div>
            <button
              onClick={handleExportStockAlertsPDF}
              className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded text-xs font-bold hover:bg-red-700 transition-colors shadow-sm self-start"
            >
              <span className="material-symbols-outlined text-[18px]">download_2</span>
              Descarregar Alertas PDF
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {stockAlerts.length === 0 ? (
              <div className="col-span-full text-center text-xs text-gray-400 py-6 bg-gray-50 rounded-lg border border-gray-200">
                <span className="material-symbols-outlined text-green-500 text-3xl">check_circle</span>
                <p className="mt-1 font-bold text-gray-600">Nenhum alerta crítico de stock de momento.</p>
                <p className="text-[10px] text-gray-400">Todo o inventário comercial está acima do limite mínimo.</p>
              </div>
            ) : (
              stockAlerts.map(p => (
                <div key={p.id} className="flex justify-between items-center p-3 rounded-lg bg-red-50 border border-red-200 text-xs">
                  <div>
                    <p className="font-black text-gray-800">{p.name}</p>
                    <p className="text-[10px] text-gray-400">SKU / Cód: {p.code}</p>
                    <p className="text-[9px] font-mono text-gray-500">Custo de Reposição: {p.buyingPrice.toLocaleString()} MT</p>
                  </div>
                  <div className="text-right">
                    <span className="font-black bg-red-200 text-red-900 px-2 py-1 rounded text-[10px] block">
                      {p.stockQty} {p.baseUnit}
                    </span>
                    <span className="text-[8px] text-red-600 block mt-1 font-bold uppercase animate-pulse">Aviso Crítico</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* --- SUB-TAB 5: AUDITORIA DE SEGURANÇA --- */}
      {activeSubTab === 'auditoria' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-3">
            <div>
              <h4 className="font-headline-md text-headline-md text-slate-800 font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-[24px] text-red-600">security</span>
                Rastreio Imutável de Auditoria de Cibersegurança
              </h4>
              <p className="text-xs text-gray-500">
                Pré-visualização dos 100 registos mais recentes. Para filtros, arquivo e pesquisa histórica, use o painel Técnico.
              </p>
            </div>
            <button
              onClick={() => { void handleExportAuditPDF(); }}
              className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded text-xs font-bold hover:bg-red-700 transition-colors self-start shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">download_2</span>
              Descarregar PDF Auditoria
            </button>
          </div>

          <div className="overflow-x-auto custom-scrollbar max-h-80">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="p-3">Data/Hora</th>
                  <th className="p-3">Utilizador</th>
                  <th className="p-3">Endereço IP</th>
                  <th className="p-3">Ação Realizada</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Detalhes da Atividade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-gray-400 italic">Nenhum evento de segurança registado</td>
                  </tr>
                ) : (
                  [...auditLogs].reverse().map(l => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="p-3 font-mono text-[11px] whitespace-nowrap">{new Date(l.timestamp).toLocaleString('pt-MZ')}</td>
                      <td className="p-3 font-bold text-gray-700">{l.username}</td>
                      <td className="p-3 font-mono text-gray-500">{l.ipAddress}</td>
                      <td className="p-3 font-semibold text-slate-800">{l.action}</td>
                      <td className="p-3">
                        <span className={`font-bold px-2 py-0.5 rounded text-[10px] uppercase ${
                          l.status === 'Sucesso' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800 animate-pulse'
                        }`}>
                          {l.status}
                        </span>
                      </td>
                      <td className="p-3 text-gray-600 max-w-xs truncate" title={l.details}>{l.details}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Toast global (portal z-[9999]): visível sobre qualquer modal */}
      <Toast message={toastMessage} type={/erro|falha|inválid|não foi/i.test(toastMessage) ? 'error' : 'success'} onDismiss={() => setToastMessage('')} />
    </div>
  );
}
