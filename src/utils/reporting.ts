import type { Sale } from '../types';
import { isCancelledSale, isProformaSale } from './saleStatus';

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
