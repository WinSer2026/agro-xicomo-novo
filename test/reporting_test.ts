/**
 * Testes dos totais de relatório.
 *
 * O que se está a proteger: uma factura cancelada não pode inflacionar a
 * faturação, o lucro nem a contagem de transações do documento oficial. Mas o
 * valor cancelado tem de continuar visível, numa linha própria que não soma.
 */
import { splitSalesForReport } from '../src/utils/reporting';
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

console.log(`\n--- RESULTADO: ${passou} testes passaram, ${falhou} falharam ---`);
if (falhou > 0) process.exit(1);
