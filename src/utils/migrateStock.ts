import { safeStorage, safeSessionStorage } from "./safeStorage";
import { uid } from './idHelper';
import { dbService } from './firebaseDB';
import { INITIAL_PRODUCTS } from '../data/initialProducts';
import { STOCK_LIST_QUANTITIES, STOCK_LIST_VERSION } from '../data/stockListUpdate';
import { Product, SystemSettings } from '../types';

export const runStockMigration = async () => {
  // Desativado definitivamente: esta migração histórica só devia correr uma vez no lançamento.
  // Executá-la no arranque dos navegadores provocava a reposição forçada das quantidades
  // do anexo inicial e reescrita de preços por cima das alterações do gestor.
  return;
};

/**
 * Migração do modelo de preços para produtos vendidos em SACO e em QUILO.
 *
 * Estes produtos são comprados em sacos: o preço de compra pertence ao SACO.
 * O quilo não tem preço de compra próprio — o seu custo é derivado do saco:
 *     custo do quilo = preço de compra do saco ÷ fator de conversão
 *
 * O sistema passa a guardar:
 *  - buyingPriceBulk: preço de compra do saco (valor real pago ao fornecedor)
 *  - buyingPrice: custo derivado da unidade base (quilo), mantendo os relatórios coerentes
 */
export const runStockListUpdate = async () => {
  const codes = Object.keys(STOCK_LIST_QUANTITIES);
  if (STOCK_LIST_VERSION <= 0 || codes.length === 0) {
    return; // lista ainda não recebida — nenhuma alteração é aplicada
  }

  try {
    const settings = await dbService.getSettings();
    if ((settings?.stockListVersion || 0) >= STOCK_LIST_VERSION) {
      return; // já aplicada globalmente (uma única vez para todos os dispositivos)
    }

    const products = await dbService.getProducts();
    const toUpdate: Product[] = [];
    const notFound: string[] = [];

    for (const [rawCode, rawQty] of Object.entries(STOCK_LIST_QUANTITIES)) {
      const code = String(rawCode).trim().toUpperCase();
      const qty = Number(rawQty);
      if (!Number.isFinite(qty) || qty < 0) continue;

      const product = products.find(p => String(p.code).trim().toUpperCase() === code);
      if (!product) {
        notFound.push(code);
        continue;
      }

      const updated: Product = { ...product, stockQty: qty };

      // Produtos vendidos em saco e em quilo: recalcular a divisão sacos/retalho
      const rate = Number(product.conversionRate) || 0;
      if (product.parentUnit && rate > 1) {
        updated.stockQtyBulk = Math.floor(qty / rate);
        updated.stockQtyRetail = qty % rate;
      }

      if (
        updated.stockQty !== product.stockQty ||
        updated.stockQtyBulk !== product.stockQtyBulk ||
        updated.stockQtyRetail !== product.stockQtyRetail
      ) {
        toUpdate.push(updated);
      }
    }

    if (toUpdate.length > 0) {
      await dbService.saveProducts(toUpdate);
    }

    if (notFound.length > 0) {
      console.warn('[StockListUpdate] Códigos não encontrados no catálogo:', notFound.join(', '));
    }

    await dbService.saveSettings({ ...settings, stockListVersion: STOCK_LIST_VERSION } as SystemSettings);

    void dbService.addAuditLog({
      id: uid('log-'),
      timestamp: new Date().toISOString(),
      username: 'Sistema (Contagem Física)',
      ipAddress: '127.0.0.1',
      action: 'Atualização de Quantidades Reais de Stock',
      status: 'Alerta',
      level: 'CRITICAL',
      details: `Quantidades reais aplicadas a ${toUpdate.length} produto(s) (lista v${STOCK_LIST_VERSION}). Preços e restantes dados não foram alterados.`
    });

    console.log(`[StockListUpdate] ${toUpdate.length} produtos actualizados com as quantidades reais.`);
  } catch (err) {
    console.error('[StockListUpdate] Failed to apply real stock quantities:', err);
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Determina o preço de compra do SACO a partir dos dados guardados (função pura, testável).
 * Devolve null quando o produto não é híbrido ou não tem preço de compra utilizável.
 */
export function deriveHybridSackCost(p: {
  buyingPrice?: number;
  buyingPriceBulk?: number;
  sellingPrice?: number;
  sellingPriceBulk?: number;
  conversionRate?: number;
}): number | null {
  const rate = Number(p.conversionRate) || 0;
  if (!(rate > 1)) return null;

  if (p.buyingPriceBulk !== undefined && p.buyingPriceBulk !== null) {
    const declared = Number(p.buyingPriceBulk) || 0;
    return declared > 0 ? declared : null;
  }

  const stored = Number(p.buyingPrice) || 0;
  if (stored <= 0) return null;

  const sellUnit = Number(p.sellingPrice) || 0;
  const sellSack = Number(p.sellingPriceBulk) || 0;

  const unitInterpretationValid = sellUnit <= 0 || stored < sellUnit;
  const sackInterpretationValid = sellSack <= 0 || stored < sellSack;

  // Valor guardado é claramente o preço do SACO
  // (ex.: 3300 por saco de 50kg de um produto vendido a 95/kg)
  if (!unitInterpretationValid && sackInterpretationValid) {
    return stored;
  }

  // Valor guardado já é o custo da unidade base (modelo usado pelo formulário)
  return stored * rate;
}

export const runHybridPriceMigration = async () => {
  // Desativado definitivamente: recalcular preços em massa no arranque dos clientes
  // sobrescrevia alterações manuais feitas pelo gestor de stock.
  return;
};
