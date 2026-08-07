const fs = require('fs');
let code = fs.readFileSync('src/components/PDVModule.tsx', 'utf8');

// Replace handleCancelSale block
code = code.replace(
`        for (const item of sale.items) {
          if (item.productId) {
            const products = await dbService.getProducts();
            const prod = products.find(p => p.id === item.productId);
            if (prod && !prod.isService) {
              const hasConversion = !!(prod.parentUnit && prod.conversionRate && prod.conversionRate > 1);
              if (hasConversion) {
                if (item.sellingUnit === 'Bulk') {
                  const qtyToAdd = item.quantity;
                  prod.stockQtyBulk = (prod.stockQtyBulk || 0) + qtyToAdd;
                  const equivalentBaseQty = qtyToAdd * (prod.conversionRate || 1);
                  prod.stockQty = prod.stockQty + equivalentBaseQty;
                } else {
                  const qtyToAdd = item.quantity;
                  prod.stockQtyRetail = (prod.stockQtyRetail || 0) + qtyToAdd;
                  prod.stockQty = prod.stockQty + qtyToAdd;
                }
              } else {
                prod.stockQty = prod.stockQty + item.quantity;
              }
              await dbService.saveProduct(prod);
            }
          }
        }`,
`        const deductionItems = [];
        for (const item of sale.items) {
          if (item.productId) {
            const products = await dbService.getProducts();
            const prod = products.find(p => p.id === item.productId);
            if (prod && !prod.isService) {
              const hasConversion = !!(prod.parentUnit && prod.conversionRate && prod.conversionRate > 1);
              if (hasConversion) {
                if (item.sellingUnit === 'Bulk') {
                  const equivalentBaseQty = item.quantity * (prod.conversionRate || 1);
                  deductionItems.push({ productId: prod.id, hasConversion, sellingUnit: 'Bulk', qtyToReduce: -item.quantity, equivalentBaseQty: -equivalentBaseQty });
                } else {
                  deductionItems.push({ productId: prod.id, hasConversion, sellingUnit: 'Retail', qtyToReduce: -item.quantity });
                }
              } else {
                deductionItems.push({ productId: prod.id, hasConversion: false, qtyToReduce: -item.quantity });
              }
            }
          }
        }
        if (deductionItems.length > 0 && typeof (dbService as any).deductProductStock === 'function') {
          await (dbService as any).deductProductStock(deductionItems);
        }`
);

// Replace handleRestoreInvoice block
code = code.replace(
`        for (const item of sale.items) {
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
            await dbService.saveProduct(prod);
          }
        }`,
`        const deductionItems = [];
        for (const item of sale.items) {
          const prod = products.find(p => p.id === item.productId);
          if (prod && !prod.isService) {
            const hasConversion = !!(prod.parentUnit && prod.conversionRate && prod.conversionRate > 1);
            if (hasConversion) {
              if (item.sellingUnit === 'Bulk') {
                const equivalentBaseQty = item.quantity * (prod.conversionRate || 1);
                deductionItems.push({ productId: prod.id, hasConversion, sellingUnit: 'Bulk', qtyToReduce: item.quantity, equivalentBaseQty });
              } else {
                deductionItems.push({ productId: prod.id, hasConversion, sellingUnit: 'Retail', qtyToReduce: item.quantity });
              }
            } else {
              deductionItems.push({ productId: prod.id, hasConversion: false, qtyToReduce: item.quantity });
            }
          }
        }
        if (deductionItems.length > 0 && typeof (dbService as any).deductProductStock === 'function') {
          await (dbService as any).deductProductStock(deductionItems);
        }`
);

fs.writeFileSync('src/components/PDVModule.tsx', code);
