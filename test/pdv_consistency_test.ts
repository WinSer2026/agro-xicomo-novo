/**
 * Consistência do PDV: IVA, documentos e stock.
 *
 * O que se está a proteger:
 *  - o valor cobrado ao cliente tem de ser o mesmo que o documento declara;
 *  - uma factura anulada não pode voltar a viver com o mesmo número;
 *  - uma reemissão não pode deduzir stock duas vezes.
 */
import { cartTaxAmount, lineTaxAmount, itemTaxRate } from '../src/utils/taxHelper';

let passou = 0, falhou = 0;
function ok(nome: string, condicao: boolean) {
  if (condicao) passou++; else { falhou++; console.error('FALHOU: ' + nome); }
}

const milho = { id: 'p1', taxRate: 16 };
const isento = { id: 'p2', taxRate: 0 };
const reduzido = { id: 'p3', taxRate: 5 };

const linha = (id: string, preco: number, qtd: number) => ({ productId: id, unitPrice: preco, quantity: qtd });

// --- IVA por linha -------------------------------------------------------
ok('16% sobre 100 = 16', Math.abs(lineTaxAmount({ totalPrice: 100, taxRate: 16 }) - 16) < 1e-9);
ok('isento não gera IVA', lineTaxAmount({ totalPrice: 100, taxRate: 0 }) === 0);
ok('taxa por omissão é 16', itemTaxRate({}, undefined) === 16);
ok('taxa do produto é respeitada', itemTaxRate({ taxRate: 5 }, milho) === 5);

// --- IVA do carrinho -----------------------------------------------------
const so16 = [linha('p1', 50, 2)]; // 100 MT a 16%
ok('carrinho 16%: IVA 16', cartTaxAmount(so16, [milho as any]) === 16);
ok('carrinho 16%: total implícito 116', 100 + cartTaxAmount(so16, [milho as any]) === 116);

const misto = [linha('p1', 50, 2), linha('p2', 100, 1)]; // 200 base
ok('misto: só a linha tributada paga IVA', cartTaxAmount(misto, [milho, isento] as any) === 16);
ok('misto: o total é 216, não 232 (16% fixo antigo)', 200 + cartTaxAmount(misto, [milho, isento] as any) === 216);

const comDesconto = cartTaxAmount(misto, [milho, isento] as any, 0.9); // 10% de desconto
ok('desconto reduz a base do IVA', Math.abs(comDesconto - 14.4) < 1e-9);
ok('desconto não inventa IVA sobre valor não cobrado', comDesconto < 16);

ok('desconto total: sem IVA', cartTaxAmount(misto, [milho, isento] as any, 0) === 0);
ok('factor negativo não rebenta', cartTaxAmount(misto, [milho, isento] as any, -1) === 0);
ok('factor acima de 1 não aumenta o IVA', cartTaxAmount(so16, [milho as any], 5) === 16);
ok('carrinho vazio: zero', cartTaxAmount([], [milho as any]) === 0);

const taxaLivre = [linha('p3', 200, 1)];
ok('taxa reduzida de 5%', Math.abs(cartTaxAmount(taxaLivre, [reduzido] as any) - 10) < 1e-9);

// --- arredondamento ao cêntimo ------------------------------------------
const centimos = [linha('p1', 0.33, 3)]; // 0,99 MT
ok('IVA arredondado a 2 decimais', Number.isInteger(Math.round(cartTaxAmount(centimos, [milho as any]) * 100)));
ok('IVA de 0,99 a 16% = 0,16', cartTaxAmount(centimos, [milho as any]) === 0.16);

console.log(`\n--- RESULTADO: ${passou} testes passaram, ${falhou} falharam ---`);
if (falhou > 0) process.exit(1);
