/**
 * Testes das regras de crédito (D3).
 *
 * Regras do dono: 20.000 MT por cliente, 30 dias de prazo, acima do limite só
 * com código de gestor, e cliente com dívida vencida há mais de 30 dias não
 * leva mais crédito.
 */
import {
  canSellOnCredit,
  customerOutstanding,
  creditDueDate,
  CREDIT_LIMIT_MT,
  CREDIT_TERM_DAYS,
  CREDIT_BLOCK_AFTER_DAYS
} from '../src/utils/creditRules';
import type { Debt } from '../src/types';

let passou = 0, falhou = 0;
function ok(nome: string, condicao: boolean) {
  if (condicao) passou++; else { falhou++; console.error('FALHOU: ' + nome); }
}

const HOJE = '2026-11-09T10:00:00.000Z';

function divida(over: Partial<Debt>): Debt {
  return {
    id: 'd1',
    saleId: 's1',
    invoiceNumber: 'FT-1',
    customerName: 'João Machava',
    date: '2026-10-01T10:00:00.000Z',
    dueDate: '2026-10-31T10:00:00.000Z',
    total: 5000,
    paidAmount: 0,
    payments: [],
    status: 'Aberta',
    operator: 'Ana',
    ...over
  } as Debt;
}

// ─── 1. Constantes decididas ───────────────────────────────────────────────
ok('limite é 20.000 MT', CREDIT_LIMIT_MT === 20000);
ok('prazo é 30 dias', CREDIT_TERM_DAYS === 30);
ok('bloqueio após 30 dias de atraso', CREDIT_BLOCK_AFTER_DAYS === 30);

// ─── 2. Cliente identificado ───────────────────────────────────────────────
const semNome = canSellOnCredit({ customerName: '', amount: 100, debts: [], todayIso: HOJE });
ok('sem cliente não há crédito', semNome.allowed === false);
const clienteGeral = canSellOnCredit({ customerName: 'Cliente Geral', amount: 100, debts: [], todayIso: HOJE });
ok('"Cliente Geral" não tem crédito', clienteGeral.allowed === false);

// ─── 3. Dentro do limite ───────────────────────────────────────────────────
const dentroDoLimite = canSellOnCredit({
  customerName: 'João Machava',
  amount: 3000,
  debts: [divida({ dueDate: '2026-12-01T10:00:00.000Z' })],
  todayIso: HOJE
});
ok('dentro do limite passa', dentroDoLimite.allowed === true);
ok('não pede gerência dentro do limite', dentroDoLimite.requiresManager === false);
ok('soma a dívida existente', dentroDoLimite.outstanding === 5000);
ok('mostra quanto sobra do limite', dentroDoLimite.remainingAfter === 12000);

// ─── 4. Acima do limite ────────────────────────────────────────────────────
const acimaDoLimite = canSellOnCredit({
  customerName: 'João Machava',
  amount: 16000,
  debts: [divida({ dueDate: '2026-12-01T10:00:00.000Z' })],
  todayIso: HOJE
});
ok('acima do limite não passa sem gerência', acimaDoLimite.allowed === false);
ok('acima do limite pede gerência', acimaDoLimite.requiresManager === true);
ok('motivo menciona o limite', acimaDoLimite.reasons.join(' ').includes('20 000') || acimaDoLimite.reasons.join(' ').includes('20000'));

const autorizado = canSellOnCredit({
  customerName: 'João Machava',
  amount: 16000,
  debts: [divida({ dueDate: '2026-12-01T10:00:00.000Z' })],
  managerAuthorized: true,
  todayIso: HOJE
});
ok('com autorização da gerência passa', autorizado.allowed === true);
ok('autorização fica assinalada', autorizado.requiresManager === true);
ok('motivo diz que a dívida passa a 21.000', autorizado.reasons.join(' ').includes('21000') || autorizado.reasons.join(' ').includes('21 000'));

// ─── 5. Dívida vencida há mais de 30 dias bloqueia ────────────────────────
const muitoAtrasado = canSellOnCredit({
  customerName: 'João Machava',
  amount: 500,
  debts: [divida({ dueDate: '2026-09-01T10:00:00.000Z', total: 2000 })],
  todayIso: HOJE
});
ok('dívida vencida há mais de 30 dias bloqueia', muitoAtrasado.allowed === false);
ok('bloqueio não se resolve com gerência', muitoAtrasado.requiresManager === false);
ok('motivo fala em regularizar', muitoAtrasado.reasons.join(' ').toLowerCase().includes('regularizar'));
ok('identifica a dívida que bloqueia', muitoAtrasado.blockingDebts.length === 1);

const atrasoPequeno = canSellOnCredit({
  customerName: 'João Machava',
  amount: 500,
  debts: [divida({ dueDate: '2026-10-20T10:00:00.000Z', total: 2000 })],
  todayIso: HOJE
});
ok('atraso de 20 dias não bloqueia', atrasoPequeno.allowed === true);

// ─── 6. Dívidas pagas não contam ──────────────────────────────────────────
const pagas = canSellOnCredit({
  customerName: 'João Machava',
  amount: 19000,
  debts: [divida({ status: 'Paga' })],
  todayIso: HOJE
});
ok('dívida paga não conta para o limite', pagas.allowed === true && pagas.outstanding === 0);

ok('dívidas de outro cliente não contam',
  customerOutstanding([divida({ customerName: 'Outro Cliente' })], 'João Machava') === 0);
ok('nome com maiúsculas diferentes é o mesmo cliente',
  customerOutstanding([divida({ customerName: 'joão machava' })], 'JOÃO MACHAVA') === 5000);
ok('capital parcialmente pago conta só o que falta',
  customerOutstanding([divida({ total: 5000, paidAmount: 2000 })], 'João Machava') === 3000);

// ─── 7. Prazo ─────────────────────────────────────────────────────────────
const vencimento = creditDueDate('2026-11-09T10:00:00.000Z');
ok('prazo de 30 dias a contar de hoje', vencimento.startsWith('2026-12-09'));

console.log(`\n--- RESULTADO: ${passou} testes passaram, ${falhou} falharam ---`);
if (falhou > 0) process.exit(1);
