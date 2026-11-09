/**
 * Turnos de caixa — abertura, fecho e transporte de saldo.
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * Este ficheiro é a "mão" que grava: lê as vendas e os movimentos do turno,
 * calcula o esperado com as regras puras de utils/cashSessions.ts, valida e
 * grava. Nada aqui inventa números: se a leitura falhar, o fecho aborta e diz
 * porquê — um fecho com números errados é pior do que um fecho adiado.
 *
 * Fluxo do botão "Trocar de turno":
 *   1. abre o ecrã de contagem (método a método);
 *   2. compara com o esperado;
 *   3. exige justificação se houver qualquer diferença (sem tolerância);
 *   4. exige quem conta e quem confere;
 *   5. grava o fecho IMUTÁVEL e abre o turno seguinte com o dinheiro CONTADO.
 *
 * Não há fundo de maneio fixo nem horários: a empresa troca de turno quando
 * quiser, carregando no botão (decisão do dono).
 */

import type { CashCounts, CashSession } from '../types';
import { dbService } from './firebaseDB';
import { uid } from './idHelper';
import {
  computeSessionExpected,
  describeSession,
  nextOpeningCounts,
  round2,
  totalOf,
  validateClose,
  type SessionExpected
} from './cashSessions';

export interface ShiftOverview {
  session: CashSession | null;
  expected: SessionExpected | null;
  /** Turnos anteriores, do mais recente para o mais antigo. */
  history: CashSession[];
  label: string;
}

/** Lê o turno aberto e o que o sistema espera encontrar na gaveta. */
export async function loadShiftOverview(): Promise<ShiftOverview> {
  const session = await dbService.getOpenCashSession();
  const history = await dbService.getCashSessions(30);
  if (!session) {
    return { session: null, expected: null, history, label: describeSession(null) };
  }
  const [sales, movements] = await Promise.all([
    dbService.getSales(),
    dbService.getCashMovements()
  ]);
  const expected = computeSessionExpected({ session, sales, movements });
  return { session, expected, history, label: describeSession(session) };
}

/** Número do próximo turno (o maior existente + 1). */
function nextNumber(history: CashSession[]): number {
  const maior = (history || []).reduce((max, s) => Math.max(max, Number(s.number) || 0), 0);
  return maior + 1;
}

/**
 * Abre um turno.
 *
 * `openingCounts` é a contagem física com que a gaveta começa:
 *  - primeiro turno do sistema -> contagem inicial assinada (não há histórico);
 *  - turnos seguintes -> o que foi contado no fecho anterior (transporte).
 */
export async function openShift(input: {
  openedBy: string;
  openingCounts: CashCounts;
  note?: string;
  isFirstSession?: boolean;
}): Promise<CashSession> {
  const openedBy = String(input.openedBy || '').trim();
  if (!openedBy) throw new Error('Indique quem abre o turno.');

  const history = await dbService.getCashSessions(200);
  const aberto = history.find(s => s.status === 'Aberto');
  if (aberto) {
    throw new Error(`Já existe um turno aberto (n.º ${aberto.number}). Feche-o antes de abrir outro.`);
  }

  const contagem: CashCounts = {};
  Object.entries(input.openingCounts || {}).forEach(([method, value]) => {
    const v = round2(Number(value) || 0);
    if (v < 0) throw new Error(`O valor inicial de ${method} não pode ser negativo.`);
    if (v !== 0) contagem[method] = v;
  });

  const agora = new Date().toISOString();
  const session: CashSession = {
    id: uid('turno-'),
    number: nextNumber(history),
    status: 'Aberto',
    openedAt: agora,
    openedBy,
    day: agora.slice(0, 10),
    openingCounts: contagem,
    isFirstSession: input.isFirstSession ?? history.length === 0,
    openingNote: (input.note || '').trim() || undefined
  };

  await dbService.createCashSession(session);

  void dbService.addAuditLog({
    id: uid('log-'),
    timestamp: agora,
    username: openedBy,
    ipAddress: 'N/D',
    action: 'Abertura de Turno de Caixa',
    status: 'Sucesso',
    level: 'INFO',
    entity: 'cash_sessions',
    details: `Turno ${session.number} aberto por ${openedBy}. Valores iniciais: ${
      Object.entries(contagem).map(([m, v]) => `${m} ${v.toFixed(2)} MT`).join(', ') || 'zero'
    }.${session.isFirstSession ? ' Primeiro turno do sistema (contagem inicial).' : ''}`
  });

  return session;
}

export interface CloseShiftInput {
  session: CashSession;
  countedBy: string;
  verifiedBy: string;
  counted: CashCounts;
  justification?: string;
  /** Abrir já o turno seguinte com o dinheiro contado. Por omissão, sim. */
  openNext?: boolean;
}

export interface CloseShiftResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  closed?: CashSession;
  next?: CashSession;
  difference?: number;
}

/**
 * Fecha o turno e (por omissão) abre o seguinte com o dinheiro contado.
 *
 * O fecho fica gravado com: quem contou, quem conferiu, contagem por método,
 * esperado por método, diferença por método e justificação. Não há tolerância:
 * basta 0,01 MT de diferença para a justificação ser obrigatória.
 */
export async function closeShift(input: CloseShiftInput): Promise<CloseShiftResult> {
  const { session } = input;

  const [sales, movements, history] = await Promise.all([
    dbService.getSales(),
    dbService.getCashMovements(),
    dbService.getCashSessions(200)
  ]);

  // Fecha a janela do turno para o cálculo: tudo o que entrou até agora.
  const expectedData = computeSessionExpected({
    session: { ...session, closedAt: new Date().toISOString() },
    sales,
    movements
  });

  const validacao = validateClose({
    session,
    countedBy: input.countedBy,
    verifiedBy: input.verifiedBy,
    counted: input.counted,
    expected: expectedData.expected,
    justification: input.justification || ''
  });

  if (!validacao.ok) {
    return { ok: false, errors: validacao.errors, warnings: validacao.warnings };
  }

  const countedBy = input.countedBy.trim();
  const verifiedBy = input.verifiedBy.trim();
  const counted: CashCounts = {};
  Object.entries(input.counted || {}).forEach(([method, value]) => {
    const v = round2(Number(value) || 0);
    if (v !== 0) counted[method] = v;
  });

  const agora = new Date().toISOString();
  let fechado: CashSession;
  try {
    fechado = await dbService.closeCashSession(session.id, {
      closedBy: countedBy,
      closedAt: agora,
      countedBy,
      verifiedBy,
      countedSamePerson: countedBy.toLowerCase() === verifiedBy.toLowerCase(),
      closingCounts: counted,
      expectedCounts: expectedData.expected,
      differenceCounts: validacao.differenceCounts,
      difference: validacao.difference,
      justification: (input.justification || '').trim() || undefined
    });
  } catch (erro) {
    return {
      ok: false,
      errors: [erro instanceof Error ? erro.message : 'Não foi possível gravar o fecho.'],
      warnings: validacao.warnings
    };
  }

  void dbService.addAuditLog({
    id: uid('log-'),
    timestamp: agora,
    username: countedBy,
    ipAddress: 'N/D',
    action: 'Fecho de Turno de Caixa',
    status: validacao.difference === 0 ? 'Sucesso' : 'Alerta',
    level: validacao.difference === 0 ? 'INFO' : 'WARNING',
    entity: 'cash_sessions',
    details: `Turno ${fechado.number} fechado. Contou: ${countedBy}; conferiu: ${verifiedBy}. ` +
      `Esperado: ${totalOf(expectedData.expected).toFixed(2)} MT; contado: ${totalOf(counted).toFixed(2)} MT; ` +
      `diferença: ${validacao.difference.toFixed(2)} MT.` +
      (validacao.difference !== 0 ? ` Justificação: ${(input.justification || '').trim()}` : '') +
      (validacao.warnings.length ? ` Avisos: ${validacao.warnings.join(' ')}` : '')
  });

  // O turno seguinte começa com o dinheiro que existe na gaveta, não com um
  // fundo inventado.
  let seguinte: CashSession | undefined;
  if (input.openNext !== false) {
    try {
      seguinte = await openShift({
        openedBy: countedBy,
        openingCounts: nextOpeningCounts(counted),
        note: `Transporte do turno ${fechado.number} (fechado por ${countedBy}, conferido por ${verifiedBy}).`,
        isFirstSession: false
      });
      void history;
    } catch (erro) {
      // O fecho é o que importa: ficou gravado. A abertura falhada aparece no
      // ecrã e o botão "Abrir turno" continua disponível.
      console.error('[Turnos] Fecho gravado, mas não foi possível abrir o turno seguinte:', erro);
    }
  }

  return {
    ok: true,
    errors: [],
    warnings: validacao.warnings,
    closed: fechado,
    next: seguinte,
    difference: validacao.difference
  };
}

/**
 * Identificador do turno aberto, para marcar vendas e movimentos.
 * Devolve undefined se não houver turno (não trava a venda: avisa).
 */
export async function currentShiftId(): Promise<string | undefined> {
  try {
    const aberto = await dbService.getOpenCashSession();
    return aberto?.id;
  } catch (erro) {
    console.warn('[Turnos] Não foi possível saber o turno aberto:', erro);
    return undefined;
  }
}
