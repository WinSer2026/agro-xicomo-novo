/**
 * CORTE DE INVENTÁRIO (Inventory Cut-off)
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * PROBLEMA QUE ESTE MÓDULO RESOLVE
 * ---------------------------------
 * Uma contagem física é tirada num instante T0 (ex.: 07:00 da manhã).
 * O lançamento dessa contagem no sistema acontece mais tarde, em T1 (ex.: 18:00).
 * Entre T0 e T1 a loja continuou a vender.
 *
 *      stock real agora  =  contagem (T0)  −  vendas ocorridas entre T0 e T1
 *      stock no sistema  =  contagem (T0)                     ← ficou inflacionado
 *
 * Ou seja: o sistema fica a MAIS exactamente nas quantidades vendidas nesse intervalo,
 * porque o lançamento da contagem substituiu (em valor absoluto) os saldos que já
 * tinham sido descontados pelas vendas.
 *
 * DUAS FORMAS LEGÍTIMAS DE CORRIGIR
 * ---------------------------------
 *  A) Anular as vendas do intervalo SEM estorno de stock e relançá-las a seguir.
 *     (o stock volta a ser descontado no relançamento → fica igual ao físico)
 *  B) Manter as vendas válidas e descontar do stock as quantidades vendidas
 *     após o momento da contagem (correcção de corte de inventário).
 *
 * PREVENÇÃO (o que evita o problema para sempre)
 * ----------------------------------------------
 * Registar sempre o MOMENTO REAL DA CONTAGEM. Com esse instante, o sistema calcula
 * sozinho os movimentos posteriores e aplica:  contagem − vendas pós-contagem.
 *
 * Todas as funções deste ficheiro são puras (sem acesso a base de dados), para poderem
 * ser testadas isoladamente e reutilizadas pelo módulo de Stock e pelo módulo de Facturas.
 */

import { Product, Sale, SaleItem } from '../types';
import { formatDateToISO } from './dateRangeHelper';
import { getUnitCost, isHybridProduct } from './priceHelper';

/** Marca colocada nas notas das vendas anuladas por correcção de inventário. */
export const CUTOFF_NOTE_TAG = '[CORTE DE INVENTÁRIO]';

/** Impacto de stock de um produto, agregado a partir de um conjunto de vendas. */
export interface ProductMovement {
  productId: string;
  productName: string;
  code: string;
  baseUnit: string;
  parentUnit?: string;
  hasConversion: boolean;
  /** Quantidade vendida em unidade-pai (ex.: sacos). */
  soldBulk: number;
  /** Quantidade vendida em unidade base no retalho (ex.: kg avulso). */
  soldRetail: number;
  /** Total convertido para unidade base (sacos × factor + retalho). */
  soldBase: number;
  /** Nº de documentos de venda que contribuíram para este movimento. */
  salesCount: number;
  /** Saldos actuais no sistema. */
  currentStockQty: number;
  currentStockBulk: number;
  currentStockRetail: number;
  /** Custo total das quantidades movimentadas (MT). */
  costValue: number;
}

/** Saldo absoluto a gravar num produto (o que o utilizador vê na pré-visualização). */
export interface StockCorrectionSnapshot {
  productId: string;
  productName: string;
  stockQty: number;
  stockQtyBulk?: number;
  stockQtyRetail?: number;
}

export interface UnmatchedItem {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
}

export interface SalesStockImpact {
  movements: ProductMovement[];
  unmatched: UnmatchedItem[];
  totals: {
    salesCount: number;
    productsAffected: number;
    totalValue: number;
    costValue: number;
  };
}

export type CutoffDirection = 'deduct' | 'restore';

/* ------------------------------------------------------------------ */
/* Datas                                                               */
/* ------------------------------------------------------------------ */

/** Converte qualquer data (ISO completo ou YYYY-MM-DD) na chave do dia YYYY-MM-DD. */
export function toDayKey(value?: string | null): string {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10);
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return '';
  return formatDateToISO(parsed);
}

/** Timestamp (ms) de uma venda: usa a data real e, em último caso, a data de criação. */
export function getSaleTimestamp(sale: Sale): number {
  const candidates = [sale?.date, sale?.createdAt];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (!isNaN(parsed.getTime())) return parsed.getTime();
  }
  return 0;
}

/** Hora HH:MM de uma venda (vazio quando o registo só tem a data). */
export function getSaleTimeLabel(sale: Sale): string {
  const raw = sale?.date || sale?.createdAt || '';
  if (!raw || !String(raw).includes('T')) return '--:--';
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return '--:--';
  return parsed.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Só as facturas definitivas activas movimentam stock.
 * Proformas, cotações e documentos já anulados nunca descontaram nada.
 */
export function isStockImpactingSale(sale: Sale): boolean {
  if (!sale) return false;
  if (sale.status === 'Cancelada') return false;
  const type = sale.documentType;
  return !type || type === 'FaturaDefinitiva';
}

export interface SaleSelectionOptions {
  /** Dia alvo (YYYY-MM-DD). */
  day: string;
  /** Hora inicial inclusiva (HH:MM). Vazio = desde o início do dia. */
  fromTime?: string;
  /** Hora final inclusiva (HH:MM). Vazio = até ao fim do dia. */
  toTime?: string;
  /** Incluir documentos já anulados (normalmente falso). */
  includeCancelled?: boolean;
  /** Incluir proformas/cotações (normalmente falso: não movimentam stock). */
  includeNonDefinitive?: boolean;
}

/** Vendas de um dia (opcionalmente limitadas a uma janela horária). */
export function selectSalesForCutoff(sales: Sale[], options: SaleSelectionOptions): Sale[] {
  const { day, fromTime, toTime, includeCancelled = false, includeNonDefinitive = false } = options;
  if (!day) return [];

  const fromTs = fromTime ? new Date(`${day}T${fromTime}:00`).getTime() : null;
  const toTs = toTime ? new Date(`${day}T${toTime}:59`).getTime() : null;

  return (sales || [])
    .filter(sale => {
      if (!sale) return false;
      if (toDayKey(sale.date) !== day) return false;
      if (!includeCancelled && sale.status === 'Cancelada') return false;
      if (!includeNonDefinitive && !(!sale.documentType || sale.documentType === 'FaturaDefinitiva')) return false;

      if (fromTs !== null || toTs !== null) {
        const ts = getSaleTimestamp(sale);
        // Registos sem hora (apenas YYYY-MM-DD) entram sempre: não há como excluí-los com rigor.
        const hasTime = String(sale.date || '').includes('T');
        if (hasTime) {
          if (fromTs !== null && ts < fromTs) return false;
          if (toTs !== null && ts > toTs) return false;
        }
      }
      return true;
    })
    .sort((a, b) => getSaleTimestamp(a) - getSaleTimestamp(b));
}

/**
 * Vendas registadas DEPOIS de um instante de corte (momento real da contagem física).
 * É esta a lista que tem de ser descontada a uma contagem lançada com atraso.
 */
export function selectSalesAfter(sales: Sale[], cutoffISO: string): Sale[] {
  if (!cutoffISO) return [];
  const cutoffTs = new Date(cutoffISO).getTime();
  if (isNaN(cutoffTs)) return [];

  return (sales || [])
    .filter(sale => isStockImpactingSale(sale) && getSaleTimestamp(sale) > cutoffTs)
    .sort((a, b) => getSaleTimestamp(a) - getSaleTimestamp(b));
}

/* ------------------------------------------------------------------ */
/* Agregação do impacto em stock                                       */
/* ------------------------------------------------------------------ */

function resolveProduct(products: Product[], item: SaleItem): Product | undefined {
  return products.find(p => String(p.id) === String(item.productId));
}

/**
 * Agrega o impacto em stock de um conjunto de vendas, respeitando produtos híbridos
 * (vendidos em saco e em quilo): o saco desconta `stockQtyBulk` + equivalente em base,
 * o retalho desconta `stockQtyRetail` + base.
 */
export function analyzeSalesStockImpact(sales: Sale[], products: Product[]): SalesStockImpact {
  const byProduct = new Map<string, ProductMovement>();
  const salesSeen = new Map<string, Set<string>>();
  const unmatched: UnmatchedItem[] = [];
  let totalValue = 0;

  for (const sale of sales || []) {
    if (!sale) continue;
    totalValue += Number(sale.total) || 0;

    for (const item of sale.items || []) {
      if (!item) continue;
      const quantity = Number(item.quantity) || 0;
      if (quantity <= 0) continue;
      if (item.isService) continue;

      const product = resolveProduct(products, item);
      if (!product) {
        unmatched.push({
          productId: String(item.productId || ''),
          name: item.name || 'Artigo desconhecido',
          quantity,
          unit: item.unit || ''
        });
        continue;
      }
      if (product.isService) continue;

      const key = String(product.id);
      let movement = byProduct.get(key);
      if (!movement) {
        movement = {
          productId: key,
          productName: product.name,
          code: product.code || '',
          baseUnit: product.baseUnit || 'Unidades',
          parentUnit: product.parentUnit,
          hasConversion: isHybridProduct(product),
          soldBulk: 0,
          soldRetail: 0,
          soldBase: 0,
          salesCount: 0,
          currentStockQty: Number(product.stockQty) || 0,
          currentStockBulk: Number(product.stockQtyBulk) || 0,
          currentStockRetail: Number(product.stockQtyRetail) || 0,
          costValue: 0
        };
        byProduct.set(key, movement);
        salesSeen.set(key, new Set<string>());
      }

      if (movement.hasConversion && item.sellingUnit === 'Bulk') {
        const rate = Number(product.conversionRate) || 1;
        movement.soldBulk += quantity;
        movement.soldBase += quantity * rate;
        movement.costValue += quantity * getUnitCost(product, 'Bulk');
      } else if (movement.hasConversion) {
        movement.soldRetail += quantity;
        movement.soldBase += quantity;
        movement.costValue += quantity * getUnitCost(product, 'Retail');
      } else {
        movement.soldBase += quantity;
        movement.costValue += quantity * getUnitCost(product);
      }

      const seen = salesSeen.get(key)!;
      const saleKey = String(sale.id || sale.invoiceNumber || '');
      if (!seen.has(saleKey)) {
        seen.add(saleKey);
        movement.salesCount += 1;
      }
    }
  }

  const movements = Array.from(byProduct.values()).sort((a, b) =>
    a.productName.localeCompare(b.productName, 'pt')
  );

  return {
    movements,
    unmatched,
    totals: {
      salesCount: (sales || []).length,
      productsAffected: movements.length,
      totalValue,
      costValue: movements.reduce((sum, m) => sum + m.costValue, 0)
    }
  };
}

/** Saldo que um produto passa a ter depois da correcção (valor absoluto, nunca negativo). */
export function projectStock(movement: ProductMovement, direction: CutoffDirection) {
  const sign = direction === 'deduct' ? -1 : 1;
  const stockQty = Math.max(0, movement.currentStockQty + sign * movement.soldBase);
  const stockQtyBulk = movement.hasConversion
    ? Math.max(0, movement.currentStockBulk + sign * movement.soldBulk)
    : undefined;
  const stockQtyRetail = movement.hasConversion
    ? Math.max(0, movement.currentStockRetail + sign * movement.soldRetail)
    : undefined;
  return { stockQty, stockQtyBulk, stockQtyRetail };
}

/**
 * Converte movimentos em saldos absolutos a gravar.
 *  - 'deduct'  → desconta as quantidades vendidas (correcção de corte de inventário).
 *  - 'restore' → devolve as quantidades ao stock (estorno clássico de anulação).
 */
export function buildStockSnapshots(
  movements: ProductMovement[],
  direction: CutoffDirection
): StockCorrectionSnapshot[] {
  return (movements || [])
    .filter(m => m.soldBase > 0 || m.soldBulk > 0 || m.soldRetail > 0)
    .map(m => {
      const projected = projectStock(m, direction);
      const snapshot: StockCorrectionSnapshot = {
        productId: m.productId,
        productName: m.productName,
        stockQty: projected.stockQty
      };
      if (projected.stockQtyBulk !== undefined) snapshot.stockQtyBulk = projected.stockQtyBulk;
      if (projected.stockQtyRetail !== undefined) snapshot.stockQtyRetail = projected.stockQtyRetail;
      return snapshot;
    });
}

/**
 * Contagem física lançada com atraso: ao valor contado em T0 descontam-se os
 * movimentos registados depois de T0, devolvendo o saldo real de agora.
 */
export function applyCutoffToPhysicalCount(countedQty: number, movement?: ProductMovement | null): number {
  const counted = Number(countedQty) || 0;
  if (!movement) return Math.max(0, counted);
  return Math.max(0, counted - (Number(movement.soldBase) || 0));
}

/** Indexa movimentos por productId (uso rápido na reconciliação). */
export function indexMovements(movements: ProductMovement[]): Record<string, ProductMovement> {
  const map: Record<string, ProductMovement> = {};
  for (const m of movements || []) map[String(m.productId)] = m;
  return map;
}

/* ------------------------------------------------------------------ */
/* Anulação documentada                                                */
/* ------------------------------------------------------------------ */

/**
 * Devolve uma cópia da venda marcada como 'Cancelada' com rasto de auditoria na nota.
 * O documento NUNCA é apagado: mantém-se no arquivo para efeitos fiscais e de histórico.
 */
export function annotateCancelledSale(
  sale: Sale,
  reason: string,
  username?: string,
  when: Date = new Date()
): Sale {
  const stamp = when.toISOString().substring(0, 16).replace('T', ' ');
  const author = username ? ` por ${username}` : '';
  const note = `${CUTOFF_NOTE_TAG} Anulada em ${stamp}${author}. Motivo: ${reason}`;
  const previous = (sale.notes || '').trim();
  return {
    ...sale,
    id: String(sale.id || sale.invoiceNumber || Date.now()),
    status: 'Cancelada',
    notes: previous ? `${previous}\n${note}` : note
  };
}

/** Linhas detalhadas (artigo a artigo) para o mapa de relançamento das vendas anuladas. */
export function buildReentryRows(sales: Sale[]): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = [];
  for (const sale of sales || []) {
    for (const item of sale.items || []) {
      rows.push({
        'Nº Documento': sale.invoiceNumber || '',
        'Data': toDayKey(sale.date),
        'Hora': getSaleTimeLabel(sale),
        'Cliente': sale.customerName || 'Consumidor Final',
        'NUIT': sale.customerNuit || '',
        'Artigo': item.name || '',
        'Quantidade': Number(item.quantity) || 0,
        'Unidade': item.unit || '',
        'Tipo Venda': item.sellingUnit === 'Bulk' ? 'Saco/Grosso' : 'Retalho',
        'Preço Unit. (MT)': Number(item.unitPrice) || 0,
        'Total Linha (MT)': Number(item.totalPrice) || 0,
        'Desconto Doc. (MT)': Number(sale.discount) || 0,
        'Total Documento (MT)': Number(sale.total) || 0,
        'Pagamento': sale.paymentMethod || '',
        'Operador': sale.operatorName || '',
        'Estado Original': sale.status || ''
      });
    }
  }
  return rows;
}

/** Resumo por artigo (quantidades a repetir no relançamento das vendas). */
export function buildReentrySummaryRows(movements: ProductMovement[]): Record<string, string | number>[] {
  return (movements || []).map(m => ({
    'Código': m.code,
    'Artigo': m.productName,
    'Qtd. Sacos/Grosso': m.soldBulk,
    'Qtd. Retalho': m.soldRetail,
    'Total (Unidade Base)': m.soldBase,
    'Unidade Base': m.baseUnit,
    'Stock Actual no Sistema': m.currentStockQty,
    'Stock Após Correcção': projectStock(m, 'deduct').stockQty,
    'Custo Movimentado (MT)': Number(m.costValue.toFixed(2))
  }));
}
