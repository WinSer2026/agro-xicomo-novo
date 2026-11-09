/**
 * Guarda de stock no carrinho e dívidas de clientes.
 */
import { checkStockAddition, lineBaseQty } from '../src/utils/stockGuard';
import { describeDebt, daysOverdue, summarizeDebts } from '../src/utils/debts';
import type { Debt } from '../src/types';

let passou = 0, falhou = 0;
function ok(nome: string, condicao: boolean) {
  if (condicao) passou++; else { falhou++; console.error('FALHOU: ' + nome); }
}

// ---------------------------------------------------------------- stock
const simples = { id: 'p1', name: 'Farinha', baseUnit: 'kg', stockQty: 100, isService: false } as any;
const hibrido = { id: 'p2', name: 'Milho', baseUnit: 'kg', parentUnit: 'Saco', conversionRate: 50, stockQty: 120, isService: false } as any;
const servico = { id: 'p3', name: 'Transporte', baseUnit: 'un', stockQty: 0, isService: true } as any;

ok('artigo simples: 1 para 1', lineBaseQty(simples, 5, 'Retail') === 5);
ok('saco converte para base', lineBaseQty(hibrido, 2, 'Bulk') === 100);
ok('retalho não converte', lineBaseQty(hibrido, 30, 'Retail') === 30);

ok('deixa vender o que existe', checkStockAddition({ product: simples, serverStock: 100, inCartBase: 0, quantity: 100, sellingUnit: 'Retail' }).allowed);
ok('bloqueia acima do stock', !checkStockAddition({ product: simples, serverStock: 100, inCartBase: 0, quantity: 101, sellingUnit: 'Retail' }).allowed);
ok('mensagem diz quanto falta', checkStockAddition({ product: simples, serverStock: 100, inCartBase: 90, quantity: 20, sellingUnit: 'Retail' }).message.includes('faltam 10'));
ok('conta o que já está no carrinho noutra unidade', !checkStockAddition({ product: hibrido, serverStock: 120, inCartBase: 100, quantity: 1, sellingUnit: 'Bulk' }).allowed);
ok('aceita quando cabe depois do carrinho', checkStockAddition({ product: hibrido, serverStock: 120, inCartBase: 50, quantity: 1, sellingUnit: 'Bulk' }).allowed);
ok('serviço nunca bloqueia', checkStockAddition({ product: servico, serverStock: 0, inCartBase: 0, quantity: 999, sellingUnit: 'Retail' }).allowed);
ok('quantidade zero é inválida', !checkStockAddition({ product: simples, serverStock: 10, inCartBase: 0, quantity: 0, sellingUnit: 'Retail' }).allowed);
ok('stock negativo do servidor não dá saldo', !checkStockAddition({ product: simples, serverStock: -5, inCartBase: 0, quantity: 1, sellingUnit: 'Retail' }).allowed);

// ---------------------------------------------------------------- dívidas
const divida = (over: Partial<Debt> = {}): Debt => ({
  id: 's1', saleId: 's1', invoiceNumber: 'FT-1', customerName: 'Ana',
  date: '2026-10-01T08:00:00.000Z', dueDate: '2026-10-31T08:00:00.000Z',
  total: 1000, paidAmount: 0, payments: [], status: 'Aberta', operator: 'Ana', ...over
} as Debt);

ok('vencida há 9 dias', daysOverdue(divida(), '2026-11-09T10:00:00.000Z') === 9);
ok('dentro do prazo dá negativo', daysOverdue(divida(), '2026-10-20T10:00:00.000Z') === -11);
ok('vence hoje', daysOverdue(divida(), '2026-10-31T10:00:00.000Z') === 0);

const vencida = describeDebt(divida(), '2026-11-09T10:00:00.000Z');
ok('estado vencida', vencida.state === 'Vencida');
ok('etiqueta em português', vencida.label === 'Vencida há 9 dias');
ok('em dívida é o total', vencida.remaining === 1000);

const parcial = describeDebt(divida({ paidAmount: 400 }), '2026-11-09T10:00:00.000Z');
ok('cobrança parcial reduz a dívida', parcial.remaining === 600);
ok('parcial ainda conta como vencida', parcial.state === 'Vencida');

const paga = describeDebt(divida({ paidAmount: 1000, status: 'Paga' }), '2026-11-09T10:00:00.000Z');
ok('paga não tem dívida', paga.remaining === 0 && paga.state === 'Paga');

const aVencer = describeDebt(divida(), '2026-10-25T10:00:00.000Z');
ok('a vencer com dias', aVencer.label === 'Vence em 6 dias');
ok('vence hoje sem dias', describeDebt(divida(), '2026-10-31T10:00:00.000Z').label === 'Vence hoje');

const resumo = summarizeDebts([
  divida({ id: 'a', saleId: 'a' }),
  divida({ id: 'b', saleId: 'b', paidAmount: 500, dueDate: '2026-12-31T08:00:00.000Z' }),
  divida({ id: 'c', saleId: 'c', paidAmount: 1000, status: 'Paga' })
], '2026-11-09T10:00:00.000Z');
ok('duas em aberto', resumo.openCount === 2);
ok('valor em aberto', resumo.openValue === 1500);
ok('uma vencida', resumo.overdueCount === 1);
ok('valor vencido', resumo.overdueValue === 1000);

console.log(`\n--- RESULTADO: ${passou} testes passaram, ${falhou} falharam ---`);
if (falhou > 0) process.exit(1);
