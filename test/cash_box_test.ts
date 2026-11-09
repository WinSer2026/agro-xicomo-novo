/**
 * Testes do livro de caixa (V-04).
 *
 * O que se está a proteger: o dinheiro que sai da gaveta por reembolso tem de
 * deixar rasto, e o máximo devolvível nunca pode passar o que o cliente pagou.
 */
import { canRefund, maxRefundFor, sumRefunds, cashBalance, toCashDay } from '../src/utils/cashBox';
import type { CashMovement, Sale } from '../src/types';

let passou = 0, falhou = 0;
function ok(nome: string, condicao: boolean) {
  if (condicao) passou++; else { falhou++; console.error('FALHOU: ' + nome); }
}

const vendaPaga = { id: '1', invoiceNumber: 'FT-1', status: 'Paga', total: 1000, amountPaid: 1000, receiptNumber: 'REC-1', date: '2026-11-09T08:00:00.000Z' } as unknown as Sale;
const vendaPagaParcial = { id: '2', invoiceNumber: 'FT-2', status: 'Pago Parcial', total: 1000, amountPaid: 400, receiptNumber: 'REC-2', date: '2026-11-09T09:00:00.000Z' } as unknown as Sale;
const proforma = { id: '3', invoiceNumber: 'PRO-1', status: 'Pendente', documentType: 'Proforma', total: 500, date: '2026-11-09T10:00:00.000Z' } as unknown as Sale;
const anulada = { id: '4', invoiceNumber: 'FT-4', status: 'Cancelada', total: 800, amountPaid: 800, date: '2026-11-09T11:00:00.000Z' } as unknown as Sale;

ok('venda paga devolve', canRefund(vendaPaga) === true);
ok('paga parcial devolve', canRefund(vendaPagaParcial) === true);
ok('proforma não devolve', canRefund(proforma) === false);
ok('anulada não devolve duas vezes', canRefund(anulada) === false);
ok('nula não devolve', canRefund(null) === false);
ok('máximo é o total pago', maxRefundFor(vendaPaga) === 1000);
ok('máximo numa parcial é o pagamento, não a factura', maxRefundFor(vendaPagaParcial) === 400);
ok('máximo de proforma é zero', maxRefundFor(proforma) === 0);

const movimentos: CashMovement[] = [
  { id: 'a', date: '2026-11-09T12:00:00.000Z', day: '2026-11-09', type: 'Reembolso', amount: -250, method: 'Dinheiro', operator: 'Ana' },
  { id: 'b', date: '2026-11-09T13:00:00.000Z', day: '2026-11-09', type: 'Sangria', amount: -100, method: 'Dinheiro', operator: 'Ana' },
  { id: 'c', date: '2026-11-05T13:00:00.000Z', day: '2026-11-05', type: 'Reembolso', amount: -900, method: 'Dinheiro', operator: 'Ana' }
];
ok('soma reembolsos do período', sumRefunds(movimentos, '2026-11-09', '2026-11-09') === 250);
ok('sangria não conta como reembolso', sumRefunds(movimentos, '2026-11-09', '2026-11-09') !== 350);

const saldo = cashBalance([vendaPaga], movimentos, '2026-11-09', '2026-11-09');
ok('entrou o dinheiro da venda', saldo.inflow === 1000);
ok('saiu reembolso + sangria', saldo.outflow === 350);
ok('saldo = entradas − saídas', saldo.balance === 650);
ok('venda anulada não conta como entrada', cashBalance([anulada], [], '2026-11-09', '2026-11-09').inflow === 0);
ok('dia em Maputo, não UTC', toCashDay('2026-11-09T23:30:00.000Z') === '2026-11-10');

// Cobrança de uma factura a crédito: entra na gaveta sem ser venda do dia.
const comCobranca = cashBalance([vendaPaga], [
  ...movimentos,
  { id: 'd', date: '2026-11-09T15:00:00.000Z', day: '2026-11-09', type: 'Entrada', amount: 400, method: 'Dinheiro', operator: 'Ana' }
], '2026-11-09', '2026-11-09');
ok('entrada de cobrança soma ao que entrou', comCobranca.inflow === 1400);
ok('entrada não é saída', comCobranca.outflow === 350);
ok('saldo inclui a cobrança', comCobranca.balance === 1050);

console.log(`\n--- RESULTADO: ${passou} testes passaram, ${falhou} falharam ---`);
if (falhou > 0) process.exit(1);
