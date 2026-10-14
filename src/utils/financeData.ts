import type { AuditLog, LossRecord, PayrollPayment, Product, ProductTransformation, Sale, SystemSettings } from '../types';

export interface FinanceData {
  sales: Sale[];
  losses: LossRecord[];
  products: Product[];
  auditLogs: AuditLog[];
  settings: SystemSettings;
  transformations: ProductTransformation[];
  payrollPayments: PayrollPayment[];
}

/** Finance reads are independent: a failed audit preview must not hide sales/DRE. */
export interface FinanceDataSource {
  enableLiveCatalogAndSalesSync(): Promise<void>;
  getSalesForPeriod(): Promise<Sale[]>;
  getLosses(): Promise<LossRecord[]>;
  getProducts(): Promise<Product[]>;
  getAuditLogsPage(options: { pageSize: number }): Promise<{ items: AuditLog[] }>;
  getSettings(): Promise<SystemSettings>;
  getTransformations(): Promise<ProductTransformation[]>;
  getPayrollPayments(): Promise<PayrollPayment[]>;
}

export async function loadFinanceData(
  source: FinanceDataSource,
  onData: (part: Partial<FinanceData>) => void,
  onError?: (section: keyof FinanceData) => void
): Promise<(keyof FinanceData)[]> {
  await source.enableLiveCatalogAndSalesSync();

  async function read<K extends keyof FinanceData>(key: K, request: () => Promise<FinanceData[K]>): Promise<K | null> {
    try {
      const data = await request();
      onData({ [key]: data } as Pick<FinanceData, K>);
      return null;
    } catch (error) {
      console.error(`[Finance] Não foi possível carregar ${key}:`, error);
      onError?.(key);
      return key;
    }
  }

  const failures = await Promise.all([
    read('sales', () => source.getSalesForPeriod()),
    read('losses', () => source.getLosses()),
    read('products', () => source.getProducts()),
    read('auditLogs', async () => (await source.getAuditLogsPage({ pageSize: 100 })).items),
    read('settings', () => source.getSettings()),
    read('transformations', () => source.getTransformations()),
    read('payrollPayments', () => source.getPayrollPayments())
  ]);
  return failures.filter((key): key is keyof FinanceData => key !== null);
}

export type FinanceReportPeriod = 'Todo o Histórico' | 'Diário' | 'Semanal' | 'Mensal' | 'Trimestral' | 'Semestral' | 'Anual';

/** Only real, non-cancelled sales count in financial reports. */
export function filterSalesForReport(sales: Sale[], period: FinanceReportPeriod, now = new Date()): Sale[] {
  const days: Record<Exclude<FinanceReportPeriod, 'Todo o Histórico'>, number> = {
    'Diário': 1, 'Semanal': 7, 'Mensal': 30, 'Trimestral': 90, 'Semestral': 180, 'Anual': 365
  };
  return sales.filter(sale => {
    if (sale.status === 'Cancelada') return false;
    if (period === 'Todo o Histórico') return true;
    const ageDays = (now.getTime() - new Date(sale.date).getTime()) / 86400000;
    return Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= days[period];
  });
}
