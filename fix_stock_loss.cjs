const fs = require('fs');
let code = fs.readFileSync('src/components/StockModule.tsx', 'utf8');

code = code.replace(
`      // Deduct stock quantity
      lossProduct.stockQty = Math.max(0, lossProduct.stockQty - lossQty);
      await dbService.saveProduct(lossProduct);`,
`      // Deduct stock quantity
      if (typeof (dbService as any).deductProductStock === 'function') {
        await (dbService as any).deductProductStock([{
          productId: lossProduct.id,
          hasConversion: false,
          qtyToReduce: lossQty
        }]);
      } else {
        lossProduct.stockQty = Math.max(0, lossProduct.stockQty - lossQty);
        await dbService.saveProduct(lossProduct);
      }`
);

fs.writeFileSync('src/components/StockModule.tsx', code);
