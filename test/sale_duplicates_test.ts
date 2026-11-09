/**
 * Testes da guarda de relançamento (V-C11).
 *
 * Cenário real: o corte de inventário anula as vendas do dia. O operador
 * relança-as no PDV. Se lançar duas vezes, o stock sai duas vezes.
 */
import { saleFingerprint, findDuplicateSale, describeDuplicateRisk } from '../src/utils/saleDuplicates';
import type { Sale } from '../src/types';

let passou = 0, falhou = 0;
function ok(nome: string, condicao: boolean) {
  if (condicao) passou++; else { falhou++; console.error('FALHOU: ' + nome); }
}

const item = (id: string, qty: number) => ({ productId: id, quantity: qty, sellingUnit: 'Retail' as const });

const original = {
  id: '1', invoiceNumber: 'FT-2026-0001', date: '2026-11-09T08:00:00.000Z', dateKey: '2026-11-09',
  customerName: 'Cliente Geral', total: 350, status: 'Cancelada', stockReturned: false,
  items: [{ productId: 'p1', quantity: 5, unitPrice: 70, totalPrice: 350, sellingUnit: 'Retail', unit: 'kg', name: 'Milho' }]
} as unknown as Sale;

const novoRelancamento = { customerName: 'Cliente Geral', total: 350, items: [item('p1', 5)] };

ok('assinatura é estável com a mesma ordem', saleFingerprint({ customerName: 'Cliente Geral', total: 350, items: [item('p1', 5)] }) === saleFingerprint(novoRelancamento));
ok('assinatura ignora maiúsculas no cliente', saleFingerprint({ customerName: 'ANA', total: 10, items: [] }) === saleFingerprint({ customerName: 'ana', total: 10, items: [] }));
ok('assinatura distingue totais', saleFingerprint({ customerName: 'x', total: 10, items: [] }) !== saleFingerprint({ customerName: 'x', total: 10.01, items: [] }));
ok('assinatura distingue quantidades', saleFingerprint({ customerName: 'x', total: 10, items: [item('p1', 1)] }) !== saleFingerprint({ customerName: 'x', total: 10, items: [item('p1', 2)] }));
ok('assinatura ignora ordem das linhas', saleFingerprint({ customerName: 'x', total: 10, items: [item('a', 1), item('b', 2)] }) === saleFingerprint({ customerName: 'x', total: 10, items: [item('b', 2), item('a', 1)] }));

const check1 = findDuplicateSale([original], novoRelancamento, '2026-11-09');
ok('detecta a venda anulada gémea', Boolean(check1.cancelledTwin));
ok('primeiro relançamento não tem duplicado válido', !check1.duplicate);

const relancada = { ...original, id: '2', invoiceNumber: 'FT-2026-0002', status: 'Paga', stockReturned: undefined } as unknown as Sale;
const check2 = findDuplicateSale([original, relancada], novoRelancamento, '2026-11-09');
ok('segundo relançamento é detetado como duplicado', Boolean(check2.duplicate));
ok('duplicado aponta para a venda válida', check2.duplicate?.invoiceNumber === 'FT-2026-0002');

const outroDia = { ...relancada, dateKey: '2026-11-08', date: '2026-11-08T08:00:00.000Z' } as unknown as Sale;
ok('venda de outro dia não conta', !findDuplicateSale([outroDia], novoRelancamento, '2026-11-09').duplicate);

const valorDiferente = { customerName: 'Cliente Geral', total: 351, items: [item('p1', 5)] };
ok('total diferente não é duplicado', !findDuplicateSale([relancada], valorDiferente, '2026-11-09').duplicate);

const proforma = { ...relancada, id: '3', documentType: 'FaturaProforma', status: 'Proforma' } as unknown as Sale;
ok('proforma não conta como venda duplicada', !findDuplicateSale([proforma], novoRelancamento, '2026-11-09').duplicate);

ok('lista vazia não rebenta', Object.keys(findDuplicateSale([], novoRelancamento, '2026-11-09')).length === 0);
ok('nulo não rebenta', Object.keys(findDuplicateSale(null, novoRelancamento, '2026-11-09')).length === 0);

const texto = describeDuplicateRisk(check2);
ok('texto nomeia a factura duplicada', texto.includes('FT-2026-0002'));
ok('texto avisa do relançamento', texto.toLowerCase().includes('relançar'));

console.log(`\n--- RESULTADO: ${passou} testes passaram, ${falhou} falharam ---`);
if (falhou > 0) process.exit(1);
