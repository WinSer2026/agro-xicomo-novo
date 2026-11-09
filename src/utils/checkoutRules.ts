import type { Sale } from '../types';

/**
 * Regras de fecho de venda (D2 e NEG-02).
 *
 * Porque existe este ficheiro: o estado da venda e a validação dos pagamentos
 * estavam dentro de uma função de 258 linhas no PDV (handleFinalizeSale), onde
 * não podiam ser testados. Aqui são funções puras, usadas pelo PDV e pelos
 * testes.
 *
 * Decisão do dono (09/11/2026, D2): "o estado depende do pagamento, não do
 * papel". Uma factura A4 paga a dinheiro fica PAGA e emite recibo.
 */

export type PrintFormat = 'A4' | 'Thermal' | 'DoubleA5' | 'ReciboA4' | 'FaturaProforma';
export type DocumentType = 'FaturaDefinitiva' | 'FaturaProforma' | 'Cotacao';

export interface SaleStatusInput {
  documentType: DocumentType;
  paymentMethod: string;
  /** O operador escolheu explicitamente emitir sem receber. */
  emitWithoutReceipt?: boolean;
}

/**
 * Estado final da venda.
 *
 * - Proforma/cotação: não é venda — fica Pendente.
 * - Crédito: fica Crédito (com dívida registada).
 * - "Emitir sem receber": Pendente, por escolha explícita.
 * - Tudo o resto (incluindo A4 pago em dinheiro): Paga.
 *
 * O formato de impressão NÃO influencia o estado (era o erro corrigido em D2).
 */
export function resolveSaleStatus(input: SaleStatusInput): Sale['status'] {
  if (input.documentType === 'FaturaProforma') return 'Pendente';
  if (input.paymentMethod === 'Crédito') return 'Crédito';
  if (input.emitWithoutReceipt) return 'Pendente';
  return 'Paga';
}

/** Uma venda paga emite sempre recibo, seja qual for o papel usado. */
export function requiresReceipt(status: Sale['status']): boolean {
  return status === 'Paga';
}

export interface MultiPaymentLine {
  method: string;
  amount: number;
}

export interface PaymentValidationInput {
  paymentMethod: string;
  total: number;
  /** Valor entregue pelo cliente (só para Dinheiro). Pode estar vazio. */
  amountReceived?: number | '';
  /** Linhas do pagamento múltiplo. */
  multiLines?: MultiPaymentLine[];
  /** Tolerância de arredondamento aceite (MT). */
  tolerance?: number;
}

export interface PaymentValidationResult {
  ok: boolean;
  message?: string;
  /** Soma efectivamente recebida (para troco e auditoria). */
  received: number;
  change: number;
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const fmt = (v: number) => v.toFixed(2);

/**
 * Valida o pagamento antes de gravar.
 *
 * Regra de ouro: uma venda não pode ficar "Paga" sem que esteja coberto o total.
 * No pagamento múltiplo, a soma das linhas tem de igualar o total; a diferença
 * (a menos) é recusada com a indicação do que falta.
 */
export function validatePayment(input: PaymentValidationInput): PaymentValidationResult {
  const tolerance = input.tolerance ?? 0.01;
  const total = round2(Number(input.total) || 0);

  if (input.paymentMethod === 'Múltiplo') {
    const lines = (input.multiLines ?? []).filter(l => Number(l.amount) > 0);
    const sum = round2(lines.reduce((acc, l) => acc + (Number(l.amount) || 0), 0));

    if (lines.length === 0) {
      return { ok: false, message: 'Indique pelo menos uma forma de pagamento com valor.', received: 0, change: 0 };
    }
    if (sum + tolerance < total) {
      return {
        ok: false,
        message: `O total dos pagamentos (${fmt(sum)} MT) é inferior ao total da venda (${fmt(total)} MT). Faltam ${fmt(round2(total - sum))} MT.`,
        received: sum,
        change: 0
      };
    }
    if (sum - total > tolerance) {
      return { ok: true, received: sum, change: round2(sum - total) };
    }
    return { ok: true, received: sum, change: 0 };
  }

  if (input.paymentMethod === 'Dinheiro') {
    const received = Number(input.amountReceived);
    if (!Number.isFinite(received) || received <= 0) {
      // Sem valor entregue declarado: aceita-se (comportamento antigo), mas sem
      // troco calculado. A interface não deve apresentar "Paga" como se
      // soubesse o troco.
      return { ok: true, received: total, change: 0 };
    }
    if (received + tolerance < total) {
      return {
        ok: false,
        message: `Valor entregue (${fmt(received)} MT) insuficiente para o total de ${fmt(total)} MT. Faltam ${fmt(round2(total - received))} MT.`,
        received,
        change: 0
      };
    }
    return { ok: true, received, change: round2(received - total) };
  }

  // Transferência, M-Pesa, E-Mola e Crédito não têm troco.
  return { ok: true, received: total, change: 0 };
}

/**
 * Confere se o total gravado corresponde às linhas e aos descontos.
 * Usado antes de escrever a venda: evita gravar documento cujo total não bate.
 */
export function totalsMatch(input: {
  subtotal: number;
  discount: number;
  total: number;
  tolerance?: number;
}): boolean {
  const tolerance = input.tolerance ?? 0.01;
  const expected = round2((Number(input.subtotal) || 0) - (Number(input.discount) || 0));
  return Math.abs(expected - (Number(input.total) || 0)) <= tolerance;
}
