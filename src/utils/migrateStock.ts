import { safeStorage, safeSessionStorage } from "./safeStorage";
import { dbService } from './firebaseDB';
import { INITIAL_PRODUCTS } from '../data/initialProducts';

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
