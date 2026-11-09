/**
 * TESTES DO CORTE DE INVENTÁRIO
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * Reproduz o caso real: contagem física tirada de manhã (T0), vendas durante o dia,
 * contagem lançada no sistema à noite (T1). Valida que as duas vias de correcção
 * (anular + relançar  /  descontar vendas) chegam exactamente ao mesmo stock final.
 *
 * Execução:  npx tsx test/inventory_cutoff_test.ts
 */

import {
  analyzeSalesStockImpact,
  annotateCancelledSale,
  applyCutoffToPhysicalCount,
  buildReentryRows,
  buildStockSnapshots,
  CUTOFF_NOTE_TAG,
  indexMovements,
  isStockImpactingSale,
  projectStock,
  selectSalesAfter,
  selectSalesForCutoff,
  toDayKey
} from '../src/utils/inventoryCutoff';
import { Product, Sale } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, description: string) {
  if (condition) {
    console.log(`[PASS] ${description}`);
    passed++;
  } else {
    console.error(`[FAIL] ${description}`);
    failed++;
  }
}

/* ------------------------------------------------------------------ */
/* Dados de cenário                                                     */
/* ------------------------------------------------------------------ */

const DIA = '2026-10-01';

/** Produto híbrido: comprado/vendido em sacos de 50 kg e também vendido a quilo. */
const milho: Product = {
  id: 'p-milho',
  code: 'SEM001',
  name: 'Milho Branco',
  category: 'Sementes',
  stockQty: 500,        // saldo que ficou no sistema após lançar a contagem (10 sacos)
  stockQtyBulk: 8,
  stockQtyRetail: 100,
  buyingPrice: 40,      // custo por kg (derivado)
  buyingPriceBulk: 2000,
  sellingPrice: 60,
  sellingPriceBulk: 2800,
  baseUnit: 'Kg',
  parentUnit: 'Sacos',
  conversionRate: 50
};

/** Produto simples (sem conversão). */
const enxada: Product = {
  id: 'p-enxada',
  code: 'FER011',
  name: 'Enxada Reforçada',
  category: 'Ferramentas e Ferragens',
  stockQty: 20,
  buyingPrice: 350,
  sellingPrice: 500,
  baseUnit: 'Unidades'
};

/** Serviço: nunca movimenta stock. */
const servico: Product = {
  id: 'p-servico',
  code: 'SRV001',
  name: 'Serviço de Pulverização',
  category: 'Serviços',
  stockQty: 0,
  buyingPrice: 0,
  sellingPrice: 1500,
  baseUnit: 'Unidades',
  isService: true
};

const produtos = [milho, enxada, servico];

function venda(overrides: Partial<Sale> & { id: string }): Sale {
  return {
    invoiceNumber: `FAC-2026-${overrides.id}`,
    date: `${DIA}T10:00:00.000Z`,
    customerName: 'Consumidor Final',
    items: [],
    subtotal: 0,
    discount: 0,
    total: 0,
    paymentMethod: 'Dinheiro',
    status: 'Paga',
    operatorId: 'op-1',
    operatorName: 'Caixa 1',
    synced: true,
    ...overrides
  } as Sale;
}

// Vendas ocorridas DEPOIS da contagem (08:00) e ANTES do lançamento (18:00)
const venda1 = venda({
  id: '0001',
  date: `${DIA}T09:30:00.000Z`,
  total: 5600,
  items: [
    { productId: 'p-milho', name: 'Milho Branco', quantity: 2, unit: 'Sacos', unitPrice: 2800, totalPrice: 5600, sellingUnit: 'Bulk' }
  ]
});

const venda2 = venda({
  id: '0002',
  date: `${DIA}T14:15:00.000Z`,
  total: 2300,
  items: [
    { productId: 'p-milho', name: 'Milho Branco', quantity: 30, unit: 'Kg', unitPrice: 60, totalPrice: 1800, sellingUnit: 'Retail' },
    { productId: 'p-enxada', name: 'Enxada Reforçada', quantity: 1, unit: 'Unidades', unitPrice: 500, totalPrice: 500 }
  ]
});

const vendaServico = venda({
  id: '0003',
  date: `${DIA}T15:00:00.000Z`,
  total: 1500,
  items: [
    { productId: 'p-servico', name: 'Serviço de Pulverização', quantity: 1, unit: 'Unidades', unitPrice: 1500, totalPrice: 1500, isService: true }
  ]
});

const vendaAnulada = venda({ id: '0004', date: `${DIA}T16:00:00.000Z`, total: 900, status: 'Cancelada' });
const proforma = venda({ id: '0005', date: `${DIA}T16:30:00.000Z`, total: 700, documentType: 'FaturaProforma' });
const vendaOutroDia = venda({ id: '0006', date: '2026-10-02T09:00:00.000Z', total: 1200 });
const vendaAntesDaContagem = venda({ id: '0007', date: `${DIA}T05:30:00.000Z`, total: 400 });

const todasVendas = [venda1, venda2, vendaServico, vendaAnulada, proforma, vendaOutroDia, vendaAntesDaContagem];

/* Fuso horário: 23:30 UTC já é o dia seguinte em Maputo (UTC+2). */
assert(
  toDayKey(`${DIA}T23:30:00.000Z`) !== DIA,
  'Uma venda às 23:30 UTC pertence ao dia seguinte em Maputo'
);
assert(
  toDayKey(`${DIA}T21:00:00.000Z`) === DIA,
  'Uma venda às 21:00 UTC continua no mesmo dia em Maputo'
);

/* ------------------------------------------------------------------ */
/* Suite 1 — Selecção de documentos                                     */
/* ------------------------------------------------------------------ */
console.log('\n--- Suite 1: Selecção de vendas do corte ---');

assert(toDayKey(`${DIA}T09:30:00.000Z`) === DIA, 'toDayKey extrai o dia de uma data ISO completa');
assert(toDayKey(DIA) === DIA, 'toDayKey aceita datas simples YYYY-MM-DD');
assert(toDayKey('') === '' && toDayKey(null) === '', 'toDayKey tolera valores vazios');

assert(isStockImpactingSale(venda1), 'Factura definitiva activa movimenta stock');
assert(!isStockImpactingSale(vendaAnulada), 'Documento já anulado não movimenta stock');
assert(!isStockImpactingSale(proforma), 'Proforma não movimenta stock');

const doDia = selectSalesForCutoff(todasVendas, { day: DIA });
assert(doDia.length === 4, `Dia ${DIA} devolve 4 documentos válidos (obtido: ${doDia.length})`);
assert(!doDia.some(s => s.status === 'Cancelada'), 'Documentos anulados ficam de fora da selecção');
assert(!doDia.some(s => s.documentType === 'FaturaProforma'), 'Proformas ficam de fora da selecção');
assert(!doDia.some(s => toDayKey(s.date) !== DIA), 'Vendas de outros dias ficam de fora');

const janela = selectSalesForCutoff(todasVendas, { day: DIA, fromTime: '08:00' });
assert(
  janela.length === 3 && !janela.some(s => s.id === '0007'),
  'Janela horária exclui a venda anterior à hora da contagem'
);

// Nota: o corte NÃO se limita ao dia — tudo o que foi vendido depois do momento da
// contagem conta, mesmo que já seja do dia seguinte (contagem lançada com dias de atraso).
const posContagem = selectSalesAfter(todasVendas, `${DIA}T08:00:00.000Z`);
assert(
  posContagem.length === 4,
  `selectSalesAfter devolve as 4 vendas válidas pós-contagem, incluindo as do dia seguinte (obtido: ${posContagem.length})`
);
assert(posContagem[0].id === '0001', 'selectSalesAfter devolve ordenado por hora');
assert(!posContagem.some(s => s.id === '0007'), 'Venda anterior à contagem não entra no corte');
assert(
  !posContagem.some(s => s.status === 'Cancelada' || s.documentType === 'FaturaProforma'),
  'Anuladas e proformas continuam fora do corte'
);

/* ------------------------------------------------------------------ */
/* Suite 2 — Agregação do impacto em stock                              */
/* ------------------------------------------------------------------ */
console.log('\n--- Suite 2: Impacto em stock (produtos híbridos) ---');

const impacto = analyzeSalesStockImpact(posContagem, produtos);
const movMilho = impacto.movements.find(m => m.productId === 'p-milho')!;
const movEnxada = impacto.movements.find(m => m.productId === 'p-enxada')!;

assert(impacto.movements.length === 2, 'Serviços não entram no impacto de stock');
assert(movMilho.soldBulk === 2, 'Sacos vendidos agregados correctamente (2 sacos)');
assert(movMilho.soldRetail === 30, 'Quilos vendidos a retalho agregados correctamente (30 kg)');
assert(movMilho.soldBase === 130, '2 sacos × 50 kg + 30 kg = 130 kg em unidade base');
assert(movMilho.salesCount === 2, 'Contagem de documentos por artigo está correcta');
assert(movEnxada.soldBase === 1 && !movEnxada.hasConversion, 'Produto simples agrega em unidade base');

// Custo: 2 sacos × 2000 + 30 kg × 40 = 5200 ; enxada 1 × 350
assert(Math.abs(movMilho.costValue - 5200) < 0.01, `Custo do milho movimentado = 5 200 MT (obtido: ${movMilho.costValue})`);
assert(Math.abs(impacto.totals.costValue - 5550) < 0.01, 'Custo total movimentado = 5 550 MT');

const impactoSemCatalogo = analyzeSalesStockImpact(posContagem, [enxada]);
assert(
  impactoSemCatalogo.unmatched.length === 2,
  `Linhas de artigos fora do catálogo são reportadas em "unmatched" (obtido: ${impactoSemCatalogo.unmatched.length})`
);
assert(
  !impactoSemCatalogo.unmatched.some(u => u.productId === 'p-servico'),
  'Serviços nunca são reportados como artigo em falta no catálogo'
);

/* ------------------------------------------------------------------ */
/* Suite 3 — Projecção de saldos                                        */
/* ------------------------------------------------------------------ */
console.log('\n--- Suite 3: Projecção de saldos ---');

const descontado = projectStock(movMilho, 'deduct');
assert(descontado.stockQty === 370, '500 kg − 130 kg vendidos = 370 kg');
assert(descontado.stockQtyBulk === 6, '8 sacos − 2 sacos = 6 sacos');
assert(descontado.stockQtyRetail === 70, '100 kg retalho − 30 kg = 70 kg');

const estornado = projectStock(movMilho, 'restore');
assert(estornado.stockQty === 630 && estornado.stockQtyBulk === 10, 'Estorno devolve as quantidades ao stock');

const snapshotsDeduct = buildStockSnapshots(impacto.movements, 'deduct');
assert(snapshotsDeduct.length === 2, 'Gera um saldo por artigo afectado');
assert(
  snapshotsDeduct.every(s => s.stockQty >= 0),
  'Saldos nunca ficam negativos'
);

const movNegativo = { ...movMilho, currentStockQty: 10, currentStockBulk: 0, currentStockRetail: 0 };
assert(projectStock(movNegativo, 'deduct').stockQty === 0, 'Saldo é travado em zero (nunca negativo)');

/* ------------------------------------------------------------------ */
/* Suite 4 — Contagem lançada com atraso                                */
/* ------------------------------------------------------------------ */
console.log('\n--- Suite 4: Contagem física lançada com atraso ---');

const indice = indexMovements(impacto.movements);
const contado = 500; // contagem tirada às 08:00 (10 sacos)
assert(applyCutoffToPhysicalCount(contado, indice['p-milho']) === 370, 'Contagem 500 kg − 130 kg vendidos = 370 kg reais');
assert(applyCutoffToPhysicalCount(contado, undefined) === 500, 'Sem movimentos a contagem é usada tal como está');
assert(applyCutoffToPhysicalCount(50, indice['p-milho']) === 0, 'Contagem inferior às saídas trava em zero');

/* ------------------------------------------------------------------ */
/* Suite 5 — Equivalência das duas vias de correcção                    */
/* ------------------------------------------------------------------ */
console.log('\n--- Suite 5: Anular+relançar  ≡  descontar vendas ---');

// Via A: anular as vendas SEM estorno e relançá-las a seguir.
const stockDepoisDeAnularSemEstorno = milho.stockQty; // nada muda
const stockDepoisDeRelancar = stockDepoisDeAnularSemEstorno - movMilho.soldBase;

// Via B: manter as vendas e descontar directamente.
const stockViaDesconto = buildStockSnapshots([movMilho], 'deduct')[0].stockQty;

assert(stockDepoisDeAnularSemEstorno === 500, 'Anulação sem estorno não mexe no stock');
assert(stockDepoisDeRelancar === 370, 'Relançamento das vendas desconta a partir do inventário contado');
assert(stockDepoisDeRelancar === stockViaDesconto, 'As duas vias chegam exactamente ao mesmo saldo final (370 kg)');

// Erro clássico que a ferramenta evita: anular COM estorno inflaciona ainda mais o stock.
const stockComEstornoIndevido = buildStockSnapshots([movMilho], 'restore')[0].stockQty;
assert(stockComEstornoIndevido === 630, 'Anular com estorno indevido levaria o stock a 630 kg (260 kg a mais que o real)');

/* ------------------------------------------------------------------ */
/* Suite 6 — Rasto documental                                           */
/* ------------------------------------------------------------------ */
console.log('\n--- Suite 6: Rasto documental e mapa de relançamento ---');

const anulada = annotateCancelledSale(venda2, 'Corte de inventário', 'gestor');
assert(anulada.status === 'Cancelada', 'Venda fica marcada como Cancelada');
assert((anulada.notes || '').includes(CUTOFF_NOTE_TAG), 'Nota de auditoria é acrescentada ao documento');
assert((anulada.notes || '').includes('gestor'), 'Nota identifica quem autorizou');
assert(anulada.id === venda2.id && anulada.total === venda2.total, 'Documento preserva id e valores (não é apagado)');

const comNotaAnterior = annotateCancelledSale({ ...venda2, notes: 'Entrega ao domicílio' }, 'Corte', 'gestor');
assert((comNotaAnterior.notes || '').startsWith('Entrega ao domicílio'), 'Nota anterior é preservada');

const linhas = buildReentryRows([venda1, venda2]);
assert(linhas.length === 3, 'Mapa de relançamento tem uma linha por artigo vendido');
assert(linhas[0]['Nº Documento'] === venda1.invoiceNumber, 'Mapa identifica o documento original');
assert(linhas.some(l => l['Tipo Venda'] === 'Saco/Grosso') && linhas.some(l => l['Tipo Venda'] === 'Retalho'),
  'Mapa distingue venda em saco e venda a retalho');

/* ------------------------------------------------------------------ */
console.log(`\n--- RESULTADO: ${passed} testes passaram, ${failed} falharam ---`);
if (failed > 0) process.exit(1);
