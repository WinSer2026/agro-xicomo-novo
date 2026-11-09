import type { CashMovement, Sale } from '../types';
import { saleInflows, UNALLOCATED_METHOD } from './cashSessions';

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
 *
 * CORRECÇÃO PD-09: antes o código perguntava
 *   `paymentMethod.toLowerCase().includes('dinheiro')`
 * e por isso uma venda em "Múltiplo" (parte em dinheiro, parte em M-Pesa) era
 * ignorada por inteiro — a gaveta tinha dinheiro que o ecrã dizia não existir.
 * Agora a parte em dinheiro vem de `saleInflows`, que sabe ler os troços
 * (`paymentBreakdown`) de uma venda em Múltiplo e nunca soma o troço de M-Pesa
 * como se fosse nota.
 *
 * Continua a contar SÓ o dinheiro físico: transferência, M-Pesa e E-Mola são
 * saldo bancário/carteira, não gaveta. Reembolsos e sangrias descontam
 * (`outflow`), porque o dinheiro saiu mesmo.
 */
export function cashBalance(
  sales: Sale[],
  movements: CashMovement[],
  startDay: string,
  endDay: string
): { inflow: number; outflow: number; balance: number; unallocated: number } {
  let inflow = 0;
  let unallocated = 0;

  sales
    .filter(sale => sale && !['Cancelada', 'canceled'].includes(String(sale.status || '')))
    .filter(sale => {
      const dia = toCashDay((sale as any).date || (sale as any).timestamp || (sale as any).createdAt);
      return dia >= startDay && dia <= endDay;
    })
    .forEach(sale => {
      const { byMethod, unallocated: resto } = saleInflows(sale);
      inflow += Number(byMethod['Dinheiro']) || 0;
      // Valores que o sistema não consegue atribuir a um método (ex.: Múltiplo
      // antigo gravado sem troços) não são somados ao saldo: são devolvidos
      // para o ecrã poder avisar.
      unallocated += Math.abs(Number(byMethod[UNALLOCATED_METHOD]) || resto || 0);
    });

  // Entradas registadas à parte (cobrança de facturas em dívida) também são
  // dinheiro na gaveta. Sem isto, o caixa fechava com sobra que ninguém sabia
  // explicar — o problema ao contrário do reembolso.
  const entradasExtra = movements
    .filter(m => m && m.day >= startDay && m.day <= endDay && Number(m.amount) > 0)
    .filter(m => String(m.method || 'Dinheiro') === 'Dinheiro')
    .reduce((total, m) => total + Number(m.amount), 0);

  const outflow = movements
    .filter(m => m && m.day >= startDay && m.day <= endDay)
    .filter(m => String(m.method || 'Dinheiro') === 'Dinheiro')
    .reduce((total, m) => total + (Number(m.amount) < 0 ? Math.abs(Number(m.amount)) : 0), 0);

  const arredondar = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return {
    inflow: arredondar(inflow + entradasExtra),
    outflow: arredondar(outflow),
    balance: arredondar(inflow + entradasExtra - outflow),
    unallocated: arredondar(unallocated)
  };
}
