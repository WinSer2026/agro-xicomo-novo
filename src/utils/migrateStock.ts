import { safeStorage, safeSessionStorage } from "./safeStorage";
import { uid } from './idHelper';
import { dbService } from './firebaseDB';
import { INITIAL_PRODUCTS } from '../data/initialProducts';
import { STOCK_LIST_QUANTITIES, STOCK_LIST_VERSION } from '../data/stockListUpdate';
import { Product, SystemSettings } from '../types';

export const runStockMigration = async () => {
  if (safeStorage.getItem('agro_stock_migrated_v1') === 'true') {
    return;
  }
  
  try {
    const existingProducts = await dbService.getProducts();
    const toUpdate = [];
    
    for (const ep of existingProducts) {
      const initial = INITIAL_PRODUCTS.find(p => p.code === ep.code);
      if (initial) {
        let needsUpdate = false;
        const up = { ...ep };
        if (ep.stockQty !== initial.stockQty) {
          up.stockQty = initial.stockQty;
          needsUpdate = true;
        }
        if (initial.stockQtyBulk !== undefined && ep.stockQtyBulk !== initial.stockQtyBulk) {
          up.stockQtyBulk = initial.stockQtyBulk;
          needsUpdate = true;
        }
        if (initial.stockQtyRetail !== undefined && ep.stockQtyRetail !== initial.stockQtyRetail) {
          up.stockQtyRetail = initial.stockQtyRetail;
          needsUpdate = true;
        }
        
        if (needsUpdate) {
          toUpdate.push(up);
        }
      }
    }
    
    if (toUpdate.length > 0) {
      console.log(`[Migration] Updating ${toUpdate.length} products stock to match initial PDF data`);
      await dbService.saveProducts(toUpdate);
    }
    
    safeStorage.setItem('agro_stock_migrated_v1', 'true');
    console.log('[Migration] Stock migration completed');
  } catch (err) {
    console.error('[Migration] Failed to migrate stock', err);
  }
}

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
  if (safeStorage.getItem('agro_hybrid_price_migrated_v1') === 'true') {
    return;
  }

  try {
    const products = await dbService.getProducts();
    const toUpdate: Product[] = [];

    for (const p of products) {
      const rate = Number(p.conversionRate) || 0;
      // Aplica-se somente aos produtos híbridos (saco + quilo/unidade)
      if (!(p.parentUnit && rate > 1)) continue;

      const sackCost = deriveHybridSackCost(p);
      if (sackCost === null || sackCost <= 0) continue;

      const updated: Product = {
        ...p,
        buyingPriceBulk: round2(sackCost),
        buyingPrice: round2(sackCost / rate)
      };

      if (
        updated.buyingPrice !== p.buyingPrice ||
        updated.buyingPriceBulk !== p.buyingPriceBulk
      ) {
        toUpdate.push(updated);
      }
    }

    if (toUpdate.length > 0) {
      console.log(`[Migration] Hybrid sack/kg price model applied to ${toUpdate.length} product(s)`);
      await dbService.saveProducts(toUpdate);
    }

    safeStorage.setItem('agro_hybrid_price_migrated_v1', 'true');
    console.log('[Migration] Hybrid price migration completed');
  } catch (err) {
    console.error('[Migration] Failed to migrate hybrid prices', err);
  }
}
