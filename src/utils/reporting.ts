import type { Product, Sale } from '../types';
import { isCancelledSale, isFinancialSale, isProformaSale } from './saleStatus';

/**
 * Separação de vendas para relatórios.
 *
 * O que estava errado: o relatório oficial periódico filtrava as vendas apenas
 * por data — `sales.filter(s => dentroDoPeríodo(s))` — e somava tudo. Uma
 * factura anulada continuava a entrar em "Faturação Bruta", em "Lucro Estimado",
 * em "Transações" e na coluna "Faturado" de cada produto. O documento que se
 * leva ao município declarava mais faturação do que a que existe.
 *
 * Regra: só documentos válidos somam. Cancelados e proformas aparecem em
 * linhas próprias, com valor, e **nunca** entram nos totais.
 */
export interface SalesReportSplit {
  /** Documentos que contam: nem cancelados, nem proformas. */
  valid: Sale[];
  cancelled: Sale[];
  proforma: Sale[];
  totals: {
    /** Faturação que existe. */
    valid: number;
    /** Valor cancelado no período — informativo, não soma. */
    cancelled: number;
    /** Valor em proformas/cotações — informativo, não soma. */
    proforma: number;
    validCount: number;
    cancelledCount: number;
    proformaCount: number;
  };
}

const valor = (sale: Sale): number => {
  const total = Number(sale.total);
  return Number.isFinite(total) ? total : 0;
};

export function splitSalesForReport(sales: Sale[] | null | undefined): SalesReportSplit {
  const lista = Array.isArray(sales) ? sales.filter(Boolean) : [];
  const cancelled: Sale[] = [];
  const proforma: Sale[] = [];
  const valid: Sale[] = [];

  for (const sale of lista) {
    if (isCancelledSale(sale)) {
      cancelled.push(sale);
    } else if (isProformaSale(sale)) {
      proforma.push(sale);
    } else {
      valid.push(sale);
    }
  }

  return {
    valid,
    cancelled,
    proforma,
    totals: {
      valid: valid.reduce((total, sale) => total + valor(sale), 0),
      cancelled: cancelled.reduce((total, sale) => total + valor(sale), 0),
      proforma: proforma.reduce((total, sale) => total + valor(sale), 0),
      validCount: valid.length,
      cancelledCount: cancelled.length,
      proformaCount: proforma.length
    }
  };
}

/** Verdadeiro quando a soma tem de ser recusada por incluir documentos anulados. */
export function hasCancelledInTotals(sales: Sale[] | null | undefined): boolean {
  return splitSalesForReport(sales).totals.cancelledCount > 0;
}

/* ------------------------------------------------------------------ */
/* Limites dos períodos                                                */
/* ------------------------------------------------------------------ */

export type ReportPeriod = 'Diário' | 'Semanal' | 'Mensal' | 'Trimestral' | 'Semestral' | 'Anual';

const PERIOD_DAYS: Record<ReportPeriod, number> = {
  Diário: 1,
  Semanal: 7,
  Mensal: 30,
  Trimestral: 90,
  Semestral: 180,
  Anual: 365
};

/**
 * Intervalo de dias (calendário local) de um período de relatório.
 *
 * O que estava errado: usava-se `Math.abs(agora - dataVenda)` com limites em
 * dias. Três consequências:
 *  - uma venda com data no FUTURO (relógio adiantado, correcção manual) entrava
 *    no relatório enquanto estivesse a menos de 30 dias;
 *  - "Diário" era "últimas 24 horas", não "hoje" — depois da meia-noite o dia
 *    anterior continuava a contar;
 *  - o corte era feito em UTC, pelo que uma venda das 23:00 em Maputo caía no
 *    dia seguinte.
 */
export function periodDayRange(period: ReportPeriod, todayIso?: string): { startDay: string; endDay: string } {
  const hoje = diaLocal(todayIso || new Date().toISOString());
  const dias = PERIOD_DAYS[period] ?? 1;
  if (dias <= 1) return { startDay: hoje, endDay: hoje };

  // Meio-dia UTC evita qualquer efeito de fuso ao recuar dias num calendário.
  const base = new Date(`${hoje}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() - (dias - 1));
  return { startDay: base.toISOString().slice(0, 10), endDay: hoje };
}

function diaLocal(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Maputo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(data);
}

/* ------------------------------------------------------------------ */
/* Stock no início do período                                          */
/* ------------------------------------------------------------------ */

/**
 * Uma venda movimentou stock?
 *
 * Uma factura anulada normalmente devolve o stock (`stockReturned !== false`),
 * logo não conta. Mas há um caso em que a anulação **não** devolve: o corte de
 * inventário, quando a contagem física já foi lançada e a mercadoria já saiu.
 * Nesse caso a saída de stock aconteceu e tem de contar para reconstruir o
 * saldo inicial — senão o "stock anterior" sai mais alto do que era.
 */
export function saleMovedStock(sale: Sale): boolean {
  if (isCancelledSale(sale)) return sale.stockReturned === false;
  return isFinancialSale(sale);
}

/**
 * Stock no início do período = stock actual + o que saiu durante o período.
 *
 * `qtyOf` devolve a quantidade em unidade base que uma venda retirou do produto.
 * Devolve `null` quando não há como saber (produto já não existe no catálogo):
 * nesse caso o ecrã tem de dizer "indeterminado", nunca inventar um número.
 */
export function stockBeforePeriod(
  currentStock: number,
  sales: Sale[],
  qtyOf: (sale: Sale) => number | null
): { value: number; complete: boolean } {
  let saida = 0;
  let completo = true;
  for (const sale of sales) {
    if (!saleMovedStock(sale)) continue;
    const qty = qtyOf(sale);
    if (qty === null) {
      completo = false;
      continue;
    }
    saida += qty;
  }
  return { value: (Number(currentStock) || 0) + saida, complete: completo };
}

/* ------------------------------------------------------------------ */
/* Dinheiro                                                            */
/* ------------------------------------------------------------------ */

/**
 * Valor em MT com dois decimais e espaço de milhares português.
 * Documentos fiscais não podem arredondar cêntimos para o inteiro.
 */
export function formatMT(value: number): string {
  const numero = Number.isFinite(value) ? value : 0;
  const negativo = numero < 0;
  const centavos = Math.round(Math.abs(numero) * 100);
  const inteiros = Math.floor(centavos / 100).toString();
  const resto = (centavos % 100).toString().padStart(2, '0');
  // Agrupamento explícito: não depende do ICU do ambiente ter dados do locale.
  const agrupado = inteiros.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negativo ? '-' : ''}${agrupado},${resto} MT`;
}

/* ------------------------------------------------------------------ */
/* Desempenho por produto                                              */
/* ------------------------------------------------------------------ */

export interface ProductPerformanceRow {
  productId: string;
  name: string;
  category: string;
  /** Quantidade vendida em unidade base. */
  soldQty: number;
  /** Valor realmente faturado (com descontos e preço da altura da venda). */
  invoiced: number;
  /** Custo com base no preço de compra actual (estimativa assumida). */
  cost: number;
  profit: number;
  /** Stock no início do período reconstruído a partir do stock actual. */
  stockBefore: number;
  /** false quando algum artigo vendido já não existe no catálogo. */
  stockBeforeComplete: boolean;
}

/**
 * Constrói a tabela de desempenho por produto.
 *
 * O que estava errado e passou a estar igual em todos os documentos:
 *  - o PDF somava `item.quantity` sem converter a unidade, enquanto o Excel
 *    convertia para unidade base — o mesmo produto aparecia com 1 saco no PDF e
 *    50 kg no Excel;
 *  - o "Faturado" era `quantidade × preço de tabela actual`, ignorando o preço
 *    e o desconto praticados na venda;
 *  - o "stock anterior" era `stock actual + vendido`, contando vendas anuladas
 *    como saída de stock.
 */
export function buildProductPerformance(
  products: Product[],
  sales: Sale[],
  helpers: {
    qtyOf: (sale: Sale, item: any, product: Product) => number;
    lineTotal: (sale: Sale, item: any) => number;
    lineCost: (sale: Sale, item: any, product: Product) => number;
  }
): ProductPerformanceRow[] {
  return (products || []).filter(Boolean).map(product => {
    let soldQty = 0;
    let invoiced = 0;
    let cost = 0;

    for (const sale of sales) {
      for (const item of (sale.items || [])) {
        if (!item || String(item.productId) !== String(product.id)) continue;
        const qty = Number(helpers.qtyOf(sale, item, product)) || 0;
        soldQty += qty;
        invoiced += Number(helpers.lineTotal(sale, item)) || 0;
        cost += Number(helpers.lineCost(sale, item, product)) || 0;
      }
    }

    const stock = stockBeforePeriod(Number(product.stockQty) || 0, sales, sale => {
      const itens = (sale.items || []).filter((item: any) => item && String(item.productId) === String(product.id));
      if (itens.length === 0) return 0;
      return itens.reduce((total: number, item: any) => total + (Number(helpers.qtyOf(sale, item, product)) || 0), 0);
    });

    return {
      productId: String(product.id),
      name: product.name || String(product.id),
      category: product.category || 'Sem categoria',
      soldQty,
      invoiced,
      cost,
      profit: invoiced - cost,
      stockBefore: stock.value,
      stockBeforeComplete: stock.complete
    };
  });
}
