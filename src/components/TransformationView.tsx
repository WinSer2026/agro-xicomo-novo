import { companyNuit } from '../utils/companyInfo';
import React, { useState, useEffect } from 'react';
import { ProductTransformation, Product, SystemSettings } from '../types';
import { appConfirm, appAlert } from '../utils/confirmDialog';
import { dbService } from '../utils/firebaseDB';
import { DateRangeFilter } from './DateRangeFilter';
import { DateRangePreset, getDateRangeFromPreset, isDateInRange, formatDatePT } from '../utils/dateRangeHelper';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

interface TransformationViewProps {
  products: Product[];
  currentUser: { username: string; role: string };
  settings?: SystemSettings | null;
  onOpenNewModal: () => void;
}

export const TransformationView: React.FC<TransformationViewProps> = ({
  products,
  currentUser,
  settings,
  onOpenNewModal
}) => {
  const [transformations, setTransformations] = useState<ProductTransformation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Concluída' | 'Cancelada'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [isReversing, setIsReversing] = useState<string | null>(null);

  // Date Range Filter States (Default: Este Mês)
  const defaultRange = getDateRangeFromPreset('Este Mês');
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [datePreset, setDatePreset] = useState<DateRangePreset>('Este Mês');

  useEffect(() => {
    loadTransformations();

    const handleUpdate = (e: any) => {
      const table = e.detail?.table;
      if (!table || table === 'all' || table === 'transformations' || table === 'products') {
        loadTransformations();
      }
    };

    window.addEventListener('db-update', handleUpdate);
    return () => window.removeEventListener('db-update', handleUpdate);
  }, []);

  const loadTransformations = async () => {
    setIsLoading(true);
    try {
      await dbService.init();
      const list = await dbService.getTransformations();
      setTransformations(list);
    } catch (err) {
      console.error('Error loading transformations:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  // Filtered Transformations by Date Range, Status and Search Query
  const filteredTransformations = transformations.filter(t => {
    // 1. Date Range Filter using the actual date of transformation
    const trfDate = t.date || (t.createdAt ? t.createdAt.split('T')[0] : '');
    if (!isDateInRange(trfDate, startDate, endDate)) {
      return false;
    }

    // 2. Status Filter
    if (statusFilter !== 'all' && t.status !== statusFilter) {
      return false;
    }

    // 3. Search Query filter (code, original product, code, operator, notes, resulting items)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const codeMatch = (t.code || '').toLowerCase().includes(q);
      const nameMatch = (t.originalProductName || '').toLowerCase().includes(q);
      const origCodeMatch = (t.originalProductCode || '').toLowerCase().includes(q);
      const opMatch = (t.operatorName || '').toLowerCase().includes(q);
      const notesMatch = (t.notes || '').toLowerCase().includes(q);
      const itemsMatch = (t.items || []).some(it => 
        it.resultingProductName.toLowerCase().includes(q) || 
        (it.resultingProductCode || '').toLowerCase().includes(q)
      );
      if (!codeMatch && !nameMatch && !origCodeMatch && !opMatch && !notesMatch && !itemsMatch) return false;
    }

    return true;
  });

  // KPI Calculations for the selected period
  const totalTransformationsCount = filteredTransformations.filter(t => t.status !== 'Cancelada').length;
  const totalOriginalQty = filteredTransformations
    .filter(t => t.status !== 'Cancelada')
    .reduce((sum, t) => sum + t.originalQuantity, 0);
  const totalOriginalCost = filteredTransformations
    .filter(t => t.status !== 'Cancelada')
    .reduce((sum, t) => sum + t.originalTotalCost, 0);
  const totalPackagesCreated = filteredTransformations
    .filter(t => t.status !== 'Cancelada')
    .reduce((sum, t) => sum + t.items.reduce((s, it) => s + it.quantity, 0), 0);
  const totalLossQty = filteredTransformations
    .filter(t => t.status !== 'Cancelada')
    .reduce((sum, t) => sum + t.lossQuantity, 0);
  const totalLossValue = filteredTransformations
    .filter(t => t.status !== 'Cancelada')
    .reduce((sum, t) => sum + t.lossValue, 0);

  const handlePrintVoucher = (trf: ProductTransformation) => {
    const doc = new jsPDF({ format: 'a4', unit: 'mm' });
    const compName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';
    const compNuit = companyNuit(settings?.companyNuit);

    // Header Banner
    doc.setFillColor(6, 78, 59);
    doc.rect(0, 0, 210, 32, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(compName, 14, 14);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`NUIT: ${compNuit} • Guia Interna de Transformação e Fracionamento`, 14, 22);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`CÓDIGO: ${trf.code}`, 150, 16);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Data: ${formatDatePT(trf.date)}`, 150, 22);

    // Section 1
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('1. Produto Original Requisitado', 14, 44);

    autoTable(doc, {
      startY: 48,
      head: [['Artigo Original', 'Qtd Requisitada', 'Custo Unitário', 'Custo Total Requisitado']],
      body: [
        [
          trf.originalProductName,
          `${trf.originalQuantity} ${trf.originalUnit}`,
          `${trf.originalUnitCost.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`,
          `${trf.originalTotalCost.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`
        ]
      ],
      headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: 'bold' },
      theme: 'grid'
    });

    // Section 2
    const lastY = (doc as any).lastAutoTable.finalY || 70;
    doc.text('2. Produtos Resultantes Gerados (Entrada no Stock)', 14, lastY + 12);

    const resultingTableRows = trf.items.map(it => [
      it.resultingProductName,
      `${it.quantity} ${it.unit}`,
      `${it.unitWeight} ${trf.originalUnit}`,
      `${(it.quantity * it.unitWeight)} ${trf.originalUnit}`,
      `${it.calculatedUnitCost.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`,
      `${(it.sellingPrice || 0).toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`,
      `${(it.quantity * it.calculatedUnitCost).toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`
    ]);

    autoTable(doc, {
      startY: lastY + 16,
      head: [['Artigo Resultante', 'Pacotes/Qtd', 'Peso Unit.', 'Total Peso', 'Custo Unit.', 'Preço Venda', 'Custo Total']],
      body: resultingTableRows,
      headStyles: { fillColor: [4, 120, 87], textColor: [255, 255, 255], fontStyle: 'bold' },
      theme: 'grid'
    });

    // Section 3
    const finalTableY = (doc as any).lastAutoTable.finalY || 130;
    doc.text('3. Balanço Contabilístico & Registo de Perdas', 14, finalTableY + 12);

    autoTable(doc, {
      startY: finalTableY + 16,
      head: [['Indicador', 'Quantidade', 'Valor Monetário (MT)', 'Impacto Financeiro']],
      body: [
        ['Saída de Stock Original', `${trf.originalQuantity} ${trf.originalUnit}`, `${trf.originalTotalCost.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`, 'Crédito de Stock Original'],
        ['Entrada de Stock Resultante', `${trf.items.reduce((s, x) => s + x.quantity, 0)} unidades`, `${trf.items.reduce((s, x) => s + (x.quantity * x.calculatedUnitCost), 0).toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`, 'Débito em Stock Fracionado'],
        ['Perda no Processo', `${trf.lossQuantity} ${trf.originalUnit}`, `${trf.lossValue.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`, trf.lossQuantity > 0 ? 'Custo Operacional de Quebra' : 'Sem Perdas (100% Eficiente)'],
        ['Balanço Líquido de Custo', 'Equilíbrio Perfeito', '0.00 MT', 'NEUTRALIDADE FINANCEIRA ✓']
      ],
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold' },
      theme: 'grid'
    });

    const sigY = Math.min(265, (doc as any).lastAutoTable.finalY + 30);
    doc.setFontSize(9);
    doc.line(14, sigY, 90, sigY);
    doc.text(`Responsável: ${trf.operatorName}`, 14, sigY + 5);
    doc.text('Gestor de Stock / Transformações', 14, sigY + 10);

    doc.line(120, sigY, 196, sigY);
    doc.text('Aprovação / Administração', 120, sigY + 5);
    doc.text('AGRO - XICOMO & SERVIÇOS, LDA', 120, sigY + 10);

    doc.save(`GUIA_TRANSFORMACAO_${trf.code}.pdf`);
  };

  const handleExportReportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape', format: 'a4', unit: 'mm' });
    const compName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';

    // Header
    doc.setFillColor(6, 78, 59);
    doc.rect(0, 0, 297, 28, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(`${compName} • Relatório de Transformações & Fracionamento`, 14, 12);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Período de Análise: ${formatDatePT(startDate)} até ${formatDatePT(endDate)} • Emitido em: ${new Date().toLocaleString('pt-MZ')}`, 14, 20);

    // Summary Box
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total de Transformações: ${totalTransformationsCount} | Consumido: ${totalOriginalQty} unidades | Pacotes Criados: ${totalPackagesCreated} | Perda Total: ${totalLossValue.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`, 14, 36);

    const rows = filteredTransformations.map(t => [
      t.code,
      formatDatePT(t.date),
      t.originalProductName,
      `${t.originalQuantity} ${t.originalUnit}`,
      `${t.originalTotalCost.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`,
      `${t.items.reduce((s, it) => s + it.quantity, 0)} pacotes (${t.items.length} tipos)`,
      `${t.lossQuantity} ${t.originalUnit} (${t.lossValue.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT)`,
      t.operatorName,
      t.status
    ]);

    autoTable(doc, {
      startY: 42,
      head: [['Código', 'Data', 'Artigo Original', 'Qtd Original', 'Custo Original', 'Pacotes Gerados', 'Perda', 'Operador', 'Estado']],
      body: rows,
      headStyles: { fillColor: [4, 120, 87], textColor: [255, 255, 255], fontStyle: 'bold' },
      theme: 'striped',
      styles: { fontSize: 8 }
    });

    doc.save(`RELATORIO_TRANSFORMACOES_${startDate}_a_${endDate}.pdf`);
  };

  const handleExportExcel = () => {
    const dataRows = filteredTransformations.map(t => ({
      'Código': t.code,
      'Data': formatDatePT(t.date),
      'Produto Original': t.originalProductName,
      'Qtd Original': t.originalQuantity,
      'Unidade Original': t.originalUnit,
      'Custo Unitário (MT)': t.originalUnitCost,
      'Custo Total (MT)': t.originalTotalCost,
      'Pacotes Gerados': t.items.reduce((s, it) => s + it.quantity, 0),
      'Perda (Qtd)': t.lossQuantity,
      'Perda (MT)': t.lossValue,
      'Responsável': t.operatorName,
      'Estado': t.status,
      'Observações': t.notes || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Transformacoes');
    XLSX.writeFile(workbook, `TRANSFORMACOES_${startDate}_a_${endDate}.xlsx`);
    showToast('Exportação para Excel concluída com sucesso!');
  };

  const handleCancelTransformation = async (trf: ProductTransformation) => {
    if (trf.status === 'Cancelada') return;

    const confirmed = await appConfirm(`Deseja mesmo anular a transformação ${trf.code}? O stock original (${trf.originalQuantity} ${trf.originalUnit}) será restaurado e os artigos fracionados gerados serão subtraídos do inventário.`);
    if (!confirmed) return;

    setIsReversing(trf.id);
    try {
      await dbService.cancelTransformationWithStockReversal(trf);

      void dbService.addAuditLog({
        id: 'log-' + Date.now(),
        timestamp: new Date().toISOString(),
        username: currentUser.username,
        ipAddress: '127.0.0.1',
        action: 'Transformação de Produto Anulada',
        status: 'Alerta',
        details: `Anulação da transformação ${trf.code}. Stock original restaurado com sucesso.`
      });

      showToast(`Transformação ${trf.code} anulada e stock reposto com sucesso!`);
      loadTransformations();
    } catch (err: any) {
      console.error('Error reversing transformation:', err);
      void appAlert('Erro ao anular transformação: ' + err.message);
    } finally {
      setIsReversing(null);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 bg-emerald-800 text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-bottom-2">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Top Banner & Action */}
      <div className="bg-linear-to-r from-emerald-800 to-teal-900 rounded-2xl p-5 sm:p-6 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-white/10 rounded-xl material-symbols-outlined text-2xl">
              swap_horizontal_circle
            </span>
            <h3 className="font-black text-base sm:text-lg tracking-tight font-headline-lg">
              Gestão de Transformações & Fracionamento
            </h3>
          </div>
          <p className="text-xs text-emerald-200">
            Registo rastreável de empacotamento, divisão de sacos, transferência de custos e relatórios de quebras
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenNewModal}
          className="px-5 py-3 bg-white text-emerald-900 hover:bg-emerald-50 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 shrink-0"
        >
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          Nova Transformação de Produto
        </button>
      </div>

      {/* Date Range Filter Component */}
      <DateRangeFilter
        title="Filtro de Período das Transformações"
        startDate={startDate}
        endDate={endDate}
        preset={datePreset}
        onRangeChange={(start, end, preset) => {
          setStartDate(start);
          setEndDate(end);
          setDatePreset(preset);
        }}
        onExportPDF={handleExportReportPDF}
        onExportExcel={handleExportExcel}
      />

      {/* KPI Cards for the period */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Transformações</span>
          <p className="text-xl font-black text-gray-900 mt-1">{totalTransformationsCount}</p>
          <p className="text-[10px] text-gray-400">no período</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Volume Original</span>
          <p className="text-xl font-black text-emerald-800 mt-1">{totalOriginalQty}</p>
          <p className="text-[10px] text-gray-400">unidades/kg consumidos</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Custo Original</span>
          <p className="text-lg font-black text-emerald-900 mt-1 font-mono">
            {totalOriginalCost.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT
          </p>
          <p className="text-[10px] text-gray-400">transferido para pacotes</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Pacotes Criados</span>
          <p className="text-xl font-black text-teal-800 mt-1">{totalPackagesCreated}</p>
          <p className="text-[10px] text-gray-400">unidades para retalho</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
          <span className="text-[10px] font-black text-amber-800 uppercase tracking-wider">Perdas Totais</span>
          <p className="text-lg font-black text-amber-900 mt-1 font-mono">
            {totalLossValue.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT
          </p>
          <p className="text-[10px] text-amber-700">({totalLossQty} unidades/kg)</p>
        </div>

        <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200 shadow-xs">
          <span className="text-[10px] font-black text-emerald-800 uppercase tracking-wider">Impacto Líquido</span>
          <p className="text-lg font-black text-emerald-950 mt-1">0.00 MT</p>
          <p className="text-[10px] font-bold text-emerald-700">Neutro (Sem Venda/Custo) ✓</p>
        </div>
      </div>

      {/* Search & List of Transformations */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-gray-150 pb-4">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-700 text-xl">history</span>
            <div>
              <h4 className="font-black text-gray-800 text-sm uppercase tracking-tight">
                Histórico de Transformações Realizadas
              </h4>
              <p className="text-[11px] text-gray-500">
                A mostrar <strong className="text-emerald-700">{filteredTransformations.length}</strong> de {transformations.length} registos
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter Chips */}
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl text-xs font-bold border border-gray-200">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  statusFilter === 'all'
                    ? 'bg-white text-gray-800 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('Concluída')}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'Concluída'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-emerald-700 hover:bg-emerald-50'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                Concluídas
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('Cancelada')}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                  statusFilter === 'Cancelada'
                    ? 'bg-red-600 text-white shadow-xs'
                    : 'text-red-700 hover:bg-red-50'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                Canceladas
              </button>
            </div>

            {/* Search Input with quick clear */}
            <div className="relative w-full sm:w-80">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Pesquisar código, artigo, operador..."
                className="w-full bg-gray-50 border border-gray-300 rounded-xl pl-9 pr-8 py-1.5 text-xs font-bold text-gray-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
                  title="Limpar pesquisa"
                >
                  <span className="material-symbols-outlined text-[16px]">cancel</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Table / Cards List */}
        {isLoading ? (
          <div className="py-12 text-center text-gray-400 space-y-2">
            <span className="animate-spin rounded-full h-6 w-6 border-2 border-emerald-600 border-t-transparent inline-block" />
            <p className="text-xs">A carregar registos de transformações...</p>
          </div>
        ) : filteredTransformations.length === 0 ? (
          <div className="py-12 text-center text-gray-400 space-y-2">
            <span className="material-symbols-outlined text-4xl text-gray-300">inventory_2</span>
            <p className="text-xs font-bold text-gray-500">
              Nenhuma transformação registada no período de {formatDatePT(startDate)} a {formatDatePT(endDate)}.
            </p>
            <button
              type="button"
              onClick={onOpenNewModal}
              className="text-xs font-black text-emerald-700 hover:underline cursor-pointer"
            >
              + Registar primeira transformação agora
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTransformations.map(t => {
              const isExpanded = expandedId === t.id;
              const isCancelled = t.status === 'Cancelada';

              return (
                <div
                  key={t.id}
                  className={`border rounded-xl transition-all ${
                    isCancelled
                      ? 'bg-red-50/40 border-red-200 opacity-75'
                      : isExpanded
                      ? 'bg-emerald-50/20 border-emerald-400 shadow-md ring-1 ring-emerald-300'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {/* Row Summary */}
                  <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                    
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-xl shrink-0 ${isCancelled ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'}`}>
                        <span className="material-symbols-outlined text-[20px]">
                          {isCancelled ? 'block' : 'call_split'}
                        </span>
                      </div>
                      
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-black text-slate-900 text-sm">
                            {t.code}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            isCancelled
                              ? 'bg-red-100 text-red-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {t.status}
                          </span>
                          <span className="text-[11px] text-gray-500 font-medium">
                            • {formatDatePT(t.date)}
                          </span>
                        </div>

                        <p className="font-bold text-gray-800">
                          Requisitado: <span className="text-emerald-900 font-black">{t.originalQuantity} {t.originalUnit}</span> de {t.originalProductName}
                        </p>
                        
                        <p className="text-[11px] text-gray-500">
                          Gerou {t.items.reduce((s, it) => s + it.quantity, 0)} pacotes em {t.items.length} tipos de artigos • Operador: <strong className="text-gray-700">{t.operatorName}</strong>
                        </p>
                      </div>
                    </div>

                    {/* Right side info and actions */}
                    <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
                      <div className="text-right mr-2 hidden sm:block">
                        <span className="text-[9px] font-black uppercase text-gray-400">Custo Total</span>
                        <p className="font-mono font-black text-gray-800 text-xs">
                          {t.originalTotalCost.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handlePrintVoucher(t)}
                        className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                        title="Imprimir Guia"
                      >
                        <span className="material-symbols-outlined text-[15px]">print</span>
                        <span className="hidden sm:inline">Guia</span>
                      </button>

                      {!isCancelled && (
                        <button
                          type="button"
                          disabled={isReversing === t.id}
                          onClick={() => handleCancelTransformation(t)}
                          className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                          title="Anular e Repor Stock"
                        >
                          <span className="material-symbols-outlined text-[15px]">undo</span>
                          <span className="hidden sm:inline">Anular</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : t.id)}
                        className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[20px]">
                          {isExpanded ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 p-4 bg-gray-50/70 rounded-b-xl space-y-3 text-xs animate-in fade-in">
                      <h5 className="font-black text-gray-700 text-[11px] uppercase tracking-wider">
                        Detalhes dos Artigos Fracionados Resultantes
                      </h5>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-emerald-800/10 text-emerald-950 font-black border-b border-emerald-200">
                              <th className="p-2">Artigo Resultante</th>
                              <th className="p-2 text-center">Quantidade</th>
                              <th className="p-2 text-center">Peso/Unid.</th>
                              <th className="p-2 text-center">Peso Total</th>
                              <th className="p-2 text-right">Custo Unit. Calculado</th>
                              <th className="p-2 text-right">Preço de Venda</th>
                              <th className="p-2 text-right">Custo Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {t.items.map(it => (
                              <tr key={it.id} className="bg-white">
                                <td className="p-2 font-bold text-gray-900">{it.resultingProductName}</td>
                                <td className="p-2 text-center font-black text-emerald-800">{it.quantity} {it.unit}</td>
                                <td className="p-2 text-center font-mono">{it.unitWeight} {t.originalUnit}</td>
                                <td className="p-2 text-center font-mono font-bold">{(it.quantity * it.unitWeight)} {t.originalUnit}</td>
                                <td className="p-2 text-right font-mono font-bold text-emerald-900">
                                  {it.calculatedUnitCost.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT
                                </td>
                                <td className="p-2 text-right font-mono text-gray-700">
                                  {(it.sellingPrice || 0).toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT
                                </td>
                                <td className="p-2 text-right font-mono font-black text-emerald-950">
                                  {(it.quantity * it.calculatedUnitCost).toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Loss and Notes */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-[11px]">
                        <div className="p-2.5 bg-white rounded-lg border border-gray-200 space-y-0.5">
                          <span className="font-black text-gray-500 uppercase text-[9px]">Perda na Transformação</span>
                          <p className="font-black text-amber-900">
                            {t.lossQuantity} {t.originalUnit} ({t.lossValue.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT)
                          </p>
                        </div>

                        <div className="p-2.5 bg-white rounded-lg border border-gray-200 space-y-0.5">
                          <span className="font-black text-gray-500 uppercase text-[9px]">Observações</span>
                          <p className="text-gray-700 font-medium">
                            {t.notes || 'Nenhuma observação registada.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TransformationView;
