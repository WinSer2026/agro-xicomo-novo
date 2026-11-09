/**
 * Aritmética de stock usada pelas operações transaccionais do inventário
 * (`adjustStock`, `registerLossAtomic`, `expireProductBatch`,
 * `applyPhysicalCount`).
 *
 * Vive separada de `firebaseDB` para poder ser testada sem Firestore: o que se
 * verifica aqui é exactamente o que o servidor escreve — uma regra que só se
 * testa com um caixa real não serve de guarda.
 */
import type { Product } from '../types';

const MIL = 1000;

/** Arredonda para milésimos: o stock é em kg, não em poeira. */
export function roundStock(value: number): number {
  return Math.round((Number(value) || 0) * MIL) / MIL;
}

/**
 * Um artigo é híbrido quando vende ao saco *e* ao peso.
 * `conversionRate <= 1` não é conversão — é um erro de cadastro, e ignorá-lo
 * evita dividir por zero ou transformar 1 saco em 1 kg.
 */
export function hybridStock(product: Pick<Product, 'parentUnit' | 'conversionRate'>): {
  hasConversion: boolean;
  rate: number;
} {
  const rate = Number(product?.conversionRate);
  const hasConversion = Boolean(product?.parentUnit) && Number.isFinite(rate) && rate > 1;
  return { hasConversion, rate: hasConversion ? rate : 1 };
}

/** Quantidade do formulário → unidade base (kg). */
export function toBaseQty(
  quantity: number,
  unit: 'Bulk' | 'base' | 'Retail' | undefined,
  product: Pick<Product, 'parentUnit' | 'conversionRate'>
): number {
  const { hasConversion, rate } = hybridStock(product);
  const factor = unit === 'Bulk' && hasConversion ? rate : 1;
  return roundStock((Number(quantity) || 0) * factor);
}

/**
 * Total em base → sacos + retalho. O retalho é o resto, e é sempre
 * `total - sacos × rate`, para as três quantidades somarem o total.
 */
export function splitHybrid(
  totalBase: number,
  product: Pick<Product, 'parentUnit' | 'conversionRate'>
): { stockQtyBulk: number | null; stockQtyRetail: number | null } {
  const { hasConversion, rate } = hybridStock(product);
  if (!hasConversion) return { stockQtyBulk: null, stockQtyRetail: null };

  const total = Math.max(0, roundStock(totalBase));
  const bulk = Math.floor(total / rate);
  return { stockQtyBulk: bulk, stockQtyRetail: roundStock(total - bulk * rate) };
}

/**
 * Saldo após uma variação, recusando negativos.
 *
 * Devolve `delta` já recortado (o que o chamador deve gravar) e `clamped`
 * quando o saldo foi travado em zero — sinal de que a operação retirava mais
 * do que existe.
 */
export function clampStockDelta(
  systemBase: number,
  delta: number,
  allowNegative = false
): { previousBase: number; target: number; delta: number; clamped: boolean } {
  const anterior = roundStock(systemBase);
  const alvo = roundStock(anterior + (Number(delta) || 0));

  if (alvo < 0) {
    if (!allowNegative) {
      return { previousBase: anterior, target: anterior, delta: 0, clamped: true };
    }
    return { previousBase: anterior, target: 0, delta: roundStock(-anterior), clamped: true };
  }
  return { previousBase: anterior, target: alvo, delta: roundStock(alvo - anterior), clamped: false };
}

/**
 * Diferença de uma contagem física (contado − sistema).
 * Positiva é sobra, negativa é falta. Nunca devolve um delta que leve o saldo
 * a negativo: a contagem é a verdade, logo `counted >= 0` basta.
 */
export function physicalDelta(systemBase: number, countedBase: number): number {
  const contado = roundStock(countedBase);
  if (contado < 0) return 0;
  return roundStock(contado - roundStock(systemBase));
}

/** Valor monetário de uma quebra/falta, com 2 casas. */
export function stockLossValue(baseQty: number, buyingPrice: number): number {
  return Math.round(Math.abs(roundStock(baseQty)) * (Number(buyingPrice) || 0) * 100) / 100;
}
