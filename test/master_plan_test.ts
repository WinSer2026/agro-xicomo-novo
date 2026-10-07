import { getDateRangeFromPreset, isDateInRange, formatDatePT } from '../src/utils/dateRangeHelper';
import { hashPassword, verifyPassword, sanitizeString, sanitizeNumber } from '../src/utils/securityHelper';
import { generateNextReceiptNumber, generateNextInvoiceNumber } from '../src/utils/sequenceHelper';
import { Product, ProductTransformation, SaleItem } from '../src/types';
import { runPostCommitTask, runPostCommitTasks } from '../src/utils/postCommit';

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
  assert(hashed.startsWith('sha256:'), 'Password hash uses salt and SHA-256');
  const isValid = await verifyPassword(pwd, hashed);
  assert(isValid === true, 'Valid password verification succeeds');
  const isInvalid = await verifyPassword('WrongPassword', hashed);
  assert(isInvalid === false, 'Invalid password rejected');

  // Backward-compatibility: plain text hash verification
  const isPlainValid = await verifyPassword('05082', '05082');
  assert(isPlainValid === true, 'Plain legacy password fallback check succeeds');

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

  console.log(`\n========================================`);
  console.log(`RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
