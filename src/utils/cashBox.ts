import type { CashMovement, Sale } from '../types';

export const CASH_METHODS = ['Dinheiro', 'Transferência', 'M-Pesa', 'E-Mola'] as const;

/** Dia local de Maputo (AAAA-MM-DD). O ISO é UTC: 23:30 de Maputo já é o dia seguinte lá. */
export function toCashDay(iso: string | undefined): string {
  if (!iso) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Maputo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(data);
}

/**
 * Uma venda já paga pode gerar reembolso. Uma proforma ou uma venda por pagar
 * não gerou entrada de dinheiro: devolver dinheiro por ela é pagar duas vezes.
 */
export function canRefund(sale: Sale | null | undefined): boolean {
  if (!sale) return false;
  const estado = String(sale.status || '');
  if (estado === 'Cancelada' || estado === 'canceled') return false;
  const pago = Number((sale as any).amountPaid);
  const total = Number(sale.total) || 0;
  if (Number.isFinite(pago) && pago > 0) return true;
  // Vendas antigas não têm amountPaid: vale o recibo emitido.
  if (sale.receiptNumber && (estado === 'Paga' || estado === 'Pago' || estado === 'Pago Parcial')) return true;
  return Boolean(sale.receiptNumber) && total > 0 && estado !== 'Pendente';
}

/** Valor máximo que faz sentido devolver: o que o cliente pagou, nunca o total da factura. */
export function maxRefundFor(sale: Sale | null | undefined): number {
  if (!sale || !canRefund(sale)) return 0;
  const pago = Number((sale as any).amountPaid);
  if (Number.isFinite(pago) && pago > 0) return Math.min(Number(sale.total) || pago, pago);
  return Number(sale.total) || 0;
}

/** Total de reembolsos num intervalo de dias (inclusive). */
export function sumRefunds(movements: CashMovement[], startDay: string, endDay: string): number {
  return movements
    .filter(m => m && m.type === 'Reembolso' && m.day >= startDay && m.day <= endDay)
    .reduce((total, m) => total + Math.abs(Number(m.amount) || 0), 0);
}

/**
 * Saldo de caixa = dinheiro que entrou das vendas no período − saídas registadas.
 * As entradas vêm das vendas pagas (só meios de pagamento em dinheiro contam
 * para a gaveta; os outros são saldo bancário/móvel, não caixa físico).
 */
export function cashBalance(
  sales: Sale[],
  movements: CashMovement[],
  startDay: string,
  endDay: string
): { inflow: number; outflow: number; balance: number } {
  const inflow = sales
    .filter(sale => sale && !['Cancelada', 'canceled'].includes(String(sale.status || '')))
    .filter(sale => {
      const dia = toCashDay((sale as any).date || (sale as any).timestamp || (sale as any).createdAt);
      return dia >= startDay && dia <= endDay;
    })
    .filter(sale => String((sale as any).paymentMethod || 'Dinheiro').toLowerCase().includes('dinheiro'))
    .reduce((total, sale) => total + (Number(sale.total) || 0), 0);

  // Entradas registadas à parte (cobrança de facturas em dívida) também são
  // dinheiro na gaveta. Sem isto, o caixa fechava com sobra que ninguém sabia
  // explicar — o problema ao contrário do reembolso.
  const entradasExtra = movements
    .filter(m => m && m.day >= startDay && m.day <= endDay && Number(m.amount) > 0)
    .reduce((total, m) => total + Number(m.amount), 0);

  const outflow = movements
    .filter(m => m && m.day >= startDay && m.day <= endDay)
    .reduce((total, m) => total + (Number(m.amount) < 0 ? Math.abs(Number(m.amount)) : 0), 0);

  return { inflow: inflow + entradasExtra, outflow, balance: inflow + entradasExtra - outflow };
}
