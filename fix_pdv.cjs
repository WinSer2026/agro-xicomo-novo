const fs = require('fs');
let code = fs.readFileSync('src/components/PDVModule.tsx', 'utf8');

code = code.replace(
`      // 1. Update stock quantities locally ONLY for FaturaDefinitiva
      if (effectiveDocType === 'FaturaDefinitiva') {
        const updatedProds: Product[] = [];
        for (const item of cart) {
          const prod = products.find(p => p.id === item.productId);
          if (prod && !prod.isService) {
            const hasConversion = !!(prod.parentUnit && prod.conversionRate && prod.conversionRate > 1);
            if (hasConversion) {
              if (item.sellingUnit === 'Bulk') {
                const qtyToReduce = item.quantity;
                prod.stockQtyBulk = Math.max(0, (prod.stockQtyBulk || 0) - qtyToReduce);
                const equivalentBaseQty = qtyToReduce * (prod.conversionRate || 1);
                prod.stockQty = Math.max(0, prod.stockQty - equivalentBaseQty);
              } else {
                const qtyToReduce = item.quantity;
                prod.stockQtyRetail = Math.max(0, (prod.stockQtyRetail || 0) - qtyToReduce);
                prod.stockQty = Math.max(0, prod.stockQty - qtyToReduce);
              }
            } else {
              prod.stockQty = Math.max(0, prod.stockQty - item.quantity);
            }
            updatedProds.push(prod);
          }
        }
        if (updatedProds.length > 0) {
          await dbService.saveProducts(updatedProds);
        }
      }`,
`      // 1. Update stock quantities locally ONLY for FaturaDefinitiva
      if (effectiveDocType === 'FaturaDefinitiva') {
        const deductionItems = [];
        for (const item of cart) {
          const prod = products.find(p => p.id === item.productId);
          if (prod && !prod.isService) {
            const hasConversion = !!(prod.parentUnit && prod.conversionRate && prod.conversionRate > 1);
            if (hasConversion) {
              if (item.sellingUnit === 'Bulk') {
                const qtyToReduce = item.quantity;
                const equivalentBaseQty = qtyToReduce * (prod.conversionRate || 1);
                deductionItems.push({ productId: prod.id, hasConversion, sellingUnit: 'Bulk', qtyToReduce, equivalentBaseQty });
              } else {
                const qtyToReduce = item.quantity;
                deductionItems.push({ productId: prod.id, hasConversion, sellingUnit: 'Retail', qtyToReduce });
              }
            } else {
              deductionItems.push({ productId: prod.id, hasConversion: false, qtyToReduce: item.quantity });
            }
          }
        }
        if (deductionItems.length > 0 && typeof (dbService as any).deductProductStock === 'function') {
          await (dbService as any).deductProductStock(deductionItems);
        }
      }`
);
fs.writeFileSync('src/components/PDVModule.tsx', code);
