/**
 * Regras do turno de caixa — funções puras, sem base de dados.
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * Um turno é o período entre abrir e fechar a gaveta. O fecho compara o que
 * está fisicamente na gaveta com o que o sistema espera, método a método.
 *
 * Decisões do dono (D5) que este ficheiro implementa:
 *  - fecho por turno, obrigatório;
 *  - sem fundo de maneio fixo: o turno seguinte começa com o que foi CONTADO;
 *  - sem tolerância de diferenças: qualquer cêntimo é registado e justificado;
 *  - contagem por método de pagamento;
 *  - reembolsos descontam do dinheiro esperado;
 *  - assinaturas de quem conta e de quem confere.
 *
 * Porque este ficheiro é puro (sem Firestore, sem React): pode ser testado com
 * números fixos e a mesma fórmula é usada no ecrã e nos relatórios. A gravação
 * está em utils/shifts.ts.
 */

import type { CashCounts, CashMovement, CashSession, Sale } from '../types';

/** Métodos que mexem em dinheiro/valores contáveis. Crédito não entra na gaveta. */
export const CASH_METHODS = ['Dinheiro', 'Transferência', 'M-Pesa', 'E-Mola'] as const;
export type CashMethod = (typeof CASH_METHODS)[number];

/** Método técnico para valores que não se conseguem atribuir (ex.: Múltiplo antigo sem troços). */
export const UNALLOCATED_METHOD = 'Por identificar';

/** Arredonda a cêntimos, evitando o clássico 0.30000000000000004. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Soma de uma contagem (todos os métodos). */
export function totalOf(counts: CashCounts | undefined | null): number {
  return round2(Object.values(counts || {}).reduce((total, value) => total + num(value), 0));
}

function addTo(counts: CashCounts, method: string, value: number): void {
  const key = method || UNALLOCATED_METHOD;
  counts[key] = round2((counts[key] || 0) + num(value));
}

/**
 * Quanto dinheiro entrou, e por que método, com esta venda.
 *
 * O ponto que estava errado antes (PD-09): uma venda paga em "Múltiplo" — parte
 * em dinheiro, parte em M-Pesa — era ignorada por completo pelo saldo de caixa,
 * porque o código só olhava para paymentMethod === 'Dinheiro'. A gaveta fechava
 * com sobra que ninguém sabia explicar.
 *
 * Regras:
 *  - venda cancelada -> nada entrou;
 *  - crédito -> nada entrou na gaveta (fica em dívida);
 *  - Múltiplo -> soma os troços de paymentBreakdown;
 *  - Múltiplo antigo sem troços -> fica em "Por identificar" (diz-se, não se inventa);
 *  - restantes -> total no próprio método.
 */
export function saleInflows(sale: Sale): { byMethod: CashCounts; unallocated: number } {
  const byMethod: CashCounts = {};
  let unallocated = 0;

  const status = String(sale?.status || '');
  if (!sale || status === 'Cancelada' || status === 'canceled') return { byMethod, unallocated };

  const method = String(sale.paymentMethod || 'Dinheiro');
  if (method === 'Crédito' || status === 'Crédito') return { byMethod, unallocated };

  const breakdown = Array.isArray(sale.paymentBreakdown) ? sale.paymentBreakdown : [];
  const breakdownTotal = round2(
    breakdown.reduce((total, part) => total + num((part as { amount?: number })?.amount), 0)
  );

  if (breakdown.length > 0 && breakdownTotal > 0) {
    breakdown.forEach(part => {
      const partMethod = String((part as { method?: string })?.method || method || UNALLOCATED_METHOD);
      const amount = num((part as { amount?: number })?.amount);
      if (amount <= 0) return;
      if (partMethod === 'Crédito') return;
      addTo(byMethod, partMethod, amount);
    });
    // Diferença entre o total da venda e a soma dos troços (venda com desconto
    // posterior, ou troço em falta): fica identificada, não escondida.
    const leftover = round2(num(sale.total) - breakdownTotal);
    if (Math.abs(leftover) >= 0.01) {
      unallocated = round2(unallocated + leftover);
      addTo(byMethod, UNALLOCATED_METHOD, leftover);
    }
    return { byMethod, unallocated };
  }

  if (method === 'Múltiplo') {
    // Sem troços não há forma honesta de repartir: registamos o total como
    // "Por identificar" e o ecrã avisa que a contagem daquele método precisa de
    // conferência manual.
    const total = num(sale.total);
    unallocated = round2(unallocated + total);
    addTo(byMethod, UNALLOCATED_METHOD, total);
    return { byMethod, unallocated };
  }

  addTo(byMethod, method, num(sale.total));
  return { byMethod, unallocated };
}

/**
 * Movimento de caixa com sinal: positivo entra, negativo sai.
 * Reembolso e sangria vêm negativos (ver dbService.addCashMovement), mas o sinal
 * é normalizado pelo tipo para que um registo antigo mal gravado não infle a
 * gaveta.
 */
export function movementFlow(movement: CashMovement): { method: string; amount: number } | null {
  if (!movement) return null;
  const method = String(movement.method || 'Dinheiro');
  const amount = num(movement.amount);
  if (amount === 0) return null;

  const tipo = String(movement.type || '');
  const negativoPorNatureza = tipo === 'Reembolso' || tipo === 'Sangria';
  const signed = negativoPorNatureza ? -Math.abs(amount) : Math.abs(amount);
  return { method, amount: signed };
}

function timeOf(record: { createdAt?: string; date?: string; timestamp?: string }): string {
  return String(record?.createdAt || record?.timestamp || record?.date || '');
}

/**
 * Este registo pertence a este turno?
 *
 * 1. Se tem `cashSessionId`, é esse e mais nenhum.
 * 2. Se não tem (registos anteriores aos turnos), só conta se caiu dentro da
 *    janela do turno — e nunca é reescrito: fica sem turno na ficha.
 */
export function belongsToSession(
  record: { cashSessionId?: string; createdAt?: string; date?: string; timestamp?: string },
  session: Pick<CashSession, 'id' | 'openedAt' | 'closedAt'>
): boolean {
  if (record?.cashSessionId) return record.cashSessionId === session.id;

  const when = timeOf(record);
  if (!when) return false;

  const start = String(session.openedAt || '');
  const end = session.closedAt ? String(session.closedAt) : '';

  // Datas só com dia (AAAA-MM-DD, registos antigos): compara por dia.
  if (when.length <= 10) {
    const startDay = start.slice(0, 10);
    const endDay = end ? end.slice(0, 10) : '';
    return (!startDay || when >= startDay) && (!endDay || when <= endDay);
  }

  return (!start || when >= start) && (!end || when <= end);
}

export interface SessionExpected {
  opening: CashCounts;
  inflow: CashCounts;
  outflow: CashCounts;
  expected: CashCounts;
  /** Valores que não se conseguiram atribuir a um método (ver UNALLOCATED_METHOD). */
  unallocated: number;
  salesCount: number;
  movementsCount: number;
}

/**
 * O que o sistema espera encontrar na gaveta, método a método:
 *   esperado = abertura + vendas recebidas − saídas (sangrias, reembolsos) + entradas
 *
 * O reembolso é uma saída: o dinheiro voltou para o cliente e já não está na
 * gaveta. Antes, o saldo mostrava-o como se estivesse lá e a falta do fecho
 * aparecia sem explicação.
 */
export function computeSessionExpected(input: {
  session: Pick<CashSession, 'id' | 'openedAt' | 'closedAt' | 'openingCounts'>;
  sales: Sale[];
  movements: CashMovement[];
}): SessionExpected {
  const opening = { ...(input.session.openingCounts || {}) };
  const inflow: CashCounts = {};
  const outflow: CashCounts = {};
  let unallocated = 0;
  let salesCount = 0;
  let movementsCount = 0;

  (input.sales || []).forEach(sale => {
    if (!belongsToSession(sale, input.session)) return;
    const { byMethod, unallocated: resto } = saleInflows(sale);
    if (Object.keys(byMethod).length === 0) return;
    salesCount += 1;
    unallocated = round2(unallocated + resto);
    Object.entries(byMethod).forEach(([method, value]) => addTo(inflow, method, value));
  });

  (input.movements || []).forEach(movement => {
    if (!belongsToSession(movement, input.session)) return;
    const flow = movementFlow(movement);
    if (!flow) return;
    movementsCount += 1;
    if (flow.amount > 0) addTo(inflow, flow.method, flow.amount);
    else addTo(outflow, flow.method, Math.abs(flow.amount));
  });

  const expected: CashCounts = {};
  const methods = new Set([
    ...Object.keys(opening),
    ...Object.keys(inflow),
    ...Object.keys(outflow)
  ]);
  methods.forEach(method => {
    const value = round2(num(opening[method]) + num(inflow[method]) - num(outflow[method]));
    expected[method] = value;
  });

  return { opening, inflow, outflow, expected, unallocated, salesCount, movementsCount };
}

/** Contado − esperado, método a método. Negativo = falta; positivo = sobra. */
export function computeCountsDifference(expected: CashCounts, counted: CashCounts): CashCounts {
  const diff: CashCounts = {};
  const methods = new Set([...Object.keys(expected || {}), ...Object.keys(counted || {})]);
  methods.forEach(method => {
    diff[method] = round2(num(counted?.[method]) - num(expected?.[method]));
  });
  return diff;
}

/** Diferença total. Zero é o único valor "normal" (não há tolerância). */
export function totalDifference(differenceCounts: CashCounts): number {
  return totalOf(differenceCounts);
}

/** Há alguma diferença, por pequena que seja? */
export function requiresJustification(differenceCounts: CashCounts, tolerance = 0): boolean {
  return Object.values(differenceCounts || {}).some(value => Math.abs(num(value)) > tolerance + 1e-9);
}

export interface CloseValidationInput {
  session: Pick<CashSession, 'id' | 'status'>;
  countedBy: string;
  verifiedBy: string;
  counted: CashCounts;
  expected: CashCounts;
  justification: string;
}

export interface CloseValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  differenceCounts: CashCounts;
  difference: number;
}

/**
 * Validação do fecho antes de gravar.
 *
 * O que trava (erros):
 *  - turno que já não está aberto;
 *  - falta de quem conta ou de quem confere;
 *  - contagem negativa ou em branco para um método com valores esperados;
 *  - diferença sem justificação escrita (mínimo 5 caracteres).
 *
 * O que só avisa (warnings):
 *  - a mesma pessoa conta e confere — permitido por decisão do dono, mas fica
 *    registado no documento do fecho (`countedSamePerson`).
 */
export function validateClose(input: CloseValidationInput): CloseValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const differenceCounts = computeCountsDifference(input.expected, input.counted);
  const difference = totalDifference(differenceCounts);

  if (input.session?.status && input.session.status !== 'Aberto') {
    errors.push('Este turno já está fechado. Um fecho não se reabre: corrige-se com um movimento contrário.');
  }
  if (!String(input.countedBy || '').trim()) {
    errors.push('Indique quem contou o dinheiro.');
  }
  if (!String(input.verifiedBy || '').trim()) {
    errors.push('Indique quem conferiu a contagem.');
  }

  // Métodos com valor esperado diferente de zero têm de ter contagem explícita.
  Object.entries(input.expected || {}).forEach(([method, value]) => {
    const esperado = num(value);
    if (Math.abs(esperado) < 0.01) return;
    const contado = input.counted?.[method];
    if (contado === undefined || contado === null || contado === ('' as unknown as number)) {
      errors.push(`Falta contar ${method} (o sistema espera ${esperado.toFixed(2)} MT).`);
    }
  });

  Object.entries(input.counted || {}).forEach(([method, value]) => {
    if (num(value) < 0) errors.push(`A contagem de ${method} não pode ser negativa.`);
  });

  if (requiresJustification(differenceCounts)) {
    if (String(input.justification || '').trim().length < 5) {
      errors.push(
        `A diferença é de ${difference.toFixed(2)} MT e não há tolerância: escreva a justificação (mínimo 5 caracteres).`
      );
    }
  }

  const counted = String(input.countedBy || '').trim().toLowerCase();
  const verified = String(input.verifiedBy || '').trim().toLowerCase();
  if (counted && verified && counted === verified) {
    warnings.push('A mesma pessoa contou e conferiu. Fica registado no fecho; deve ser evitado quando houver outra pessoa disponível.');
  }

  return { ok: errors.length === 0, errors, warnings, differenceCounts, difference };
}

/**
 * Com quanto abre o turno seguinte: com o que foi CONTADO, não com o que o
 * sistema esperava. É a regra do dono: o dinheiro que passa é o que existe.
 */
export function nextOpeningCounts(closingCounts: CashCounts): CashCounts {
  const opening: CashCounts = {};
  Object.entries(closingCounts || {}).forEach(([method, value]) => {
    const v = round2(num(value));
    if (v !== 0) opening[method] = v;
  });
  return opening;
}

/** Texto curto para o cabeçalho/ecrã: "Turno 12 · aberto 08:10 por Ana". */
export function describeSession(session: CashSession | null | undefined): string {
  if (!session) return 'Sem turno aberto';
  const hora = session.openedAt ? new Date(session.openedAt) : null;
  const hhmm = hora && !Number.isNaN(hora.getTime())
    ? hora.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
    : '';
  return `Turno ${session.number}${hhmm ? ` · aberto ${hhmm}` : ''}${session.openedBy ? ` por ${session.openedBy}` : ''}`;
}
