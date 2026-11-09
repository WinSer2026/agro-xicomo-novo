/**
 * Testes dos totais de relatório.
 *
 * O que se está a proteger: uma factura cancelada não pode inflacionar a
 * faturação, o lucro nem a contagem de transações do documento oficial. Mas o
 * valor cancelado tem de continuar visível, numa linha própria que não soma.
 */
import {
  splitSalesForReport,
  periodDayRange,
  saleMovedStock,
  stockBeforePeriod,
  formatMT,
  buildProductPerformance
} from '../src/utils/reporting';
import type { Sale } from '../src/types';

let passou = 0, falhou = 0;
function ok(nome: string, condicao: boolean) {
  if (condicao) passou++; else { falhou++; console.error('FALHOU: ' + nome); }
}

const s = (id: string, total: number, status: string, extra: Partial<Sale> = {}) =>
  ({ id, invoiceNumber: `FT-${id}`, total, status, date: '2026-11-09T08:00:00.000Z', items: [], ...extra } as unknown as Sale);

const vendas: Sale[] = [
  s('1', 1000, 'Paga'),
  s('2', 500, 'Pendente'),
  s('3', 700, 'Cancelada'),
  s('4', 300, 'canceled'),                                   // legado
  s('5', 400, 'Proforma', { documentType: 'FaturaProforma' }),
  s('6', 250, 'Emitida', { documentType: 'Cotacao' })
];

const split = splitSalesForReport(vendas);
ok('só válidas somam', split.totals.valid === 1500);
ok('válidas são Paga + Pendente', split.valid.length === 2);
ok('canceladas somadas à parte', split.totals.cancelled === 1000);
ok('estado legado conta como cancelada', split.cancelled.length === 2);
ok('proformas somadas em separado', split.totals.proforma === 650);
ok('proformas são proforma + cotação', split.proforma.length === 2);
ok('contagens coerentes', split.totals.validCount === 2 && split.totals.cancelledCount === 2 && split.totals.proformaCount === 2);
ok('nada cancelado entra no total válido', split.totals.valid === 1000 + 500);
ok('não há perda de linhas', split.valid.length + split.cancelled.length + split.proforma.length === vendas.length);

const vazio = splitSalesForReport([]);
ok('lista vazia devolve zeros', vazio.totals.valid === 0 && vazio.totals.cancelledCount === 0);
const nulo = splitSalesForReport(null);
ok('nulo não rebenta', nulo.valid.length === 0);

const soCanceladas = splitSalesForReport([s('9', 800, 'Cancelada')]);
ok('relatório só com canceladas tem faturação zero', soCanceladas.totals.valid === 0);
ok('...mas declara o valor cancelado', soCanceladas.totals.cancelled === 800);


/* ---------------- limites de período ---------------- */

const hoje = '2026-11-09T10:00:00.000Z';
ok('Diário = hoje e só hoje', (() => { const r = periodDayRange('Diário', hoje); return r.startDay === '2026-11-09' && r.endDay === '2026-11-09'; })());
ok('Semanal = 7 dias com hoje', (() => { const r = periodDayRange('Semanal', hoje); return r.startDay === '2026-11-03' && r.endDay === '2026-11-09'; })());
ok('Mensal = 30 dias', (() => { const r = periodDayRange('Mensal', hoje); return r.startDay === '2026-10-11'; })());
ok('Anual = 365 dias', (() => { const r = periodDayRange('Anual', hoje); return r.startDay === '2025-11-10'; })());
const madrugada = periodDayRange('Diário', '2026-11-09T23:30:00.000Z');
ok('dia de Maputo, não UTC', madrugada.startDay === '2026-11-10' && madrugada.endDay === '2026-11-10');

/* ---------------- stock movimentado ---------------- */

const anuladaComEstorno = s('10', 100, 'Cancelada', { stockReturned: true } as any);
const anuladaSemEstorno = s('11', 100, 'Cancelada', { stockReturned: false } as any);
const anuladaAntiga = s('12', 100, 'Cancelada');
ok('anulada com estorno não movimenta stock', saleMovedStock(anuladaComEstorno) === false);
ok('anulada sem estorno (corte) movimentou', saleMovedStock(anuladaSemEstorno) === true);
ok('anulada antiga assume estorno', saleMovedStock(anuladaAntiga) === false);
ok('venda válida movimenta', saleMovedStock(s('13', 100, 'Paga')) === true);
ok('proforma não movimenta', saleMovedStock(s('14', 100, 'Proforma', { documentType: 'FaturaProforma' })) === false);

const antes = stockBeforePeriod(370, [s('20', 100, 'Paga'), s('21', 100, 'Cancelada', { stockReturned: false } as any), anuladaComEstorno], (venda) => (venda.id === '20' ? 50 : venda.id === '21' ? 30 : 20));
ok('stock anterior conta válidas e anuladas sem estorno', antes.value === 450);
ok('cálculo completo', antes.complete === true);
const semProduto = stockBeforePeriod(10, [s('22', 100, 'Paga')], () => null);
ok('produto inexistente marca indeterminado', semProduto.complete === false && semProduto.value === 10);

/* ---------------- formatação de dinheiro ---------------- */

ok('dinheiro com centavos', formatMT(1234.5) === '1 234,50 MT');
ok('zero com centavos', formatMT(0) === '0,00 MT');
ok('negativo com sinal', formatMT(-89.9).startsWith('-'));
ok('NaN não rebenta', formatMT(NaN) === '0,00 MT');

/* ---------------- desempenho por produto ---------------- */

const produto = { id: 'p1', name: 'Milho', category: 'Cereais', stockQty: 370, buyingPrice: 10, sellingPrice: 20, baseUnit: 'kg' } as any;
const vendaKg = { id: 's1', status: 'Paga', total: 200, items: [{ productId: 'p1', quantity: 10, unitPrice: 20, sellingUnit: 'Base' }] } as unknown as Sale;
const perf = buildProductPerformance([produto], [vendaKg], {
  qtyOf: (_s, item) => Number(item.quantity),
  lineTotal: (_s, item) => Number(item.unitPrice) * Number(item.quantity),
  lineCost: (_s, item, p) => Number(p.buyingPrice) * Number(item.quantity)
});
ok('vendido em unidade base', perf[0].soldQty === 10);
ok('faturado é o preço da venda', perf[0].invoiced === 200);
ok('custo usa preço de compra', perf[0].cost === 100);
ok('lucro = faturado − custo', perf[0].profit === 100);
ok('stock anterior reconstruído', perf[0].stockBefore === 380);

console.log(`\n--- RESULTADO: ${passou} testes passaram, ${falhou} falharam ---`);
if (falhou > 0) process.exit(1);
