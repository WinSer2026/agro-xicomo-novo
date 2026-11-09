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

/**
 * IVA de um carrinho inteiro, linha a linha.
 *
 * `discountRatio` é o factor (0..1) que sobra depois de todos os descontos —
 * de linha e de documento. Reparte-se proporcionalmente: assim o IVA é cobrado
 * sobre o que o cliente realmente paga, e não sobre o preço de tabela.
 *
 * Existe para o PDV não voltar a ter duas contas diferentes: a que forma o
 * total e a que fica gravada na venda.
 */
export function cartTaxAmount(
  items: Array<{ productId?: string | number; unitPrice?: number; quantity?: number; taxRate?: number; totalPrice?: number }>,
  products: Array<Pick<Product, 'id' | 'taxRate'>> = [],
  discountRatio = 1
): number {
  const fator = Math.min(1, Math.max(0, Number.isFinite(discountRatio) ? discountRatio : 1));
  const total = (items || []).reduce((acc, item) => {
    if (!item) return acc;
    const produto = products.find(p => String(p.id) === String(item.productId));
    const bruto = Number(item.unitPrice) * Number(item.quantity);
    const base = Number.isFinite(bruto) && bruto !== 0 ? bruto : Number(item.totalPrice) || 0;
    return acc + lineTaxAmount({ totalPrice: base * fator, taxRate: item.taxRate }, produto);
  }, 0);
  return Math.round(total * 100) / 100;
}
