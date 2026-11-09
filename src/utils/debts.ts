import type { Debt } from '../types';

/**
 * Estado de uma dívida, em linguagem de balcão.
 *
 * Uma venda a crédito sem prazo não se cobra: ninguém sabe quando é que está
 * atrasada. Estas funções transformam datas em frases que o operador entende.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

function diaLocal(iso?: string): string {
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

/** Dias de atraso (0 = ainda dentro do prazo; negativo = faltam dias). */
export function daysOverdue(debt: Pick<Debt, 'dueDate'>, todayIso?: string): number {
  const vencimento = diaLocal(debt.dueDate);
  const hoje = diaLocal(todayIso || new Date().toISOString());
  if (!vencimento || !hoje) return 0;
  const a = new Date(`${vencimento}T12:00:00.000Z`).getTime();
  const b = new Date(`${hoje}T12:00:00.000Z`).getTime();
  return Math.round((b - a) / DIA_MS);
}

export interface DebtView {
  remaining: number;
  paid: number;
  overdueDays: number;
  /** 'Paga' | 'Vencida' | 'A vencer' | 'Sem prazo' */
  state: 'Paga' | 'Vencida' | 'A vencer' | 'Anulada';
  label: string;
}

export function describeDebt(debt: Debt, todayIso?: string): DebtView {
  const total = Number(debt.total) || 0;
  const paid = Number(debt.paidAmount) || 0;
  const remaining = Math.max(0, Math.round((total - paid) * 100) / 100);

  if (debt.status === 'Paga' || remaining <= 0.009) {
    return { remaining: 0, paid, overdueDays: 0, state: 'Paga', label: 'Paga' };
  }
  if (debt.status === 'Anulada') {
    return { remaining, paid, overdueDays: 0, state: 'Anulada', label: 'Anulada' };
  }

  const dias = daysOverdue(debt, todayIso);
  if (dias > 0) {
    return {
      remaining,
      paid,
      overdueDays: dias,
      state: 'Vencida',
      label: `Vencida há ${dias} dia${dias === 1 ? '' : 's'}`
    };
  }
  const faltam = Math.abs(dias);
  return {
    remaining,
    paid,
    overdueDays: 0,
    state: 'A vencer',
    label: faltam === 0 ? 'Vence hoje' : `Vence em ${faltam} dia${faltam === 1 ? '' : 's'}`
  };
}

export interface DebtSummary {
  openCount: number;
  openValue: number;
  overdueCount: number;
  overdueValue: number;
}

export function summarizeDebts(debts: Debt[], todayIso?: string): DebtSummary {
  const resumo: DebtSummary = { openCount: 0, openValue: 0, overdueCount: 0, overdueValue: 0 };
  for (const divida of debts || []) {
    if (!divida) continue;
    const vista = describeDebt(divida, todayIso);
    if (vista.remaining <= 0.009) continue;
    resumo.openCount += 1;
    resumo.openValue += vista.remaining;
    if (vista.state === 'Vencida') {
      resumo.overdueCount += 1;
      resumo.overdueValue += vista.remaining;
    }
  }
  resumo.openValue = Math.round(resumo.openValue * 100) / 100;
  resumo.overdueValue = Math.round(resumo.overdueValue * 100) / 100;
  return resumo;
}
