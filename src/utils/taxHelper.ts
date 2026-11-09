import { Product, SaleItem } from '../types';

/**
 * Cálculo do IVA.
 *
 * A taxa estava fixa em 16% no PDV, o que impedia declarar produtos com taxa
 * diferente (ou isentos) — achado E-02. A taxa é agora por produto (`taxRate`),
 * com omissão de 16%, e fica registada na linha da venda para o histórico não
 * depender do catálogo actual.
 */
export const DEFAULT_TAX_RATE = 16;

export function normalizeTaxRate(rate?: number | null): number {
  if (rate === null || rate === undefined || Number.isNaN(Number(rate))) return DEFAULT_TAX_RATE;
  const value = Number(rate);
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export function itemTaxRate(item: Pick<SaleItem, 'taxRate'>, product?: Pick<Product, 'taxRate'> | null): number {
  if (item.taxRate !== undefined && item.taxRate !== null) return normalizeTaxRate(item.taxRate);
  return normalizeTaxRate(product?.taxRate);
}

/** IVA contido numa linha, já depois do desconto da linha. */
export function lineTaxAmount(item: Pick<SaleItem, 'totalPrice' | 'taxRate'>, product?: Pick<Product, 'taxRate'> | null): number {
  const rate = itemTaxRate(item, product);
  if (rate <= 0) return 0;
  const base = Number(item.totalPrice) || 0;
  return Math.round(base * (rate / 100) * 100) / 100;
}

export function sumTaxAmount(
  items: Array<Pick<SaleItem, 'totalPrice' | 'taxRate'>>,
  products: Product[] = []
): number {
  const total = items.reduce((acc, item) => {
    const produto = products.find(p => p.id === (item as SaleItem).productId);
    return acc + lineTaxAmount(item, produto);
  }, 0);
  return Math.round(total * 100) / 100;
}
