/**
 * Price & Cost Helper
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * Regras de negócio centrais:
 *  1. O preço de compra tem de ser SEMPRE inferior ao preço de venda (nunca igual).
 *  2. Existem produtos vendidos ao mesmo tempo em SACO (revenda / Bulk) e em QUILO (retalho):
 *     esses produtos foram comprados em sacos, logo NÃO têm preço de compra por quilo.
 *     O custo do quilo é sempre derivado: (preço de compra do saco ÷ fator de conversão).
 */

import { Product } from '../types';

export type SellingUnit = 'Bulk' | 'Retail';

/** Produto híbrido: vendido em unidade pai (Saco/Caixa) e em unidade base (Kg/Unidade). */
export function isHybridProduct(
  p?: { parentUnit?: string; conversionRate?: number } | null
): boolean {
  if (!p) return false;
  return Boolean(p.parentUnit && Number(p.conversionRate) > 1);
}

/**
 * Preço de compra (custo) por unidade de venda.
 * - Produto normal: buyingPrice.
 * - Produto híbrido: em Bulk devolve o custo do saco; em Retail devolve o custo
 *   derivado do quilo (custo do saco ÷ fator de conversão).
 */
export function getUnitCost(p?: Product | null, sellingUnit?: SellingUnit | string | null): number {
  if (!p) return 0;
  if (isHybridProduct(p)) {
    const rate = Number(p.conversionRate) || 1;
    const sackCost = p.buyingPriceBulk !== undefined && p.buyingPriceBulk !== null
      ? Number(p.buyingPriceBulk)
      : Number(p.buyingPrice) * rate;
    return sellingUnit === 'Bulk' ? sackCost : sackCost / rate;
  }
  return Number(p.buyingPrice) || 0;
}

/** Custo do saco (unidade pai) de um produto híbrido. */
export function getBulkCost(p?: Product | null): number {
  if (!p) return 0;
  if (!isHybridProduct(p)) return Number(p.buyingPrice) || 0;
  const rate = Number(p.conversionRate) || 1;
  return p.buyingPriceBulk !== undefined && p.buyingPriceBulk !== null
    ? Number(p.buyingPriceBulk)
    : Number(p.buyingPrice) * rate;
}

/** Preço de venda do saco (unidade pai); se não estiver definido, usa o preço base × fator. */
export function getBulkSellingPrice(p?: Product | null): number {
  if (!p) return 0;
  if (!isHybridProduct(p)) return Number(p.sellingPrice) || 0;
  if (p.sellingPriceBulk !== undefined && Number(p.sellingPriceBulk) > 0) {
    return Number(p.sellingPriceBulk);
  }
  return (Number(p.sellingPrice) || 0) * (Number(p.conversionRate) || 1);
}

/**
 * Quantidade convertida para a unidade base (ex.: quilos), para que os relatórios de vendas
 * somem sempre a mesma unidade nos produtos vendidos em saco e em quilo.
 */
export function getBaseUnitQuantity(
  p: Product | null | undefined,
  quantity: number,
  sellingUnit?: SellingUnit | string | null
): number {
  const qty = Number(quantity) || 0;
  if (p && isHybridProduct(p) && sellingUnit === 'Bulk') {
    return qty * (Number(p.conversionRate) || 1);
  }
  return qty;
}

export const PRICE_RULE_MESSAGE = 'O preço de compra tem que ser inferior ao preço de venda.';
export const PRICE_REQUIRED_MESSAGE = 'Preencha o preço de compra e o preço de venda.';
export const PRICE_REQUIRED_HYBRID_MESSAGE = 'Preencha o preço de compra do saco e os preços de venda (saco e quilo).';

/**
 * Validação para produtos normais (não híbridos).
 * Devolve a mensagem de alerta ou null se estiver tudo válido.
 */
export function validateStandardPrices(
  buyingPrice: number,
  sellingPrice: number,
  isService?: boolean
): string | null {
  const buy = Number(buyingPrice) || 0;
  const sell = Number(sellingPrice) || 0;

  // Serviços: só é exigido o preço de venda (não há compra de mercadoria).
  if (isService) {
    if (sell <= 0) return PRICE_REQUIRED_MESSAGE;
    return null;
  }

  if (buy <= 0 || sell <= 0) return PRICE_REQUIRED_MESSAGE;
  if (buy >= sell) return PRICE_RULE_MESSAGE;
  return null;
}

/**
 * Validação para produtos vendidos em saco E em quilo.
 * O quilo não tem preço de compra próprio — o custo vem do saco ÷ fator.
 */
export function validateHybridPrices(
  bulkCost: number,
  bulkSellingPrice: number,
  baseSellingPrice: number,
  conversionRate: number
): string | null {
  const sackCost = Number(bulkCost) || 0;
  const sackSell = Number(bulkSellingPrice) || 0;
  const unitSell = Number(baseSellingPrice) || 0;
  const rate = Number(conversionRate) || 0;

  if (sackCost <= 0 || sackSell <= 0 || unitSell <= 0 || rate <= 1) {
    return PRICE_REQUIRED_HYBRID_MESSAGE;
  }

  // Regra do saco: compra < venda
  if (sackCost >= sackSell) return PRICE_RULE_MESSAGE;

  // Regra do quilo: custo derivado do saco < preço de venda ao quilo
  const derivedUnitCost = sackCost / rate;
  if (derivedUnitCost >= unitSell) return PRICE_RULE_MESSAGE;

  return null;
}
