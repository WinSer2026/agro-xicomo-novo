/**
 * Testes das regras de fecho de venda (D2, D1, NEG-02).
 *
 * O que se está a proteger:
 *  - uma factura A4 paga a dinheiro tem de ficar PAGA e emitir recibo (era o
 *    erro oposto: ficava "Pendente" só por causa do papel escolhido);
 *  - uma venda não pode ficar "Paga" sem estar coberta pelo pagamento;
 *  - o IVA não se soma ao total — extrai-se de dentro dele.
 */
import { resolveSaleStatus, requiresReceipt, validatePayment, totalsMatch } from '../src/utils/checkoutRules';
import { getSaleTotals, extractIva, netOfIva } from '../src/utils/saleTotals';
import type { SaleItem } from '../src/types';

let passou = 0, falhou = 0;
function ok(nome: string, condicao: boolean) {
  if (condicao) passou++; else { falhou++; console.error('FALHOU: ' + nome); }
}

// ─── 1. Estado da venda depende do pagamento, não do papel (D2) ───────────
ok('A4 pago a dinheiro fica Paga',
  resolveSaleStatus({ documentType: 'FaturaDefinitiva', paymentMethod: 'Dinheiro' }) === 'Paga');
ok('A4 pago por M-Pesa fica Paga',
  resolveSaleStatus({ documentType: 'FaturaDefinitiva', paymentMethod: 'M-Pesa' }) === 'Paga');
ok('térmica paga fica Paga',
  resolveSaleStatus({ documentType: 'FaturaDefinitiva', paymentMethod: 'Dinheiro' }) === 'Paga');
ok('proforma fica Pendente',
  resolveSaleStatus({ documentType: 'FaturaProforma', paymentMethod: 'Dinheiro' }) === 'Pendente');
ok('crédito fica Crédito',
  resolveSaleStatus({ documentType: 'FaturaDefinitiva', paymentMethod: 'Crédito' }) === 'Crédito');
ok('emitir sem receber fica Pendente',
  resolveSaleStatus({ documentType: 'FaturaDefinitiva', paymentMethod: 'Dinheiro', emitWithoutReceipt: true }) === 'Pendente');

// ─── 2. Recibo ────────────────────────────────────────────────────────────
ok('venda paga emite recibo', requiresReceipt('Paga') === true);
ok('venda pendente não emite recibo', requiresReceipt('Pendente') === false);
ok('venda a crédito não emite recibo de pagamento', requiresReceipt('Crédito') === false);
ok('venda anulada não emite recibo', requiresReceipt('Cancelada') === false);

// ─── 3. Pagamento em dinheiro ─────────────────────────────────────────────
const troco = validatePayment({ paymentMethod: 'Dinheiro', total: 116, amountReceived: 200 });
ok('dinheiro suficiente passa', troco.ok === true);
ok('troco calculado', troco.change === 84);
ok('valor recebido guardado', troco.received === 200);

const falta = validatePayment({ paymentMethod: 'Dinheiro', total: 116, amountReceived: 100 });
ok('dinheiro insuficiente é recusado', falta.ok === false);
ok('mensagem diz quanto falta', (falta.message || '').includes('16.00'));

const semValor = validatePayment({ paymentMethod: 'Dinheiro', total: 116, amountReceived: '' });
ok('sem valor entregue não trava a venda antiga', semValor.ok === true);
ok('sem valor entregue não inventa troco', semValor.change === 0);

// ─── 4. Pagamento múltiplo ────────────────────────────────────────────────
const multiploOk = validatePayment({
  paymentMethod: 'Múltiplo', total: 1000,
  multiLines: [{ method: 'Dinheiro', amount: 600 }, { method: 'M-Pesa', amount: 400 }]
});
ok('múltiplo que cobre o total passa', multiploOk.ok === true);
ok('múltiplo exacto não dá troco', multiploOk.change === 0);

const multiploFalta = validatePayment({
  paymentMethod: 'Múltiplo', total: 1000,
  multiLines: [{ method: 'Dinheiro', amount: 600 }, { method: 'M-Pesa', amount: 300 }]
});
ok('múltiplo a menos é recusado', multiploFalta.ok === false);
ok('mensagem do múltiplo diz o que falta', (multiploFalta.message || '').includes('100.00'));

const multiploVazio = validatePayment({ paymentMethod: 'Múltiplo', total: 1000, multiLines: [] });
ok('múltiplo sem linhas é recusado', multiploVazio.ok === false);

const multiploTroco = validatePayment({
  paymentMethod: 'Múltiplo', total: 1000,
  multiLines: [{ method: 'Dinheiro', amount: 1100 }]
});
ok('múltiplo acima do total devolve troco', multiploTroco.ok === true && multiploTroco.change === 100);

// ─── 5. Outros métodos ────────────────────────────────────────────────────
const mpesa = validatePayment({ paymentMethod: 'M-Pesa', total: 500 });
ok('M-Pesa não tem troco', mpesa.ok === true && mpesa.change === 0);
ok('M-Pesa regista o total recebido', mpesa.received === 500);

// ─── 6. Totais ────────────────────────────────────────────────────────────
ok('total bate com subtotal − desconto', totalsMatch({ subtotal: 400, discount: 50, total: 350 }));
ok('total errado é detectado', !totalsMatch({ subtotal: 400, discount: 50, total: 406 }));

// ─── 7. D1: IVA incluído no preço ─────────────────────────────────────────
const item: SaleItem = { productId: 'p1', name: 'Adubo', quantity: 1, unit: 'Kg', unitPrice: 116, totalPrice: 116 } as SaleItem;
const totais = getSaleTotals([item], 0, true);
ok('D1: total não cresce ao discriminar IVA', totais.total === 116);
ok('D1: IVA de 116 MT é 16 MT', Math.abs(totais.ivaAmount - 16) < 0.01);
ok('D1: base é 100 MT', Math.abs(totais.netTotal - 100) < 0.01);
ok('D1: base + IVA = total', Math.abs((totais.ivaAmount + totais.netTotal) - totais.total) < 0.01);
ok('D1: sem IVA ligado, não há discriminação', getSaleTotals([item]).ivaAmount === 0);
ok('D1: sem IVA ligado, o total é o mesmo', getSaleTotals([item]).total === 116);

ok('extractIva de 116 = 16', Math.abs(extractIva(116) - 16) < 0.01);
ok('netOfIva de 116 = 100', Math.abs(netOfIva(116) - 100) < 0.01);
ok('extractIva de zero = zero', extractIva(0) === 0);
ok('extractIva nunca negativo', extractIva(-50) === 0);

console.log(`\n--- RESULTADO: ${passou} testes passaram, ${falhou} falharam ---`);
if (falhou > 0) process.exit(1);
