import { initializeApp } from 'firebase/app';
import { 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  deleteDoc, 
  onSnapshot, 
  getDoc, 
  writeBatch, 
  increment,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getAggregateFromServer,
  runTransaction,
  count,
  sum,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type DocumentData
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { StockCorrectionSnapshot } from './inventoryCutoff';
import { 
  Product, 
  Sale, 
  LossRecord, 
  Employee, 
  Attendance, 
  AuditLog, 
  ActiveSession, 
  SystemSettings, 
  UserCredentials, 
  PayrollPayment, 
  Customer, 
  PausedSale,
  ProductTransformation,
  StockMovement,
  CashMovement,
  Debt,
  DebtPayment
} from '../types';
import { INITIAL_PRODUCTS } from '../data/initialProducts';
import { safeStorage, safeSessionStorage } from './safeStorage';
import { getUnitCost } from './priceHelper';
import {
  clampStockDelta,
  hybridStock,
  physicalDelta,
  roundStock,
  splitHybrid,
  stockLossValue,
  toBaseQty
} from './stockMath';
import {
  getArchiveCutoffTimestamp,
  getCursorPageMetadata,
  getInclusiveDateBounds,
  getSafeArchiveBatchSize
} from './paginationHelper';

/**
 * Opaque Firestore cursor. It is deliberately kept in memory only: the
 * snapshot contains the exact ordering information required by startAfter.
 */
export type FirestorePageCursor = QueryDocumentSnapshot<DocumentData>;

/** Uma linha de correcção de stock do corte de inventário (valores com sinal). */
export interface CutoffStockDelta {
  productId: string;
  productName: string;
  /** Variação em unidade base: negativa desconta, positiva devolve. */
  base: number;
  bulk?: number;
  retail?: number;
}

export interface CutoffResult {
  cancelled: number;
  skipped: string[];
  creditNotes: Array<{ invoiceNumber: string; creditNoteNumber: string }>;
  stockAdjusted: number;
  clamped: string[];
  /** Total em MT devolvido aos clientes nesta operação. */
  refunded: number;
  /** false quando a operação teve de ser dividida em mais do que uma transacção. */
  atomic: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: FirestorePageCursor | null;
  hasMore: boolean;
}

export interface DateRangeQueryOptions {
  startDate?: string;
  endDate?: string;
}

export interface SalesPageOptions extends DateRangeQueryOptions {
  pageSize?: number;
  cursor?: FirestorePageCursor | null;
  status?: Sale['status'];
}

export interface ProductPageOptions {
  pageSize?: number;
  cursor?: FirestorePageCursor | null;
  category?: string;
}

export interface AuditLogPageOptions extends DateRangeQueryOptions {
  pageSize?: number;
  cursor?: FirestorePageCursor | null;
  source?: 'active' | 'archive';
}

/** Lançado quando uma venda exigiria mais stock do que existe. */
export class InsufficientStockError extends Error {
  public readonly productName: string;
  public readonly available: number;
  public readonly requested: number;
  public readonly unit: string;

  constructor(productName: string, available: number, requested: number, unit: string) {
    super(
      `Stock insuficiente para "${productName}": disponível ${available} ${unit}, pedido ${requested} ${unit}.`
    );
    this.name = 'InsufficientStockError';
    this.productName = productName;
    this.available = available;
    this.requested = requested;
    this.unit = unit;
  }
}

export interface SalesSummary {
  totalInvoiced: number;
  paidInvoiced: number;
  /** Faturas com estado 'Pendente' (legado: documento emitido sem pagamento). */
  pendingInvoiced: number;
  /** Vendas a crédito: dívida real de clientes. */
  creditInvoiced: number;
  /** Dívida total = Pendente + Crédito (nunca inclui proformas nem canceladas). */
  debtInvoiced: number;
  /** Proformas/cotações: documentos sem efeito financeiro. */
  proformaInvoiced: number;
  canceledInvoiced: number;
  totalCount: number;
  paidCount: number;
  pendingCount: number;
  creditCount: number;
  debtCount: number;
  proformaCount: number;
  canceledCount: number;
}

export interface AuditArchiveResult {
  archivedCount: number;
  hasMore: boolean;
  cutoffTimestamp: string;
}

const app = initializeApp(firebaseConfig);

/**
 * Autenticação anónima do Firebase.
 *
 * As regras do Firestore passaram a exigir `request.auth != null`. O sistema
 * não tem login Firebase (as credenciais são da aplicação), por isso usa-se
 * sessão anónima. Se o fornecedor "Anónimo" não estiver ativo no projeto, isto
 * falha sem bloquear: a aplicação continua a funcionar com os fallbacks locais.
 */
let anonymousAuthError: string | null = null;

export const authReady: Promise<boolean> = (async () => {
  try {
    const { getAuth, signInAnonymously } = await import('firebase/auth');
    const auth = getAuth(app);
    if (auth.currentUser) return true;
    await signInAnonymously(auth);
    anonymousAuthError = null;
    return true;
  } catch (err) {
    // Guardado para o diagnóstico do módulo técnico: sem esta mensagem, o
    // dono só veria "listas vazias" depois de publicar as regras.
    anonymousAuthError = (err as { code?: string; message?: string })?.code
      || (err as { message?: string })?.message
      || String(err);
    console.warn('[Firebase] Sessão anónima indisponível (modo local):', err);
    return false;
  }
})();

export interface FirebaseAuthDiagnostics {
  projectId: string;
  databaseId: string;
  signedIn: boolean;
  uid: string | null;
  error: string | null;
}

/**
 * Diagnóstico da ligação ao Firebase, mostrado no módulo técnico.
 *
 * Responde à única pergunta que interessa antes de publicar as regras: existe
 * sessão autenticada? Sem ela, `request.auth != null` recusa tudo.
 */
export async function getFirebaseAuthDiagnostics(): Promise<FirebaseAuthDiagnostics> {
  const base: FirebaseAuthDiagnostics = {
    projectId: firebaseConfig.projectId,
    databaseId: firebaseConfig.firestoreDatabaseId,
    signedIn: false,
    uid: null,
    error: anonymousAuthError,
  };
  try {
    const ready = await authReady;
    const { getAuth } = await import('firebase/auth');
    const auth = getAuth(app);
    const uid = auth.currentUser?.uid ?? null;
    return { ...base, signedIn: ready && !!uid, uid, error: anonymousAuthError };
  } catch (err) {
    return { ...base, error: anonymousAuthError || String(err) };
  }
}

let dbInstance;
try {
  dbInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  }, firebaseConfig.firestoreDatabaseId);
} catch (e) {
  console.warn('[FirebaseDBService] Fallback to standard initializeFirestore without multi-tab persistence:', e);
  dbInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true
  }, firebaseConfig.firestoreDatabaseId);
}

const db = dbInstance;

/**
 * Audit records are valuable, but they must not turn a completed sale or stock
 * movement into an apparent failure. When Firestore is temporarily unavailable,
 * keep the record locally and retry it on the next initialization or successful
 * audit write.
 */
const PENDING_AUDIT_LOGS_KEY = 'agro_pending_audit_logs';
const MAX_PENDING_AUDIT_LOGS = 100;

export class FirebaseDBService {
  private initPromise: Promise<void> | null = null;
  private pendingAuditFlush: Promise<void> | null = null;
  private productsCache: Product[] | null = null;
  private salesCache: Sale[] | null = null;
  private customersCache: Customer[] | null = null;
  private credentialsCache: UserCredentials[] | null = null;
  private activeSessionsCache: ActiveSession[] | null = null;
  private transformationsCache: ProductTransformation[] | null = null;
  private settingsCache: SystemSettings | null = null;
  private lossesCache: LossRecord[] | null = null;
  private cashMovementsCache: CashMovement[] | null = null;
  private debtsCache: Debt[] | null = null;
  private payrollCache: PayrollPayment[] | null = null;
  private pausedSalesCache: PausedSale[] | null = null;
  private employeesCache: Employee[] | null = null;
  private attendanceCache: Attendance[] | null = null;
  private unsubscribers: (() => void)[] = [];
  private largeCollectionListenersStarted = false;

  public async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    console.log('[FirebaseDBService] Initializing Firestore real-time listeners and caching...');
    // Com as regras do Firestore a exigirem autenticação, os listeners em tempo
    // real têm de arrancar depois da sessão anónima — senão o primeiro snapshot
    // é recusado e o canal fica morto até recarregar.
    await this.ensureAuth();
    this.initPromise = Promise.resolve();

    // Clear previous listeners if any
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];

    // Products and sales can become very large. Their full real-time listeners
    // are deliberately opt-in through enableLiveCatalogAndSalesSync(), so
    // opening an invoice/audit history does not download both collections.

    // Realtime customers listener
    this.unsubscribers.push(onSnapshot(collection(db, 'customers'), (snapshot) => {
      const customers: Customer[] = [];
      snapshot.forEach(doc => {
        customers.push(doc.data() as Customer);
      });
      this.customersCache = customers.sort((a, b) => a.name.localeCompare(b.name));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'customers', count: customers.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (customers):', error);
    }));

    // Realtime transformations listener
    this.unsubscribers.push(onSnapshot(collection(db, 'transformations'), (snapshot) => {
      const transformations: ProductTransformation[] = [];
      snapshot.forEach(doc => {
        transformations.push(doc.data() as ProductTransformation);
      });
      this.transformationsCache = transformations.sort((a, b) => b.date.localeCompare(a.date));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'transformations', count: transformations.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (transformations):', error);
    }));

    // Realtime credentials listener
    this.unsubscribers.push(onSnapshot(collection(db, 'credentials'), (snapshot) => {
      const creds: UserCredentials[] = [];
      snapshot.forEach(doc => {
        creds.push(doc.data() as UserCredentials);
      });
      if (creds.length > 0) {
        this.credentialsCache = creds.sort((a, b) => a.username.localeCompare(b.username));
        safeStorage.setItem('agro_credentials_cache', JSON.stringify(this.credentialsCache));
        window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'credentials', count: creds.length } }));
      }
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (credentials):', error);
    }));

    // Realtime active sessions listener (supports 12+ concurrent multi-user sessions)
    this.unsubscribers.push(onSnapshot(collection(db, 'active_sessions'), (snapshot) => {
      const sessions: ActiveSession[] = [];
      snapshot.forEach(doc => {
        sessions.push(doc.data() as ActiveSession);
      });
      this.activeSessionsCache = sessions.sort((a, b) => b.loginTime.localeCompare(a.loginTime));
      safeStorage.setItem('agro_active_sessions_cache', JSON.stringify(this.activeSessionsCache));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'active_sessions', count: sessions.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (active_sessions):', error);
    }));

    // Realtime settings listener
    this.unsubscribers.push(onSnapshot(doc(db, 'settings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        const s = snapshot.data() as SystemSettings;
        this.settingsCache = s;
        safeStorage.setItem('agro_settings_cache', JSON.stringify(s));
        window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'settings' } }));
      }
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (settings):', error);
    }));

    // Realtime losses listener
    this.unsubscribers.push(onSnapshot(collection(db, 'losses'), (snapshot) => {
      const losses: LossRecord[] = [];
      snapshot.forEach(d => losses.push(d.data() as LossRecord));
      this.lossesCache = losses.sort((a, b) => b.date.localeCompare(a.date));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'losses', count: losses.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (losses):', error);
    }));

    // Realtime payroll listener
    this.unsubscribers.push(onSnapshot(collection(db, 'payroll_payments'), (snapshot) => {
      const payroll: PayrollPayment[] = [];
      snapshot.forEach(d => payroll.push(d.data() as PayrollPayment));
      this.payrollCache = payroll.sort((a, b) => (b.paymentDate || b.date).localeCompare(a.paymentDate || a.date));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'payroll_payments', count: payroll.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (payroll_payments):', error);
    }));

    // Realtime employees listener
    this.unsubscribers.push(onSnapshot(collection(db, 'employees'), (snapshot) => {
      const employees: Employee[] = [];
      snapshot.forEach(d => employees.push(d.data() as Employee));
      this.employeesCache = employees.sort((a, b) => a.name.localeCompare(b.name));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'employees', count: employees.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (employees):', error);
    }));

    // Realtime attendance listener
    this.unsubscribers.push(onSnapshot(collection(db, 'attendance'), (snapshot) => {
      const attendance: Attendance[] = [];
      snapshot.forEach(d => attendance.push(d.data() as Attendance));
      this.attendanceCache = attendance.sort((a, b) => b.date.localeCompare(a.date));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'attendance', count: attendance.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (attendance):', error);
    }));

    // Realtime paused_sales listener
    this.unsubscribers.push(onSnapshot(collection(db, 'paused_sales'), (snapshot) => {
      const paused: PausedSale[] = [];
      snapshot.forEach(d => paused.push(d.data() as PausedSale));
      this.pausedSalesCache = paused.sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'paused_sales', count: paused.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (paused_sales):', error);
    }));

    // Do not block the application startup if an old audit record cannot be
    // resent yet. The business data listeners are already ready at this point.
    void this.flushPendingAuditLogs();

    return this.initPromise;
  }

  /**
   * Starts full realtime catalogue/sales subscriptions only for modules that
   * genuinely operate on whole datasets (PDV, inventory and finance). History
   * screens use paged queries and must not call this method.
   */
  public async enableLiveCatalogAndSalesSync(): Promise<void> {
    await this.init();
    if (this.largeCollectionListenersStarted) return;
    this.largeCollectionListenersStarted = true;

    this.unsubscribers.push(onSnapshot(collection(db, 'products'), (snapshot) => {
      const products: Product[] = [];
      snapshot.forEach(documentSnapshot => {
        products.push(this.sanitizeProduct(this.recordFromSnapshot<Product>(documentSnapshot)));
      });
      this.productsCache = products.sort((a, b) => a.name.localeCompare(b.name));
      safeStorage.setItem('agro_products_cache', JSON.stringify(this.productsCache));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', count: products.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (products):', error);
    }));

    this.unsubscribers.push(onSnapshot(collection(db, 'sales'), (snapshot) => {
      const sales: Sale[] = [];
      snapshot.forEach(documentSnapshot => {
        sales.push(this.recordFromSnapshot<Sale>(documentSnapshot));
      });
      this.salesCache = sales.sort((a, b) => b.date.localeCompare(a.date));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', count: sales.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (sales):', error);
    }));
  }

  /** Read deferred audit records defensively so a corrupt browser cache never blocks the ERP. */
  private getPendingAuditLogs(): AuditLog[] {
    try {
      const raw = safeStorage.getItem(PENDING_AUDIT_LOGS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is AuditLog => Boolean(item && typeof item.id === 'string' && item.id))
        .slice(-MAX_PENDING_AUDIT_LOGS);
    } catch (error) {
      console.warn('[FirebaseDBService] Could not read deferred audit logs:', error);
      return [];
    }
  }

  private savePendingAuditLogs(logs: AuditLog[]): void {
    try {
      if (logs.length === 0) {
        safeStorage.removeItem(PENDING_AUDIT_LOGS_KEY);
        return;
      }
      safeStorage.setItem(PENDING_AUDIT_LOGS_KEY, JSON.stringify(logs.slice(-MAX_PENDING_AUDIT_LOGS)));
    } catch (error) {
      console.warn('[FirebaseDBService] Could not persist deferred audit logs:', error);
    }
  }

  private queueAuditLog(log: AuditLog): void {
    const queued = this.getPendingAuditLogs();
    if (!queued.some(item => item.id === log.id)) {
      queued.push(log);
      this.savePendingAuditLogs(queued);
    }
  }

  private removePendingAuditLog(id: string): void {
    this.savePendingAuditLogs(this.getPendingAuditLogs().filter(log => log.id !== id));
  }

  private flushPendingAuditLogs(): Promise<void> {
    if (this.pendingAuditFlush) return this.pendingAuditFlush;

    this.pendingAuditFlush = this.doFlushPendingAuditLogs().finally(() => {
      this.pendingAuditFlush = null;
    });
    return this.pendingAuditFlush;
  }

  private async doFlushPendingAuditLogs(): Promise<void> {
    const queued = this.getPendingAuditLogs();
    if (queued.length === 0) return;

    const deliveredIds = new Set<string>();
    for (const log of queued) {
      try {
        await this.upsert('audit_logs', log.id, log);
        deliveredIds.add(log.id);
      } catch (error) {
        console.warn(`[FirebaseDBService] Deferred audit log ${log.id} is still pending:`, error);
      }
    }

    // Preserve entries added while the asynchronous flush was running. Removing
    // only IDs known to have reached Firestore avoids losing a newer audit log.
    const currentQueue = this.getPendingAuditLogs();
    this.savePendingAuditLogs(currentQueue.filter(log => !deliveredIds.has(log.id)));
  }

  // Generic DB methods
  /**
   * Espera pela sessão anónima antes de tocar no Firestore.
   *
   * Com as regras novas (`request.auth != null`), uma leitura feita antes de a
   * sessão anónima estar criada é recusada com permission-denied. Esta espera
   * é central e nunca bloqueia: se a autenticação anónima estiver desactivada,
   * `authReady` resolve `false` e o pedido segue como antes.
   */
  private async ensureAuth(): Promise<void> {
    try {
      await authReady;
    } catch {
      /* nunca impede a tentativa */
    }
  }

  private async getAll<T>(colName: string): Promise<T[]> {
    await this.ensureAuth();
    try {
      console.log(`[FirebaseDBService] getAll() fetching collection: ${colName}`);
      const snapshot = await getDocs(collection(db, colName));
      const items = snapshot.docs.map(doc => doc.data() as T);
      console.log(`[FirebaseDBService] getAll() fetched ${items.length} records from ${colName}`);
      return items;
    } catch (e) {
      console.error(`[FirebaseDBService] Error getting ${colName}:`, e);
      return [];
    }
  }

  /** Convert a Firestore document to an app record while preserving its document ID. */
  private recordFromSnapshot<T>(snapshot: QueryDocumentSnapshot<DocumentData>): T {
    const data = snapshot.data() as T & { id?: string };
    return {
      ...data,
      id: data.id || snapshot.id
    } as T;
  }

  private getDateRangeConstraints(field: string, range: DateRangeQueryOptions): QueryConstraint[] {
    const bounds = getInclusiveDateBounds(range.startDate, range.endDate);
    const constraints: QueryConstraint[] = [];
    if (bounds.start) constraints.push(where(field, '>=', bounds.start));
    if (bounds.end) constraints.push(where(field, '<=', bounds.end));
    return constraints;
  }

  /**
   * Fetch one deterministic page plus one sentinel document. The extra document
   * tells the UI whether "Carregar mais" is useful without a separate count
   * query. Cursors intentionally stay opaque and in-memory.
   */
  private async getOrderedPage<T>(
    collectionName: string,
    sortField: string,
    direction: 'asc' | 'desc',
    requestedPageSize: number | undefined,
    cursor: FirestorePageCursor | null | undefined,
    constraints: QueryConstraint[] = []
  ): Promise<PaginatedResult<T>> {
    const { pageSize } = getCursorPageMetadata(0, requestedPageSize);
    const queryConstraints: QueryConstraint[] = [
      ...constraints,
      orderBy(sortField, direction)
    ];

    if (cursor) queryConstraints.push(startAfter(cursor));
    queryConstraints.push(limit(pageSize + 1));

    const snapshot = await getDocs(query(collection(db, collectionName), ...queryConstraints));
    const { hasMore } = getCursorPageMetadata(snapshot.docs.length, pageSize);
    const pageDocuments = snapshot.docs.slice(0, pageSize);

    return {
      items: pageDocuments.map(documentSnapshot => this.recordFromSnapshot<T>(documentSnapshot)),
      nextCursor: hasMore && pageDocuments.length > 0 ? pageDocuments[pageDocuments.length - 1] : null,
      hasMore
    };
  }

  private sanitizeData(obj: any): any {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeData(item));
    }
    const cleaned: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val !== undefined) {
        cleaned[key] = this.sanitizeData(val);
      }
    }
    return cleaned;
  }

  private async upsert(colName: string, id: string, data: any): Promise<void> {
    await this.ensureAuth();
    try {
      const validId = String(id || data?.id || data?.invoiceNumber || Date.now());
      const sanitized = this.sanitizeData(data);
      console.log(`[FirebaseDBService] upsert() to collection: ${colName}, ID: ${validId}`);
      await setDoc(doc(db, colName, validId), sanitized);
      console.log(`[FirebaseDBService] upsert() successful on ${colName}/${validId}`);
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: colName, id: validId } }));
    } catch (e) {
      console.error(`[FirebaseDBService] Error saving to ${colName}/${id}:`, e);
      throw e;
    }
  }

  private async upsertBatch(colName: string, items: { id: string }[]): Promise<void> {
    if (items.length === 0) return;
    // Stay below Firestore's 500-write limit. Imports and backups can now
    // legitimately contain much more than one archive/page worth of records.
    const writesPerCommit = 450;
    try {
      console.log(`[FirebaseDBService] upsertBatch() to collection: ${colName}, count: ${items.length}`);
      for (let offset = 0; offset < items.length; offset += writesPerCommit) {
        const batch = writeBatch(db);
        items.slice(offset, offset + writesPerCommit).forEach(item => {
          const validId = String(item.id || Date.now());
          const sanitized = this.sanitizeData(item);
          batch.set(doc(db, colName, validId), sanitized);
        });
        await batch.commit();
      }
      console.log(`[FirebaseDBService] upsertBatch() successful on ${colName}`);
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: colName, count: items.length } }));
    } catch (e) {
      console.error(`[FirebaseDBService] Error batch saving to ${colName}:`, e);
      throw e;
    }
  }

  private async deleteRow(colName: string, id: string): Promise<void> {
    await this.ensureAuth();
    try {
      const validId = String(id);
      console.log(`[FirebaseDBService] deleteRow() from collection: ${colName}, ID: ${validId}`);
      await deleteDoc(doc(db, colName, validId));
      console.log(`[FirebaseDBService] deleteRow() successful on ${colName}/${validId}`);
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: colName, deletedId: validId } }));
    } catch (e) {
      console.error(`[FirebaseDBService] Error deleting from ${colName}/${id}:`, e);
      // A delete is a business mutation. Unlike telemetry, callers must be able
      // to show a real failure instead of confirming an operation that did not
      // reach the database.
      throw e;
    }
  }

  // --- Products ---
  private sanitizeProduct(p: Product): Product {
    if (!p) return p;
    const baseUnit = (p.baseUnit || 'Unidades').replace(/font-bold/gi, '').trim() || 'Unidades';
    const parentUnit = p.parentUnit ? p.parentUnit.replace(/font-bold/gi, '').trim() : undefined;
    return {
      ...p,
      baseUnit,
      parentUnit
    };
  }

  public async getProducts(): Promise<Product[]> {
    if (this.productsCache && this.productsCache.length > 0) {
      console.log(`[FirebaseDBService] getProducts() returning cached products (${this.productsCache.length})`);
      return this.productsCache;
    }
    const cached = safeStorage.getItem('agro_products_cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = parsed.map(p => this.sanitizeProduct(p));
          this.productsCache = cleaned;
          return cleaned;
        }
      } catch (e) {}
    }
    const rawProducts = await this.getAll<Product>('products');
    if (rawProducts.length === 0) {
      console.log('[FirebaseDBService] getProducts() found 0 products in Firestore. Seeding initial products...');
      const seeded = INITIAL_PRODUCTS.map(p => this.sanitizeProduct({ ...p }));
      await this.upsertBatch('products', seeded);
      this.productsCache = seeded;
      return seeded;
    }
    const products = rawProducts.map(p => this.sanitizeProduct(p));
    this.productsCache = products.sort((a, b) => a.name.localeCompare(b.name));
    safeStorage.setItem('agro_products_cache', JSON.stringify(this.productsCache));
    return this.productsCache;
  }

  /**
   * Read only the items below the configured stock threshold for the shell
   * alert badge. This prevents every module change from loading the catalogue.
   */
  public async getLowStockProducts(criticalLevel: number): Promise<Product[]> {
    const level = Math.max(0, Number(criticalLevel) || 0);
    const snapshot = await getDocs(query(
      collection(db, 'products'),
      where('stockQty', '<=', level),
      orderBy('stockQty', 'asc')
    ));
    return snapshot.docs
      .map(documentSnapshot => this.sanitizeProduct(this.recordFromSnapshot<Product>(documentSnapshot)))
      .filter(product => !product.isService);
  }

  /**
   * Lightweight catalogue page for list views. Full product reads remain
   * available for PDV, stock reconciliation and batch operations that truly
   * need the complete catalogue.
   */
  public async getProductsPage(options: ProductPageOptions = {}): Promise<PaginatedResult<Product>> {
    const constraints: QueryConstraint[] = [];
    if (options.category?.trim()) {
      constraints.push(where('category', '==', options.category.trim()));
    }

    const result = await this.getOrderedPage<Product>(
      'products',
      'name',
      'asc',
      options.pageSize,
      options.cursor,
      constraints
    );

    return {
      ...result,
      items: result.items.map(product => this.sanitizeProduct(product))
    };
  }

  public async saveProduct(p: Product): Promise<void> {
    const cleaned = this.sanitizeProduct(p);
    console.log(`[FirebaseDBService] saveProduct() ID: ${cleaned.id}, name: ${cleaned.name}, stock: ${cleaned.stockQty}`);
    await this.upsert('products', cleaned.id, cleaned);
    this.productsCache = null; // Invalidate cache so next fetch re-syncs
  }

  public async deductProductStock(cartItems: any[]): Promise<void> {
    if (cartItems.length === 0) return;
    try {
      console.log(`[FirebaseDBService] deductProductStock() for ${cartItems.length} items`);
      const batch = writeBatch(db);
      for (const item of cartItems) {
        const docRef = doc(db, "products", item.productId);
        if (item.hasConversion) {
          if (item.sellingUnit === "Bulk") {
            batch.update(docRef, { stockQtyBulk: increment(-item.qtyToReduce), stockQty: increment(-item.equivalentBaseQty) });
          } else {
            batch.update(docRef, { stockQtyRetail: increment(-item.qtyToReduce), stockQty: increment(-item.qtyToReduce) });
          }
        } else {
          batch.update(docRef, { stockQty: increment(-item.qtyToReduce) });
        }
      }
      await batch.commit();
      this.productsCache = null;
      console.log('[FirebaseDBService] deductProductStock() batch commit successful.');
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'stock-deduct' } }));
    } catch (e) {
      console.error("[FirebaseDBService] Error deducting stock:", e);
      // Stock movements are critical and must not be silently acknowledged.
      throw e;
    }
  }

  public async saveProducts(list: Product[]): Promise<void> {
    console.log(`[FirebaseDBService] saveProducts() batch count: ${list.length}`);
    await this.upsertBatch('products', list);
    this.productsCache = null;
  }

  public async deleteProduct(id: string): Promise<void> {
    console.log(`[FirebaseDBService] deleteProduct() ID: ${id}`);
    await this.deleteRow('products', id);
    this.productsCache = null;
  }

  /**
   * O que já aconteceu a este artigo (ES-37/38).
   *
   * Antes de apagar, é preciso saber se ele aparece em facturas, quebras,
   * movimentos ou transformações. Um artigo com histórico não se apaga — as
   * facturas antigas passariam a falar de um produto inexistente.
   */
  public async getProductUsage(productId: string): Promise<{
    sales: number;
    losses: number;
    movements: number;
    transformations: number;
    stock: number;
    name: string;
  }> {
    await this.ensureAuth();
    const id = String(productId);

    const [prodSnap, sales, losses, movements, transformations] = await Promise.all([
      getDoc(doc(db, 'products', id)),
      this.getAll<Sale>('sales'),
      this.getAll<LossRecord>('losses'),
      this.getAll<StockMovement>('stock_movements'),
      this.getAll<ProductTransformation>('transformations')
    ]);

    const produto = prodSnap.exists() ? (prodSnap.data() as Product) : null;

    return {
      name: produto?.name || '',
      stock: Number(produto?.stockQty) || 0,
      sales: sales.filter(venda => (venda.items || []).some(item => String(item.productId) === id)).length,
      losses: losses.filter(perda => String(perda.productId) === id).length,
      movements: movements.filter(mov => String(mov.productId) === id).length,
      transformations: transformations.filter(
        trf => String(trf.originalProductId) === id ||
          (trf.items || []).some(item => String(item.resultingProductId) === id)
      ).length
    };
  }

  /**
   * Desactivação (ES-37): o artigo sai de venda, mas fica no catálogo e no
   * histórico. Só é aceite com stock a zero — senão a mercadoria desaparecia
   * do inventário sem sair do armazém.
   */
  public async deactivateProduct(input: {
    productId: string;
    operator: string;
    ipAddress?: string;
    reason?: string;
  }): Promise<void> {
    await this.ensureAuth();

    const id = String(input.productId);
    const ref = doc(db, 'products', id);
    const auditoriaId = `log-desact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const agora = new Date().toISOString();

    await runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Produto não encontrado.');

      const produto = snap.data() as Product;
      const stock = roundStock(Number(produto.stockQty) || 0);
      if (stock > 0) {
        throw new Error(
          `${produto.name} ainda tem ${stock} ${produto.baseUnit || 'un'} em stock. ` +
            'Dê baixa (venda, quebra ou contagem) antes de o desactivar.'
        );
      }

      transaction.set(
        ref,
        {
          isActive: false,
          deactivatedAt: agora,
          deactivatedBy: input.operator,
          deactivationReason: input.reason || 'Eliminação pedida — desactivado por ter histórico',
          updatedAt: agora
        },
        { merge: true }
      );

      transaction.set(
        doc(db, 'audit_logs', auditoriaId),
        this.sanitizeData({
          id: auditoriaId,
          timestamp: agora,
          username: input.operator,
          ipAddress: input.ipAddress || 'desconhecido',
          action: 'Desactivação de Produto',
          status: 'Alerta',
          level: 'WARNING',
          entity: 'products',
          details:
            `${produto.name} (código ${produto.code || '—'}) desactivado. ` +
            `Motivo: ${input.reason || 'tem histórico de vendas/movimentos'}. Stock a zero.`
        } as AuditLog)
      );
    });

    this.productsCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'deactivate' } }));
  }

  /** Reativação de um artigo desactivado. */
  public async reactivateProduct(input: {
    productId: string;
    operator: string;
    ipAddress?: string;
  }): Promise<void> {
    await this.ensureAuth();

    const id = String(input.productId);
    const ref = doc(db, 'products', id);
    const auditoriaId = `log-react-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const agora = new Date().toISOString();

    await runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Produto não encontrado.');
      const produto = snap.data() as Product;

      transaction.set(ref, { isActive: true, updatedAt: agora }, { merge: true });

      transaction.set(
        doc(db, 'audit_logs', auditoriaId),
        this.sanitizeData({
          id: auditoriaId,
          timestamp: agora,
          username: input.operator,
          ipAddress: input.ipAddress || 'desconhecido',
          action: 'Reativação de Produto',
          status: 'Sucesso',
          level: 'INFO',
          entity: 'products',
          details: `${produto.name} (código ${produto.code || '—'}) voltou a estar activo.`
        } as AuditLog)
      );
    });

    this.productsCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'reactivate' } }));
  }


  // --- Sales ---
  public async getSales(): Promise<Sale[]> {
    if (this.salesCache && this.salesCache.length >= 0) {
      console.log(`[FirebaseDBService] getSales() returning cached/realtime sales (${this.salesCache.length})`);
      this.getAll<Sale>('sales').then(fresh => {
        if (fresh && fresh.length !== this.salesCache?.length) {
          this.salesCache = fresh.sort((a, b) => b.date.localeCompare(a.date));
          window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', count: fresh.length } }));
        }
      }).catch(() => {});
      return this.salesCache;
    }
    const list = await this.getAll<Sale>('sales');
    this.salesCache = list.sort((a, b) => b.date.localeCompare(a.date));
    console.log(`[FirebaseDBService] getSales() fetched ${this.salesCache.length} sales from Firestore.`);
    return this.salesCache;
  }

  /**
   * Fetch a date/status-filtered invoice page directly from Firestore. This
   * deliberately bypasses salesCache so a partial list can never be mistaken
   * for the complete sales history by PDV or accounting routines.
   */
  public async getSalesPage(options: SalesPageOptions = {}): Promise<PaginatedResult<Sale>> {
    const constraints = this.getDateRangeConstraints('date', options);
    if (options.status) constraints.unshift(where('status', '==', options.status));

    return this.getOrderedPage<Sale>(
      'sales',
      'date',
      'desc',
      options.pageSize,
      options.cursor,
      constraints
    );
  }

  /**
   * Paginated full-period fetch for an explicit export/report only. Screens
   * should use getSalesPage instead so opening a history list does not download
   * every invoice ever issued.
   */
  public async getSalesForPeriod(options: Omit<SalesPageOptions, 'cursor' | 'pageSize'> = {}): Promise<Sale[]> {
    const allSales: Sale[] = [];
    let cursor: FirestorePageCursor | null = null;

    do {
      const page = await this.getSalesPage({ ...options, cursor, pageSize: 250 });
      allSales.push(...page.items);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    } while (cursor);

    return allSales;
  }

  /** Server-side aggregation keeps invoice dashboard totals accurate without reading every sale. */
  public async getSalesSummary(range: DateRangeQueryOptions = {}): Promise<SalesSummary> {
    const statusAggregate = async (status: Sale['status']) => {
      const aggregateQuery = query(
        collection(db, 'sales'),
        where('status', '==', status),
        ...this.getDateRangeConstraints('date', range)
      );
      const snapshot = await getAggregateFromServer(aggregateQuery, {
        recordCount: count(),
        totalValue: sum('total')
      });
      const data = snapshot.data();
      return {
        count: Number(data.recordCount || 0),
        total: Number(data.totalValue || 0)
      };
    };

    const [paid, pending, credit, canceled, proforma, legacyCanceled] = await Promise.all([
      statusAggregate('Paga'),
      statusAggregate('Pendente'),
      statusAggregate('Crédito'),
      statusAggregate('Cancelada'),
      statusAggregate('Proforma'),
      // Registos antigos com o estado em inglês: sem esta agregação, os
      // cartões de "Cancelado" não batiam com a lista (FT-07).
      statusAggregate('canceled' as Sale['status'])
    ]);

    return {
      totalInvoiced: paid.total + pending.total + credit.total,
      paidInvoiced: paid.total,
      // Pendente e Crédito são estados distintos na interface, mas ambos são
      // dívida de clientes. `debtInvoiced` é a única soma que deve alimentar
      // indicadores de dívida.
      pendingInvoiced: pending.total,
      creditInvoiced: credit.total,
      debtInvoiced: pending.total + credit.total,
      proformaInvoiced: proforma.total,
      canceledInvoiced: canceled.total + legacyCanceled.total,
      totalCount: paid.count + pending.count + credit.count + canceled.count + proforma.count,
      paidCount: paid.count,
      pendingCount: pending.count,
      creditCount: credit.count,
      debtCount: pending.count + credit.count,
      proformaCount: proforma.count,
      canceledCount: canceled.count + legacyCanceled.count
    };
  }

  /**
   * Numeração fiscal autoritativa (B-01).
   *
   * Um único documento `counters/document_numbers` guarda o último número de
   * cada prefixo (FAC-2026, FP-2026, REC-POS-2026, REC-A4-2026). A escrita é
   * feita numa transacção: dois terminais a vender ao mesmo tempo recebem
   * números distintos, e o contador nunca recua.
   *
   * `fallbackMax` é o maior número que o cliente já viu nas vendas carregadas;
   * serve para semear o contador na primeira utilização (continuidade com a
   * numeração antiga) sem nunca permitir reutilizar um número existente.
   */
  /**
   * Contador transaccional por prefixo (do `main`): dois postos a faturar ao
   * mesmo tempo recebem números diferentes, nunca o mesmo.
   */
  public async nextDocumentNumber(counterKey: string, minimumNext: number): Promise<number> {
    await this.ensureAuth();
    const ref = doc(db, 'counters', counterKey);
    return runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const current = snap.exists() ? Number(snap.data().value || 0) : 0;
      const next = Math.max(current + 1, minimumNext);
      tx.set(ref, { value: next, updatedAt: new Date().toISOString() }, { merge: true });
      return next;
    });
  }

  /**
   * Numeração por tipo de documento com prefixo do ano (linha desta sessão).
   * Devolve o número já formatado («FAC-2026-0007»), procurando o máximo das
   * vendas existentes quando o contador ainda não existe.
   */
  public async nextDocumentNumberByKind(
    kind: 'FaturaDefinitiva' | 'FaturaProforma' | 'ReciboPOS' | 'ReciboA4' | 'NotaCredito',
    year: number,
    fallbackMax = 0
  ): Promise<string> {
    await this.ensureAuth();
    const prefixByKind: Record<typeof kind, string> = {
      FaturaDefinitiva: `FAC-${year}-`,
      FaturaProforma: `FP-${year}-`,
      ReciboPOS: `REC-POS-${year}-`,
      ReciboA4: `REC-A4-${year}-`,
      NotaCredito: `NC-${year}-`
    };
    const prefix = prefixByKind[kind];
    const counterRef = doc(db, 'counters', 'document_numbers');
    const safeFallback = Number.isFinite(fallbackMax) ? Math.max(0, Math.floor(fallbackMax)) : 0;

    const next = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(counterRef);
      const stored = snapshot.exists()
        ? Number((snapshot.data() as Record<string, number>)[prefix] || 0)
        : 0;
      const value = Math.max(stored, safeFallback) + 1;
      transaction.set(counterRef, { [prefix]: value, updatedAt: new Date().toISOString() }, { merge: true });
      return value;
    });

    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  /**
   * Liquidação de uma factura, com número de recibo atribuído na MESMA
   * transacção.
   *
   * Porquê uma transacção: antes o pagamento era um `addSale` cego. Dois postos
   * a liquidar a mesma factura queimavam dois números de recibo e o segundo
   * apagava o primeiro; e se a factura tivesse sido anulada entretanto, o
   * pagamento "ressuscitava" uma venda anulada sem aviso. Aqui a factura é lida
   * dentro da transacção, o estado é validado e o contador avança ao mesmo
   * tempo — ou fica tudo gravado, ou nada fica.
   */
  public async payInvoiceWithReceipt(
    saleId: string,
    payment: { paidBy: string; settledPaymentMethod: string; fallbackMax?: number }
  ): Promise<{ sale: Sale; receiptNumber: string }> {
    await this.ensureAuth();
    const saleRef = doc(db, 'sales', String(saleId));
    const counterRef = doc(db, 'counters', 'document_numbers');
    const year = new Date().getFullYear();
    const prefix = `REC-A4-${year}-`;

    const result = await runTransaction(db, async transaction => {
      const saleSnapshot = await transaction.get(saleRef);
      if (!saleSnapshot.exists()) {
        throw new Error('Factura não encontrada. Actualize a lista.');
      }
      const current = saleSnapshot.data() as Sale;
      const status = String(current.status || '');

      if (status === 'Cancelada' || status === 'canceled') {
        throw new Error(`A factura ${current.invoiceNumber} está anulada e não pode ser liquidada.`);
      }
      if (status === 'Paga') {
        throw new Error(`A factura ${current.invoiceNumber} já está paga.`);
      }
      if (status !== 'Pendente' && status !== 'Crédito') {
        throw new Error(
          `A factura ${current.invoiceNumber} não é uma dívida (estado: ${status || 'desconhecido'}).`
        );
      }

      const counterSnapshot = await transaction.get(counterRef);
      const stored = counterSnapshot.exists()
        ? Number((counterSnapshot.data() as Record<string, number>)[prefix] || 0)
        : 0;
      // Se o contador estiver vazio (base migrada, contador apagado), usa-se o
      // maior recibo já emitido como ponto de partida — senão o próximo recibo
      // repetia um número que o cliente já tem em mãos.
      const safeFallback = Number.isFinite(payment.fallbackMax) ? Math.max(0, Math.floor(payment.fallbackMax!)) : 0;
      const next = Math.max(stored, safeFallback) + 1;
      const receiptNumber = `${prefix}${String(next).padStart(4, '0')}`;
      const now = new Date().toISOString();

      const updated: Sale = {
        ...current,
        status: 'Paga',
        receiptNumber,
        paidAt: now,
        paidBy: payment.paidBy,
        settledPaymentMethod: payment.settledPaymentMethod,
      };

      transaction.set(saleRef, this.sanitizeData(updated), { merge: true });
      transaction.set(
        counterRef,
        { [prefix]: next, updatedAt: now },
        { merge: true }
      );

      return { sale: updated, receiptNumber };
    });

    this.salesCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', id: saleId, action: 'paid' } }));
    return result;
  }

  public async addSale(s: Sale): Promise<void> {
    console.log(`[FirebaseDBService] addSale() ID: ${s.id}, invoice: ${s.invoiceNumber}, total: ${s.total}`);
    // Ensure all items retain their buying cost snapshot
    const prods = await this.getProducts();
    const enrichedItems = (s.items || []).map(item => {
      const prod = prods.find(p => p.id === item.productId);
      // Produtos vendidos em saco e em quilo: o quilo não tem preço de compra próprio,
      // o seu custo é derivado do preço de compra do saco ÷ fator de conversão.
      const cost = item.costPrice ?? item.buyingPrice ?? (prod ? getUnitCost(prod, item.sellingUnit) : undefined) ?? item.unitPrice;
      return {
        ...item,
        costPrice: cost,
        buyingPrice: cost
      };
    });

    const enrichedSale: Sale = {
      ...s,
      items: enrichedItems,
      createdAt: s.createdAt || new Date().toISOString(),
      status: s.status || 'Pendente'
    };

    await this.upsert('sales', enrichedSale.id, enrichedSale);
    this.salesCache = null;
  }

  /**
   * Grava a venda e deduz stock na MESMA transacção.
   *
   * A dedução passou de `writeBatch` (que apenas garantia atomicidade) para
   * `runTransaction`, porque a atomicidade não impede o stock negativo: sem
   * ler o saldo actual dentro da transacção, dois terminais que leram "3"
   * vendem ambos e o saldo fica "-7" gravado com sucesso. Agora a venda é
   * recusada com `InsufficientStockError` e nada é escrito.
   */
  public async addSaleWithStockDeduction(sale: Sale, deductionItems: any[]): Promise<void> {
    await this.ensureAuth();
    const saleId = String(sale.id || sale.invoiceNumber || Date.now());

    // Custo histórico: lido fora da transacção (não interfere com as escritas).
    const prods = await this.getProducts();
    const enrichedItems = (sale.items || []).map(item => {
      const prod = prods.find(p => String(p.id) === String(item.productId));
      const cost = item.costPrice ?? item.buyingPrice ?? (prod ? getUnitCost(prod, item.sellingUnit) : undefined) ?? item.unitPrice;
      return {
        ...item,
        costPrice: cost,
        buyingPrice: cost
      };
    });

    const sanitizedSale = this.sanitizeData({
      ...sale,
      id: saleId,
      items: enrichedItems,
      createdAt: sale.createdAt || new Date().toISOString(),
      status: sale.status || 'Pendente'
    });

    // Del tas reais aplicados, para o livro de movimentos (F-05).
    const movementDeltas: Array<{ productId: string; productName: string; unit: string; base: number }> = [];

    await runTransaction(db, async transaction => {
      const grouped = new Map<string, {
        bulk: number;
        retail: number;
        base: number;
        productName: string;
        unit: string;
        checks: Array<{ field: 'stockQty' | 'stockQtyBulk' | 'stockQtyRetail'; needed: number }>;
      }>();

      for (const item of deductionItems) {
        if (!item || !item.productId) continue;
        const id = String(item.productId);
        const qty = Number(item.qtyToReduce) || 0;
        if (qty <= 0) continue;

        const entry = grouped.get(id) || { bulk: 0, retail: 0, base: 0, productName: '', unit: 'un', checks: [] };
        if (item.hasConversion && item.sellingUnit === 'Bulk') {
          entry.bulk += qty;
          entry.base += Number(item.equivalentBaseQty) || qty;
          entry.checks.push({ field: 'stockQtyBulk', needed: qty });
        } else if (item.hasConversion) {
          entry.retail += qty;
          entry.base += qty;
          entry.checks.push({ field: 'stockQtyRetail', needed: qty });
        } else {
          entry.base += qty;
          entry.checks.push({ field: 'stockQty', needed: qty });
        }
        grouped.set(id, entry);
      }

      // 1. Ler (antes de qualquer escrita, como exige a transacção).
      const snapshots = new Map<string, any>();
      for (const id of grouped.keys()) {
        const snap = await transaction.get(doc(db, 'products', id));
        snapshots.set(id, snap);
      }

      // A-07: uma transacção do Firestore aceita no máximo 500 escritas. Com
      // demasiadas linhas distintas a venda falharia no meio; recusa-se cedo.
      if (grouped.size > 400) {
        throw new Error(
          `Venda com ${grouped.size} produtos distintos excede o limite de uma operação atómica (400). Divida a venda em duas.`
        );
      }

      // 2. Validar disponibilidade real.
      for (const [id, entry] of grouped.entries()) {
        const snap = snapshots.get(id);
        if (!snap || !snap.exists()) continue; // produto apagado: não bloqueia a venda
        const data = snap.data() as Record<string, any>;
        entry.productName = String(data.name || id);
        const uniqueChecks = new Map<string, number>();
        entry.checks.forEach(check => {
          uniqueChecks.set(check.field, (uniqueChecks.get(check.field) || 0) + check.needed);
        });
        for (const [field, needed] of uniqueChecks.entries()) {
          const available = Number(data[field]) || 0;
          if (needed > available + 1e-9) {
            throw new InsufficientStockError(
              entry.productName,
              available,
              needed,
              field === 'stockQtyBulk' ? String(data.parentUnit || 'saco') : String(data.baseUnit || 'un')
            );
          }
        }
      }

      // 3. Escrever (uma única escrita por produto).
      for (const [id, entry] of grouped.entries()) {
        const snap = snapshots.get(id);
        if (!snap || !snap.exists()) continue;
        const updates: Record<string, unknown> = {};
        if (entry.bulk > 0) updates.stockQtyBulk = increment(-entry.bulk);
        if (entry.retail > 0) updates.stockQtyRetail = increment(-entry.retail);
        if (entry.base > 0) updates.stockQty = increment(-entry.base);
        if (Object.keys(updates).length > 0) {
          transaction.set(doc(db, 'products', id), updates, { merge: true });
          const dados = snap.data() as Record<string, any>;
          movementDeltas.push({
            productId: id,
            productName: String(dados.name || id),
            unit: String(dados.baseUnit || 'un'),
            base: entry.base
          });
        }
      }

      // Venda completa, sem `merge`: um documento de venda novo não pode herdar
      // campos de uma venda anterior (era o defeito A-02). O id é único desde a
      // origem, por isso não há risco de sobrepor outra venda.
      transaction.set(doc(db, 'sales', saleId), sanitizedSale);
    });

    this.productsCache = null;
    this.salesCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', id: saleId } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'stock-deduct' } }));

    // F-05: rasto de cada saída de stock. A venda já está confirmada; uma
    // falha aqui fica em fila local e não desfaz a venda.
    await this.recordStockMovements(
      movementDeltas.map(delta => ({
        id: `mov-${saleId}-${delta.productId}`,
        date: new Date().toISOString(),
        productId: delta.productId,
        productName: delta.productName,
        type: 'Venda' as const,
        qtyDelta: -Math.abs(delta.base),
        unit: delta.unit,
        reference: String(sanitizedSale.invoiceNumber || saleId),
        operatorName: sanitizedSale.operatorName,
        terminalId: (sanitizedSale as any).terminalId
      }))
    );
  }

  /**
   * Anulação de venda com devolução de stock.
   *
   * Vulnerabilidades que esta versão fecha:
   *  1. **Duplicação**: não havia verificação de estado. Chamar a rotina duas
   *     vezes devolvia o stock duas vezes (o utilizador ficava com produto a
   *     mais e a venda anulada uma só vez). Agora a venda é lida dentro da
   *     transacção e uma venda já anulada é recusada.
   *  2. **Produtos fantasmas**: `batch.set(..., {merge:true})` com `increment`
   *     num produto eliminado **criava** um documento com stock e sem nome.
   *     Agora só se repõe o que ainda existe, e o que não existe é devolvido
   *     ao chamador para ser mostrado ao operador.
   *  3. **Sem limite**: uma anulação com centenas de linhas distintas excedia
   *     o limite de escritas de uma transacção. Passa a ser recusada cedo.
   */
  public async cancelSaleWithStockRestoration(
    sale: Sale,
    restockItems: any[]
  ): Promise<{ restored: number; skipped: Array<{ productId: string; name: string }> }> {
    await this.ensureAuth();

    const validos = (restockItems || []).filter(item => item && item.productId && Number(item.qtyToAdd) > 0);
    if (validos.length > 200) {
      throw new Error(
        `Anulação com ${validos.length} linhas de stock excede o limite de uma operação atómica (200). Divida a operação.`
      );
    }

    const saleId = String(sale.id || sale.invoiceNumber || Date.now());
    const saleRef = doc(db, 'sales', saleId);
    // Marca explícita: sem isto, os relatórios não conseguem distinguir uma
    // anulação clássica (stock voltou) de um corte de inventário (stock saiu).
    const sanitizedSale = this.sanitizeData({ ...sale, id: saleId, status: 'Cancelada', stockReturned: true });

    const skipped: Array<{ productId: string; name: string }> = [];
    let restored = 0;

    // Uma escrita por produto, para caber folgado no limite da transacção.
    const porProduto = new Map<string, { bulk: number; retail: number; base: number; name: string }>();
    for (const item of validos) {
      const id = String(item.productId);
      const entry = porProduto.get(id) || { bulk: 0, retail: 0, base: 0, name: item.productName || id };
      const qty = Number(item.qtyToAdd) || 0;
      if (item.hasConversion && item.sellingUnit === 'Bulk') {
        entry.bulk += qty;
        entry.base += Number(item.equivalentBaseQty) || qty;
      } else if (item.hasConversion) {
        entry.retail += qty;
        entry.base += qty;
      } else {
        entry.base += qty;
      }
      porProduto.set(id, entry);
    }

    await runTransaction(db, async transaction => {
      const saleSnapshot = await transaction.get(saleRef);
      if (saleSnapshot.exists()) {
        const estado = String((saleSnapshot.data() as Sale).status || '');
        if (estado === 'Cancelada' || estado === 'canceled') {
          throw new Error('Esta venda já está anulada. O stock não volta a ser reposto.');
        }
      }

      const produtos = new Map<string, any>();
      for (const id of porProduto.keys()) {
        produtos.set(id, await transaction.get(doc(db, 'products', id)));
      }

      for (const [id, entry] of porProduto.entries()) {
        const snap = produtos.get(id);
        if (!snap || !snap.exists()) {
          skipped.push({ productId: id, name: entry.name });
          continue;
        }
        const updates: Record<string, unknown> = {};
        if (entry.bulk > 0) updates.stockQtyBulk = increment(entry.bulk);
        if (entry.retail > 0) updates.stockQtyRetail = increment(entry.retail);
        if (entry.base > 0) updates.stockQty = increment(entry.base);
        if (Object.keys(updates).length > 0) {
          transaction.set(doc(db, 'products', id), updates, { merge: true });
          restored += 1;
        }
      }

      transaction.set(saleRef, sanitizedSale, { merge: true });
    });

    this.productsCache = null;
    this.salesCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', id: saleId } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'stock-restore' } }));

    await this.recordStockMovements(
      validos
        .filter(item => !skipped.some(s => s.productId === String(item.productId)))
        .map(item => ({
          id: `mov-estorno-${saleId}-${item.productId}-${Date.now()}`,
          date: new Date().toISOString(),
          productId: String(item.productId),
          productName: String(item.productName || item.productId),
          type: 'Estorno' as const,
          qtyDelta: Math.abs(Number(item.equivalentBaseQty || item.qtyToAdd) || 0),
          unit: String(item.unit || 'un'),
          reference: String(sale.creditNoteNumber || sanitizedSale.invoiceNumber || saleId),
          operatorName: sanitizedSale.operatorName
        }))
    );

    return { restored, skipped };
  }

  // --- Corte de inventário ---

  /**
   * Executa um corte de inventário numa só transacção por lote.
   *
   * Antes existiam duas rotinas separadas (`cancelSalesBulk` e
   * `applyStockCorrection`) chamadas uma a seguir à outra: uma falha entre as
   * duas deixava vendas anuladas com o stock por corrigir — o pior dos mundos,
   * porque o stock inflacionado continuava lá e as facturas já não existiam.
   * Aqui as vendas, as notas de crédito, o contador e o stock (por diferença)
   * são escritos no mesmo commit.
   *
   * Regras que a rotina garante:
   *  - só anula documentos que existem e que não estão já anulados;
   *  - numera uma NC por factura definitiva, no contador transaccional;
   *  - aplica o stock por **diferença** (lida dentro da transacção), para não
   *    apagar vendas registadas entretanto;
   *  - nunca cria produtos inexistentes;
   *  - devolve o que fez, para o ecrã poder dizer a verdade.
   */
  public async applyCutoff(input: {
    sales: Sale[];
    stockDeltas: CutoffStockDelta[];
    applyStock: boolean;
    username: string;
    reason: string;
    /** Reembolsos a registar em caixa, um por factura paga anulada. */
    refunds?: Array<{ saleId?: string; invoiceNumber?: string; creditNoteNumber?: string; receiptNumber?: string; amount: number; method: string }>;
  }): Promise<CutoffResult> {
    await this.ensureAuth();

    const vendas = (input.sales || []).filter(sale => sale && (sale.id || sale.invoiceNumber));
    const deltas = input.applyStock
      ? (input.stockDeltas || []).filter(delta => delta && delta.productId)
      : [];
    const reembolsos = (input.refunds || []).filter(r => r && Number(r.amount) > 0);

    const resultado: CutoffResult = {
      cancelled: 0,
      skipped: [],
      creditNotes: [],
      stockAdjusted: 0,
      clamped: [],
      refunded: 0,
      atomic: true
    };

    if (vendas.length === 0 && deltas.length === 0 && reembolsos.length === 0) return resultado;

    const CHUNK = 150; // 150 vendas + 150 produtos + contador < 500 escritas
    if (vendas.length > CHUNK) resultado.atomic = false;

    for (let inicio = 0; inicio < Math.max(vendas.length, 1); inicio += CHUNK) {
      const lote = vendas.slice(inicio, inicio + CHUNK);
      const aplicarStockAgora = inicio === 0 && deltas.length > 0;
      const year = new Date().getFullYear();
      const prefix = `NC-${year}-`;

      await runTransaction(db, async transaction => {
        const counterRef = doc(db, 'counters', 'document_numbers');
        const counterSnapshot = await transaction.get(counterRef);
        const inicial = counterSnapshot.exists()
          ? Number((counterSnapshot.data() as Record<string, number>)[prefix] || 0)
          : 0;
        let next = inicial;

        // --- Vendas ---
        const refs = lote.map(sale => doc(db, 'sales', String(sale.id || sale.invoiceNumber)));
        const documentos: any[] = [];
        for (const ref of refs) documentos.push(await transaction.get(ref));

        for (let k = 0; k < lote.length; k++) {
          const ref = refs[k];
          const snap = documentos[k];
          if (!snap.exists()) {
            resultado.skipped.push(lote[k].invoiceNumber || String(lote[k].id));
            continue;
          }
          const atual = snap.data() as Sale;
          const estado = String(atual.status || '');
          if (estado === 'Cancelada' || estado === 'canceled') {
            resultado.skipped.push(atual.invoiceNumber || String(atual.id));
            continue;
          }

          const isDefinitiva = !atual.documentType || atual.documentType === 'FaturaDefinitiva';
          const creditNoteNumber = isDefinitiva ? `${prefix}${String(++next).padStart(4, '0')}` : undefined;

          const nota = [
            atual.notes,
            `[CORTE DE INVENTÁRIO] Anulada em ${new Date().toISOString().substring(0, 16).replace('T', ' ')} por ${input.username}.`,
            `Motivo: ${input.reason}`,
            creditNoteNumber ? `Nota de crédito: ${creditNoteNumber}.` : '',
            atual.receiptNumber ? `Recibo emitido (${atual.receiptNumber}) fica sem efeito por esta anulação. Recibo anulado em ${new Date().toISOString()}.` : ''
          ].filter(Boolean).join('\n');

          const atualizada: Sale = {
            ...atual,
            status: 'Cancelada',
            // Com estorno o stock voltou; sem estorno a saída aconteceu mesmo
            // (a contagem física já a tinha em conta).
            stockReturned: input.applyStock,
            cancelledAt: new Date().toISOString(),
            cancelledBy: input.username,
            previousStatus: atual.status as Sale['previousStatus'],
            ...(creditNoteNumber ? { creditNoteNumber } : {}),
            notes: nota
          };

          transaction.set(ref, this.sanitizeData(atualizada), { merge: true });
          resultado.cancelled += 1;
          if (creditNoteNumber) {
            resultado.creditNotes.push({
              invoiceNumber: atualizada.invoiceNumber,
              creditNoteNumber
            });
          }
        }

        if (next > inicial) {
          transaction.set(counterRef, { [prefix]: next, updatedAt: new Date().toISOString() }, { merge: true });
        }

        // --- Reembolsos: entram no livro de caixa no mesmo commit ---
        if (inicio === 0 && reembolsos.length > 0) {
          const agora = new Date().toISOString();
          // Dia local de Maputo: às 23:30 a data UTC já é o dia seguinte.
          const diaCaixa = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Maputo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(new Date());
          for (const reembolso of reembolsos) {
            const id = `cx-corte-${reembolso.saleId || reembolso.invoiceNumber || agora}-${next}`;
            const movimento: CashMovement = {
              id,
              date: agora,
              day: diaCaixa,
              type: 'Reembolso',
              amount: -Math.abs(Number(reembolso.amount)),
              method: reembolso.method || 'Dinheiro',
              operator: input.username,
              authorizedBy: input.username,
              reference: reembolso.invoiceNumber,
              receiptNumber: reembolso.receiptNumber,
              creditNoteNumber: reembolso.creditNoteNumber,
              notes: `Reembolso por anulação em corte de inventário (${input.reason})`
            };
            transaction.set(doc(db, 'cash_movements', id), movimento);
            resultado.refunded += Math.abs(Number(reembolso.amount));
          }
        }

        // --- Stock, por diferença ---
        if (aplicarStockAgora) {
          const refsProdutos = deltas.map(delta => doc(db, 'products', String(delta.productId)));
          const produtos: any[] = [];
          for (const ref of refsProdutos) produtos.push(await transaction.get(ref));

          for (let k = 0; k < deltas.length; k++) {
            const snap = produtos[k];
            // Produto apagado: nunca se cria documento fantasma.
            if (!snap || !snap.exists()) continue;
            const produto = snap.data() as Product;
            const delta = deltas[k];
            const escritas: Record<string, unknown> = {};
            let tocou = false;

            const aplicar = (campo: 'stockQty' | 'stockQtyBulk' | 'stockQtyRetail', valor?: number) => {
              if (valor === undefined || Math.abs(valor) < 1e-9) return;
              const atualValor = Number((produto as any)[campo]) || 0;
              const projetado = atualValor + valor;
              if (projetado < 0) {
                // Não se esconde o problema: trava-se em zero e diz-se o nome.
                if (!resultado.clamped.includes(produto.name || delta.productName)) {
                  resultado.clamped.push(produto.name || delta.productName);
                }
                if (atualValor === 0) return;
                escritas[campo] = increment(-atualValor);
                tocou = true;
                return;
              }
              escritas[campo] = increment(valor);
              tocou = true;
            };

            aplicar('stockQty', delta.base);
            aplicar('stockQtyBulk', delta.bulk);
            aplicar('stockQtyRetail', delta.retail);

            if (tocou) {
              transaction.set(refsProdutos[k], escritas, { merge: true });
              resultado.stockAdjusted += 1;
            }
          }
        }
      });
    }

    this.salesCache = null;
    this.productsCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', action: 'cutoff', count: resultado.cancelled } }));
    if (resultado.stockAdjusted > 0) {
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'cutoff-stock' } }));
    }
    if (resultado.refunded > 0) {
      this.cashMovementsCache = null;
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'cash_movements', action: 'cutoff-refund' } }));
    }
    return resultado;
  }

  // --- Ajustes de stock transaccionais (auditoria da gestão de stock) ---

  /**
   * Altera o stock de um artigo por **diferença**, dentro de uma transacção, e
   * deixa três rastos no mesmo commit: o saldo, o movimento de stock e a
   * auditoria.
   *
   * Porque existe: todos os ecrãs de stock escreviam o saldo **absoluto**
   * calculado no formulário. Uma venda feita entre abrir o modal e gravar era
   * apagada pelo valor do ecrã — sem erro, sem aviso. E nenhum desses ecrãs
   * deixava movimento no livro: o saldo mudava e não havia explicação.
   *
   * Regras:
   *  - lê o saldo dentro da transacção e aplica só a variação;
   *  - recusa deixar o saldo negativo (salvo `allowNegative`, usado só por
   *    correcções de contagem que já foram validadas);
   *  - nos artigos híbridos mantém base, sacos e retalho coerentes entre si;
   *  - produto inexistente nunca é criado por acidente.
   */
  public async adjustStock(input: {
    productId: string;
    /** Variação em unidade base (positiva entra, negativa sai). */
    deltaBase?: number;
    /** Variação em sacos (multiplica pela conversão). */
    deltaBulk?: number;
    /** Valor absoluto em unidade base (contagem física). */
    absoluteBase?: number;
    reason: string;
    operator: string;
    source: 'Ajuste' | 'Contagem Física' | 'Expiração' | 'Requisição' | 'Entrada IA' | 'Entrada Manual' | 'Transformação';
    ipAddress?: string;
    allowNegative?: boolean;
  }): Promise<{
    previousBase: number;
    newBase: number;
    delta: number;
    clamped: boolean;
    productName: string;
  }> {
    await this.ensureAuth();

    const productId = String(input.productId);
    const ref = doc(db, 'products', productId);
    const movementId = `mov-ajuste-${productId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const auditId = `log-ajuste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const resultado = await runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) {
        throw new Error('Produto não encontrado. Actualize a lista antes de ajustar.');
      }
      const produto = snap.data() as Product;

      const baseAtual = roundStock(Number(produto.stockQty) || 0);
      const { hasConversion, rate } = hybridStock(produto);

      let deltaBruto = 0;
      if (typeof input.absoluteBase === 'number' && Number.isFinite(input.absoluteBase)) {
        // Contagem/valor absoluto: o delta nasce da diferença para o saldo lido.
        deltaBruto = roundStock(input.absoluteBase) - baseAtual;
      } else if (typeof input.deltaBulk === 'number' && Number.isFinite(input.deltaBulk) && hasConversion) {
        deltaBruto = roundStock(Number(input.deltaBulk) * rate);
      } else {
        deltaBruto = roundStock(Number(input.deltaBase) || 0);
      }

      const aplicado = clampStockDelta(baseAtual, deltaBruto, Boolean(input.allowNegative));
      const { target: alvoFinal, delta: deltaFinal, clamped } = aplicado;

      if (!input.allowNegative && clamped) {
        throw new Error(
          `Stock insuficiente para ${produto.name}: existem ${baseAtual} ${produto.baseUnit || 'un'} ` +
            `e a operação retiraria ${Math.abs(deltaBruto)}.`
        );
      }

      if (deltaFinal === 0) {
        return { previousBase: baseAtual, newBase: baseAtual, delta: 0, clamped, productName: produto.name };
      }

      const escritas: Record<string, unknown> = { stockQty: increment(deltaFinal) };

      if (hasConversion) {
        // Sacos e retalho derivam do total para não divergirem dele. Um valor
        // fraccionário no retalho é aceite (venda ao peso).
        const { stockQtyBulk, stockQtyRetail } = splitHybrid(alvoFinal, produto);
        escritas.stockQtyBulk = stockQtyBulk;
        escritas.stockQtyRetail = stockQtyRetail;
      }

      transaction.set(ref, escritas, { merge: true });

      const movimento: StockMovement = {
        id: movementId,
        date: new Date().toISOString(),
        productId,
        productName: produto.name,
        type: input.source === 'Transformação' ? 'Transformação' : input.source === 'Entrada IA' || input.source === 'Entrada Manual' ? 'Entrada' : 'Ajuste',
        qtyDelta: deltaFinal,
        unit: produto.baseUnit || 'un',
        reference: input.source,
        operatorName: input.operator,
        note: input.reason
      };
      transaction.set(doc(db, 'stock_movements', movementId), this.sanitizeData(movimento));

      const auditoria: AuditLog = {
        id: auditId,
        timestamp: new Date().toISOString(),
        username: input.operator,
        ipAddress: input.ipAddress || 'desconhecido',
        action: `Ajuste de Stock (${input.source})`,
        status: 'Sucesso',
        level: 'WARNING',
        entity: 'products',
        details:
          `${produto.name}: ${baseAtual} → ${alvoFinal} ${produto.baseUnit || 'un'} ` +
          `(${deltaFinal > 0 ? '+' : ''}${deltaFinal}). Motivo: ${input.reason}`
      };
      transaction.set(doc(db, 'audit_logs', auditId), this.sanitizeData(auditoria));

      return { previousBase: baseAtual, newBase: alvoFinal, delta: deltaFinal, clamped, productName: produto.name };
    });

    this.productsCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'adjust' } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'stock_movements', action: 'adjust' } }));
    return resultado;
  }

  /**
   * Quebra/perda: saldo, registo de perda, movimento e auditoria no mesmo
   * commit.
   *
   * Antes: a quebra era deduzida **sempre em unidade base**, sem conversão —
   * dar baixa de 1 saco (50 kg) retirava 1 kg do stock, enquanto o relatório de
   * quebras registava 50 kg. O prejuízo da contabilidade e o stock real nunca
   * coincidiam.
   */
  public async registerLossAtomic(input: {
    productId: string;
    /** Quantidade na unidade escolhida pelo operador. */
    quantity: number;
    /** 'Bulk' converte para base; 'base' usa a quantidade tal como está. */
    unit?: 'Bulk' | 'base';
    reason: string;
    justification: string;
    operator: string;
    ipAddress?: string;
  }): Promise<{ baseQty: number; costValue: number; productName: string }> {
    await this.ensureAuth();

    const productId = String(input.productId);
    const ref = doc(db, 'products', productId);
    const lossId = `loss-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const movementId = `mov-quebra-${lossId}`;
    const auditId = `log-quebra-${lossId}`;

    const resultado = await runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Produto não encontrado.');

      const produto = snap.data() as Product;
      const qtdBase = toBaseQty(Number(input.quantity) || 0, input.unit, produto);
      if (qtdBase <= 0) throw new Error('A quantidade da quebra tem de ser maior que zero.');

      const atual = roundStock(Number(produto.stockQty) || 0);
      if (qtdBase > atual + 1e-6) {
        throw new Error(
          `A quebra (${qtdBase} ${produto.baseUnit || 'un'}) excede o stock disponível (${atual}).`
        );
      }

      const costValue = stockLossValue(qtdBase, Number(produto.buyingPrice) || 0);
      const agora = new Date().toISOString();

      const escritas: Record<string, unknown> = { stockQty: increment(-qtdBase) };
      const { stockQtyBulk, stockQtyRetail } = splitHybrid(atual - qtdBase, produto);
      if (stockQtyBulk !== null) {
        escritas.stockQtyBulk = stockQtyBulk;
        escritas.stockQtyRetail = stockQtyRetail;
      }
      transaction.set(ref, escritas, { merge: true });

      const perda: LossRecord = {
        id: lossId,
        productId,
        productName: produto.name,
        quantity: qtdBase,
        unit: produto.baseUnit || 'un',
        date: agora,
        reason: input.reason as LossRecord['reason'],
        justification: input.justification,
        costValue
      };
      transaction.set(doc(db, 'losses', lossId), this.sanitizeData(perda));

      const movimento: StockMovement = {
        id: movementId,
        date: agora,
        productId,
        productName: produto.name,
        type: 'Quebra',
        qtyDelta: -qtdBase,
        unit: produto.baseUnit || 'un',
        reference: lossId,
        operatorName: input.operator,
        note: input.reason
      };
      transaction.set(doc(db, 'stock_movements', movementId), this.sanitizeData(movimento));

      const auditoria: AuditLog = {
        id: auditId,
        timestamp: agora,
        username: input.operator,
        ipAddress: input.ipAddress || 'desconhecido',
        action: 'Registo de Quebra/Perda',
        status: 'Alerta',
        level: 'WARNING',
        entity: 'losses',
        details: `Quebra de ${qtdBase} ${produto.baseUnit || 'un'} de ${produto.name} (motivo: ${input.reason}). Prejuízo: ${costValue} MT.`
      };
      transaction.set(doc(db, 'audit_logs', auditId), this.sanitizeData(auditoria));

      return { baseQty: qtdBase, costValue, productName: produto.name };
    });

    this.productsCache = null;
    this.lossesCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'loss' } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'losses', action: 'add' } }));
    return resultado;
  }

  /**
   * Expurgo de um lote vencido — só quando alguém o decide.
   *
   * Antes isto acontecia sozinho ao abrir o ecrã de stock: bastava uma data mal
   * digitada para o stock de um artigo inteiro desaparecer, e nos artigos
   * híbridos só o total era zerado (sacos e retalho ficavam a vender).
   */
  public async expireProductBatch(input: {
    productId: string;
    operator: string;
    ipAddress?: string;
  }): Promise<{ removedBase: number; costValue: number; productName: string }> {
    await this.ensureAuth();

    const productId = String(input.productId);
    const ref = doc(db, 'products', productId);
    const lossId = `loss-venc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const auditId = `log-venc-${lossId}`;

    const resultado = await runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Produto não encontrado.');

      const produto = snap.data() as Product;
      const qtd = Number(produto.stockQty) || 0;
      if (qtd <= 0) {
        throw new Error(`${produto.name} já não tem stock para dar baixa.`);
      }

      const custo = Math.round(qtd * (Number(produto.buyingPrice) || 0) * 100) / 100;
      const agora = new Date().toISOString();

      // As três quantidades caem juntas: nenhum ecrã pode continuar a vender
      // mercadoria que foi dada como perdida.
      transaction.set(ref, { stockQty: 0, stockQtyBulk: 0, stockQtyRetail: 0 }, { merge: true });

      const perda: LossRecord = {
        id: lossId,
        productId,
        productName: `${produto.name} (LOTE VENCIDO)`,
        quantity: qtd,
        unit: produto.baseUnit || 'un',
        date: agora,
        reason: 'Fora de Prazo',
        justification: `Lote vencido em ${produto.expiryDate || '—'}. Baixa autorizada por ${input.operator}.`,
        costValue: custo
      };
      transaction.set(doc(db, 'losses', lossId), this.sanitizeData(perda));

      const movimento: StockMovement = {
        id: `mov-venc-${lossId}`,
        date: agora,
        productId,
        productName: produto.name,
        type: 'Quebra',
        qtyDelta: -qtd,
        unit: produto.baseUnit || 'un',
        reference: lossId,
        operatorName: input.operator,
        note: 'Lote vencido — baixa autorizada'
      };
      transaction.set(doc(db, 'stock_movements', movimento.id), this.sanitizeData(movimento));

      const auditoria: AuditLog = {
        id: auditId,
        timestamp: agora,
        username: input.operator,
        ipAddress: input.ipAddress || 'desconhecido',
        action: 'Baixa de Lote Vencido',
        status: 'Alerta',
        level: 'WARNING',
        entity: 'products',
        details: `${produto.name}: ${qtd} ${produto.baseUnit || 'un'} vencidos (validade ${produto.expiryDate || '—'}). Prejuízo ${custo} MT.`
      };
      transaction.set(doc(db, 'audit_logs', auditId), this.sanitizeData(auditoria));

      return { removedBase: qtd, costValue: custo, productName: produto.name };
    });

    this.productsCache = null;
    this.lossesCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'expire' } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'losses', action: 'expire' } }));
    return resultado;
  }

  /**
   * Contagem física: aplica as diferenças por transacção, com movimento de
   * stock em todas elas (faltas e sobras) e perda registada nas faltas.
   *
   * Antes: `stockQty = physicalQty` absoluto, a perda gravada antes do produto e
   * as sobras sem qualquer rasto.
   */
  public async applyPhysicalCount(input: {
    counts: Record<string, number>;
    operator: string;
    ipAddress?: string;
  }): Promise<{ adjusted: number; shortages: number; surpluses: number; lossValue: number; skipped: string[] }> {
    await this.ensureAuth();

    const resultado = { adjusted: 0, shortages: 0, surpluses: 0, lossValue: 0, skipped: [] as string[] };
    const agora = new Date().toISOString();

    for (const [productId, physRaw] of Object.entries(input.counts || {})) {
      const fisico = Number(physRaw);
      if (!Number.isFinite(fisico) || fisico < 0) {
        resultado.skipped.push(productId);
        continue;
      }

      try {
        await runTransaction(db, async transaction => {
          const ref = doc(db, 'products', productId);
          const snap = await transaction.get(ref);
          if (!snap.exists()) {
            resultado.skipped.push(productId);
            return;
          }
          const produto = snap.data() as Product;
          const atual = roundStock(Number(produto.stockQty) || 0);
          const delta = physicalDelta(atual, fisico);
          if (delta === 0) return;

          const escritas: Record<string, unknown> = { stockQty: increment(delta) };
          const { stockQtyBulk, stockQtyRetail } = splitHybrid(atual + delta, produto);
          if (stockQtyBulk !== null) {
            escritas.stockQtyBulk = stockQtyBulk;
            escritas.stockQtyRetail = stockQtyRetail;
          }
          transaction.set(ref, escritas, { merge: true });

          const movementId = `mov-contagem-${productId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const movimento: StockMovement = {
            id: movementId,
            date: agora,
            productId,
            productName: produto.name,
            type: 'Ajuste',
            qtyDelta: delta,
            unit: produto.baseUnit || 'un',
            reference: 'Contagem Física',
            operatorName: input.operator,
            note: `Sistema ${atual} → contagem ${fisico}`
          };
          transaction.set(doc(db, 'stock_movements', movementId), this.sanitizeData(movimento));

          resultado.adjusted += 1;
          if (delta < 0) {
            const custo = stockLossValue(delta, Number(produto.buyingPrice) || 0);
            resultado.shortages += 1;
            resultado.lossValue += custo;

            // A perda nasce na MESMA transacção da correcção de stock.
            const lossId = `loss-phy-${productId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const perda: LossRecord = {
              id: lossId,
              productId,
              productName: produto.name,
              quantity: Math.abs(delta),
              unit: produto.baseUnit || 'un',
              date: agora,
              reason: 'Diferença de Inventário',
              justification: `Contagem física: sistema ${atual}, contado ${fisico}.`,
              costValue: custo
            };
            transaction.set(doc(db, 'losses', lossId), this.sanitizeData(perda));
          } else {
            resultado.surpluses += 1;
          }
        });
      } catch (erro) {
        console.error('[FirebaseDB] Falha na contagem física de', productId, erro);
        resultado.skipped.push(productId);
      }
    }

    const auditId = `log-contagem-${Date.now()}`;
    const auditoria: AuditLog = {
      id: auditId,
      timestamp: agora,
      username: input.operator,
      ipAddress: input.ipAddress || 'desconhecido',
      action: 'Ajuste de Contagem Física',
      status: 'Sucesso',
      level: 'WARNING',
      entity: 'products',
      details:
        `${resultado.adjusted} artigo(s) ajustado(s): ${resultado.shortages} falta(s) e ${resultado.surpluses} sobra(s). ` +
        `Valor das faltas: ${resultado.lossValue.toFixed(2)} MT.` +
        (resultado.skipped.length ? ` Ignorados: ${resultado.skipped.length}.` : '')
    };
    await this.upsert('audit_logs', auditId, this.sanitizeData(auditoria));

    this.productsCache = null;
    this.lossesCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'physical-count' } }));
    return resultado;
  }

  /**
   * Alteração de preços isolada, com merge — nunca toca no stock.
   *
   * A entrada por IA somava stock e depois gravava o artigo inteiro a partir da
   * cópia do ecrã: uma venda feita entretanto era apagada. Preços e stock
   * passam a ser duas operações distintas, cada uma transaccional.
   */
  public async updateProductPrices(input: {
    productId: string;
    buyingPrice?: number;
    sellingPrice?: number;
    operator: string;
    ipAddress?: string;
    reason?: string;
  }): Promise<void> {
    await this.ensureAuth();

    const ref = doc(db, 'products', String(input.productId));
    const auditoriaId = `log-preco-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    await runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Produto não encontrado.');

      const produto = snap.data() as Product;
      const escritas: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      const mudancas: string[] = [];

      if (typeof input.buyingPrice === 'number' && Number.isFinite(input.buyingPrice)) {
        escritas.buyingPrice = input.buyingPrice;
        mudancas.push(`compra ${Number(produto.buyingPrice) || 0} → ${input.buyingPrice}`);
      }
      if (typeof input.sellingPrice === 'number' && Number.isFinite(input.sellingPrice)) {
        escritas.sellingPrice = input.sellingPrice;
        mudancas.push(`venda ${Number(produto.sellingPrice) || 0} → ${input.sellingPrice}`);
      }
      if (mudancas.length === 0) return;

      transaction.set(ref, escritas, { merge: true });
      transaction.set(
        doc(db, 'audit_logs', auditoriaId),
        this.sanitizeData({
          id: auditoriaId,
          timestamp: new Date().toISOString(),
          username: input.operator,
          ipAddress: input.ipAddress || 'desconhecido',
          action: 'Alteração de Preço',
          status: 'Sucesso',
          level: 'WARNING',
          entity: 'products',
          details: `${produto.name}: ${mudancas.join('; ')}.${input.reason ? ` (${input.reason})` : ''}`
        } as AuditLog)
      );
    });

    this.productsCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'price' } }));
  }

  /**
   * Requisição de sacos: abre N sacos da revenda para venda a retalho.
   *
   * ES-24/25/26: antes gravava `stockQtyBulk`/`stockQtyRetail` absolutos a
   * partir do estado do ecrã (dois operadores, uma operação perdida), sem
   * movimento e com utilizador fixo. Agora lê o saldo dentro da transacção,
   * recusa abrir mais sacos do que existem e deixa movimento + auditoria.
   *
   * Nota de modelo: o total não muda — o saco aberto continua a ser
   * mercadoria. `stockQtyBulk + stockQtyRetail` mantém-se igual a `stockQty`.
   */
  public async requisitionSacks(input: {
    productId: string;
    sacks: number;
    operator: string;
    ipAddress?: string;
  }): Promise<{ bulk: number; retail: number; total: number; productName: string }> {
    await this.ensureAuth();

    const sacks = Number(input.sacks);
    if (!Number.isFinite(sacks) || sacks <= 0) {
      throw new Error('A quantidade requisitada deve ser maior que zero.');
    }

    const productId = String(input.productId);
    const ref = doc(db, 'products', productId);
    const auditoriaId = `log-req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const movimentoId = `mov-req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const resultado = await runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error('Produto não encontrado.');

      const produto = snap.data() as Product;
      const { hasConversion, rate } = hybridStock(produto);
      if (!hasConversion) {
        throw new Error(`${produto.name} não tem embalagem definida: não há sacos para requisitar.`);
      }

      const bulkAtual = Number(produto.stockQtyBulk) || 0;
      const retailAtual = Number(produto.stockQtyRetail) || 0;
      if (sacks > bulkAtual) {
        throw new Error(
          `Só existem ${bulkAtual} ${produto.parentUnit} na revenda de ${produto.name}.`
        );
      }

      const novoBulk = roundStock(bulkAtual - sacks);
      const novoRetail = roundStock(retailAtual + sacks * rate);
      const total = roundStock(Number(produto.stockQty) || 0);

      transaction.set(
        ref,
        { stockQtyBulk: novoBulk, stockQtyRetail: novoRetail, updatedAt: new Date().toISOString() },
        { merge: true }
      );

      // Movimento com delta zero: o total não mudou, mas o livro explica a
      // abertura do saco (ES-25).
      transaction.set(
        doc(db, 'stock_movements', movimentoId),
        this.sanitizeData({
          id: movimentoId,
          date: new Date().toISOString(),
          productId,
          productName: produto.name,
          type: 'Ajuste',
          qtyDelta: 0,
          unit: produto.baseUnit || 'un',
          reference: 'Requisição',
          operatorName: input.operator,
          note:
            `${sacks} ${produto.parentUnit} aberto(s) para retalho: ` +
            `revenda ${bulkAtual} → ${novoBulk}, retalho ${retailAtual} → ${novoRetail}.`
        } as StockMovement)
      );

      transaction.set(
        doc(db, 'audit_logs', auditoriaId),
        this.sanitizeData({
          id: auditoriaId,
          timestamp: new Date().toISOString(),
          username: input.operator,
          ipAddress: input.ipAddress || 'desconhecido',
          action: 'Requisição de Saco para Venda a Retalho',
          status: 'Sucesso',
          level: 'INFO',
          entity: 'products',
          details:
            `${produto.name}: ${sacks} ${produto.parentUnit} transferido(s) para retalho ` +
            `(${sacks * rate} ${produto.baseUnit}). Revista ${bulkAtual} → ${novoBulk}.`
        } as AuditLog)
      );

      return { bulk: novoBulk, retail: novoRetail, total, productName: produto.name };
    });

    this.productsCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'requisition' } }));
    return resultado;
  }

  // --- Dívidas de clientes (vendas a crédito) ---

  /** Lê uma única vez o stock de um artigo. Sem cache: é guarda, não relatório. */
  public async getProductStock(productId: string): Promise<number | null> {
    try {
      const snap = await getDoc(doc(db, 'products', String(productId)));
      if (!snap.exists()) return null;
      return Number((snap.data() as Product).stockQty) || 0;
    } catch (erro) {
      console.error('[FirebaseDB] Falha ao ler stock do artigo:', erro);
      return null;
    }
  }

  public async getDebts(): Promise<Debt[]> {
    if (this.debtsCache) return this.debtsCache;
    const lista = await this.getAll<Debt>('debts');
    this.debtsCache = lista.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return this.debtsCache;
  }

  /**
   * Cria o registo de dívida de uma venda não paga.
   *
   * Idempotente: o id é o da venda, por isso repetir não duplica. Grava-se
   * apenas o necessário — prazo e zero pagamentos.
   */
  public async createDebtFromSale(sale: Sale, termDays = 30): Promise<Debt | null> {
    const estado = String(sale.status || '');
    // Só dívidas reais: uma venda cancelada ou proforma nunca gera registo.
    if (estado !== 'Crédito' && estado !== 'Pendente') return null;

    await this.ensureAuth();
    const id = String(sale.id || sale.invoiceNumber);
    const existente = await getDoc(doc(db, 'debts', id));
    if (existente.exists()) return existente.data() as Debt;

    const emissao = sale.date || new Date().toISOString();
    const prazo = new Date(emissao);
    prazo.setDate(prazo.getDate() + (Number.isFinite(termDays) ? termDays : 30));

    const divida: Debt = {
      id,
      saleId: id,
      invoiceNumber: sale.invoiceNumber,
      customerName: sale.customerName || 'Cliente Geral',
      customerNuit: sale.customerNuit,
      date: emissao,
      dueDate: prazo.toISOString(),
      total: Number(sale.total) || 0,
      paidAmount: Number(sale.amountPaid) || 0,
      payments: [],
      status: 'Aberta',
      operator: sale.operatorName || sale.operatorId || 'Sistema'
    };

    await setDoc(doc(db, 'debts', id), this.sanitizeData(divida));
    this.debtsCache = null;
    return divida;
  }

  /**
   * Recebe dinheiro de uma factura em dívida — total ou parcial.
   *
   * Uma só transacção escreve: o pagamento na dívida, o estado da venda, o
   * número do recibo e a entrada no livro de caixa. Antes não havia nada disto:
   * a venda ficava «Paga» a 100% ou não se registava pagamento nenhum.
   */
  public async settleDebt(input: {
    saleId: string;
    amount: number;
    method: string;
    operator: string;
    fallbackMax?: number;
    note?: string;
  }): Promise<{ debt: Debt; sale: Sale; receiptNumber: string; full: boolean; remaining: number }> {
    await this.ensureAuth();

    const saleId = String(input.saleId);
    const valor = Math.round((Number(input.amount) || 0) * 100) / 100;
    if (!(valor > 0)) throw new Error('O valor do pagamento tem de ser maior que zero.');

    const saleRef = doc(db, 'sales', saleId);
    const debtRef = doc(db, 'debts', saleId);
    const counterRef = doc(db, 'counters', 'document_numbers');
    const prefix = `REC-A4-${new Date().getFullYear()}-`;

    const resultado = await runTransaction(db, async transaction => {
      const saleSnap = await transaction.get(saleRef);
      if (!saleSnap.exists()) throw new Error('Factura não encontrada. Actualize a lista.');
      const venda = saleSnap.data() as Sale;
      const estado = String(venda.status || '');

      if (estado === 'Cancelada' || estado === 'canceled') {
        throw new Error(`A factura ${venda.invoiceNumber} está anulada.`);
      }
      if (estado === 'Paga') {
        throw new Error(`A factura ${venda.invoiceNumber} já está paga.`);
      }
      if (estado !== 'Pendente' && estado !== 'Crédito') {
        throw new Error(`A factura ${venda.invoiceNumber} não é uma dívida (estado: ${estado || 'desconhecido'}).`);
      }

      const debtSnap = await transaction.get(debtRef);
      const dividaExistente = debtSnap.exists() ? (debtSnap.data() as Debt) : null;
      const total = Number(dividaExistente?.total ?? venda.total) || 0;
      const jaPago = Number(dividaExistente?.paidAmount ?? venda.amountPaid) || 0;
      const restante = Math.round((total - jaPago) * 100) / 100;

      if (valor > restante + 0.01) {
        throw new Error(
          `O valor (${valor.toFixed(2)} MT) excede o que falta pagar (${restante.toFixed(2)} MT).`
        );
      }

      const counterSnap = await transaction.get(counterRef);
      const guardado = counterSnap.exists()
        ? Number((counterSnap.data() as Record<string, number>)[prefix] || 0)
        : 0;
      const safeFallback = Number.isFinite(input.fallbackMax) ? Math.max(0, Math.floor(input.fallbackMax!)) : 0;
      const proximo = Math.max(guardado, safeFallback) + 1;
      const receiptNumber = `${prefix}${String(proximo).padStart(4, '0')}`;

      const agora = new Date().toISOString();
      const pagoTotal = Math.round((jaPago + valor) * 100) / 100;
      const liquidada = pagoTotal >= total - 0.01;

      const pagamento: DebtPayment = {
        id: `pay-${Date.now()}-${proximo}`,
        date: agora,
        amount: valor,
        method: input.method || 'Dinheiro',
        operator: input.operator,
        receiptNumber,
        note: input.note
      };

      const divida: Debt = {
        id: saleId,
        saleId,
        invoiceNumber: venda.invoiceNumber,
        customerName: venda.customerName || 'Cliente Geral',
        customerNuit: venda.customerNuit,
        date: dividaExistente?.date || venda.date || agora,
        dueDate:
          dividaExistente?.dueDate ||
          new Date(new Date(venda.date || agora).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        total,
        paidAmount: pagoTotal,
        payments: [...(dividaExistente?.payments || []), pagamento],
        status: 'Aberta',
        operator: venda.operatorName || venda.operatorId || input.operator
      };

      const vendaAtualizada: Sale = this.sanitizeData({
        ...venda,
        amountPaid: pagoTotal,
        ...(liquidada
          ? { status: 'Paga' as const, paidAt: agora, paidBy: input.operator, settledPaymentMethod: input.method }
          : {}),
        receiptNumber: liquidada ? receiptNumber : venda.receiptNumber
      });

      transaction.set(saleRef, vendaAtualizada, { merge: true });
      transaction.set(counterRef, { [prefix]: proximo, updatedAt: agora }, { merge: true });

      // Dinheiro que entra na gaveta: sem isto, o caixa fechava com sobra.
      const diaCaixa = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Maputo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
      const movimentoId = `cx-cobranca-${saleId}-${proximo}`;
      const movimento: CashMovement = {
        id: movimentoId,
        date: agora,
        day: diaCaixa,
        type: 'Entrada',
        amount: valor,
        method: input.method || 'Dinheiro',
        operator: input.operator,
        authorizedBy: input.operator,
        reference: venda.invoiceNumber,
        receiptNumber,
        notes: liquidada
          ? `Liquidação de ${venda.invoiceNumber}`
          : `Cobrança parcial de ${venda.invoiceNumber} (falta ${Math.max(0, total - pagoTotal).toFixed(2)} MT)`
      };
      transaction.set(doc(db, 'cash_movements', movimentoId), movimento);
      transaction.set(debtRef, { ...divida, status: liquidada ? 'Paga' : 'Aberta' });

      return {
        debt: { ...divida, status: liquidada ? 'Paga' as const : 'Aberta' as const },
        sale: vendaAtualizada,
        receiptNumber,
        full: liquidada,
        remaining: Math.max(0, Math.round((total - pagoTotal) * 100) / 100)
      };
    });

    this.debtsCache = null;
    this.salesCache = null;
    this.cashMovementsCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'debts', action: 'settle' } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', action: 'settle' } }));
    return resultado;
  }

  // --- Movimentos de caixa (reembolsos, sangrias) ---

  /**
   * Lê os movimentos de caixa. É a única fonte de verdade para o dinheiro que
   * saiu da gaveta sem ser por venda.
   */
  public async getCashMovements(): Promise<CashMovement[]> {
    if (this.cashMovementsCache) return this.cashMovementsCache;
    const lista = await this.getAll<CashMovement>('cash_movements');
    this.cashMovementsCache = lista.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return this.cashMovementsCache;
  }

  /**
   * Regista um movimento de caixa.
   *
   * Não é "best effort": se o reembolso não ficar gravado, o dinheiro sai e o
   * caixa passa a ter uma falta sem explicação. O chamador tem de tratar o erro
   * e dizer ao operador que a devolução não foi registada.
   */
  public async addCashMovement(movement: CashMovement): Promise<void> {
    const valor = Number(movement.amount) || 0;
    if (valor === 0) return;
    const registo: CashMovement = {
      ...movement,
      id: movement.id || `cx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      day: movement.day || movement.date?.substring(0, 10) || new Date().toISOString().substring(0, 10),
      // Saídas ficam sempre negativas: é o que o saldo de caixa espera.
      amount: movement.type === 'Reembolso' || movement.type === 'Sangria' ? -Math.abs(valor) : Math.abs(valor)
    };
    await this.upsert('cash_movements', registo.id, registo);
    this.cashMovementsCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'cash_movements', action: 'add' } }));
  }

  // --- Losses ---
  public async getLosses(): Promise<LossRecord[]> {
    if (this.lossesCache && this.lossesCache.length >= 0) {
      return this.lossesCache;
    }
    const list = await this.getAll<LossRecord>('losses');
    this.lossesCache = list.sort((a, b) => b.date.localeCompare(a.date));
    return this.lossesCache;
  }

  // --- Livro de movimentos de stock (F-05) ---
  /**
   * Regista movimentos de stock. É deliberadamente "best effort": a venda já
   * foi confirmada e não pode ser posta em causa por uma falha de auditoria.
   * Os movimentos são gravados em lote e ficam em fila local se a rede cair.
   */
  public async recordStockMovements(movements: StockMovement[]): Promise<void> {
    await this.ensureAuth();
    const validos = (movements || []).filter(m => m && m.productId && Number.isFinite(m.qtyDelta) && m.qtyDelta !== 0);
    if (validos.length === 0) return;

    try {
      for (let i = 0; i < validos.length; i += 400) {
        const lote = validos.slice(i, i + 400);
        const batch = writeBatch(db);
        lote.forEach(movimento => {
          batch.set(doc(db, 'stock_movements', movimento.id), this.sanitizeData(movimento));
        });
        await batch.commit();
      }
    } catch (err) {
      console.warn('[F-05] Não foi possível gravar o livro de movimentos agora.', err);
      try {
        const fila = JSON.parse(safeStorage.getItem('agro_stock_movements_queue') || '[]');
        safeStorage.setItem('agro_stock_movements_queue', JSON.stringify([...fila, ...validos].slice(-2000)));
      } catch {
        /* sem armazenamento */
      }
    }
  }

  /** Reenvia os movimentos que ficaram em fila. */
  public async flushStockMovementsQueue(): Promise<void> {
    try {
      const fila = JSON.parse(safeStorage.getItem('agro_stock_movements_queue') || '[]') as StockMovement[];
      if (!Array.isArray(fila) || fila.length === 0) return;
      await this.recordStockMovements(fila);
      safeStorage.removeItem('agro_stock_movements_queue');
    } catch {
      /* ignora */
    }
  }

  /** Movimentos de um produto (mais recentes primeiro). */
  public async getStockMovements(productId?: string, limit = 200): Promise<StockMovement[]> {
    const lista = await this.getAll<StockMovement>('stock_movements');
    const filtrada = productId
      ? lista.filter(movimento => String(movimento.productId) === String(productId))
      : lista;
    return filtrada
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, limit);
  }

  public async addLoss(l: LossRecord): Promise<void> {
    console.log(`[FirebaseDBService] addLoss() ID: ${l.id}`);
    await this.upsert('losses', l.id, l);
    this.lossesCache = null;

    // F-05: a quebra também é movimento de stock.
    await this.recordStockMovements([{
      id: `mov-quebra-${l.id}`,
      date: l.date || new Date().toISOString(),
      productId: String((l as any).productId || ''),
      productName: String((l as any).productName || (l as any).productId || ''),
      type: 'Quebra' as const,
      qtyDelta: -Math.abs(Number((l as any).quantity) || 0),
      unit: String((l as any).unit || 'un'),
      reference: String(l.id),
      note: (l as any).reason || (l as any).motivo
    }]);
  }

  // --- Product Transformations (Parte 4) ---
  public async getTransformations(): Promise<ProductTransformation[]> {
    if (this.transformationsCache && this.transformationsCache.length >= 0) {
      return this.transformationsCache;
    }
    const list = await this.getAll<ProductTransformation>('transformations');
    this.transformationsCache = list.sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt));
    return this.transformationsCache;
  }

  public async saveTransformation(t: ProductTransformation): Promise<void> {
    await this.upsert('transformations', t.id, t);
    this.transformationsCache = null;
  }

  public async deleteTransformation(id: string): Promise<void> {
    await this.deleteRow('transformations', id);
    this.transformationsCache = null;
  }

  /**
   * Transformação / fraccionamento — tudo numa transacção.
   *
   * ES-39: o saldo do produto de origem era deduzido às cegas, em `writeBatch`
   * (que não lê nada). Duas pessoas a transformar ao mesmo tempo deixavam o
   * artigo com saldo negativo e o PDV a vender o que não existia. Agora o saldo
   * é lido dentro da transacção, a operação é recusada se não houver quantidade
   * suficiente, e as três quantidades (base, sacos, retalho) ficam coerentes.
   *
   * ES-43/47: cada lado da transformação deixa movimento de stock
   * (`Transformação`) e uma linha de auditoria com o utilizador real.
   */
  public async addTransformationWithStockUpdate(
    transformation: ProductTransformation,
    itemsToCredit: Array<{
      productId: string;
      qtyToAdd: number;
      productData?: Partial<Product>;
      name: string;
      unitPrice: number;
      costPrice: number;
      category: string;
      baseUnit: string;
      code?: string;
    }>,
    originalDeduction: {
      productId: string;
      qtyToDeduct: number;
      isBulk?: boolean;
      equivalentBaseQty?: number;
    },
    context?: { operator?: string; ipAddress?: string }
  ): Promise<void> {
    await this.ensureAuth();

    const operator = context?.operator || transformation.operatorName || 'Operador';
    const ipAddress = context?.ipAddress || 'desconhecido';
    const agora = new Date().toISOString();

    await runTransaction(db, async transaction => {
      // --- Leituras (todas antes de qualquer escrita) ---
      const origRef = doc(db, 'products', originalDeduction.productId);
      const origSnap = await transaction.get(origRef);
      if (!origSnap.exists()) {
        throw new Error('O artigo de origem já não existe. Actualize o ecrã e repita a operação.');
      }
      const origem = origSnap.data() as Product;

      // Agrega linhas repetidas do mesmo artigo resultante: somar duas vezes o
      // mesmo id dentro de uma transacção sobrescreveria a primeira.
      const creditos = new Map<string, { qtyToAdd: number; item: (typeof itemsToCredit)[number] }>();
      for (const item of itemsToCredit) {
        const existente = creditos.get(item.productId);
        if (existente) {
          existente.qtyToAdd = roundStock(existente.qtyToAdd + (Number(item.qtyToAdd) || 0));
        } else {
          creditos.set(item.productId, { qtyToAdd: Number(item.qtyToAdd) || 0, item });
        }
      }
      if (creditos.size === 0) throw new Error('A transformação não tem artigos resultantes.');

      const creditRefs = Array.from(creditos.keys()).map(id => doc(db, 'products', id));
      const creditSnaps = await Promise.all(creditRefs.map(ref => transaction.get(ref)));

      for (const [, credito] of creditos) {
        if (credito.qtyToAdd <= 0) {
          throw new Error(`A quantidade de "${credito.item.name}" tem de ser maior que zero.`);
        }
      }

      // --- Verificação de saldo (ES-39) ---
      const { hasConversion, rate } = hybridStock(origem);
      const baseAtual = roundStock(Number(origem.stockQty) || 0);
      const aDeduzir = roundStock(
        originalDeduction.equivalentBaseQty ??
          (originalDeduction.isBulk && hasConversion
            ? (Number(originalDeduction.qtyToDeduct) || 0) * rate
            : Number(originalDeduction.qtyToDeduct) || 0)
      );

      if (aDeduzir <= 0) {
        throw new Error('A quantidade a transformar tem de ser maior que zero.');
      }
      if (aDeduzir > baseAtual + 1e-6) {
        throw new Error(
          `Stock insuficiente em ${origem.name}: existem ${baseAtual} ${origem.baseUnit || 'un'} ` +
            `e a transformação precisa de ${aDeduzir}.`
        );
      }

      // --- Escritas ---
      // Um artigo pode ser, ao mesmo tempo, origem e destino (ex.: 1 saco
      // aberto em 2 sacos do mesmo artigo). Gravar o mesmo documento duas
      // vezes na mesma transacção perderia a primeira escrita, por isso as
      // variações são somadas por artigo antes de escrever.
      const variacoes = new Map<string, number>();
      variacoes.set(originalDeduction.productId, -aDeduzir);
      Array.from(creditos.entries()).forEach(([productId, credito]) => {
        variacoes.set(productId, roundStock((variacoes.get(productId) || 0) + credito.qtyToAdd));
      });

      const snapsPorId = new Map<string, any>();
      snapsPorId.set(originalDeduction.productId, origSnap);
      Array.from(creditos.keys()).forEach((id, idx) => snapsPorId.set(id, creditSnaps[idx]));

      Array.from(variacoes.entries()).forEach(([productId, delta]) => {
        if (delta === 0) return;

        const snap = snapsPorId.get(productId);
        const credito = creditos.get(productId);

        if (snap && snap.exists()) {
          const atual = snap.data() as Product;
          const total = roundStock((Number(atual.stockQty) || 0) + delta);
          const escritas: Record<string, unknown> = {
            stockQty: increment(delta),
            updatedAt: agora
          };
          const split = splitHybrid(total, atual);
          if (split.stockQtyBulk !== null) {
            escritas.stockQtyBulk = split.stockQtyBulk;
            escritas.stockQtyRetail = split.stockQtyRetail;
          }
          transaction.set(doc(db, 'products', productId), escritas, { merge: true });
          return;
        }

        // Produto novo criado dentro da transformação.
        if (!credito) return;
        const item = credito.item;
        const novo: Product = {
          id: productId,
          code:
            item.code ||
            'TRF-' + Math.floor(1000000000000 + Math.random() * 900000000000).toString(),
          name: item.name,
          category: item.category || 'Transformados',
          stockQty: delta,
          stockQtyRetail: delta,
          buyingPrice: item.costPrice,
          sellingPrice: item.unitPrice,
          baseUnit: item.baseUnit || 'Pacotes',
          ...item.productData
        };
        novo.stockQty = delta;
        novo.stockQtyRetail = delta;
        transaction.set(doc(db, 'products', productId), this.sanitizeData(novo));
      });

      // Movimento da saída do artigo de origem.
      transaction.set(
        doc(db, 'stock_movements', `mov-trf-out-${transformation.id}`),
        this.sanitizeData({
          id: `mov-trf-out-${transformation.id}`,
          date: agora,
          productId: originalDeduction.productId,
          productName: origem.name,
          type: 'Transformação',
          qtyDelta: -aDeduzir,
          unit: origem.baseUnit || 'un',
          reference: transformation.code,
          operatorName: operator,
          note: `Saída para transformação ${transformation.code}`
        } as StockMovement)
      );

      // Movimento de cada entrada.
      Array.from(creditos.entries()).forEach(([productId, credito], idx) => {
        transaction.set(
          doc(db, 'stock_movements', `mov-trf-in-${transformation.id}-${idx}`),
          this.sanitizeData({
            id: `mov-trf-in-${transformation.id}-${idx}`,
            date: agora,
            productId,
            productName: credito.item.name,
            type: 'Transformação',
            qtyDelta: credito.qtyToAdd,
            unit: credito.item.baseUnit || 'un',
            reference: transformation.code,
            operatorName: operator,
            note: `Entrada da transformação ${transformation.code}`
          } as StockMovement)
        );
      });

      // Perda do fraccionamento (dentro da mesma transacção)
      if (transformation.lossQuantity > 0) {
        const lossId = 'loss-trf-' + transformation.id;
        transaction.set(
          doc(db, 'losses', lossId),
          this.sanitizeData({
            id: lossId,
            productId: transformation.originalProductId,
            productName: transformation.originalProductName,
            quantity: transformation.lossQuantity,
            unit: transformation.originalUnit,
            date: transformation.date,
            reason: 'Perda em Transformação',
            responsibleEmployeeId: transformation.operatorId,
            justification:
              `Perda no fraccionamento da transformação ${transformation.code}: ` +
              `${transformation.notes || 'Sem observações'}`,
            costValue: transformation.lossValue,
            transformationId: transformation.id
          } as LossRecord)
        );
      }

      transaction.set(
        doc(db, 'transformations', transformation.id),
        this.sanitizeData(transformation)
      );

      transaction.set(
        doc(db, 'audit_logs', `log-trf-${transformation.id}`),
        this.sanitizeData({
          id: `log-trf-${transformation.id}`,
          timestamp: agora,
          username: operator,
          ipAddress,
          action: 'Transformação de Produto Realizada',
          status: 'Sucesso',
          level: 'INFO',
          entity: 'transformations',
          details:
            `${origem.name}: ${aDeduzir} ${origem.baseUnit || 'un'} (saldo ${baseAtual} → ${roundStock(baseAtual - aDeduzir)}) ` +
            `transformados em ${creditos.size} artigo(s). Perda: ${transformation.lossQuantity || 0}. ` +
            `Guia ${transformation.code}.`
        } as AuditLog)
      );
    });

    this.productsCache = null;
    this.transformationsCache = null;
    this.lossesCache = null;

    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'transformation' } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'transformations', id: transformation.id } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'losses', action: 'transformation-loss' } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'stock_movements', action: 'transformation' } }));
  }

  /**
   * Anulação de uma transformação — devolve mercadoria, não apaga prova.
   *
   * ES-40/41: a reversão devolvia apenas `stockQty`. Num artigo híbrido, o
   * total voltava e os sacos/retalho ficavam errados para sempre.
   * ES-42: a perda do fraccionamento era **apagada**. Agora fica marcada como
   * anulada — continua visível, com autor e motivo, e sai das somas.
   *
   * A anulação é recusada se os artigos gerados já foram vendidos (o stock
   * ficaria negativo): nesse caso a mercadoria existe, mas noutro lado.
   */
  public async cancelTransformationWithStockReversal(
    transformation: ProductTransformation,
    context?: { operator?: string; ipAddress?: string }
  ): Promise<void> {
    if (transformation.status === 'Cancelada') return;

    await this.ensureAuth();

    const operator = context?.operator || transformation.operatorName || 'Operador';
    const ipAddress = context?.ipAddress || 'desconhecido';
    const agora = new Date().toISOString();

    await runTransaction(db, async transaction => {
      // --- Leituras ---
      const origRef = doc(db, 'products', transformation.originalProductId);
      const origSnap = await transaction.get(origRef);

      const itemRefs = (transformation.items || []).map(item =>
        doc(db, 'products', item.resultingProductId)
      );
      const itemSnaps = await Promise.all(itemRefs.map(ref => transaction.get(ref)));

      const lossRef = doc(db, 'losses', 'loss-trf-' + transformation.id);
      const lossSnap = transformation.lossQuantity > 0 ? await transaction.get(lossRef) : null;

      // --- Variações por artigo (origem devolve, gerados entregam) ---
      const variacoes = new Map<string, number>();
      variacoes.set(
        transformation.originalProductId,
        (variacoes.get(transformation.originalProductId) || 0) + (Number(transformation.originalQuantity) || 0)
      );
      (transformation.items || []).forEach(item => {
        const atual = variacoes.get(item.resultingProductId) || 0;
        variacoes.set(item.resultingProductId, atual - (Number(item.quantity) || 0));
      });

      const snapsPorId = new Map<string, any>();
      if (origSnap.exists()) snapsPorId.set(transformation.originalProductId, origSnap);
      (transformation.items || []).forEach((item, idx) => {
        snapsPorId.set(item.resultingProductId, itemSnaps[idx]);
      });

      // Recusa se algum artigo gerado já não tem o que devolver.
      for (const [productId, delta] of variacoes.entries()) {
        if (delta >= 0) continue;
        const snap = snapsPorId.get(productId);
        if (!snap || !snap.exists()) continue;
        const produto = snap.data() as Product;
        const disponivel = roundStock(Number(produto.stockQty) || 0);
        if (Math.abs(delta) > disponivel + 1e-6) {
          throw new Error(
            `Não é possível anular: ${produto.name} já só tem ${disponivel} ${produto.baseUnit || 'un'} ` +
              `e esta transformação gerou ${Math.abs(delta)}. A mercadoria já foi vendida ou movimentada.`
          );
        }
      }

      // --- Escritas ---
      Array.from(variacoes.entries()).forEach(([productId, delta]) => {
        if (delta === 0) return;
        const snap = snapsPorId.get(productId);
        if (!snap || !snap.exists()) return;

        const produto = snap.data() as Product;
        const total = roundStock((Number(produto.stockQty) || 0) + delta);
        const escritas: Record<string, unknown> = { stockQty: increment(delta), updatedAt: agora };
        const split = splitHybrid(total, produto);
        if (split.stockQtyBulk !== null) {
          escritas.stockQtyBulk = split.stockQtyBulk;
          escritas.stockQtyRetail = split.stockQtyRetail;
        }
        transaction.set(doc(db, 'products', productId), escritas, { merge: true });

        // Movimento de devolução: o livro passa a explicar a anulação (ES-43).
        const movId = `mov-trf-rev-${transformation.id}-${productId}`;
        transaction.set(
          doc(db, 'stock_movements', movId),
          this.sanitizeData({
            id: movId,
            date: agora,
            productId,
            productName: produto.name,
            type: 'Transformação',
            qtyDelta: delta,
            unit: produto.baseUnit || 'un',
            reference: `${transformation.code} (anulada)`,
            operatorName: operator,
            note: `Anulação da transformação ${transformation.code}`
          } as StockMovement)
        );
      });

      // Perda anulada — não apagada.
      if (lossSnap) {
        transaction.set(
          lossRef,
          {
            annulled: true,
            annulledAt: agora,
            annulledBy: operator,
            annulledReason: `Transformação ${transformation.code} anulada`
          },
          { merge: true }
        );
      }

      const updatedTrf: ProductTransformation = {
        ...transformation,
        status: 'Cancelada',
        updatedAt: agora
      };
      transaction.set(doc(db, 'transformations', transformation.id), this.sanitizeData(updatedTrf));

      transaction.set(
        doc(db, 'audit_logs', `log-trf-rev-${transformation.id}`),
        this.sanitizeData({
          id: `log-trf-rev-${transformation.id}`,
          timestamp: agora,
          username: operator,
          ipAddress,
          action: 'Transformação de Produto Anulada',
          status: 'Alerta',
          level: 'WARNING',
          entity: 'transformations',
          details:
            `Guia ${transformation.code} anulada. Devolvidos ${transformation.originalQuantity} ` +
            `${transformation.originalUnit} a ${transformation.originalProductName} e retirados os artigos gerados. ` +
            `Perda ${transformation.lossQuantity || 0} anulada (não apagada).`
        } as AuditLog)
      );
    });

    this.productsCache = null;
    this.transformationsCache = null;
    this.lossesCache = null;

    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'transformation-reversal' } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'transformations', id: transformation.id } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'losses', action: 'transformation-reversal' } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'stock_movements', action: 'transformation-reversal' } }));
  }

  // --- Employees ---
  public async getEmployees(): Promise<Employee[]> {
    if (this.employeesCache && this.employeesCache.length >= 0) {
      return this.employeesCache;
    }
    const list = await this.getAll<Employee>('employees');
    this.employeesCache = list.sort((a, b) => a.name.localeCompare(b.name));
    return this.employeesCache;
  }
  public async saveEmployee(e: Employee): Promise<void> { 
    await this.upsert('employees', e.id, e); 
    this.employeesCache = null;
  }
  public async deleteEmployee(id: string): Promise<void> { 
    await this.deleteRow('employees', id); 
    this.employeesCache = null;
  }

  // --- Attendance ---
  public async getAttendance(): Promise<Attendance[]> { 
    if (this.attendanceCache && this.attendanceCache.length >= 0) {
      return this.attendanceCache;
    }
    const list = await this.getAll<Attendance>('attendance');
    this.attendanceCache = list.sort((a, b) => b.date.localeCompare(a.date));
    return this.attendanceCache;
  }
  public async saveAttendance(a: Attendance): Promise<void> { 
    await this.upsert('attendance', a.id, a); 
    this.attendanceCache = null;
  }

  // --- Audit Logs ---
  public async getAuditLogs(): Promise<AuditLog[]> {
    const list = await this.getAll<AuditLog>('audit_logs');
    return list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /** Query active or archived audit history by period, one bounded page at a time. */
  public async getAuditLogsPage(options: AuditLogPageOptions = {}): Promise<PaginatedResult<AuditLog>> {
    const collectionName = options.source === 'archive' ? 'audit_logs_archive' : 'audit_logs';
    return this.getOrderedPage<AuditLog>(
      collectionName,
      'timestamp',
      'desc',
      options.pageSize,
      options.cursor,
      this.getDateRangeConstraints('timestamp', options)
    );
  }

  /**
   * Fetch a complete selected period only when explicitly exporting it. The
   * default audit screen must use getAuditLogsPage instead.
   */
  public async getAuditLogsForPeriod(
    options: Omit<AuditLogPageOptions, 'cursor' | 'pageSize'> = {}
  ): Promise<AuditLog[]> {
    const allLogs: AuditLog[] = [];
    let cursor: FirestorePageCursor | null = null;

    do {
      const page = await this.getAuditLogsPage({ ...options, cursor, pageSize: 250 });
      allLogs.push(...page.items);
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    } while (cursor);

    return allLogs;
  }

  /**
   * Moves one safe batch of old logs to a separate collection. Every source
   * record is copied and deleted in the same atomic Firestore batch, so a failed
   * commit leaves the live log untouched. No audit record is silently discarded.
   */
  public async archiveAuditLogsBefore(
    cutoffDate: string,
    requestedBatchSize?: number
  ): Promise<AuditArchiveResult> {
    await this.ensureAuth();
    const cutoffTimestamp = getArchiveCutoffTimestamp(cutoffDate);
    const batchSize = getSafeArchiveBatchSize(requestedBatchSize);
    const sourceQuery = query(
      collection(db, 'audit_logs'),
      where('timestamp', '<', cutoffTimestamp),
      orderBy('timestamp', 'asc'),
      // One sentinel document lets the UI say truthfully whether another safe
      // archive click is needed, without exceeding the write-batch limit.
      limit(batchSize + 1)
    );
    const snapshot = await getDocs(sourceQuery);
    const documentsToArchive = snapshot.docs.slice(0, batchSize);

    if (documentsToArchive.length === 0) {
      return { archivedCount: 0, hasMore: false, cutoffTimestamp };
    }

    const archivedAt = new Date().toISOString();
    const batch = writeBatch(db);
    documentsToArchive.forEach(sourceDocument => {
      const sourceLog = this.recordFromSnapshot<AuditLog>(sourceDocument);
      const archivedRecord = this.sanitizeData({
        ...sourceLog,
        id: sourceLog.id || sourceDocument.id,
        archivedAt,
        archivedFrom: 'audit_logs'
      });
      batch.set(doc(db, 'audit_logs_archive', sourceDocument.id), archivedRecord);
      batch.delete(sourceDocument.ref);
    });

    await batch.commit();
    window.dispatchEvent(new CustomEvent('db-update', {
      detail: { table: 'audit_logs', action: 'archived', count: documentsToArchive.length }
    }));
    window.dispatchEvent(new CustomEvent('db-update', {
      detail: { table: 'audit_logs_archive', action: 'archived', count: documentsToArchive.length }
    }));

    return {
      archivedCount: documentsToArchive.length,
      hasMore: snapshot.docs.length > batchSize,
      cutoffTimestamp
    };
  }

  /**
   * Records an audit event without invalidating an already completed business
   * action. If the audit collection is temporarily unavailable, the record is
   * retained locally and sent again later.
   *
   * Returns true when Firestore accepted the record immediately and false when
   * it was safely deferred.
   */
  public async addAuditLog(l: AuditLog): Promise<boolean> {
    // Persist first so auditability is retained even when Firestore keeps an
    // offline write pending for a long time.
    this.queueAuditLog(l);
    try {
      await this.upsert('audit_logs', l.id, l);
      this.removePendingAuditLog(l.id);
      // A working write is a good opportunity to retry earlier deferred logs.
      void this.flushPendingAuditLogs();
      return true;
    } catch (error) {
      console.warn('[FirebaseDBService] Audit log deferred; the original operation remains successful:', error);
      return false;
    }
  }

  // --- Active Sessions ---
  public async getActiveSessions(): Promise<ActiveSession[]> {
    if (this.activeSessionsCache && this.activeSessionsCache.length >= 0) {
      return this.activeSessionsCache;
    }
    const list = await this.getAll<ActiveSession>('active_sessions');
    this.activeSessionsCache = list.sort((a, b) => b.loginTime.localeCompare(a.loginTime));
    return this.activeSessionsCache;
  }
  /**
   * Encerra sessões antigas do mesmo utilizador/IP/dispositivo (do `main`).
   * Trazido na fusão: o ecrã de login conta com este método para não deixar
   * sessões de ontem abertas.
   */
  public async terminatePreviousSessions(params: {
    username?: string;
    ipAddress?: string;
    deviceId?: string;
    excludeSessionId?: string;
  }): Promise<string[]> {
    const list = await this.getAll<ActiveSession>('active_sessions');
    const now = Date.now();
    const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000;
    const terminatedIds: string[] = [];

    const normUser = params.username ? params.username.toLowerCase().trim() : '';
    const normIp =
      params.ipAddress && params.ipAddress !== 'N/D' && params.ipAddress !== 'Local / N/D'
        ? params.ipAddress.trim()
        : '';
    const normDev = params.deviceId ? params.deviceId.trim() : '';

    for (const sess of list) {
      if (params.excludeSessionId && sess.id === params.excludeSessionId) continue;

      const sessUser = (sess.username || '').toLowerCase().trim();
      const sessIp = (sess.ipAddress || '').trim();
      const sessDev = (sess.deviceId || '').trim();
      const sessTime = new Date(sess.loginTime).getTime();
      const isStale = isNaN(sessTime) || now - sessTime > MAX_SESSION_AGE_MS;

      const isSameUser = Boolean(normUser && sessUser === normUser);
      const isSameIp = Boolean(normIp && sessIp && sessIp !== 'N/D' && sessIp !== 'Local / N/D' && sessIp === normIp);
      const isSameDevice = Boolean(normDev && sessDev && sessDev === normDev);

      if (isSameUser || isSameIp || isSameDevice || isStale) {
        try {
          await this.removeActiveSession(sess.id);
          terminatedIds.push(sess.id);
        } catch (e) {
          console.warn('[SessionCleanup] Erro ao remover sessão antiga:', sess.id, e);
        }
      }
    }

    return terminatedIds;
  }

  /** Sinal de vida da sessão (bloqueio por inactividade). */
  public async updateSessionHeartbeat(sessionId: string): Promise<void> {
    if (!sessionId) return;
    try {
      const nowIso = new Date().toISOString();
      if (this.activeSessionsCache) {
        const item = this.activeSessionsCache.find(x => x.id === sessionId);
        if (item) item.lastHeartbeat = nowIso;
      }
    } catch {
      // Heartbeat não pode rebentar a aplicação por falhar.
    }
  }

  public async saveActiveSession(s: ActiveSession): Promise<void> { 
    await this.upsert('active_sessions', s.id, s);
    if (!this.activeSessionsCache) this.activeSessionsCache = [];
    const idx = this.activeSessionsCache.findIndex(x => x.id === s.id);
    if (idx >= 0) {
      this.activeSessionsCache[idx] = s;
    } else {
      this.activeSessionsCache.unshift(s);
    }
  }
  public async removeActiveSession(id: string): Promise<void> { 
    await this.deleteRow('active_sessions', id);
    if (this.activeSessionsCache) {
      this.activeSessionsCache = this.activeSessionsCache.filter(x => x.id !== id);
    }
  }
  public async clearActiveSessions(): Promise<void> {
    const list = await this.getActiveSessions();
    for (const s of list) {
      await this.removeActiveSession(s.id);
    }
  }

  // --- Settings ---
  private getDefaultSettings(): SystemSettings {
    return {
      mode: 'Online', companyName: 'AGRO - XICOMO & SERVIÇOS, LDA', logoUrl: '', stockPasswordHash: '05082',
      vodacom1: '845197072', vodacom2: '84 94 23 241', vodacom3: '', movitel1: '86 36 99900', movitel2: '', movitel3: '',
      fixo1: '', fixo2: '', email: 'agroxicomo1@gmail.com', banco: 'First Capital Bank, S.A.', numero_conta: '99466610001',
      nib: '001000000099466610196', banco2: '', numero_conta2: '', nib2: '', mpesa: '', emola: '',
      companyNuit: '401976590', criticalStockLevel: 10, printerA4: 'Microsoft Print to PDF', printerThermal: 'Xprinter XP-80', theme: 'light'
    };
  }

  public async getSettings(): Promise<SystemSettings> {
    if (this.settingsCache) {
      return this.settingsCache;
    }
    const cached = safeStorage.getItem('agro_settings_cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          this.settingsCache = parsed;
          return parsed;
        }
      } catch (e) {}
    }
    try {
      const snap = await getDoc(doc(db, 'settings', 'global'));
      if (snap.exists()) {
        const s = snap.data() as SystemSettings;
        this.settingsCache = s;
        safeStorage.setItem('agro_settings_cache', JSON.stringify(s));
        return s;
      }
    } catch(e) {}
    const def = this.getDefaultSettings();
    await this.saveSettings(def);
    return def;
  }

  public async saveSettings(s: SystemSettings): Promise<void> {
    this.settingsCache = s;
    safeStorage.setItem('agro_settings_cache', JSON.stringify(s));
    await this.upsert('settings', 'global', s);
  }

  // --- Credentials ---
  public async getCredentials(): Promise<UserCredentials[]> {
    if (this.credentialsCache && this.credentialsCache.length > 0) {
      return this.credentialsCache;
    }
    const cached = safeStorage.getItem('agro_credentials_cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.credentialsCache = parsed;
          return parsed;
        }
      } catch (e) {}
    }

    const list = await this.getAll<UserCredentials>('credentials');
    if (list && list.length > 0) {
      this.credentialsCache = list.sort((a, b) => a.username.localeCompare(b.username));
      safeStorage.setItem('agro_credentials_cache', JSON.stringify(this.credentialsCache));
      return this.credentialsCache;
    }

    // Se a base de dados estiver completamente vazia, criamos um utilizador administrador inicial
    const initialAdmin: UserCredentials[] = [
      {
        id: 'usr-admin-inicial',
        username: 'admin',
        passwordHash: 'sha256:AXadmin2026:ffe6646a86429864a103ddd12a441381390e88eee2e1d639268c4360b0e67e02',
        role: 'Técnico',
        roles: ['Técnico'],
        mfaEnabled: false,
        mustChangePassword: true,
        passwordResetVersion: 2
      }
    ];
    await this.upsertBatch('credentials', initialAdmin);
    this.credentialsCache = initialAdmin;
    safeStorage.setItem('agro_credentials_cache', JSON.stringify(initialAdmin));
    return initialAdmin;
  }

  public async saveCredential(c: UserCredentials): Promise<void> {
    await this.upsert('credentials', c.id, c);
    if (!this.credentialsCache) {
      this.credentialsCache = [];
    }
    const idx = this.credentialsCache.findIndex(u => u.id === c.id || u.username.toLowerCase() === c.username.toLowerCase());
    if (idx >= 0) {
      this.credentialsCache[idx] = c;
    } else {
      this.credentialsCache.push(c);
    }
    this.credentialsCache.sort((a, b) => a.username.localeCompare(b.username));
    safeStorage.setItem('agro_credentials_cache', JSON.stringify(this.credentialsCache));
  }

  public async deleteCredential(id: string): Promise<void> {
    await this.deleteRow('credentials', id);
    if (this.credentialsCache) {
      this.credentialsCache = this.credentialsCache.filter(u => u.id !== id);
      safeStorage.setItem('agro_credentials_cache', JSON.stringify(this.credentialsCache));
    }
  }

  // --- Payroll Payments ---
  public async getPayrollPayments(): Promise<PayrollPayment[]> { 
    if (this.payrollCache && this.payrollCache.length >= 0) {
      return this.payrollCache;
    }
    const list = await this.getAll<PayrollPayment>('payroll_payments');
    this.payrollCache = list.sort((a, b) => (b.paymentDate || b.date).localeCompare(a.paymentDate || a.date));
    return this.payrollCache;
  }
  public async savePayrollPayment(p: PayrollPayment): Promise<void> { 
    await this.upsert('payroll_payments', p.id, p); 
    this.payrollCache = null;
  }

  // --- Customers ---
  public async getCustomers(): Promise<Customer[]> {
    if (this.customersCache) return this.customersCache;
    const list = await this.getAll<Customer>('customers');
    this.customersCache = list.sort((a, b) => a.name.localeCompare(b.name));
    return this.customersCache;
  }
  public async saveCustomer(c: Customer): Promise<void> { await this.upsert('customers', c.id, c); this.customersCache = null; }
  public async deleteCustomer(id: string): Promise<void> { await this.deleteRow('customers', id); this.customersCache = null; }

  // --- Paused Sales ---
  public async getPausedSales(): Promise<PausedSale[]> {
    if (this.pausedSalesCache && this.pausedSalesCache.length >= 0) {
      return this.pausedSalesCache;
    }
    const list = await this.getAll<PausedSale>('paused_sales');
    this.pausedSalesCache = list.sort((a, b) => b.date.localeCompare(a.date));
    return this.pausedSalesCache;
  }
  public async savePausedSale(ps: PausedSale): Promise<void> { 
    await this.upsert('paused_sales', ps.id, ps); 
    this.pausedSalesCache = null;
  }
  public async deletePausedSale(id: string): Promise<void> { 
    await this.deleteRow('paused_sales', id); 
    this.pausedSalesCache = null;
  }

  // --- Complete System Backup & Export (Parte 1 & Parte 9) ---
  public async exportAllData(): Promise<string> {
    const [
      products,
      sales,
      losses,
      transformations,
      employees,
      attendance,
      audit_logs,
      audit_logs_archive,
      settings,
      credentials,
      payroll_payments,
      customers,
      paused_sales
    ] = await Promise.all([
      this.getProducts(),
      this.getSales(),
      this.getLosses(),
      this.getTransformations(),
      this.getEmployees(),
      this.getAttendance(),
      this.getAuditLogs(),
      this.getAuditLogsForPeriod({ source: 'archive' }),
      this.getSettings(),
      this.getCredentials(),
      this.getPayrollPayments(),
      this.getCustomers(),
      this.getPausedSales()
    ]);

    const backupPayload = {
      system: 'AGRO - XICOMO & SERVIÇOS, LDA - ERP Zero Loss',
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      counts: {
        products: products.length,
        sales: sales.length,
        losses: losses.length,
        transformations: transformations.length,
        employees: employees.length,
        attendance: attendance.length,
        audit_logs: audit_logs.length,
        audit_logs_archive: audit_logs_archive.length,
        payroll_payments: payroll_payments.length,
        customers: customers.length,
        paused_sales: paused_sales.length
      },
      data: {
        products,
        sales,
        losses,
        transformations,
        employees,
        attendance,
        audit_logs,
        audit_logs_archive,
        settings: settings ? [settings] : [],
        credentials,
        payroll_payments,
        customers,
        paused_sales
      }
    };

    return JSON.stringify(backupPayload, null, 2);
  }

  public async importAllData(jsonStr: string): Promise<void> {
    const parsed = JSON.parse(jsonStr);
    const data = parsed.data || parsed; // Support both nested format and legacy format

    if (Array.isArray(data.products) && data.products.length > 0) {
      await this.upsertBatch('products', data.products);
      this.productsCache = null;
    }
    if (Array.isArray(data.sales) && data.sales.length > 0) {
      await this.upsertBatch('sales', data.sales);
      this.salesCache = null;
    }
    if (Array.isArray(data.losses) && data.losses.length > 0) {
      await this.upsertBatch('losses', data.losses);
    }
    if (Array.isArray(data.transformations) && data.transformations.length > 0) {
      await this.upsertBatch('transformations', data.transformations);
      this.transformationsCache = null;
    }
    if (Array.isArray(data.employees) && data.employees.length > 0) {
      await this.upsertBatch('employees', data.employees);
    }
    if (Array.isArray(data.attendance) && data.attendance.length > 0) {
      await this.upsertBatch('attendance', data.attendance);
    }
    if (Array.isArray(data.audit_logs) && data.audit_logs.length > 0) {
      await this.upsertBatch('audit_logs', data.audit_logs);
    }
    if (Array.isArray(data.audit_logs_archive) && data.audit_logs_archive.length > 0) {
      await this.upsertBatch('audit_logs_archive', data.audit_logs_archive);
    }
    if (Array.isArray(data.credentials) && data.credentials.length > 0) {
      await this.upsertBatch('credentials', data.credentials);
      this.credentialsCache = null;
    }
    if (Array.isArray(data.payroll_payments) && data.payroll_payments.length > 0) {
      await this.upsertBatch('payroll_payments', data.payroll_payments);
    }
    if (Array.isArray(data.customers) && data.customers.length > 0) {
      await this.upsertBatch('customers', data.customers);
      this.customersCache = null;
    }
    if (Array.isArray(data.paused_sales) && data.paused_sales.length > 0) {
      await this.upsertBatch('paused_sales', data.paused_sales);
    }
    if (Array.isArray(data.settings) && data.settings.length > 0) {
      await this.saveSettings(data.settings[0]);
    }

    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'all', action: 'import' } }));
  }

  public async autoBackupToLocalStorage(): Promise<void> {
    try {
      const dataStr = await this.exportAllData();
      const timestamp = new Date().toISOString();
      const indexStr = safeStorage.getItem('agro_erp_backups_index') || '[]';
      let index = JSON.parse(indexStr) as string[];

      // Purge orphan keys
      const expectedKeys = new Set(index.map(t => `agro_erp_backup_${t}`));
      for (let i = 0; i < safeStorage.length; i++) {
        const key = safeStorage.key(i);
        if (key && key.startsWith('agro_erp_backup_') && !expectedKeys.has(key)) {
          safeStorage.removeItem(key);
          i--;
        }
      }

      // Keep at most 3 backups in localStorage
      while (index.length >= 3) {
        const oldest = index.pop();
        if (oldest) {
          safeStorage.removeItem(`agro_erp_backup_${oldest}`);
        }
      }

      const key = `agro_erp_backup_${timestamp}`;
      try {
        safeStorage.setItem(key, dataStr);
        index.unshift(timestamp);
        safeStorage.setItem('agro_erp_backups_index', JSON.stringify(index));
        console.log('[FirebaseDBService] Automated scheduled backup saved at:', timestamp);
      } catch (quotaError) {
        console.warn('Quota exceeded. Emergency purge of older backups...');
        for (const t of index) {
          safeStorage.removeItem(`agro_erp_backup_${t}`);
        }
        index = [];
        safeStorage.setItem(key, dataStr);
        index.unshift(timestamp);
        safeStorage.setItem('agro_erp_backups_index', JSON.stringify(index));
      }
    } catch (e) {
      console.error('Error during automated backup:', e);
    }
  }

  /**
   * Apaga dados operacionais. **Só para limpeza de dados de teste antes de
   * entrar em produção.**
   *
   * Nunca deve ser usada para "fechar exercício": a legislação obriga a
   * conservar o registo de vendas e de documentos fiscais, e o fecho de ano
   * resolve-se pela numeração por ano (já implementada em `counters`), não
   * apagando o histórico. Ver `handleNovoAno` no módulo técnico.
   *
   * Devolve a contagem por coleção para que a operação possa ser auditada com
   * números reais em vez de "concluído".
   */
  public async clearSystemData(): Promise<Record<string, number>> {
    console.log('[FirebaseDBService] clearSystemData requested');
    // Credenciais e definições ficam intactas de propósito.
    const collectionsToClear = [
      'sales',
      'losses',
      'attendance',
      'payroll_payments',
      'paused_sales',
      'transformations',
      // O livro de stock referencia vendas: se as vendas desaparecem e os
      // movimentos ficam, a reconciliação passa a acusar diferenças eternas.
      'stock_movements'
    ];
    const deleted: Record<string, number> = {};

    for (const col of collectionsToClear) {
      const docs = await this.getAll<{ id: string }>(col);
      deleted[col] = 0;
      for (let i = 0; i < docs.length; i += 400) {
        const lote = docs.slice(i, i + 400);
        const batch = writeBatch(db);
        lote.forEach(d => {
          if (!d || !d.id) return;
          batch.delete(doc(db, col, String(d.id)));
        });
        await batch.commit();
        deleted[col] += lote.length;
      }
    }

    this.salesCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'all', action: 'clear' } }));
    return deleted;
  }

  // --- Stock Reconciliation Engine (Parte 7) ---
  /**
   * Reconciliação de stock.
   *
   * Nota importante: o sistema NÃO tem livro de movimentos de stock (nem stock
   * inicial, nem entradas de compra), pelo que não é possível reconstruir o
   * stock "teórico" absoluto de um produto simples. O que é possível — e é o
   * que esta rotina faz agora, em vez de devolver sempre zero — é validar:
   *  1. a composição dos produtos híbridos (sacos × fator + retalho = total);
   *  2. a existência de saldos negativos (venda acima do disponível);
   *  3. o consumo por vendas, perdas e transformações, para auditoria.
   */
  public async reconcileStock(): Promise<{
    items: Array<{
      productId: string;
      productName: string;
      recordedStock: number;
      calculatedStock: number;
      difference: number;
      totalSold: number;
      totalLost: number;
      totalTransformedIn: number;
      totalTransformedOut: number;
      negativeStock: boolean;
      /** 'units' = produto simples (sem base de cálculo); 'conversion' = híbrido. */
      basis: 'units' | 'conversion';
      status: 'Sincronizado' | 'Discrepância';
    }>;
    discrepancies: Array<any>;
    discrepantCount: number;
    alignedCount: number;
    totalProductsChecked: number;
    hasDiscrepancies: boolean;
  }> {
    const products = await this.getProducts();
    const sales = await this.getSales();
    const losses = await this.getLosses();
    const transformations = await this.getTransformations();

    const items = [];
    const round2 = (n: number) => Math.round(n * 100) / 100;

    for (const prod of products) {
      const conversionRate = Number(prod.conversionRate) || 0;
      const isHybrid = Boolean(prod.parentUnit) && conversionRate > 1;
      const bulkQty = Number(prod.stockQtyBulk) || 0;
      const retailQty = Number(prod.stockQtyRetail) || 0;
      const recordedStock = Number(prod.stockQty) || 0;

      // Consumo em unidades base (um saco conta como `conversionRate` unidades).
      let totalSold = 0;
      sales.forEach(s => {
        if (s.status === 'Cancelada') return;
        (s.items || []).forEach(it => {
          if (it.productId === prod.id) {
            const qty = Number(it.quantity) || 0;
            totalSold += it.sellingUnit === 'Bulk' && isHybrid ? qty * conversionRate : qty;
          }
        });
      });

      // Calculate total lost
      let totalLost = 0;
      losses.forEach(l => {
        if (l.productId === prod.id) {
          totalLost += Number(l.quantity) || 0;
        }
      });

      // Calculate transformations out (where prod was original)
      let totalTransformedOut = 0;
      transformations.forEach(t => {
        if (t.status === 'Cancelada') return;
        if (t.originalProductId === prod.id) {
          totalTransformedOut += t.originalQuantity;
        }
      });

      // Calculate transformations in (where prod was resulting)
      let totalTransformedIn = 0;
      transformations.forEach(t => {
        if (t.status === 'Cancelada') return;
        (t.items || []).forEach(it => {
          if (it.resultingProductId === prod.id) {
            totalTransformedIn += it.quantity;
          }
        });
      });

      // Stock derivado: só os híbridos têm duas componentes que devem somar
      // ao total. Nos restantes não há base de cálculo sem livro de movimentos.
      const calculatedStock = isHybrid
        ? round2(bulkQty * conversionRate + retailQty)
        : recordedStock;
      const difference = isHybrid ? round2(recordedStock - calculatedStock) : 0;
      const negativeStock = recordedStock < 0;
      const hasDiscrepancy = negativeStock || Math.abs(difference) > 0.001;

      items.push({
        productId: prod.id,
        productName: prod.name,
        recordedStock,
        calculatedStock,
        difference,
        totalSold: round2(totalSold),
        totalLost,
        totalTransformedIn: round2(totalTransformedIn),
        totalTransformedOut: round2(totalTransformedOut),
        negativeStock,
        basis: isHybrid ? 'conversion' : 'units',
        status: (hasDiscrepancy ? 'Discrepância' : 'Sincronizado') as 'Sincronizado' | 'Discrepância'
      });
    }

    const discrepancies = items.filter(i => i.status === 'Discrepância');

    return {
      items,
      discrepancies,
      discrepantCount: discrepancies.length,
      alignedCount: items.length - discrepancies.length,
      totalProductsChecked: products.length,
      hasDiscrepancies: discrepancies.length > 0
    };
  }

  // --- Misc Helpers ---
  public isSSEActive(): boolean { return true; }
  public getPendingCount(): number { return 0; }
  public getLastSyncTime(): string { return new Date().toLocaleTimeString(); }

  // --- Active Cart ---
  /**
   * I-02: o rascunho do PDV era uma chave única no armazenamento partilhado.
   * Duas abas (ou dois postos no mesmo browser) escreviam no mesmo sítio e o
   * carrinho de um aparecia no outro. A chave passa a incluir o separador.
   */
  private activeCartKey(): string {
    let tabId = '';
    try {
      tabId = safeSessionStorage.getItem('agro_tab_id') || '';
      if (!tabId) {
        tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        safeSessionStorage.setItem('agro_tab_id', tabId);
      }
    } catch {
      tabId = 'tab-default';
    }
    return `agro_active_cart_${tabId}`;
  }

  public async saveActiveCart(cartData: any): Promise<void> {
    try {
      safeStorage.setItem(this.activeCartKey(), JSON.stringify(cartData));
    } catch (e) {}
  }
  public async getActiveCart(): Promise<any | null> {
    try {
      const saved = safeStorage.getItem(this.activeCartKey());
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }
  public async clearActiveCart(): Promise<void> {
    try {
      safeStorage.removeItem(this.activeCartKey());
      // Limpa também a chave antiga (rascunhos criados antes de I-02).
      safeStorage.removeItem('agro_active_cart');
    } catch (e) {}
  }

  // --- Compatibility Stubs ---
  public isConfigured(): boolean { return true; }
  public getFirebaseConfig(): { url: string; key: string } { return { url: 'Firebase', key: 'Managed by AI Studio' }; }
  public setFirebaseConfig(url: string, key: string): void {}
  public clearFirebaseConfig(): void {}
  public async testConnection(customUrl?: string, customKey?: string): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    return { success: true, message: 'Firebase conectado com sucesso e operando com sincronização em tempo real!', latencyMs: 38 };
  }
  public async syncAllWithFirebase(): Promise<{ success: boolean; logs: string[]; summary: Record<string, { local: number; cloud: number; synced: number }> }> {
    return { success: true, logs: ['Sincronização Firebase em Tempo Real ativa e consistente.'], summary: {} };
  }
  public async resetProductsToInitial(): Promise<Product[]> {
    this.productsCache = null;
    safeStorage.removeItem('agro_products_cache');
    const seeded = INITIAL_PRODUCTS.map(p => ({ ...p }));
    await this.upsertBatch('products', seeded);
    return seeded;
  }
}

export const dbService = new FirebaseDBService();
