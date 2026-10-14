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

/** Shared checkout totals for the regular and retroactive sale flows. */
export function getSaleTotals(items: SaleItem[], extraDiscount = 0, includeIva = false) {
  const subtotal = roundMT(items.reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0), 0));
  const itemDiscounts = roundMT(items.reduce((sum, item) => sum + getItemDiscount(item), 0));
  const safeExtraDiscount = Number.isFinite(extraDiscount) ? Math.max(0, extraDiscount) : 0;
  const discount = roundMT(Math.min(subtotal, itemDiscounts + safeExtraDiscount));
  const base = roundMT(Math.max(0, subtotal - discount));
  const ivaAmount = includeIva ? roundMT(base * 0.16) : 0;
  return { subtotal, discount, ivaAmount, total: roundMT(base + ivaAmount) };
}
