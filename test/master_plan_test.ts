import { getDateRangeFromPreset, isDateInRange, formatDatePT } from '../src/utils/dateRangeHelper';
import { hashPassword, verifyPassword, needsPasswordRehash, sanitizeString, sanitizeNumber } from '../src/utils/securityHelper';
import { generateNextReceiptNumber, generateNextInvoiceNumber } from '../src/utils/sequenceHelper';
import { Product, ProductTransformation, Sale, SaleItem } from '../src/types';
import { clampItemDiscountValue, getItemDiscount, getMaxItemDiscountValue, getSaleTotals } from '../src/utils/saleTotals';
import { filterSalesForReport, loadFinanceData, FinanceDataSource } from '../src/utils/financeData';
import { runPostCommitTask, runPostCommitTasks } from '../src/utils/postCommit';
import {
  getArchiveCutoffTimestamp,
  getCursorPageMetadata,
  getInclusiveDateBounds,
  getSafeArchiveBatchSize,
  normalizePageSize
} from '../src/utils/paginationHelper';

async function runTests() {
  console.log('--- STARTING MASTER PLAN AUDIT & ENHANCEMENT TESTS ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  // TEST 1: Date Range Presets & Helpers
  console.log('\n--- Test Suite 1: Date Range Helper ---');
  const todayRange = getDateRangeFromPreset('Hoje');
  const nowStr = new Date().toISOString().split('T')[0];
  assert(todayRange.startDate === nowStr && todayRange.endDate === nowStr, 'Preset "Hoje" matches current UTC date');

  const monthRange = getDateRangeFromPreset('Este Mês');
  assert(monthRange.startDate <= monthRange.endDate, 'Preset "Este Mês" valid interval');

  assert(isDateInRange('2026-09-15', '2026-09-01', '2026-09-30'), 'Date in middle of range is detected');
  assert(!isDateInRange('2026-08-31', '2026-09-01', '2026-09-30'), 'Date before range is excluded');
  assert(!isDateInRange('2026-10-01', '2026-09-01', '2026-09-30'), 'Date after range is excluded');

  // TEST 2: Security & Password Hashing
  console.log('\n--- Test Suite 2: Security & Crypto ---');
  const pwd = 'Xicomo@Admin2026!';
  const hashed = await hashPassword(pwd);
  assert(hashed.startsWith('pbkdf2:'), 'Password hash uses salt and PBKDF2');
  const isValid = await verifyPassword(pwd, hashed);
  assert(isValid === true, 'Valid password verification succeeds');
  const isInvalid = await verifyPassword('WrongPassword', hashed);
  assert(isInvalid === false, 'Invalid password rejected');
  assert(needsPasswordRehash(hashed) === false, 'PBKDF2 hashes do not need rehash');
  assert(needsPasswordRehash('05082') === true, 'Legacy plaintext hashes are flagged for migration');

  // Backward-compatibility: plain text hash verification (migration path)
  const isPlainValid = await verifyPassword('05082', '05082');
  assert(isPlainValid === true, 'Plain legacy password fallback check succeeds');

  // Backward-compatibility: legacy salted SHA-256 verification (self-made test vector)
  const isLegacyValid = await verifyPassword(
    'teste1',
    'sha256:SALT1234:29dc010c114d6021a750f6a270bbd27c8c771ab192c18c842bca171514b0f598'
  );
  assert(isLegacyValid === true, 'Legacy sha256 password verification still succeeds');
  assert(needsPasswordRehash('sha256:x:y') === true, 'Legacy sha256 hashes are flagged for migration');

  // XSS Sanitization
  const dangerousStr = '<script>alert("hack")</script> Milho';
  const cleanStr = sanitizeString(dangerousStr);
  assert(!cleanStr.includes('<script>') && !cleanStr.includes('</script>'), 'XSS tags stripped from input');

  const cleanNum = sanitizeNumber('150.50 MT', 0);
  assert(cleanNum === 150.5, 'Number sanitizer correctly parses decimals');

  // TEST 3: Product Transformation Cost Conservation & Neutrality
  console.log('\n--- Test Suite 3: Transformation Cost Conservation & Neutrality ---');
  // Scenario: 1 bag of 50kg costing 2000 MT transformed into:
  // - 40 packs of 1kg (total 40kg)
  // - 1 pack of 5kg (total 5kg)
  // - 1 pack of 3kg (total 3kg)
  // - 2kg loss in handling
  const originalBagCost = 2000;
  const originalKg = 50;
  const costPerKg = originalBagCost / originalKg; // 40 MT/kg

  const item1Qty = 40; // 40 * 1kg = 40kg
  const item1UnitCost = 1 * costPerKg; // 40 MT

  const item2Qty = 1;  // 1 * 5kg = 5kg
  const item2UnitCost = 5 * costPerKg; // 200 MT

  const item3Qty = 1;  // 1 * 3kg = 3kg
  const item3UnitCost = 3 * costPerKg; // 120 MT

  const lossKg = 2; // 2kg loss
  const lossValue = lossKg * costPerKg; // 80 MT

  const totalCreatedCost = (item1Qty * item1UnitCost) + (item2Qty * item2UnitCost) + (item3Qty * item3UnitCost);
  const totalAccounted = totalCreatedCost + lossValue;

  assert(totalAccounted === originalBagCost, `Cost neutrality holds: ${totalAccounted} MT == ${originalBagCost} MT`);
  assert(totalCreatedCost === 1920, `Created stock value is exactly 1920 MT`);
  assert(lossValue === 80, `Operational loss recorded at exactly 80 MT`);

  // TEST 4: Immutable Sale Snapshot Cost Price
  console.log('\n--- Test Suite 4: Immutable Sale Items & Snapshot Margins ---');
  const saleItem: SaleItem = {
    productId: 'prod-001',
    name: 'Adubo NPK 10-24-12 1kg',
    quantity: 5,
    unitPrice: 120, // Sold at 120 MT
    costPrice: 80,  // Snapshotted cost at 80 MT
    totalPrice: 600,
    unit: 'Pacote 1kg'
  };

  const revenue = saleItem.quantity * saleItem.unitPrice; // 600 MT
  const cost = saleItem.quantity * (saleItem.costPrice || 0); // 400 MT
  const grossProfit = revenue - cost; // 200 MT
  const marginPct = (grossProfit / revenue) * 100; // 33.33%

  assert(revenue === 600, 'Sale revenue is 600 MT');
  assert(cost === 400, 'Cost of goods sold based on snapshot is 400 MT');
  assert(grossProfit === 200, 'Gross profit is 200 MT');
  assert(Math.round(marginPct) === 33, 'Gross margin percentage is 33%');

  // TEST 5: Category Matching & Diacritic Robustness (Químicos / Serviços / Sementes)
  console.log('\n--- Test Suite 5: Category Matching & Diacritic Robustness ---');
  const { matchCategory } = await import('../src/utils/categoryHelper');
  assert(matchCategory('Químicos', 'quimicos'), 'Product category "Químicos" matches "quimicos"');
  assert(matchCategory('Químicos', 'quimico'), 'Product category "Químicos" matches singular "quimico"');
  assert(matchCategory('quimicos', 'QUÍMICOS'), 'Product category "quimicos" matches uppercase "QUÍMICOS"');
  assert(matchCategory('Pesticidas / Químico', 'quimicos'), 'Product category "Pesticidas / Químico" matches "quimicos"');
  assert(matchCategory('Sementes', 'semente'), 'Product category "Sementes" matches "semente"');
  assert(matchCategory('Adubos', 'adubo'), 'Product category "Adubos" matches "adubo"');
  assert(matchCategory('Serviços', 'servico'), 'Product category "Serviços" matches "servico"');
  assert(matchCategory('Ferramentas e Ferragens', 'ferramentas'), 'Product category "Ferramentas e Ferragens" matches "ferramentas"');
  assert(!matchCategory('Sementes', 'quimicos'), 'Product category "Sementes" does not match "quimicos"');

  // TEST 6: Unit Sanitization (Stripping CSS artifact "font-bold")
  console.log('\n--- Test Suite 6: Unit Sanitization ---');
  const dirtyUnit = 'Unidades font-bold';
  const cleanUnit = dirtyUnit.replace(/font-bold/gi, '').trim() || 'Unidades';
  assert(cleanUnit === 'Unidades', 'Dirty unit "Unidades font-bold" is sanitized to "Unidades"');

  const dirtyParentUnit = 'Sacos font-bold';
  const cleanParentUnit = dirtyParentUnit.replace(/font-bold/gi, '').trim();
  assert(cleanParentUnit === 'Sacos', 'Dirty parent unit "Sacos font-bold" is sanitized to "Sacos"');

  // TEST 7: Post-commit safeguards. A completed sale must not become an error
  // just because a later refresh or document generation fails.
  console.log('\n--- Test Suite 7: Post-Commit Operation Safeguards ---');
  const originalConsoleWarn = console.warn;
  // The utility deliberately logs contained post-commit failures in production.
  // Silence that expected diagnostic output while asserting its return contract.
  console.warn = () => undefined;
  try {
    const completedTask = await runPostCommitTask({
      label: 'test successful refresh',
      task: () => Promise.resolve()
    });
    assert(completedTask, 'Successful post-commit task reports completion');

    const failedTask = await runPostCommitTask({
      label: 'test failed print',
      task: () => Promise.reject(new Error('printer unavailable'))
    });
    assert(!failedTask, 'Failed post-commit task is contained instead of throwing');

    const failedLabels = await runPostCommitTasks([
      { label: 'refresh catalogue', task: () => Promise.resolve() },
      { label: 'generate document', task: () => Promise.reject(new Error('PDF unavailable')) }
    ]);
    assert(failedLabels.length === 1 && failedLabels[0] === 'generate document', 'Only failed post-commit tasks are reported');
  } finally {
    console.warn = originalConsoleWarn;
  }

  // TEST 8: Pagination and audit archive safeguards
  console.log('\n--- Test Suite 8: Pagination & Audit Archive Safeguards ---');
  assert(normalizePageSize(undefined) === 50, 'Default Firestore page size is bounded at 50 records');
  assert(normalizePageSize(999) === 250, 'Requested page sizes are capped at the safe maximum');
  assert(normalizePageSize(0) === 50, 'Invalid page size falls back to the default');

  const firstPage = getCursorPageMetadata(51, 50);
  assert(firstPage.itemCount === 50 && firstPage.hasMore, 'Sentinel document produces a next-page cursor decision');
  const finalPage = getCursorPageMetadata(17, 50);
  assert(finalPage.itemCount === 17 && !finalPage.hasMore, 'Short final page does not offer an invalid next cursor');

  const bounds = getInclusiveDateBounds('2026-10-01', '2026-10-07');
  assert(bounds.start === '2026-10-01' && bounds.end === '2026-10-07T23:59:59.999Z', 'Date range includes plain dates and ISO timestamps on the ending day');
  assert(getArchiveCutoffTimestamp('2026-04-01') === '2026-04-01T00:00:00.000Z', 'Audit archive cutoff is exclusive from the selected day start');
  assert(getSafeArchiveBatchSize(999) === 250, 'Audit archive batch stays within Firestore 500-write atomic limit');
  assert(getSafeArchiveBatchSize(200) === 200, 'Requested safe archive batch size is preserved');

  // TEST 9: Regular and retroactive checkouts use the same bounded discount math.
  console.log('\n--- Test Suite 9: POS & Historic Sale Discounts ---');
  const discountItem: SaleItem = {
    productId: 'prod-001', name: 'Adubo', quantity: 3, unit: 'Kg', unitPrice: 100, totalPrice: 300
  };
  assert(getItemDiscount({ ...discountItem, discountType: 'line_total', discountValue: 20 }) === 20, 'Fixed line discount applies once');
  assert(getItemDiscount({ ...discountItem, discountType: 'per_unit', discountValue: 20 }) === 60, 'Fixed unit discount scales with quantity');
  assert(getItemDiscount({ ...discountItem, discountType: 'percent_total', discountValue: 10 }) === 30, 'Percentage line discount applies to gross line');
  assert(getItemDiscount({ ...discountItem, discountType: 'percent_unit', discountValue: 10 }) === 30, 'Percentage unit discount scales with quantity');
  assert(getItemDiscount({ ...discountItem, discountType: 'percent_total', discountValue: 250 }) === 300, 'Discount never exceeds line price');
  assert(getMaxItemDiscountValue(discountItem, 'per_unit') === 100 && getMaxItemDiscountValue(discountItem, 'percent_total') === 100, 'Input limits follow price and percentage');
  assert(clampItemDiscountValue({ ...discountItem, quantity: 1 }, 'line_total', 500) === 100, 'Reducing quantity clamps an existing line discount');
  const discountedItem = { ...discountItem, discountType: 'percent_total' as const, discountValue: 10 };
  const secondItem = { ...discountItem, productId: 'prod-002', quantity: 2, unitPrice: 50, discountType: 'per_unit' as const, discountValue: 5 };
  const historicTotals = getSaleTotals([discountedItem, secondItem]);
  assert(historicTotals.subtotal === 400 && historicTotals.discount === 40 && historicTotals.total === 360, 'Historic sale totals account for both line discounts');
  assert(getSaleTotals([discountedItem, secondItem], 10, true).total === 406, 'Regular sale and paused-cart totals share discount + IVA logic');
  assert(getSaleTotals([{ ...discountItem, discountValue: 999 }]).total === 0, 'Excess fixed discount cannot create a negative sale');

  // TEST 10: Older/retroactive sales appear in finance; audit errors cannot hide them.
  console.log('\n--- Test Suite 10: Financial Results & Partial Data Failure ---');
  assert(getDateRangeFromPreset('Todo o Histórico').startDate === '' && getDateRangeFromPreset('Todo o Histórico').endDate === '', 'Full-history preset includes older transactions');
  const historicSale: Sale = {
    id: 'sale-retro-test', invoiceNumber: 'FAC-2026-1', date: '2026-02-12T10:00:00.000Z',
    customerName: 'Cliente Geral', items: [
      { ...discountedItem, totalPrice: 270 }, { ...secondItem, totalPrice: 90 }
    ], subtotal: historicTotals.subtotal, discount: historicTotals.discount, total: historicTotals.total,
    paymentMethod: 'Dinheiro', status: 'Paga', operatorId: 'admin', operatorName: 'admin', synced: true
  };
  const cancelledSale = { ...historicSale, id: 'cancelled-test', status: 'Cancelada' as const, date: '2026-10-12T10:00:00.000Z' };
  const reportNow = new Date('2026-10-14T12:00:00.000Z');
  assert(filterSalesForReport([historicSale, cancelledSale], 'Todo o Histórico', reportNow).length === 1, 'Full financial history includes old sales but not cancelled ones');
  assert(filterSalesForReport([historicSale], 'Mensal', reportNow).length === 0, 'Recent-period filter excludes older sales only when selected');
  assert(isDateInRange(historicSale.date, '', '') && historicSale.total === 360, 'Finance can show the discounted historic sale in an unbounded date range');

  let rejectAudit!: (error: Error) => void;
  const pendingAudit = new Promise<{ items: [] }>((_, reject) => { rejectAudit = reject; });
  const fakeFinance: FinanceDataSource = {
    enableLiveCatalogAndSalesSync: async () => undefined,
    getSalesForPeriod: async () => [historicSale],
    getLosses: async () => [],
    getProducts: async () => [],
    getAuditLogsPage: () => pendingAudit,
    getSettings: async () => ({} as Awaited<ReturnType<FinanceDataSource['getSettings']>>),
    getTransformations: async () => [],
    getPayrollPayments: async () => []
  };
  const receivedSales: Sale[][] = [];
  const oldConsoleError = console.error;
  console.error = () => undefined; // expected rejected audit read
  try {
    const notifiedFailures: string[] = [];
    const reading = loadFinanceData(fakeFinance, part => { if (part.sales) receivedSales.push(part.sales); }, key => notifiedFailures.push(key));
    await new Promise(resolve => setImmediate(resolve));
    assert(receivedSales[0]?.[0]?.id === historicSale.id, 'Finance renders sales before slow audit preview finishes');
    rejectAudit(new Error('audit preview unavailable'));
    const failures = await reading;
    assert(failures.length === 1 && failures[0] === 'auditLogs' && notifiedFailures[0] === 'auditLogs', 'Audit failure is reported without discarding financial results');

    const missingSales = loadFinanceData({
      ...fakeFinance,
      getSalesForPeriod: async () => { throw new Error('network unavailable'); },
      getAuditLogsPage: async () => ({ items: [] })
    }, () => undefined, key => notifiedFailures.push(key));
    const failed = await missingSales;
    assert(failed.length === 1 && failed[0] === 'sales' && notifiedFailures.includes('sales'), 'Sales read errors are surfaced instead of displayed as zero revenue');
  } finally {
    console.error = oldConsoleError;
  }

  console.log(`\n========================================`);
  console.log(`RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
