/**
 * Guarda de stock no carrinho e dívidas de clientes.
 */
import { checkStockAddition, lineBaseQty } from '../src/utils/stockGuard';
import { describeDebt, daysOverdue, summarizeDebts } from '../src/utils/debts';
import {
  clampStockDelta,
  hybridStock,
  physicalDelta,
  roundStock,
  splitHybrid,
  stockLossValue,
  toBaseQty
} from '../src/utils/stockMath';
import { matchProduct, normalizeTerm } from '../src/utils/productMatch';
import { isCountedLoss, countedLosses, totalLossValue, lossQuantityByProduct } from '../src/utils/losses';
import { categoryKey, collectCategories, canonicalCategory } from '../src/utils/categories';
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

// ------------------------------------------------- aritmética do inventário
// ES-27: dar baixa de 1 saco tem de retirar 50 kg, não 1 kg.
ok('saco converte para a unidade base', toBaseQty(1, 'Bulk', hibrido) === 50);
ok('dois sacos são 100 kg', toBaseQty(2, 'Bulk', hibrido) === 100);
ok('unidade base não converte', toBaseQty(7, 'base', hibrido) === 7);
ok('artigo simples ignora "saco"', toBaseQty(1, 'Bulk', simples) === 1);
ok('conversão 1 não é conversão', !hybridStock({ parentUnit: 'Saco', conversionRate: 1 } as any).hasConversion);
ok('conversão em texto é aceite', toBaseQty(2, 'Bulk', { parentUnit: 'Saco', conversionRate: '50' as any }) === 100);

// Híbrido: base = sacos + retalho, sempre.
const duzentos = splitHybrid(120, hibrido);
ok('120 kg = 2 sacos', duzentos.stockQtyBulk === 2);
ok('120 kg = 20 kg de retalho', duzentos.stockQtyRetail === 20);
ok('sacos e retalho somam o total', duzentos.stockQtyBulk! * 50 + duzentos.stockQtyRetail! === 120);
const aposQuebra = splitHybrid(70, hibrido);
ok('depois de 1 saco de quebra sobram 70 kg', aposQuebra.stockQtyBulk === 1 && aposQuebra.stockQtyRetail === 20);
const vazio = splitHybrid(0, hibrido);
ok('zero não cria saco fantasma', vazio.stockQtyBulk === 0 && vazio.stockQtyRetail === 0);
ok('artigo simples não tem sacos', splitHybrid(120, simples).stockQtyBulk === null);
ok('retalho com dízima fecha no total', roundStock(splitHybrid(50.5, hibrido).stockQtyRetail!) === 0.5);

// Ajuste por diferença: grava-se o delta, nunca o absoluto.
const ajuste = clampStockDelta(120, 100 - 120);
ok('ajuste para 100 retira 20', ajuste.delta === -20 && ajuste.target === 100);
ok('ajuste para cima entra 30', clampStockDelta(100, 130 - 100).delta === 30);
ok('ajuste sem diferença não escreve', clampStockDelta(100, 100 - 100).delta === 0);

// Ninguém deve stock a negativo por engano.
const recusado = clampStockDelta(10, -20);
ok('retirar mais do que existe trava em zero', recusado.delta === 0 && recusado.clamped);
const corrigido = clampStockDelta(10, -20, true);
ok('correcção autorizada desce só até zero', corrigido.target === 0 && corrigido.delta === -10);

// Contagem física: faltas e sobras.
ok('contagem com falta', physicalDelta(120, 100) === -20);
ok('contagem com sobra', physicalDelta(100, 120) === 20);
ok('contagem igual não escreve', physicalDelta(100, 100) === 0);
ok('contagem negativa é recusada', physicalDelta(100, -1) === 0);
ok('contagem com pó de saco não inventa milésimos', physicalDelta(100, 100.0001) === 0);

// Valor do prejuízo.
ok('50 kg a 20 MT valem 1000 MT', stockLossValue(50, 20) === 1000);
ok('prejuízo arredonda a cêntimos', stockLossValue(3, 33.333) === 100);

// ------------------------------------------- correspondência de artigo (IA)
// ES-44: a IA devolve texto livre; adivinhar por pedaço de nome punha
// mercadoria no artigo errado. Só vale igualdade exacta de código ou nome.
const catalogo: any[] = [
  { id: 'a1', name: 'ADUBO NPK', code: '9610000000011' },
  { id: 'a2', name: 'ADUBO NPK 12-24-12', code: '9610000000028' },
  { id: 'a3', name: 'Semente de Milho', code: '9610000000035' },
  { id: 'a4', name: 'Semente de Milho', code: '9610000000042' }
];

ok('nome exacto encontra o artigo certo', matchProduct(catalogo, 'ADUBO NPK').product?.id === 'a1');
ok('nome maior não é confundido com o curto', matchProduct(catalogo, 'ADUBO NPK 12-24-12').product?.id === 'a2');
ok('pedaço de nome não encontra nada', matchProduct(catalogo, 'ADUBO').status === 'none');
ok('código exacto encontra', matchProduct(catalogo, '9610000000028').product?.id === 'a2');
ok('código parcial não encontra', matchProduct(catalogo, '961000').status === 'none');
ok('maiúsculas e acentos não contam', matchProduct(catalogo, '  semente de milho ').status === 'ambiguous');
ok('nome repetido é ambíguo, não chute', matchProduct(catalogo, 'Semente de Milho').matches.length === 2);
ok('texto vazio não corresponde', matchProduct(catalogo, '   ').status === 'none');
ok('normalização tira acentos', normalizeTerm('  Adúbo   NPK ') === 'adubo npk');
ok('catálogo vazio não rebenta', matchProduct([], 'ADUBO NPK').status === 'none');

// ------------------------------------------------ perdas anuladas (ES-42)
const perda = (over: any = {}) => ({ id: 'l1', productId: 'p1', productName: 'Milho', quantity: 10, unit: 'kg', date: '2026-11-01', reason: 'Outro', justification: '', costValue: 500, ...over });
ok('perda normal conta', isCountedLoss(perda()));
ok('perda anulada não conta', !isCountedLoss(perda({ annulled: true })));
ok('lista vazia não rebenta', countedLosses(undefined as any).length === 0);
ok('total ignora anuladas', totalLossValue([perda(), perda({ id: 'l2', annulled: true })]) === 500);
ok('total com valor inválido não é NaN', totalLossValue([perda({ costValue: NaN })]) === 0);
ok('quantidade perdida somada por artigo', lossQuantityByProduct([perda(), perda({ id: 'l2', quantity: 5 }), perda({ id: 'l3', productId: 'p2', quantity: 3 })])['p1'] === 15);
ok('anulada não soma quantidade', lossQuantityByProduct([perda({ annulled: true })])['p1'] === undefined);

// ------------------------------------------------- categorias (ES-51)
ok('chave ignora maiúsculas, espaços e acentos', categoryKey('  Adúbos  ' ) === 'adubos');
ok('mesma categoria aparece uma vez', collectCategories([
  { category: 'Adubos' }, { category: 'adubos ' }, { category: 'ADUBOS' }
]).length === 1);
ok('rótulo mais usado ganha', collectCategories([
  { category: 'Adubos' }, { category: 'adubos ' }, { category: 'adubos' }
])[0] === 'adubos');
ok('empate fica com o que tem maiúscula', collectCategories([
  { category: 'adubos' }, { category: 'Adubos' }
])[0] === 'Adubos');
ok('categorias base sem artigos aparecem', collectCategories([], ['Sementes'])[0] === 'Sementes');
ok('categoria vazia é ignorada', collectCategories([{ category: '  ' }, { category: '' }]).length === 0);
ok('escrita livre reaproveita a existente', canonicalCategory(' adubos', ['Adubos', 'Sementes']) === 'Adubos');
ok('categoria nova mantém-se', canonicalCategory(' Irrigação ', ['Adubos']) === 'Irrigação');

console.log(`\n--- RESULTADO: ${passou} testes passaram, ${falhou} falharam ---`);
if (falhou > 0) process.exit(1);
