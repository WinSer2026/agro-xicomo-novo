/**
 * Regras de venda a crédito (decisão D3 do dono, 09/11/2026).
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * Regras decididas:
 *  - limite de 20.000 MT em dívida por cliente;
 *  - prazo de 30 dias para pagar;
 *  - acima do limite só com autorização da gerência (código de gestor);
 *  - cliente com dívida vencida há mais de 30 dias não leva mais crédito.
 *
 * Funções puras: o PDV passa as dívidas que já tem em memória e recebe uma
 * decisão com o motivo escrito, para o operador saber o que dizer ao cliente.
 */

import type { Debt } from '../types';
import { describeDebt } from './debts';

/** Limite de dívida por cliente, em MT. */
export const CREDIT_LIMIT_MT = 20000;
/** Prazo de pagamento, em dias. */
export const CREDIT_TERM_DAYS = 30;
/** A partir de quantos dias de atraso se bloqueia novo crédito. */
export const CREDIT_BLOCK_AFTER_DAYS = 30;

const DIA_MS = 24 * 60 * 60 * 1000;

function chaveCliente(nome: string): string {
  return (nome || '').trim().toLowerCase();
}

/** Dívidas em aberto de um cliente (nome comparado sem maiúsculas nem espaços extra). */
export function customerDebts(debts: Debt[], customerName: string): Debt[] {
  const alvo = chaveCliente(customerName);
  if (!alvo) return [];
  return (debts || []).filter(d => {
    if (chaveCliente(d.customerName || '') !== alvo) return false;
    const estado = describeDebt(d);
    return estado.state !== 'Paga' && estado.state !== 'Anulada';
  });
}

/** Total em dívida (capital não pago) de um cliente. */
export function customerOutstanding(debts: Debt[], customerName: string): number {
  const total = customerDebts(debts, customerName)
    .reduce((soma, d) => soma + describeDebt(d).remaining, 0);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

/** Data de vencimento de uma venda a crédito feita hoje (30 dias). */
export function creditDueDate(fromIso?: string): string {
  const base = fromIso ? new Date(fromIso) : new Date();
  const data = Number.isNaN(base.getTime()) ? new Date() : base;
  return new Date(data.getTime() + CREDIT_TERM_DAYS * DIA_MS).toISOString();
}

export interface CreditCheckInput {
  customerName: string;
  /** Valor da venda que se está a fazer. */
  amount: number;
  debts: Debt[];
  /** Já foi introduzido o código de gestor para esta venda? */
  managerAuthorized?: boolean;
  todayIso?: string;
}

export interface CreditCheckResult {
  /** Pode vender a crédito (com ou sem código de gestor). */
  allowed: boolean;
  /** A venda exige o código de gestor antes de continuar. */
  requiresManager: boolean;
  /** Motivos, em linguagem de balcão. */
  reasons: string[];
  outstanding: number;
  /** Quanto ainda cabe no limite depois desta venda (pode ser negativo). */
  remainingAfter: number;
  dueDate: string;
  /** Dívidas vencidas há mais de 30 dias que estão a bloquear. */
  blockingDebts: Debt[];
}

/**
 * Decide se esta venda a crédito pode avançar.
 *
 * Ordem das verificações:
 *  1. cliente identificado (não pode ser "Cliente Geral");
 *  2. dívida vencida há mais de 30 dias -> bloqueia, sem excepção;
 *  3. total em dívida acima de 20.000 MT -> exige código de gestor;
 *  4. caso contrário, passa.
 */
export function canSellOnCredit(input: CreditCheckInput): CreditCheckResult {
  const nome = (input.customerName || '').trim();
  const amount = Math.max(0, Number(input.amount) || 0);
  const dueDate = creditDueDate(input.todayIso);

  if (!nome || chaveCliente(nome) === 'cliente geral') {
    return {
      allowed: false,
      requiresManager: false,
      reasons: ['Venda a crédito exige cliente identificado (não pode ser "Cliente Geral").'],
      outstanding: 0,
      remainingAfter: CREDIT_LIMIT_MT,
      dueDate,
      blockingDebts: []
    };
  }

  const abertas = customerDebts(input.debts, nome);
  const outstanding = abertas.reduce((soma, d) => soma + describeDebt(d).remaining, 0);
  const outstandingArredondado = Math.round((outstanding + Number.EPSILON) * 100) / 100;

  const blockingDebts = abertas.filter(d => {
    const vista = describeDebt(d, input.todayIso);
    return vista.state === 'Vencida' && vista.overdueDays > CREDIT_BLOCK_AFTER_DAYS;
  });

  if (blockingDebts.length > 0) {
    const mais = blockingDebts.reduce((pior, d) => {
      const dias = describeDebt(d, input.todayIso).overdueDays;
      return dias > pior ? dias : pior;
    }, 0);
    const valor = blockingDebts.reduce((soma, d) => soma + describeDebt(d, input.todayIso).remaining, 0);
    return {
      allowed: false,
      requiresManager: false,
      reasons: [
        `${nome} tem ${valor.toFixed(2)} MT em dívida vencida há ${mais} dias (limite: ${CREDIT_BLOCK_AFTER_DAYS} dias). ` +
        'Não se vende a crédito até regularizar. Se o cliente pagar parte, registe o pagamento e volte a tentar.'
      ],
      outstanding: outstandingArredondado,
      remainingAfter: Math.round((CREDIT_LIMIT_MT - outstandingArredondado - amount) * 100) / 100,
      dueDate,
      blockingDebts
    };
  }

  const depois = Math.round((outstandingArredondado + amount) * 100) / 100;
  if (depois > CREDIT_LIMIT_MT + 0.009) {
    const excesso = Math.round((depois - CREDIT_LIMIT_MT) * 100) / 100;
    if (!input.managerAuthorized) {
      return {
        allowed: false,
        requiresManager: true,
        reasons: [
          `${nome} já deve ${outstandingArredondado.toFixed(2)} MT. Esta venda levaria a dívida a ${depois.toFixed(2)} MT, ` +
          `${excesso.toFixed(2)} MT acima do limite de ${CREDIT_LIMIT_MT.toFixed(2)} MT. ` +
          'É necessária autorização da gerência (código de gestor).'
        ],
        outstanding: outstandingArredondado,
        remainingAfter: Math.round((CREDIT_LIMIT_MT - depois) * 100) / 100,
        dueDate,
        blockingDebts: []
      };
    }
    return {
      allowed: true,
      requiresManager: true,
      reasons: [
        `Autorizado pela gerência acima do limite: dívida passará a ${depois.toFixed(2)} MT (limite ${CREDIT_LIMIT_MT.toFixed(2)} MT).`
      ],
      outstanding: outstandingArredondado,
      remainingAfter: Math.round((CREDIT_LIMIT_MT - depois) * 100) / 100,
      dueDate,
      blockingDebts: []
    };
  }

  return {
    allowed: true,
    requiresManager: false,
    reasons: [],
    outstanding: outstandingArredondado,
    remainingAfter: Math.round((CREDIT_LIMIT_MT - depois) * 100) / 100,
    dueDate,
    blockingDebts: []
  };
}
