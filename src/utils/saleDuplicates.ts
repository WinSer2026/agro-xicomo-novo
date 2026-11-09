import type { Sale } from '../types';
import { isCancelledSale, isFinancialSale } from './saleStatus';
import { toLocalDateKey } from './dateRangeHelper';

/**
 * Detecção de relançamento duplicado.
 *
 * O problema (V-C11): o corte de inventário anula vendas do dia e a operação
 * normal é relançá-las no PDV. Nada impedia o operador de as lançar **duas
 * vezes** — o stock saía duas vezes e o cliente era facturado duas vezes, sem
 * que nenhum ecrã dissesse nada.
 *
 * Aqui compara-se uma venda em construção com as vendas do próprio dia:
 *  - `duplicate`   — já existe uma venda válida igual (relançamento repetido);
 *  - `cancelledTwin` — existe uma venda anulada igual (é a que se quer relançar).
 */

export interface SaleFingerprintInput {
  customerName?: string;
  total: number;
  items: Array<{ productId?: string | number; quantity?: number; sellingUnit?: string }>;
}

const normalizarCliente = (nome?: string): string => {
  const limpo = String(nome || '').trim().toLowerCase();
  if (!limpo || limpo === 'cliente geral' || limpo === 'consumidor final') return 'cliente-geral';
  return limpo.replace(/\s+/g, ' ');
};

const normalizarItens = (itens: SaleFingerprintInput['items']): string =>
  (itens || [])
    .map(item => ({
      id: String(item?.productId ?? ''),
      qty: Math.round((Number(item?.quantity) || 0) * 1000) / 1000,
      unidade: String(item?.sellingUnit || 'Base')
    }))
    .filter(linha => linha.id && linha.qty !== 0)
    .sort((a, b) => (a.id + a.unidade).localeCompare(b.id + b.unidade))
    .map(linha => `${linha.id}|${linha.qty}|${linha.unidade}`)
    .join(';');

/** Assinatura estável: cliente + total (ao cêntimo) + conjunto de linhas. */
export function saleFingerprint(input: SaleFingerprintInput): string {
  const total = Math.round((Number(input.total) || 0) * 100);
  return `${normalizarCliente(input.customerName)}#${total}#${normalizarItens(input.items)}`;
}

export function fingerprintOfSale(sale: Sale): string {
  return saleFingerprint({
    customerName: sale.customerName,
    total: Number(sale.total) || 0,
    items: (sale.items || []).map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      sellingUnit: item.sellingUnit
    }))
  });
}

export interface DuplicateCheck {
  /** Venda válida do mesmo dia com a mesma assinatura. */
  duplicate?: Sale;
  /** Venda anulada do mesmo dia com a mesma assinatura (a original do corte). */
  cancelledTwin?: Sale;
}

/**
 * Procura conflitos entre uma venda nova e as vendas do dia.
 * `todayKey` é o dia local (AAAA-MM-DD); sem ele usa-se o de cada venda.
 */
export function findDuplicateSale(
  sales: Sale[] | null | undefined,
  candidate: SaleFingerprintInput,
  todayKey?: string
): DuplicateCheck {
  const assinatura = saleFingerprint(candidate);
  const resultado: DuplicateCheck = {};

  for (const sale of sales || []) {
    if (!sale) continue;
    const dia = todayKey || toLocalDateKey(sale.dateKey || sale.date);
    if (!todayKey && !dia) continue;
    const diaVenda = toLocalDateKey(sale.dateKey || sale.date);
    if (todayKey && diaVenda !== todayKey) continue;
    if (fingerprintOfSale(sale) !== assinatura) continue;

    if (isCancelledSale(sale)) {
      if (!resultado.cancelledTwin) resultado.cancelledTwin = sale;
    } else if (isFinancialSale(sale)) {
      if (!resultado.duplicate) resultado.duplicate = sale;
    }
  }

  return resultado;
}

/** Texto único para o operador confirmar antes de gravar. */
export function describeDuplicateRisk(check: DuplicateCheck): string {
  const partes: string[] = [];
  if (check.duplicate) {
    partes.push(`Já existe hoje uma venda igual: ${check.duplicate.invoiceNumber} (${Number(check.duplicate.total).toFixed(2)} MT).`);
  }
  if (check.cancelledTwin) {
    partes.push(`Existe uma venda anulada igual (${check.cancelledTwin.invoiceNumber}) — se está a relançar vendas do corte de inventário, cada uma deve entrar uma única vez.`);
  }
  return partes.join('\n\n');
}
