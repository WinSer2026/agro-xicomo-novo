import type { SaleItem } from '../types';

export type ItemDiscountType = NonNullable<SaleItem['discountType']>;

const roundMT = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Maximum value allowed in the discount input for a given line and mode. */
export function getMaxItemDiscountValue(item: SaleItem, type: ItemDiscountType): number {
  const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
  const quantity = Math.max(0, Number(item.quantity) || 0);
  if (type === 'percent_unit' || type === 'percent_total') return 100;
  return type === 'per_unit' ? unitPrice : roundMT(unitPrice * quantity);
}

export function clampItemDiscountValue(item: SaleItem, type: ItemDiscountType, value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(0, value), getMaxItemDiscountValue(item, type)) : 0;
}

/** Applied discount in MT, bounded by the line's gross value (including legacy carts). */
export function getItemDiscount(item: SaleItem): number {
  const gross = Math.max(0, Number(item.unitPrice) * Number(item.quantity));
  if (!Number.isFinite(gross) || gross === 0) return 0;
  const value = Math.max(0, Number(item.discountValue) || 0);
  if (!Number.isFinite(value)) return 0;

  let discount: number;
  switch (item.discountType) {
    case 'per_unit':
      discount = value * item.quantity;
      break;
    case 'percent_unit':
      discount = (item.unitPrice * value / 100) * item.quantity;
      break;
    case 'percent_total':
      discount = gross * value / 100;
      break;
    default:
      discount = value; // line_total, also the default in the normal PDV
  }
  return roundMT(Math.min(gross, discount));
}

/** Taxa de IVA em vigor (Moçambique, 16%). */
export const IVA_RATE = 0.16;

/**
 * IVA contido num valor com IVA incluído.
 *
 * O preço de revenda JÁ INCLUI o IVA (decisão D1 do dono). Por isso o IVA não
 * se soma ao total: extrai-se de dentro dele.
 *
 *   116 MT -> IVA = 116 − 116/1,16 = 16 MT ; base = 100 MT ; total = 116 MT
 *
 * A fórmula antiga (`total * 0,16`) devolvia 18,56 MT em 116 — errado, porque
 * tratava o total como se fosse base. E a anterior a essa somava o IVA por cima,
 * cobrando ao cliente 16% a mais.
 */
export function extractIva(valueWithIva: number): number {
  const valor = Math.max(0, Number(valueWithIva) || 0);
  return roundMT(valor - valor / (1 + IVA_RATE));
}

/** Base tributável (valor sem IVA) de um valor com IVA incluído. */
export function netOfIva(valueWithIva: number): number {
  const valor = Math.max(0, Number(valueWithIva) || 0);
  return roundMT(valor - extractIva(valor));
}

/**
 * Totais partilhados pelo PDV normal e pela venda retroactiva.
 *
 *  - subtotal: soma dos preços de tabela × quantidade (com IVA incluído);
 *  - discount: descontos de linha + desconto global;
 *  - total: subtotal − discount (o cliente paga exactamente isto);
 *  - ivaAmount: parte do total que é IVA (não se soma);
 *  - netTotal: parte do total que é base tributável.
 *
 * O botão "IVA" não altera o total: muda apenas a discriminação no documento.
 */
export function getSaleTotals(items: SaleItem[], extraDiscount = 0, includeIva = false) {
  const subtotal = roundMT(items.reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0), 0));
  const itemDiscounts = roundMT(items.reduce((sum, item) => sum + getItemDiscount(item), 0));
  const safeExtraDiscount = Number.isFinite(extraDiscount) ? Math.max(0, extraDiscount) : 0;
  const discount = roundMT(Math.min(subtotal, itemDiscounts + safeExtraDiscount));
  const total = roundMT(Math.max(0, subtotal - discount));
  const ivaAmount = includeIva ? extractIva(total) : 0;
  const netTotal = roundMT(total - ivaAmount);
  return { subtotal, discount, total, ivaAmount, netTotal };
}
