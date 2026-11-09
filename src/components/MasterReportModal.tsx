import React, { useState, useMemo } from 'react';
import { Sale, LossRecord, Product, AuditLog, SystemSettings, ProductTransformation, PayrollPayment, Customer } from '../types';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDatePT } from '../utils/dateRangeHelper';

export type MasterReportPeriod = 
  | 'Hoje' 
  | 'Esta Semana' 
  | 'Este Mês' 
  | 'Este Trimestre' 
  | 'Este Semestre' 
  | 'Este Ano' 
  | '3 Anos' 
  | '5 Anos' 
  | 'Todo o Histórico';

interface MasterReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  sales: Sale[];
  losses: LossRecord[];
  products: Product[];
  transformations: ProductTransformation[];
  payrollPayments: PayrollPayment[];
  auditLogs: AuditLog[];
  customers: Customer[];
  settings: SystemSettings | null;
}

export default function MasterReportModal({
  isOpen,
  onClose,
  sales,
  losses,
  products,
  transformations,
  payrollPayments,
  auditLogs,
  customers,
  settings
}: MasterReportModalProps) {
  const [period, setPeriod] = useState<MasterReportPeriod>('Este Mês');
  const [activeReportTab, setActiveReportTab] = useState<'summary' | 'sales' | 'discounts' | 'customers' | 'stock' | 'hr' | 'audit'>('summary');
  const [isExporting, setIsExporting] = useState(false);

  // Date filtering logic based on preset
  const dateRange = useMemo(() => {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    let start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    switch (period) {
      case 'Hoje':
        break;
      case 'Esta Semana': {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        start = new Date(now.setDate(diff));
        start.setHours(0, 0, 0, 0);
        break;
      }
      case 'Este Mês':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'Este Trimestre': {
        const qMonth = Math.floor(now.getMonth() / 3) * 3;
        start = new Date(now.getFullYear(), qMonth, 1);
        break;
      }
      case 'Este Semestre': {
        const sMonth = now.getMonth() < 6 ? 0 : 6;
        start = new Date(now.getFullYear(), sMonth, 1);
        break;
      }
      case 'Este Ano':
        start = new Date(now.getFullYear(), 0, 1);
        break;
      case '3 Anos':
        start = new Date(now.getFullYear() - 3, 0, 1);
        break;
      case '5 Anos':
        start = new Date(now.getFullYear() - 5, 0, 1);
        break;
      case 'Todo o Histórico':
        start = new Date(2000, 0, 1);
        break;
    }
    return { start, end };
  }, [period]);

  const isInRange = (dateStr?: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= dateRange.start && d <= dateRange.end;
  };

  // Filtered collections
  const filteredSales = useMemo(() => sales.filter(s => isInRange(s.date || s.createdAt)), [sales, dateRange]);
  const filteredLosses = useMemo(() => losses.filter(l => isInRange(l.date)), [losses, dateRange]);
  const filteredTransformations = useMemo(() => transformations.filter(t => isInRange(t.date || t.createdAt)), [transformations, dateRange]);
  const filteredPayroll = useMemo(() => payrollPayments.filter(p => isInRange(p.date)), [payrollPayments, dateRange]);
  const filteredAuditLogs = useMemo(() => auditLogs.filter(a => isInRange(a.timestamp)), [auditLogs, dateRange]);

  // Specific table breakdowns
  const paidSales = useMemo(() => filteredSales.filter(s => s.status === 'Paga'), [filteredSales]);
  const pendingSales = useMemo(() => filteredSales.filter(s => s.status === 'Pendente' || s.status === 'Crédito'), [filteredSales]);
  const cancelledSales = useMemo(() => filteredSales.filter(s => s.status === 'Cancelada'), [filteredSales]);
  const salesWithDiscount = useMemo(() => filteredSales.filter(s => Number(s.discount || 0) > 0), [filteredSales]);

  // Named customers aggregation
  const namedCustomers = useMemo(() => {
    const map = new Map<string, { name: string; nuit?: string; salesCount: number; totalSpent: number }>();
    for (const s of filteredSales) {
      const name = (s.customerName || '').trim();
      if (!name || name.toLowerCase() === 'cliente geral') continue;
      const existing = map.get(name) || { name, nuit: s.customerNuit, salesCount: 0, totalSpent: 0 };
      existing.salesCount += 1;
      existing.totalSpent += Number(s.total || 0);
      if (!existing.nuit && s.customerNuit) existing.nuit = s.customerNuit;
      map.set(name, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.totalSpent - a.totalSpent);
  }, [filteredSales]);

  // Financial KPI calculations
  const totalInvoiced = useMemo(() => paidSales.reduce((acc, s) => acc + Number(s.total || 0), 0), [paidSales]);
  const totalDiscounts = useMemo(() => filteredSales.reduce((acc, s) => acc + Number(s.discount || 0), 0), [filteredSales]);
  const totalVat = useMemo(() => {
    // 16% VAT internally extracted from gross retail price (IVA = total - total / 1.16)
    return totalInvoiced - (totalInvoiced / 1.16);
  }, [totalInvoiced]);

  const totalCost = useMemo(() => {
    let cost = 0;
    for (const s of paidSales) {
      for (const it of (s.items || [])) {
        const c = Number(it.costPrice ?? it.buyingPrice ?? 0);
        cost += c * Number(it.quantity || 0);
      }
    }
    return cost;
  }, [paidSales]);

  const netProfit = totalInvoiced - totalCost;

  if (!isOpen) return null;

  // Export to Excel handler
  const handleExportExcel = () => {
    setIsExporting(true);
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Resumo Executivo
      const summaryData = [
        ['AGRO - XICOMO & SERVIÇOS, LDA - RELATÓRIO COMPLETO DO SISTEMA'],
        ['Período:', period],
        ['Gerado em:', new Date().toLocaleString('pt-MZ')],
        [''],
        ['MÉTRICAS FINANCEIRAS', 'VALOR (MT)'],
        ['Faturação Bruta Total', totalInvoiced],
        ['Custo das Mercadorias Vendidas (CMV)', totalCost],
        ['Margem de Lucro Bruto Estimado', netProfit],
        ['Total de Descontos Concedidos', totalDiscounts],
        ['IVA Estimado Incluído (16%)', Math.round(totalVat * 100) / 100],
        [''],
        ['MÉTRICAS OPERACIONAIS', 'QUANTIDADE'],
        ['Total de Transações no Período', filteredSales.length],
        ['Vendas Concluídas (Pagas)', paidSales.length],
        ['Vendas Pendentes / Crédito', pendingSales.length],
        ['Vendas Canceladas / Anuladas', cancelledSales.length],
        ['Vendas com Desconto', salesWithDiscount.length],
        ['Clientes com Nome Registado', namedCustomers.length],
        ['Transformações de Produtos', filteredTransformations.length],
        ['Quebras Registadas', filteredLosses.length]
      ];
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumo Geral');

      // Sheet 2: Vendas
      const salesData = [
        ['Nº Fatura', 'Data/Hora', 'Cliente', 'NUIT', 'Operador', 'Subtotal (MT)', 'Desconto (MT)', 'Total (MT)', 'Método', 'Estado']
      ];
      for (const s of filteredSales) {
        salesData.push([
          s.invoiceNumber || s.id,
          s.date ? new Date(s.date).toLocaleString('pt-MZ') : '',
          s.customerName || 'Cliente Geral',
          s.customerNuit || '-',
          s.operatorName || s.operatorId || 'Operador',
          Number(s.subtotal || 0).toFixed(2),
          Number(s.discount || 0).toFixed(2),
          Number(s.total || 0).toFixed(2),
          s.paymentMethod || 'Numerário',
          s.status || 'Paga'
        ]);
      }
      const wsSales = XLSX.utils.aoa_to_sheet(salesData);
      XLSX.utils.book_append_sheet(wb, wsSales, 'Vendas');

      // Sheet 3: Descontos
      const discountsData = [
        ['Nº Fatura', 'Data', 'Cliente', 'Subtotal (MT)', 'Desconto Concedido (MT)', '% Desconto', 'Operador']
      ];
      for (const s of salesWithDiscount) {
        const sub = Number(s.subtotal || 1);
        const disc = Number(s.discount || 0);
        const pct = ((disc / sub) * 100).toFixed(1) + '%';
        discountsData.push([
          s.invoiceNumber || s.id,
          s.date ? new Date(s.date).toLocaleDateString('pt-MZ') : '',
          s.customerName || 'Cliente Geral',
          sub.toFixed(2),
          disc.toFixed(2),
          pct,
          s.operatorName || 'Operador'
        ]);
      }
      const wsDiscounts = XLSX.utils.aoa_to_sheet(discountsData);
      XLSX.utils.book_append_sheet(wb, wsDiscounts, 'Descontos');

      // Sheet 4: Clientes
      const custData = [
        ['Nome do Cliente', 'NUIT', 'Total de Compras', 'Valor Total Gasto (MT)']
      ];
      for (const c of namedCustomers) {
        custData.push([
          c.name,
          c.nuit || '-',
          c.salesCount,
          c.totalSpent.toFixed(2)
        ]);
      }
      const wsCust = XLSX.utils.aoa_to_sheet(custData);
      XLSX.utils.book_append_sheet(wb, wsCust, 'Clientes Identificados');

      // Sheet 5: Stock & Transformações
      const stockData = [
        ['Código / ID', 'Data', 'Tipo', 'Artigo Origem', 'Quantidade', 'Custo / Perda (MT)', 'Operador', 'Estado']
      ];
      for (const t of filteredTransformations) {
        stockData.push([
          t.code || t.id,
          t.date ? new Date(t.date).toLocaleDateString('pt-MZ') : '',
          'Transformação',
          t.originalProductName,
          `${t.originalQuantity} ${t.originalUnit}`,
          t.lossValue ? `${t.lossValue} MT (Perda)` : '0.00 MT',
          t.operatorName || 'Operador',
          t.status
        ]);
      }
      for (const l of filteredLosses) {
        stockData.push([
          l.id,
          l.date ? new Date(l.date).toLocaleDateString('pt-MZ') : '',
          'Quebra / Perda',
          l.productName,
          `${l.quantity}`,
          `${l.lossValue} MT`,
          l.registeredBy || 'Operador',
          l.reason
        ]);
      }
      const wsStock = XLSX.utils.aoa_to_sheet(stockData);
      XLSX.utils.book_append_sheet(wb, wsStock, 'Stock e Transformações');

      // Download file using robust blob trigger
      const filename = `RELATORIO_COMPLETO_SISTEMA_${period.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const blobUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = blobUrl;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      setTimeout(() => {
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(blobUrl);
      }, 500);
    } catch (e: any) {
      console.error('Erro na exportação Excel:', e);
      alert('Erro ao gerar ficheiro Excel: ' + e.message);
    } finally {
      setIsExporting(false);
    }
  };

  // Export to PDF handler
  const handleExportPDF = () => {
    setIsExporting(true);
    try {
      const doc = new jsPDF('landscape', 'mm', 'a4');
      const companyName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';
      const companyNuit = settings?.companyNuit || '401976590';

      // Header Banner
      doc.setFillColor(14, 98, 49);
      doc.rect(0, 0, 297, 22, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.text(companyName.toUpperCase(), 15, 12);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`NUIT: ${companyNuit} | RELATÓRIO EXECUTIVO COMPLETO DO SISTEMA (${period.toUpperCase()})`, 15, 18);
      doc.text(`Gerado em: ${new Date().toLocaleString('pt-MZ')}`, 240, 18);

      let currentY = 30;

      // Summary KPI Grid
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('1. RESUMO GERAL DE OPERAÇÕES E DESEMPENHO', 15, currentY);
      currentY += 5;

      const summaryRows = [
        ['Faturação Bruta Concluída:', `${totalInvoiced.toLocaleString('pt-MZ')} MT`, 'Vendas Concluídas:', `${paidSales.length}`],
        ['Custo das Mercadorias Vendidas:', `${totalCost.toLocaleString('pt-MZ')} MT`, 'Vendas a Crédito / Pendentes:', `${pendingSales.length}`],
        ['Margem Lucro Est.:', `${netProfit.toLocaleString('pt-MZ')} MT`, 'Vendas Canceladas / Anuladas:', `${cancelledSales.length}`],
        ['Total Descontos Concedidos:', `${totalDiscounts.toLocaleString('pt-MZ')} MT`, 'Total Transações:', `${filteredSales.length}`],
        ['IVA Líquido Estimado (16%):', `${Math.round(totalVat).toLocaleString('pt-MZ')} MT`, 'Clientes com Nome Registado:', `${namedCustomers.length}`]
      ];

      autoTable(doc, {
        startY: currentY,
        body: summaryRows,
        theme: 'plain',
        styles: { fontSize: 8.5, cellPadding: 2 },
        columnStyles: {
          0: { fontStyle: 'bold', textColor: [70, 70, 70], cellWidth: 65 },
          1: { fontStyle: 'bold', textColor: [14, 98, 49], cellWidth: 50 },
          2: { fontStyle: 'bold', textColor: [70, 70, 70], cellWidth: 65 },
          3: { fontStyle: 'bold', textColor: [30, 41, 59], cellWidth: 50 }
        }
      });

      currentY = ((doc as any).lastAutoTable?.finalY || currentY + 30) + 10;

      // Table 2: Vendas do Período
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`2. REGISTO DETALHADO DE VENDAS (${filteredSales.length} DOCUMENTOS)`, 15, currentY);
      currentY += 4;

      const salesTableRows = filteredSales.slice(0, 40).map(s => [
        s.invoiceNumber || s.id,
        s.date ? new Date(s.date).toLocaleDateString('pt-MZ') : '',
        (s.customerName || 'Cliente Geral').slice(0, 24),
        s.operatorName || 'Operador',
        Number(s.subtotal || 0).toLocaleString('pt-MZ') + ' MT',
        Number(s.discount || 0) > 0 ? `-${Number(s.discount).toLocaleString('pt-MZ')} MT` : '-',
        Number(s.total || 0).toLocaleString('pt-MZ') + ' MT',
        s.paymentMethod || 'Numerário',
        s.status || 'Paga'
      ]);

      autoTable(doc, {
        startY: currentY,
        head: [['Nº FATURA', 'DATA', 'CLIENTE', 'OPERADOR', 'SUBTOTAL', 'DESCONTO', 'TOTAL', 'MÉTODO', 'ESTADO']],
        body: salesTableRows,
        theme: 'striped',
        styles: { fontSize: 7.5, cellPadding: 1.8 },
        headStyles: { fillColor: [14, 98, 49], textColor: [255, 255, 255], fontStyle: 'bold' }
      });

      // Add New Page for Discounts and Clients
      doc.addPage('a4', 'landscape');
      currentY = 20;

      // Table 3: Descontos
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`3. AUDITORIA DE DESCONTOS CONCEDIDOS (${salesWithDiscount.length} OPERAÇÕES)`, 15, currentY);
      currentY += 4;

      const discountRows = salesWithDiscount.slice(0, 30).map(s => {
        const sub = Number(s.subtotal || 1);
        const disc = Number(s.discount || 0);
        return [
          s.invoiceNumber || s.id,
          s.date ? new Date(s.date).toLocaleDateString('pt-MZ') : '',
          s.customerName || 'Cliente Geral',
          s.operatorName || 'Operador',
          sub.toLocaleString('pt-MZ') + ' MT',
          `-${disc.toLocaleString('pt-MZ')} MT`,
          ((disc / sub) * 100).toFixed(1) + '%'
        ];
      });

      autoTable(doc, {
        startY: currentY,
        head: [['Nº FATURA', 'DATA', 'CLIENTE', 'OPERADOR', 'VALOR ORIGINAL', 'DESCONTO', '% CONCEDIDO']],
        body: discountRows.length > 0 ? discountRows : [['Nenhum desconto registado neste período', '-', '-', '-', '-', '-', '-']],
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [180, 83, 9], textColor: [255, 255, 255] }
      });

      currentY = ((doc as any).lastAutoTable?.finalY || currentY + 30) + 12;

      // Table 4: Clientes com Nome
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`4. TOP CLIENTES IDENTIFICADOS (${namedCustomers.length} CLIENTES)`, 15, currentY);
      currentY += 4;

      const customerRows = namedCustomers.slice(0, 20).map(c => [
        c.name,
        c.nuit || '-',
        c.salesCount.toString(),
        c.totalSpent.toLocaleString('pt-MZ') + ' MT'
      ]);

      autoTable(doc, {
        startY: currentY,
        head: [['NOME DO CLIENTE', 'NUIT', 'QTD COMPRAS', 'TOTAL ACUMULADO (MT)']],
        body: customerRows.length > 0 ? customerRows : [['Nenhum cliente identificado no período', '-', '-', '-']],
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255] }
      });

      const filename = `RELATORIO_COMPLETO_SISTEMA_${period.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
      const pdfBlob = doc.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const downloadPdfLink = document.createElement('a');
      downloadPdfLink.href = pdfUrl;
      downloadPdfLink.download = filename;
      document.body.appendChild(downloadPdfLink);
      downloadPdfLink.click();
      setTimeout(() => {
        document.body.removeChild(downloadPdfLink);
        URL.revokeObjectURL(pdfUrl);
      }, 500);
    } catch (e: any) {
      console.error('Erro na exportação PDF:', e);
      alert('Erro ao gerar relatório PDF: ' + e.message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-3xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
        
        {/* Header */}
        <div className="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <span className="material-symbols-outlined text-2xl">assessment</span>
            </div>
            <div>
              <h3 className="text-base font-black uppercase tracking-wide">Relatório Completo do Sistema</h3>
              <p className="text-xs text-slate-400">Auditoria Global, Vendas, Descontos, Clientes e Movimentos</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">table_view</span>
              Exportar Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={handleExportPDF}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">picture_as_pdf</span>
              Exportar PDF (.pdf)
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
        </div>

        {/* Period Selector Tabs */}
        <div className="p-3 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          <span className="text-slate-500 text-[11px] font-bold uppercase mr-1">Período:</span>
          {(['Hoje', 'Esta Semana', 'Este Mês', 'Este Trimestre', 'Este Semestre', 'Este Ano', '3 Anos', '5 Anos', 'Todo o Histórico'] as MasterReportPeriod[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                period === p
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Sub-tab Views */}
        <div className="px-5 pt-3 border-b border-slate-200 flex items-center gap-4 text-xs font-bold text-slate-600 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveReportTab('summary')}
            className={`pb-2.5 border-b-2 cursor-pointer transition-all ${
              activeReportTab === 'summary' ? 'border-emerald-600 text-emerald-700' : 'border-transparent hover:text-slate-900'
            }`}
          >
            Resumo Geral
          </button>
          <button
            type="button"
            onClick={() => setActiveReportTab('sales')}
            className={`pb-2.5 border-b-2 cursor-pointer transition-all ${
              activeReportTab === 'sales' ? 'border-emerald-600 text-emerald-700' : 'border-transparent hover:text-slate-900'
            }`}
          >
            Vendas ({filteredSales.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveReportTab('discounts')}
            className={`pb-2.5 border-b-2 cursor-pointer transition-all ${
              activeReportTab === 'discounts' ? 'border-amber-600 text-amber-700' : 'border-transparent hover:text-slate-900'
            }`}
          >
            Tabela de Descontos ({salesWithDiscount.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveReportTab('customers')}
            className={`pb-2.5 border-b-2 cursor-pointer transition-all ${
              activeReportTab === 'customers' ? 'border-teal-600 text-teal-700' : 'border-transparent hover:text-slate-900'
            }`}
          >
            Clientes Identificados ({namedCustomers.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveReportTab('stock')}
            className={`pb-2.5 border-b-2 cursor-pointer transition-all ${
              activeReportTab === 'stock' ? 'border-purple-600 text-purple-700' : 'border-transparent hover:text-slate-900'
            }`}
          >
            Stock & Transformações ({filteredTransformations.length + filteredLosses.length})
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {activeReportTab === 'summary' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100">
                  <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider">Faturação Concluída</span>
                  <p className="text-xl font-black text-emerald-950 font-mono mt-1">{totalInvoiced.toLocaleString('pt-MZ')} MT</p>
                  <span className="text-[10px] text-emerald-700 font-medium">{paidSales.length} faturas liquidadas</span>
                </div>
                <div className="bg-teal-50/50 p-4 rounded-2xl border border-teal-100">
                  <span className="text-[10px] font-black uppercase text-teal-800 tracking-wider">Margem de Lucro Est.</span>
                  <p className="text-xl font-black text-teal-950 font-mono mt-1">{netProfit.toLocaleString('pt-MZ')} MT</p>
                  <span className="text-[10px] text-teal-700 font-medium">Após custo real dos artigos</span>
                </div>
                <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-100">
                  <span className="text-[10px] font-black uppercase text-amber-800 tracking-wider">Total em Descontos</span>
                  <p className="text-xl font-black text-amber-950 font-mono mt-1">-{totalDiscounts.toLocaleString('pt-MZ')} MT</p>
                  <span className="text-[10px] text-amber-700 font-medium">{salesWithDiscount.length} vendas com desconto</span>
                </div>
                <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
                  <span className="text-[10px] font-black uppercase text-blue-800 tracking-wider">IVA Estimado (16%)</span>
                  <p className="text-xl font-black text-blue-950 font-mono mt-1">{Math.round(totalVat).toLocaleString('pt-MZ')} MT</p>
                  <span className="text-[10px] text-blue-700 font-medium">Incluído no valor bruto</span>
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-2">
                <h4 className="font-bold text-slate-800 uppercase text-[11px]">Resumo Operacional ({period})</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-slate-600">
                  <div>Vendas Concluídas: <strong className="text-slate-900">{paidSales.length}</strong></div>
                  <div>Vendas a Crédito: <strong className="text-slate-900">{pendingSales.length}</strong></div>
                  <div>Vendas Canceladas: <strong className="text-red-700">{cancelledSales.length}</strong></div>
                  <div>Clientes Registados: <strong className="text-slate-900">{namedCustomers.length}</strong></div>
                </div>
              </div>
            </div>
          )}

          {activeReportTab === 'sales' && (
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0">
                    <tr>
                      <th className="p-2.5">Fatura Nº</th>
                      <th className="p-2.5">Data</th>
                      <th className="p-2.5">Cliente</th>
                      <th className="p-2.5">Operador</th>
                      <th className="p-2.5 text-right">Subtotal</th>
                      <th className="p-2.5 text-right">Desconto</th>
                      <th className="p-2.5 text-right">Total</th>
                      <th className="p-2.5 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSales.map(s => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold font-mono text-slate-900">{s.invoiceNumber || s.id}</td>
                        <td className="p-2.5 text-slate-500">{s.date ? new Date(s.date).toLocaleDateString('pt-MZ') : '-'}</td>
                        <td className="p-2.5 font-medium text-slate-800">{s.customerName || 'Cliente Geral'}</td>
                        <td className="p-2.5 text-slate-600">{s.operatorName || 'Operador'}</td>
                        <td className="p-2.5 text-right font-mono">{Number(s.subtotal || 0).toLocaleString('pt-MZ')} MT</td>
                        <td className="p-2.5 text-right font-mono text-amber-700">{Number(s.discount || 0) > 0 ? `-${Number(s.discount).toLocaleString('pt-MZ')} MT` : '-'}</td>
                        <td className="p-2.5 text-right font-bold font-mono text-emerald-700">{Number(s.total || 0).toLocaleString('pt-MZ')} MT</td>
                        <td className="p-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            s.status === 'Paga' ? 'bg-emerald-100 text-emerald-800' :
                            s.status === 'Cancelada' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeReportTab === 'discounts' && (
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-amber-50 text-amber-900 font-bold sticky top-0">
                    <tr>
                      <th className="p-2.5">Fatura Nº</th>
                      <th className="p-2.5">Data</th>
                      <th className="p-2.5">Cliente</th>
                      <th className="p-2.5">Operador</th>
                      <th className="p-2.5 text-right">Subtotal</th>
                      <th className="p-2.5 text-right">Desconto Aplicado</th>
                      <th className="p-2.5 text-right">% Desconto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {salesWithDiscount.map(s => {
                      const sub = Number(s.subtotal || 1);
                      const disc = Number(s.discount || 0);
                      const pct = ((disc / sub) * 100).toFixed(1);
                      return (
                        <tr key={s.id} className="hover:bg-slate-50">
                          <td className="p-2.5 font-bold font-mono text-slate-900">{s.invoiceNumber || s.id}</td>
                          <td className="p-2.5 text-slate-500">{s.date ? new Date(s.date).toLocaleDateString('pt-MZ') : '-'}</td>
                          <td className="p-2.5 font-medium text-slate-800">{s.customerName || 'Cliente Geral'}</td>
                          <td className="p-2.5 text-slate-600">{s.operatorName || 'Operador'}</td>
                          <td className="p-2.5 text-right font-mono">{sub.toLocaleString('pt-MZ')} MT</td>
                          <td className="p-2.5 text-right font-mono font-bold text-amber-700">-{disc.toLocaleString('pt-MZ')} MT</td>
                          <td className="p-2.5 text-right font-mono font-bold text-amber-800">{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeReportTab === 'customers' && (
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-teal-50 text-teal-900 font-bold sticky top-0">
                    <tr>
                      <th className="p-2.5">Nome do Cliente</th>
                      <th className="p-2.5">NUIT</th>
                      <th className="p-2.5 text-center">Compras Efetuadas</th>
                      <th className="p-2.5 text-right">Total Acumulado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {namedCustomers.map(c => (
                      <tr key={c.name} className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold text-slate-900">{c.name}</td>
                        <td className="p-2.5 text-slate-500 font-mono">{c.nuit || '-'}</td>
                        <td className="p-2.5 text-center font-bold text-slate-700">{c.salesCount}</td>
                        <td className="p-2.5 text-right font-bold font-mono text-teal-700">{c.totalSpent.toLocaleString('pt-MZ')} MT</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeReportTab === 'stock' && (
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-purple-50 text-purple-900 font-bold sticky top-0">
                    <tr>
                      <th className="p-2.5">Documento</th>
                      <th className="p-2.5">Data</th>
                      <th className="p-2.5">Tipo</th>
                      <th className="p-2.5">Artigo</th>
                      <th className="p-2.5">Quantidade</th>
                      <th className="p-2.5 text-center">Estado / Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTransformations.map(t => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold font-mono text-slate-900">{t.code || t.id}</td>
                        <td className="p-2.5 text-slate-500">{t.date ? new Date(t.date).toLocaleDateString('pt-MZ') : '-'}</td>
                        <td className="p-2.5 font-bold text-purple-700">Transformação</td>
                        <td className="p-2.5 font-medium text-slate-800">{t.originalProductName}</td>
                        <td className="p-2.5 font-mono">{t.originalQuantity} {t.originalUnit}</td>
                        <td className="p-2.5 text-center font-bold text-slate-600">{t.status}</td>
                      </tr>
                    ))}
                    {filteredLosses.map(l => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-mono text-slate-500">{l.id.slice(0, 10)}</td>
                        <td className="p-2.5 text-slate-500">{l.date ? new Date(l.date).toLocaleDateString('pt-MZ') : '-'}</td>
                        <td className="p-2.5 font-bold text-rose-700">Quebra / Perda</td>
                        <td className="p-2.5 font-medium text-slate-800">{l.productName}</td>
                        <td className="p-2.5 font-mono">{l.quantity}</td>
                        <td className="p-2.5 text-center text-slate-600">{l.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Relatório Completo gerado com dados oficiais do ERP AgroGestão Zero.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>

      </div>
    </div>
  );
}
