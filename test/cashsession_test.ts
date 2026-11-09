/**
 * Testes do turno de caixa (PG-28) e da correcção do saldo (PD-09).
 *
 * O que se está a proteger: o fecho do turno compara a gaveta com o que o
 * sistema espera, método a método. Se a conta estiver mal, alguém assina uma
 * diferença que não existe — ou pior, uma falta real passa por sobra.
 */
import {
  belongsToSession,
  computeCountsDifference,
  computeSessionExpected,
  nextOpeningCounts,
  requiresJustification,
  round2,
  saleInflows,
  totalDifference,
  totalOf,
  validateClose,
  UNALLOCATED_METHOD
} from '../src/utils/cashSessions';
import { cashBalance } from '../src/utils/cashBox';
import type { CashMovement, Sale } from '../src/types';

let passou = 0, falhou = 0;
function ok(nome: string, condicao: boolean) {
  if (condicao) passou++; else { falhou++; console.error('FALHOU: ' + nome); }
}
function igual(nome: string, obtido: number, esperado: number) {
  ok(`${nome} (obtido ${obtido}, esperado ${esperado})`, Math.abs(obtido - esperado) < 0.005);
}

const turno = { id: 'turno-1', openedAt: '2026-11-09T08:00:00.000Z', closedAt: undefined, openingCounts: { Dinheiro: 2000 } };

// ─── 1. Quanto entrou de cada venda ────────────────────────────────────────
const vendaDinheiro = {
  id: 's1', invoiceNumber: 'FT-1', status: 'Paga', total: 1000, paymentMethod: 'Dinheiro',
  date: '2026-11-09T09:00:00.000Z', cashSessionId: 'turno-1'
} as unknown as Sale;

const vendaMultipla = {
  id: 's2', invoiceNumber: 'FT-2', status: 'Paga', total: 1000, paymentMethod: 'Múltiplo',
  date: '2026-11-09T10:00:00.000Z', cashSessionId: 'turno-1',
  paymentBreakdown: [
    { method: 'Dinheiro', amount: 600 },
    { method: 'M-Pesa', amount: 400 }
  ]
} as unknown as Sale;

const vendaCredito = {
  id: 's3', invoiceNumber: 'FT-3', status: 'Crédito', total: 3000, paymentMethod: 'Crédito',
  date: '2026-11-09T11:00:00.000Z', cashSessionId: 'turno-1'
} as unknown as Sale;

const vendaAnulada = {
  id: 's4', invoiceNumber: 'FT-4', status: 'Cancelada', total: 900, paymentMethod: 'Dinheiro',
  date: '2026-11-09T12:00:00.000Z', cashSessionId: 'turno-1'
} as unknown as Sale;

const multiploSemTrocos = {
  id: 's5', invoiceNumber: 'FT-5', status: 'Paga', total: 500, paymentMethod: 'Múltiplo',
  date: '2026-11-09T13:00:00.000Z', cashSessionId: 'turno-1'
} as unknown as Sale;

const entrada1 = saleInflows(vendaDinheiro);
igual('venda em dinheiro entra na gaveta', entrada1.byMethod['Dinheiro'] || 0, 1000);

const entrada2 = saleInflows(vendaMultipla);
igual('múltiplo: parte em dinheiro', entrada2.byMethod['Dinheiro'] || 0, 600);
igual('múltiplo: parte em M-Pesa', entrada2.byMethod['M-Pesa'] || 0, 400);
igual('múltiplo não fica sem atribuição', entrada2.unallocated, 0);

ok('crédito não mete dinheiro na gaveta', Object.keys(saleInflows(vendaCredito).byMethod).length === 0);
ok('venda cancelada não conta', Object.keys(saleInflows(vendaAnulada).byMethod).length === 0);

const entradaSemTrocos = saleInflows(multiploSemTrocos);
igual('múltiplo antigo fica por identificar', entradaSemTrocos.byMethod[UNALLOCATED_METHOD] || 0, 500);
igual('múltiplo antigo é assinalado', entradaSemTrocos.unallocated, 500);

// ─── 2. PD-09: o saldo de caixa já vê o dinheiro dentro do múltiplo ───────
const saldo = cashBalance(
  [vendaDinheiro, vendaMultipla, vendaCredito, vendaAnulada],
  [],
  '2026-11-09',
  '2026-11-09'
);
igual('PD-09: dinheiro das duas vendas (1000 + 600)', saldo.inflow, 1600);
igual('PD-09: crédito não entra no caixa', saldo.balance, 1600);

const saldoComReembolso = cashBalance(
  [vendaDinheiro],
  [{ id: 'm1', date: '2026-11-09T14:00:00.000Z', day: '2026-11-09', type: 'Reembolso', amount: -250, method: 'Dinheiro', operator: 'Ana' } as CashMovement],
  '2026-11-09',
  '2026-11-09'
);
igual('reembolso desconta do saldo', saldoComReembolso.balance, 750);

// ─── 3. Esperado no turno ─────────────────────────────────────────────────
const movimentos: CashMovement[] = [
  { id: 'm1', date: '2026-11-09T14:00:00.000Z', day: '2026-11-09', type: 'Reembolso', amount: -250, method: 'Dinheiro', operator: 'Ana', cashSessionId: 'turno-1' } as CashMovement,
  { id: 'm2', date: '2026-11-09T15:00:00.000Z', day: '2026-11-09', type: 'Sangria', amount: -500, method: 'Dinheiro', operator: 'Ana', cashSessionId: 'turno-1' } as CashMovement,
  { id: 'm3', date: '2026-11-09T16:00:00.000Z', day: '2026-11-09', type: 'Entrada', amount: 300, method: 'Dinheiro', operator: 'Ana', cashSessionId: 'turno-1' } as CashMovement
];

const esperado = computeSessionExpected({
  session: turno,
  sales: [vendaDinheiro, vendaMultipla, vendaCredito, vendaAnulada],
  movements: movimentos
});

// Dinheiro: 2000 (abertura) + 1000 + 600 − 250 − 500 + 300 = 3150
igual('esperado em dinheiro', esperado.expected['Dinheiro'] || 0, 3150);
igual('esperado em M-Pesa', esperado.expected['M-Pesa'] || 0, 400);
igual('total esperado', totalOf(esperado.expected), 3550);
igual('contou 2 vendas com dinheiro', esperado.salesCount, 2);

// Movimentos de outro turno não entram
const esperadoOutroTurno = computeSessionExpected({
  session: { ...turno, id: 'turno-2' },
  sales: [vendaDinheiro],
  movements: movimentos
});
igual('movimentos de outro turno não contam', esperadoOutroTurno.expected['Dinheiro'] || 0, 2000);

// ─── 4. Diferença e justificação ──────────────────────────────────────────
const diferenca = computeCountsDifference(esperado.expected, { Dinheiro: 3149.99, 'M-Pesa': 400 });
igual('diferença de um cêntimo é detectada', totalDifference(diferenca), -0.01);
ok('um cêntimo já exige justificação', requiresJustification(diferenca) === true);
ok('contagem certa não exige justificação', requiresJustification(diferenca, 0) === true && requiresJustification({ Dinheiro: 0 }) === false);

const semDiferenca = computeCountsDifference({ Dinheiro: 1000 }, { Dinheiro: 1000 });
igual('contagem certa dá zero', totalDifference(semDiferenca), 0);
ok('zero não exige justificação', requiresJustification(semDiferenca) === false);

// ─── 5. Validação do fecho ────────────────────────────────────────────────
const fechoBom = validateClose({
  session: { id: 'turno-1', status: 'Aberto' },
  countedBy: 'Ana',
  verifiedBy: 'Carlos',
  counted: { Dinheiro: 3150, 'M-Pesa': 400 },
  expected: esperado.expected,
  justification: ''
});
ok('fecho certo passa', fechoBom.ok === true);
igual('fecho certo tem diferença zero', fechoBom.difference, 0);

const fechoSemNome = validateClose({
  session: { id: 'turno-1', status: 'Aberto' },
  countedBy: '',
  verifiedBy: 'Carlos',
  counted: { Dinheiro: 3150, 'M-Pesa': 400 },
  expected: esperado.expected,
  justification: ''
});
ok('fecho sem quem contou é recusado', fechoSemNome.ok === false);
ok('erro diz que falta quem contou', fechoSemNome.errors.some(e => e.toLowerCase().includes('quem contou')));

const fechoSemConferente = validateClose({
  session: { id: 'turno-1', status: 'Aberto' },
  countedBy: 'Ana',
  verifiedBy: '',
  counted: { Dinheiro: 3150, 'M-Pesa': 400 },
  expected: esperado.expected,
  justification: ''
});
ok('fecho sem quem conferiu é recusado', fechoSemConferente.ok === false);

const fechoComFalta = validateClose({
  session: { id: 'turno-1', status: 'Aberto' },
  countedBy: 'Ana',
  verifiedBy: 'Carlos',
  counted: { Dinheiro: 3100, 'M-Pesa': 400 },
  expected: esperado.expected,
  justification: ''
});
ok('falta de 50 MT sem justificação é recusada (sem tolerância)', fechoComFalta.ok === false);
igual('falta calculada', fechoComFalta.difference, -50);

const fechoJustificado = validateClose({
  session: { id: 'turno-1', status: 'Aberto' },
  countedBy: 'Ana',
  verifiedBy: 'Carlos',
  counted: { Dinheiro: 3100, 'M-Pesa': 400 },
  expected: esperado.expected,
  justification: 'Faltou troco de 50 MT entregue a cliente; confirmado com o gerente'
});
ok('com justificação o fecho passa', fechoJustificado.ok === true);

const fechoSemContarMetodo = validateClose({
  session: { id: 'turno-1', status: 'Aberto' },
  countedBy: 'Ana',
  verifiedBy: 'Carlos',
  counted: { Dinheiro: 3150 },
  expected: esperado.expected,
  justification: ''
});
ok('método com valor esperado tem de ser contado', fechoSemContarMetodo.ok === false);
ok('erro nomeia o método em falta', fechoSemContarMetodo.errors.some(e => e.includes('M-Pesa')));

const fechoMesmaPessoa = validateClose({
  session: { id: 'turno-1', status: 'Aberto' },
  countedBy: 'Ana',
  verifiedBy: 'ana',
  counted: { Dinheiro: 3150, 'M-Pesa': 400 },
  expected: esperado.expected,
  justification: ''
});
ok('mesma pessoa pode contar e conferir', fechoMesmaPessoa.ok === true);
ok('mas fica com aviso registado', fechoMesmaPessoa.warnings.length === 1);

const fechoDeTurnoFechado = validateClose({
  session: { id: 'turno-1', status: 'Fechado' },
  countedBy: 'Ana',
  verifiedBy: 'Carlos',
  counted: { Dinheiro: 3150 },
  expected: esperado.expected,
  justification: ''
});
ok('turno já fechado não se fecha outra vez', fechoDeTurnoFechado.ok === false);

const fechoNegativo = validateClose({
  session: { id: 'turno-1', status: 'Aberto' },
  countedBy: 'Ana',
  verifiedBy: 'Carlos',
  counted: { Dinheiro: -5 },
  expected: { Dinheiro: 0 },
  justification: 'x'
});
ok('contagem negativa é recusada', fechoNegativo.ok === false);

// ─── 6. Transporte de saldo ───────────────────────────────────────────────
const aberturaSeguinte = nextOpeningCounts({ Dinheiro: 3150, 'M-Pesa': 400, 'Transferência': 0 });
igual('transita o dinheiro contado', aberturaSeguinte['Dinheiro'], 3150);
igual('transita o saldo móvel contado', aberturaSeguinte['M-Pesa'], 400);
ok('métodos a zero não transitam', aberturaSeguinte['Transferência'] === undefined);

// ─── 7. Pertença ao turno (registos antigos sem cashSessionId) ────────────
ok('venda marcada pertence ao turno', belongsToSession({ cashSessionId: 'turno-1' }, turno));
ok('venda de outro turno não pertence', !belongsToSession({ cashSessionId: 'turno-9' }, turno));
ok('venda sem turno dentro da janela conta', belongsToSession({ date: '2026-11-09T09:30:00.000Z' }, turno));
ok('venda sem turno antes da abertura não conta', !belongsToSession({ date: '2026-11-09T07:30:00.000Z' }, turno));
ok('data só com dia é comparada por dia', belongsToSession({ date: '2026-11-09' }, turno));

// ─── 8. Arredondamento ────────────────────────────────────────────────────
igual('arredonda a cêntimos', round2(0.1 + 0.2), 0.3);
igual('soma de contagem', totalOf({ Dinheiro: 10.005, 'M-Pesa': 20 }), 30.01);

console.log(`\n--- RESULTADO: ${passou} testes passaram, ${falhou} falharam ---`);
if (falhou > 0) process.exit(1);
