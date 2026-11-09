/**
 * FERRAMENTA DE CORTE DE INVENTÁRIO
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * Resolve o caso em que a contagem física é tirada a uma hora e só é lançada no
 * sistema mais tarde, depois de já terem sido feitas vendas. Nessa situação o stock
 * do sistema fica inflacionado exactamente nas quantidades vendidas no intervalo.
 *
 * Dois modos de operação:
 *
 *  1. ANULAR VENDAS (sem estorno de stock)
 *     Marca as vendas do período como "Cancelada" e NÃO devolve as quantidades ao
 *     stock — porque o inventário lançado é anterior a essas vendas. A seguir as
 *     vendas são relançadas no PDV e o stock volta a descontar normalmente.
 *
 *  2. DESCONTAR VENDAS DO STOCK (vendas mantêm-se válidas)
 *     Mantém todas as facturas (numeração e recibos entregues ao cliente intactos)
 *     e desconta do stock as quantidades vendidas após a contagem. Menos risco.
 *
 * Toda a operação exige palavra-passe de gestor, mostra pré-visualização completa e
 * deixa rasto no registo de auditoria.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { dbService } from '../utils/firebaseDB';
import Toast, { type ToastKind } from './Toast';
import { Product, Sale, SystemSettings } from '../types';
import { formatDateToISO, formatDatePT } from '../utils/dateRangeHelper';
import {
  analyzeSalesStockImpact,
  annotateCancelledSale,
  buildReentryRows,
  buildReentrySummaryRows,
  buildStockSnapshots,
  getSaleTimeLabel,
  projectStock,
  selectSalesForCutoff,
  StockCorrectionSnapshot,
  toDayKey
} from '../utils/inventoryCutoff';

type CutoffMode = 'anular' | 'descontar';

interface InventoryCutoffToolProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: { username: string; role: string } | null;
  /** Chamado após uma execução bem sucedida, para o módulo recarregar os seus dados. */
  onCompleted?: () => void;
}

const DEFAULT_REASON = 'Contagem física lançada depois das vendas do dia (corte de inventário)';

const money = (value: number) =>
  `${(Number(value) || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT`;

const qty = (value: number) =>
  (Number(value) || 0).toLocaleString('pt-PT', { maximumFractionDigits: 3 });

export default function InventoryCutoffTool({
  isOpen,
  onClose,
  currentUser,
  onCompleted
}: InventoryCutoffToolProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [mode, setMode] = useState<CutoffMode>('anular');
  const [day, setDay] = useState(formatDateToISO(new Date()));
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [restoreStock, setRestoreStock] = useState(false);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});

  const [showConfirm, setShowConfirm] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<ToastKind>('success');
  const [result, setResult] = useState<{
    mode: CutoffMode;
    salesCount: number;
    productsCount: number;
    stockTouched: boolean;
  } | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      await dbService.init();
      const [prodList, saleList, globalSettings] = await Promise.all([
        dbService.getProducts(),
        dbService.getSales(),
        dbService.getSettings()
      ]);
      setProducts(prodList);
      setSales(saleList);
      setSettings(globalSettings);
    } catch (err) {
      console.error('[CorteInventario] Falha ao carregar dados:', err);
      setError('Não foi possível carregar vendas e produtos. Verifique a ligação e tente de novo.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setResult(null);
      setError('');
      setExcluded({});
      loadData();
    }
  }, [isOpen, loadData]);

  const daySales = useMemo(
    () => selectSalesForCutoff(sales, { day, fromTime, toTime }),
    [sales, day, fromTime, toTime]
  );

  const selectedSales = useMemo(
    () => daySales.filter(sale => !excluded[String(sale.id)]),
    [daySales, excluded]
  );

  const impact = useMemo(() => analyzeSalesStockImpact(selectedSales, products), [selectedSales, products]);

  /** Direcção do movimento de stock que esta execução vai provocar (null = stock intocado). */
  const direction: 'deduct' | 'restore' | null =
    mode === 'descontar' ? 'deduct' : restoreStock ? 'restore' : null;

  const snapshots: StockCorrectionSnapshot[] = useMemo(
    () => (direction ? buildStockSnapshots(impact.movements, direction) : []),
    [impact.movements, direction]
  );

  const cancelledSameDay = useMemo(
    () => (sales || []).filter(sale => sale.status === 'Cancelada' && toDayKey(sale.date) === day).length,
    [sales, day]
  );

  const toggleSale = (saleId: string) => {
    setExcluded(prev => ({ ...prev, [saleId]: !prev[saleId] }));
  };

  const toggleAll = (select: boolean) => {
    if (select) {
      setExcluded({});
      return;
    }
    const all: Record<string, boolean> = {};
    daySales.forEach(sale => {
      all[String(sale.id)] = true;
    });
    setExcluded(all);
  };

  const showToast = (message: string, type: ToastKind = 'success') => {
    setToast(message);
    setToastType(type);
  };

  /* --------------------------------------------------------------- */
  /* Exportações (mapa para relançamento das vendas)                  */
  /* --------------------------------------------------------------- */

  const handleExportExcel = () => {
    if (selectedSales.length === 0) {
      showToast('Não há vendas seleccionadas para exportar.', 'warning');
      return;
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildReentryRows(selectedSales)), 'Vendas_Detalhe');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(buildReentrySummaryRows(impact.movements)),
      'Resumo_Por_Artigo'
    );
    XLSX.writeFile(wb, `Corte_Inventario_${day}.xlsx`);
    showToast('Mapa de relançamento exportado em Excel.');
  };

  const handleExportPDF = () => {
    if (selectedSales.length === 0) {
      showToast('Não há vendas seleccionadas para exportar.', 'warning');
      return;
    }
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const companyName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(0, 106, 78);
    doc.text('MAPA DE CORTE DE INVENTÁRIO', 15, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`${companyName} • NUIT: ${settings?.companyNuit || '401976590'}`, 15, 25);
    doc.text(
      `Dia: ${formatDatePT(day)}${fromTime || toTime ? ` • Janela: ${fromTime || '00:00'} - ${toTime || '23:59'}` : ''}`,
      15,
      29
    );
    doc.text(
      `Documentos: ${selectedSales.length} • Valor: ${money(impact.totals.totalValue)} • Artigos afectados: ${impact.totals.productsAffected}`,
      15,
      33
    );

    doc.setDrawColor(0, 106, 78);
    doc.line(15, 36, 195, 36);

    let y = 44;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Nº DOCUMENTO', 15, y);
    doc.text('HORA', 48, y);
    doc.text('CLIENTE', 62, y);
    doc.text('PAGAMENTO', 120, y);
    doc.text('TOTAL (MT)', 160, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    selectedSales.forEach(sale => {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      doc.text(String(sale.invoiceNumber || '').substring(0, 18), 15, y);
      doc.text(getSaleTimeLabel(sale), 48, y);
      doc.text((sale.customerName || 'Consumidor Final').substring(0, 28), 62, y);
      doc.text((sale.paymentMethod || '').substring(0, 14), 120, y);
      doc.text((Number(sale.total) || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2 }), 160, y);
      y += 5;
    });

    y += 6;
    if (y > 240) {
      doc.addPage();
      y = 20;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 106, 78);
    doc.text('QUANTIDADES A REPETIR NO RELANÇAMENTO', 15, y);
    y += 6;
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text('ARTIGO', 15, y);
    doc.text('SACOS', 110, y);
    doc.text('RETALHO', 132, y);
    doc.text('TOTAL BASE', 158, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    impact.movements.forEach(movement => {
      if (y > 275) {
        doc.addPage();
        y = 20;
      }
      doc.text(movement.productName.substring(0, 50), 15, y);
      doc.text(qty(movement.soldBulk), 110, y);
      doc.text(qty(movement.soldRetail), 132, y);
      doc.text(`${qty(movement.soldBase)} ${movement.baseUnit}`, 158, y);
      y += 5;
    });

    doc.save(`Corte_Inventario_${day}.pdf`);
    showToast('Mapa de corte de inventário descarregado em PDF.');
  };

  /* --------------------------------------------------------------- */
  /* Execução                                                         */
  /* --------------------------------------------------------------- */

  const handleExecute = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isRunning) return;

    const expected = (settings?.stockPasswordHash || '').trim();
    const typed = password.trim();
    if (!expected || typed !== expected) {
      setError('Palavra-passe de autorização incorrecta ou não configurada.');
      return;
    }
    if (selectedSales.length === 0) {
      setError('Não há vendas seleccionadas para processar.');
      return;
    }

    setIsRunning(true);
    setError('');
    try {
      const username = currentUser?.username || 'Gestor';

      if (mode === 'anular') {
        const annotated = selectedSales.map(sale => annotateCancelledSale(sale, reason, username));
        await dbService.cancelSalesBulk(annotated, snapshots);
      } else {
        await dbService.applyStockCorrection(snapshots);
      }

      await dbService.addAuditLog({
        id: 'log-cutoff-' + Date.now(),
        timestamp: new Date().toISOString(),
        username,
        ipAddress: '127.0.0.1',
        action: mode === 'anular' ? 'Anulação em Massa (Corte de Inventário)' : 'Correcção de Stock por Corte de Inventário',
        status: 'Sucesso',
        level: 'WARNING',
        entity: 'sales/products',
        details:
          mode === 'anular'
            ? `${selectedSales.length} venda(s) do dia ${day} anuladas ${snapshots.length > 0 ? 'COM' : 'SEM'} estorno de stock. ` +
              `Valor anulado: ${money(impact.totals.totalValue)}. Motivo: ${reason}`
            : `Stock corrigido em ${snapshots.length} artigo(s) com base em ${selectedSales.length} venda(s) do dia ${day} ` +
              `posteriores à contagem física. Custo movimentado: ${money(impact.totals.costValue)}. Motivo: ${reason}`
      });

      setResult({
        mode,
        salesCount: selectedSales.length,
        productsCount: mode === 'anular' ? snapshots.length : snapshots.length,
        stockTouched: snapshots.length > 0
      });
      setShowConfirm(false);
      setPassword('');
      await loadData();
      onCompleted?.();
    } catch (err) {
      console.error('[CorteInventario] Falha na execução:', err);
      setError('Erro ao executar a operação. Nada foi concluído — verifique a ligação e tente novamente.');
    } finally {
      setIsRunning(false);
    }
  };

  if (!isOpen) return null;

  const modeCards: { id: CutoffMode; title: string; subtitle: string; icon: string; detail: string }[] = [
    {
      id: 'anular',
      title: 'Anular vendas do período',
      subtitle: 'e relançá-las a seguir no PDV',
      icon: 'cancel',
      detail:
        'As facturas passam a "Cancelada" e, por omissão, o stock NÃO é devolvido — porque o inventário lançado é anterior a estas vendas. Relance depois as vendas no PDV: o stock desconta normalmente.'
    },
    {
      id: 'descontar',
      title: 'Descontar vendas do stock',
      subtitle: 'mantendo as facturas válidas',
      icon: 'inventory',
      detail:
        'As facturas mantêm-se válidas (numeração e recibos já entregues ficam intactos) e o sistema desconta do stock as quantidades vendidas depois da contagem. É a via com menos risco.'
    }
  ];

  return (
    <div className="fixed inset-0 bg-black/60 z-50 p-2 sm:p-4 flex items-start sm:items-center justify-center backdrop-blur-xs overflow-y-auto">
      <div className="bg-slate-50 rounded-xl shadow-2xl w-full max-w-5xl my-2 overflow-hidden border border-slate-200">
        {/* Cabeçalho */}
        <div className="bg-slate-900 px-3 py-2 text-white flex items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-sm flex items-center gap-1.5">
              <span className="material-symbols-outlined">content_cut</span>
              Corte de Inventário — Anulação de Vendas &amp; Correcção de Stock
            </h3>
            <p className="text-[10px] text-slate-300 mt-0.5 max-w-3xl leading-snug">
              Use quando a contagem física foi tirada a uma hora e só foi lançada no sistema mais tarde, depois de já
              terem sido registadas vendas. O sistema mostra tudo antes de gravar.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-white hover:opacity-80 cursor-pointer shrink-0">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-3 space-y-2.5 max-h-[86vh] overflow-y-auto">
          {/* Resultado da última execução */}
          {result && (
            <div className="bg-emerald-50 border border-emerald-300 rounded-lg px-2.5 py-1.5 text-emerald-900">
              <p className="font-black text-sm flex items-center gap-2">
                <span className="material-symbols-outlined">task_alt</span>
                Operação concluída com sucesso
              </p>
              {result.mode === 'anular' ? (
                <p className="text-xs">
                  {result.salesCount} venda(s) anuladas{' '}
                  {result.stockTouched
                    ? `e stock estornado em ${result.productsCount} artigo(s).`
                    : 'sem qualquer alteração de stock. Pode agora relançar as vendas no PDV.'}
                </p>
              ) : (
                <p className="text-xs">
                  Stock corrigido em {result.productsCount} artigo(s). As facturas mantiveram-se válidas.
                </p>
              )}
            </div>
          )}

          {/* 1. Modo de operação */}
          <section className="space-y-2">
            <h4 className="text-[9.5px] font-black uppercase text-slate-500 tracking-wide">1. O que pretende fazer</h4>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {modeCards.map(card => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setMode(card.id)}
                  className={`text-left p-2.5 rounded-lg border-2 transition-all cursor-pointer ${
                    mode === card.id
                      ? 'border-emerald-600 bg-white shadow-md'
                      : 'border-slate-200 bg-white/60 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`material-symbols-outlined ${mode === card.id ? 'text-emerald-600' : 'text-slate-400'}`}
                    >
                      {card.icon}
                    </span>
                    <div>
                      <p className="font-black text-sm text-slate-800">{card.title}</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">{card.subtitle}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-600 mt-1 leading-snug">{card.detail}</p>
                </button>
              ))}
            </div>
          </section>

          {/* 2. Período */}
          <section className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-1.5">
            <h4 className="text-[9.5px] font-black uppercase text-slate-500 tracking-wide">
              2. Período das vendas a tratar
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">Dia</label>
                <input
                  type="date"
                  value={day}
                  onChange={e => setDay(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-[11px] focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                  Desde (hora da contagem)
                </label>
                <input
                  type="time"
                  value={fromTime}
                  onChange={e => setFromTime(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-[11px] focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">Até (opcional)</label>
                <input
                  type="time"
                  value={toTime}
                  onChange={e => setToTime(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-[11px] focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setFromTime('');
                    setToTime('');
                  }}
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-xl cursor-pointer"
                >
                  Dia inteiro
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                Motivo (fica registado na auditoria e na nota do documento)
              </label>
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-600"
              />
            </div>
            <p className="text-[10.5px] text-slate-500">
              Só entram documentos que movimentam stock: facturas definitivas activas. Proformas, cotações e documentos
              já anulados ficam de fora.
              {cancelledSameDay > 0 && ` Neste dia existem ${cancelledSameDay} documento(s) já anulado(s) — ignorados.`}
            </p>
          </section>

          {/* 3. Pré-visualização */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h4 className="text-[9.5px] font-black uppercase text-slate-500 tracking-wide">
                3. Pré-visualização do impacto
              </h4>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-[11px] rounded-xl flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px]">table_view</span>
                  Mapa p/ relançamento (Excel)
                </button>
                <button
                  type="button"
                  onClick={handleExportPDF}
                  className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-800 border border-red-200 font-bold text-[11px] rounded-xl flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px]">picture_as_pdf</span>
                  PDF
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white border border-slate-200 rounded-lg p-2">
                <p className="text-[9.5px] font-black uppercase text-slate-400 tracking-wider">Documentos</p>
                <p className="text-xl font-black text-slate-800 font-mono">{selectedSales.length}</p>
                <p className="text-[10px] text-slate-400">de {daySales.length} encontrados no período</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2">
                <p className="text-[9.5px] font-black uppercase text-slate-400 tracking-wider">Valor facturado</p>
                <p className="text-xl font-black text-slate-800 font-mono">{money(impact.totals.totalValue)}</p>
                <p className="text-[10px] text-slate-400">
                  {mode === 'anular' ? 'sai dos relatórios ao anular' : 'mantém-se nos relatórios'}
                </p>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2">
                <p className="text-[9.5px] font-black uppercase text-slate-400 tracking-wider">Artigos afectados</p>
                <p className="text-xl font-black text-slate-800 font-mono">{impact.totals.productsAffected}</p>
                <p className="text-[10px] text-slate-400">custo {money(impact.totals.costValue)}</p>
              </div>
              <div
                className={`rounded-lg p-2 border ${
                  direction ? 'bg-amber-50 border-amber-300' : 'bg-slate-100 border-slate-200'
                }`}
              >
                <p className="text-[9.5px] font-black uppercase text-slate-500 tracking-wider">Efeito no stock</p>
                <p className={`text-sm font-black ${direction ? 'text-amber-800' : 'text-slate-700'} mt-1`}>
                  {direction === 'deduct'
                    ? 'Stock vai DESCER'
                    : direction === 'restore'
                      ? 'Stock vai SUBIR (estorno)'
                      : 'Stock NÃO é alterado'}
                </p>
                <p className="text-[10px] text-slate-500">
                  {snapshots.length > 0 ? `${snapshots.length} artigo(s) gravados` : 'nenhuma gravação em produtos'}
                </p>
              </div>
            </div>

            {/* Opção de estorno (apenas no modo anular) */}
            {mode === 'anular' && (
              <label className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg p-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={restoreStock}
                  onChange={e => setRestoreStock(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-amber-600"
                />
                <span>
                  <span className="block text-xs font-black text-slate-800">
                    Devolver as quantidades ao stock (estorno clássico)
                  </span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    Deixe <strong>desligado</strong> no seu caso: o inventário que está no sistema foi contado{' '}
                    <strong>antes</strong> destas vendas, logo o stock já não contém esta saída. Ligue apenas se estas
                    vendas nunca chegaram a sair da loja (devolução real de mercadoria).
                  </span>
                </span>
              </label>
            )}

            {impact.unmatched.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-lg p-2 text-[11px]">
                <p className="font-black flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                  {impact.unmatched.length} linha(s) de venda referem artigos que já não existem no catálogo
                </p>
                <p className="mt-0.5">
                  Essas linhas não têm impacto de stock calculável:{' '}
                  {impact.unmatched
                    .slice(0, 5)
                    .map(item => `${item.name} (${qty(item.quantity)} ${item.unit})`)
                    .join(', ')}
                  {impact.unmatched.length > 5 ? '…' : ''}
                </p>
              </div>
            )}

            {/* Tabela de vendas */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                <p className="text-[11px] font-black text-slate-700">
                  Documentos do período {isLoading && <span className="text-slate-400 font-normal">a carregar…</span>}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => toggleAll(true)}
                    className="text-[10.5px] font-bold text-emerald-700 hover:underline cursor-pointer"
                  >
                    Seleccionar todas
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleAll(false)}
                    className="text-[10.5px] font-bold text-slate-500 hover:underline cursor-pointer"
                  >
                    Limpar
                  </button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-white sticky top-0">
                    <tr className="text-slate-500 uppercase text-[9px] font-black tracking-wider border-b border-slate-150">
                      <th className="p-2 w-8"></th>
                      <th className="p-2">Documento</th>
                      <th className="p-2">Hora</th>
                      <th className="p-2">Cliente</th>
                      <th className="p-2">Pagamento</th>
                      <th className="p-2 text-right">Total</th>
                      <th className="p-2 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {daySales.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-400 italic">
                          Nenhuma venda encontrada neste período.
                        </td>
                      </tr>
                    ) : (
                      daySales.map(sale => {
                        const saleId = String(sale.id);
                        const isSelected = !excluded[saleId];
                        return (
                          <tr key={saleId} className={isSelected ? 'bg-white' : 'bg-slate-50/80 opacity-60'}>
                            <td className="p-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSale(saleId)}
                                className="w-4 h-4 accent-emerald-600 cursor-pointer"
                              />
                            </td>
                            <td className="p-2 font-mono font-black text-slate-700">{sale.invoiceNumber}</td>
                            <td className="p-2 text-slate-500">{getSaleTimeLabel(sale)}</td>
                            <td className="p-2 text-slate-700">{sale.customerName || 'Consumidor Final'}</td>
                            <td className="p-2 text-slate-500">{sale.paymentMethod}</td>
                            <td className="p-2 text-right font-mono font-bold text-slate-800">{money(sale.total)}</td>
                            <td className="p-2 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-slate-100 text-slate-600">
                                {sale.status}
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

            {/* Tabela de impacto por artigo */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                <p className="text-[11px] font-black text-slate-700">
                  Impacto por artigo {direction ? '(saldo que ficará gravado)' : '(apenas informativo — stock intocado)'}
                </p>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-white sticky top-0">
                    <tr className="text-slate-500 uppercase text-[9px] font-black tracking-wider border-b border-slate-150">
                      <th className="p-2">Artigo</th>
                      <th className="p-2 text-right">Vendido (saco)</th>
                      <th className="p-2 text-right">Vendido (retalho)</th>
                      <th className="p-2 text-right">Total base</th>
                      <th className="p-2 text-right">Stock actual</th>
                      <th className="p-2 text-right">Stock final</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {impact.movements.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-slate-400 italic">
                          Sem movimentos de stock para apresentar.
                        </td>
                      </tr>
                    ) : (
                      impact.movements.map(movement => {
                        const projected = direction
                          ? projectStock(movement, direction)
                          : { stockQty: movement.currentStockQty };
                        const changed = projected.stockQty !== movement.currentStockQty;
                        return (
                          <tr key={movement.productId}>
                            <td className="p-2">
                              <p className="font-bold text-slate-800">{movement.productName}</p>
                              <p className="text-[9.5px] text-slate-400 font-mono">{movement.code}</p>
                            </td>
                            <td className="p-2 text-right font-mono text-slate-600">
                              {movement.hasConversion ? qty(movement.soldBulk) : '—'}
                            </td>
                            <td className="p-2 text-right font-mono text-slate-600">
                              {movement.hasConversion ? qty(movement.soldRetail) : '—'}
                            </td>
                            <td className="p-2 text-right font-mono font-bold text-slate-800">
                              {qty(movement.soldBase)} {movement.baseUnit}
                            </td>
                            <td className="p-2 text-right font-mono text-slate-500">{qty(movement.currentStockQty)}</td>
                            <td
                              className={`p-2 text-right font-mono font-black ${
                                changed ? (projected.stockQty < movement.currentStockQty ? 'text-red-700' : 'text-blue-700') : 'text-slate-400'
                              }`}
                            >
                              {qty(projected.stockQty)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {error && !showConfirm && (
            <div className="bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">error</span>
              {error}
            </div>
          )}
        </div>

        {/* Rodapé de acção */}
        <div className="border-t border-slate-200 bg-white p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500 max-w-2xl">
            {mode === 'anular'
              ? 'Os documentos ficam arquivados como "Cancelada" (nunca são apagados) e saem automaticamente dos relatórios de facturação e lucro.'
              : 'Nenhum documento é alterado: só os saldos de stock dos artigos listados acima são corrigidos.'}
          </p>
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer"
            >
              Fechar
            </button>
            <button
              type="button"
              disabled={selectedSales.length === 0 || isRunning}
              onClick={() => {
                setError('');
                setPassword('');
                setShowConfirm(true);
              }}
              className="flex-1 sm:flex-none px-5 py-2.5 bg-slate-900 hover:bg-black text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[16px]">verified_user</span>
              {mode === 'anular' ? `Anular ${selectedSales.length} venda(s)` : 'Corrigir stock'}
            </button>
          </div>
        </div>
      </div>

      {/* Confirmação com palavra-passe */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/70 z-[60] p-4 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="bg-slate-900 p-4 text-white font-bold flex justify-between items-center">
              <span className="flex items-center gap-2 text-sm">
                <span className="material-symbols-outlined">verified_user</span>
                Autorização de Gestor
              </span>
              <button type="button" onClick={() => setShowConfirm(false)} className="text-white hover:opacity-80 cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleExecute} className="p-5 space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-700 space-y-1">
                <p className="font-black text-slate-900 text-xs">Resumo da operação</p>
                <p>
                  • Dia: <strong>{formatDatePT(day)}</strong>
                  {(fromTime || toTime) && (
                    <>
                      {' '}
                      (janela {fromTime || '00:00'} – {toTime || '23:59'})
                    </>
                  )}
                </p>
                <p>
                  • {mode === 'anular' ? 'Vendas a anular' : 'Vendas usadas no cálculo'}:{' '}
                  <strong>{selectedSales.length}</strong> — {money(impact.totals.totalValue)}
                </p>
                <p>
                  • Stock:{' '}
                  <strong className={direction ? 'text-amber-700' : 'text-emerald-700'}>
                    {direction === 'deduct'
                      ? `desce em ${snapshots.length} artigo(s)`
                      : direction === 'restore'
                        ? `sobe em ${snapshots.length} artigo(s)`
                        : 'não é alterado'}
                  </strong>
                </p>
                {mode === 'anular' && !restoreStock && (
                  <p className="text-emerald-800">
                    • A seguir relance as vendas no PDV para o stock descontar a partir do inventário contado.
                  </p>
                )}
              </div>

              {error && (
                <div className="bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  {error}
                </div>
              )}

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-700 mb-1">
                  Palavra-passe de autorização <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Palavra-passe do gestor de stock"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
                  required
                  autoFocus
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={isRunning}
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-black text-white font-bold rounded-xl text-xs shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isRunning ? 'A processar…' : 'Confirmar e executar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Toast message={toast} type={toastType} onDismiss={() => setToast('')} />
    </div>
  );
}
