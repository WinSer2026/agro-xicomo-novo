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
  runTransaction,
  increment,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getAggregateFromServer,
  count,
  sum,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type DocumentData
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
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
  ProductTransformation
} from '../types';
import { INITIAL_PRODUCTS } from '../data/initialProducts';
import { safeStorage } from './safeStorage';
import { getUnitCost } from './priceHelper';
import { uid } from './idHelper';
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

export interface SalesSummary {
  totalInvoiced: number;
  paidInvoiced: number;
  pendingInvoiced: number;
  canceledInvoiced: number;
  totalCount: number;
  paidCount: number;
  pendingCount: number;
  canceledCount: number;
}

export interface AuditArchiveResult {
  archivedCount: number;
  hasMore: boolean;
  cutoffTimestamp: string;
}

import type { StockCorrectionSnapshot } from './inventoryCutoff';

const app = initializeApp(firebaseConfig);

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

/** Comparações de ordenação tolerantes a campos em falta em registos legados. */
function safeStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

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
  private payrollCache: PayrollPayment[] | null = null;
  private pausedSalesCache: PausedSale[] | null = null;
  private employeesCache: Employee[] | null = null;
  private attendanceCache: Attendance[] | null = null;
  private lastWriteAckAt: number | null = null;
  private unsubscribers: (() => void)[] = [];
  private largeCollectionListenersStarted = false;

  public async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
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
      this.customersCache = customers.sort((a, b) => safeStr(a.name).localeCompare(safeStr(b.name)));
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
      this.transformationsCache = transformations.sort((a, b) => safeStr(b.date).localeCompare(safeStr(a.date)));
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
        this.credentialsCache = creds.sort((a, b) => safeStr(a.username).localeCompare(safeStr(b.username)));
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
      this.activeSessionsCache = sessions.sort((a, b) => safeStr(b.loginTime).localeCompare(safeStr(a.loginTime)));
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
      this.lossesCache = losses.sort((a, b) => safeStr(b.date).localeCompare(safeStr(a.date)));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'losses', count: losses.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (losses):', error);
    }));

    // Realtime payroll listener
    this.unsubscribers.push(onSnapshot(collection(db, 'payroll_payments'), (snapshot) => {
      const payroll: PayrollPayment[] = [];
      snapshot.forEach(d => payroll.push(d.data() as PayrollPayment));
      this.payrollCache = payroll.sort((a, b) => safeStr(b.paymentDate || b.date).localeCompare(safeStr(a.paymentDate || a.date)));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'payroll_payments', count: payroll.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (payroll_payments):', error);
    }));

    // Realtime employees listener
    this.unsubscribers.push(onSnapshot(collection(db, 'employees'), (snapshot) => {
      const employees: Employee[] = [];
      snapshot.forEach(d => employees.push(d.data() as Employee));
      this.employeesCache = employees.sort((a, b) => safeStr(a.name).localeCompare(safeStr(b.name)));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'employees', count: employees.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (employees):', error);
    }));

    // Realtime attendance listener
    this.unsubscribers.push(onSnapshot(collection(db, 'attendance'), (snapshot) => {
      const attendance: Attendance[] = [];
      snapshot.forEach(d => attendance.push(d.data() as Attendance));
      this.attendanceCache = attendance.sort((a, b) => safeStr(b.date).localeCompare(safeStr(a.date)));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'attendance', count: attendance.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (attendance):', error);
    }));

    // Realtime paused_sales listener
    this.unsubscribers.push(onSnapshot(collection(db, 'paused_sales'), (snapshot) => {
      const paused: PausedSale[] = [];
      snapshot.forEach(d => paused.push(d.data() as PausedSale));
      this.pausedSalesCache = paused.sort((a, b) => safeStr(b.createdAt || b.date).localeCompare(safeStr(a.createdAt || a.date)));
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
      this.productsCache = products.sort((a, b) => safeStr(a.name).localeCompare(safeStr(b.name)));
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
      this.salesCache = sales.sort((a, b) => safeStr(b.date).localeCompare(safeStr(a.date)));
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
  private async getAll<T>(colName: string): Promise<T[]> {
    try {
      const snapshot = await getDocs(collection(db, colName));
      const items = snapshot.docs.map(doc => doc.data() as T);
      return items;
    } catch (e) {
      console.error(`[FirebaseDBService] Error getting ${colName}:`, e);
      return [];
    }
  }

  /**
   * Strict variant of getAll(): distinguishes "collection is empty" from
   * "read failed". Critical reads (products, credentials) MUST use this so a
   * transient network error can never be mistaken for an empty database and
   * trigger destructive seeding/overwriting (Auditoria FASE 1, achados A-02/D-03).
   */
  private async getAllOrFail<T>(colName: string): Promise<T[]> {
    const snapshot = await getDocs(collection(db, colName));
    const items = snapshot.docs.map(doc => doc.data() as T);
    return items;
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
    try {
      const validId = String(id || data?.id || data?.invoiceNumber || Date.now());
      const sanitized = this.sanitizeData(data);
      await setDoc(doc(db, colName, validId), sanitized);
      this.lastWriteAckAt = Date.now();
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
      for (let offset = 0; offset < items.length; offset += writesPerCommit) {
        const batch = writeBatch(db);
        items.slice(offset, offset + writesPerCommit).forEach(item => {
          const validId = String(item.id || Date.now());
          const sanitized = this.sanitizeData(item);
          batch.set(doc(db, colName, validId), sanitized);
        });
        await batch.commit();
      }
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: colName, count: items.length } }));
    } catch (e) {
      console.error(`[FirebaseDBService] Error batch saving to ${colName}:`, e);
      throw e;
    }
  }

  private async deleteRow(colName: string, id: string): Promise<void> {
    try {
      const validId = String(id);
      await deleteDoc(doc(db, colName, validId));
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

  /**
   * Devolve SEMPRE cópias superficiais dos produtos.
   * Vários módulos alteram o produto no próprio objecto (ex.: prod.stockQty = ...)
   * antes de gravar. Como a cache partilhada era devolvida por referência, essas
   * alterações ficavam "sujas" na cache mesmo quando a gravação falhava — e dois
   * terminais passavam a ver valores diferentes. As cópias evitam esse efeito.
   */
  public async getProducts(): Promise<Product[]> {
    if (this.productsCache && this.productsCache.length > 0) {
      return this.productsCache.map(p => ({ ...p }));
    }
    const cached = safeStorage.getItem('agro_products_cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleaned = parsed.map(p => this.sanitizeProduct(p));
          this.productsCache = cleaned;
          // Se o listener em tempo real não estiver a correr, atualizar em background para
          // sincronizar alterações de preços feitas por outros postos sem bloquear a UI
          if (!this.largeCollectionListenersStarted) {
            this.getAllOrFail<Product>('products').then(fresh => {
              if (fresh && fresh.length > 0) {
                const freshCleaned = fresh.map(p => this.sanitizeProduct(p)).sort((a, b) => safeStr(a.name).localeCompare(safeStr(b.name)));
                this.productsCache = freshCleaned;
                safeStorage.setItem('agro_products_cache', JSON.stringify(freshCleaned));
                window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', count: freshCleaned.length } }));
              }
            }).catch(() => {});
          }
          return cleaned.map(p => ({ ...p }));
        }
      } catch (e) {}
    }
    // Leitura estrita: se a ligação falhar, NÃO interpretar como "catálogo
    // vazio". Em caso de erro, propagar e deixar o cache local servir de fallback.
    const rawProducts = await this.getAllOrFail<Product>('products');
    if (rawProducts.length === 0) {
      // NUNCA fazer seeding automático destrutivo aqui: isso sobrescrevia preços alterados
      // pelo gestor de stock para os valores de fábrica (INITIAL_PRODUCTS).
      this.productsCache = [];
      return [];
    }
    const products = rawProducts.map(p => this.sanitizeProduct(p));
    this.productsCache = products.sort((a, b) => safeStr(a.name).localeCompare(safeStr(b.name)));
    safeStorage.setItem('agro_products_cache', JSON.stringify(this.productsCache));
    return this.productsCache.map(p => ({ ...p }));
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
    await this.upsert('products', cleaned.id, cleaned);
    if (this.productsCache) {
      const idx = this.productsCache.findIndex(item => item.id === cleaned.id);
      if (idx >= 0) {
        this.productsCache[idx] = cleaned;
      } else {
        this.productsCache.push(cleaned);
      }
      this.productsCache.sort((a, b) => safeStr(a.name).localeCompare(safeStr(b.name)));
      safeStorage.setItem('agro_products_cache', JSON.stringify(this.productsCache));
    } else {
      safeStorage.removeItem('agro_products_cache');
    }
  }

  public async deductProductStock(cartItems: any[]): Promise<void> {
    if (cartItems.length === 0) return;
    try {
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
      safeStorage.removeItem('agro_products_cache');
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'stock-deduct' } }));
    } catch (e) {
      console.error("[FirebaseDBService] Error deducting stock:", e);
      // Stock movements are critical and must not be silently acknowledged.
      throw e;
    }
  }

  public async saveProducts(list: Product[]): Promise<void> {
    const cleanedList = list.map(p => this.sanitizeProduct(p));
    await this.upsertBatch('products', cleanedList);
    if (this.productsCache) {
      const map = new Map(cleanedList.map(item => [item.id, item]));
      this.productsCache = this.productsCache.map(p => map.get(p.id) || p);
      for (const item of cleanedList) {
        if (!this.productsCache.some(p => p.id === item.id)) {
          this.productsCache.push(item);
        }
      }
      this.productsCache.sort((a, b) => safeStr(a.name).localeCompare(safeStr(b.name)));
      safeStorage.setItem('agro_products_cache', JSON.stringify(this.productsCache));
    } else {
      safeStorage.removeItem('agro_products_cache');
    }
  }

  public async deleteProduct(id: string): Promise<void> {
    await this.deleteRow('products', id);
    if (this.productsCache) {
      this.productsCache = this.productsCache.filter(p => p.id !== id);
      safeStorage.setItem('agro_products_cache', JSON.stringify(this.productsCache));
    } else {
      safeStorage.removeItem('agro_products_cache');
    }
  }

  // --- Sales ---
  public async getSales(): Promise<Sale[]> {
    if (this.salesCache && this.salesCache.length > 0) {
      this.getAll<Sale>('sales').then(fresh => {
        if (fresh && fresh.length !== this.salesCache?.length) {
          this.salesCache = fresh.sort((a, b) => safeStr(b.date).localeCompare(safeStr(a.date)));
          window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', count: fresh.length } }));
        }
      }).catch(() => {});
      return this.salesCache;
    }
    const list = await this.getAll<Sale>('sales');
    this.salesCache = list.sort((a, b) => safeStr(b.date).localeCompare(safeStr(a.date)));
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

    const [paid, pending, credit, canceled] = await Promise.all([
      statusAggregate('Paga'),
      statusAggregate('Pendente'),
      statusAggregate('Crédito'),
      statusAggregate('Cancelada')
    ]);

    return {
      totalInvoiced: paid.total + pending.total + credit.total,
      paidInvoiced: paid.total,
      // The existing invoice tabs expose Pendente separately from Crédito.
      // Keep those labels truthful while still including credit invoices in the
      // overall issued-total/count.
      pendingInvoiced: pending.total,
      canceledInvoiced: canceled.total,
      totalCount: paid.count + pending.count + credit.count + canceled.count,
      paidCount: paid.count,
      pendingCount: pending.count,
      canceledCount: canceled.count
    };
  }

  /**
   * Numeração sequencial transaccional de documentos (facturas/recibos).
   * Serializa pedidos simultâneos de vendedores diferentes através de uma
   * transacção Firestore sobre `counters/{key}` (Auditoria FASE 1, D-01).
   *
   * `minimumNext` é o próximo número calculado localmente a partir do histórico
   * (garante continuidade com a numeração legada); o valor devolvido é sempre
   * >= minimumNext e nunca é repetido entre pedidos concorrentes.
   */
  public async nextDocumentNumber(counterKey: string, minimumNext: number): Promise<number> {
    const ref = doc(db, 'counters', counterKey);
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists() ? Number(snap.data().value || 0) : 0;
      const next = Math.max(current + 1, minimumNext);
      tx.set(ref, { value: next, updatedAt: new Date().toISOString() }, { merge: true });
      return next;
    });
  }

  public async addSale(s: Sale): Promise<void> {
    // Ensure all items retain their buying cost snapshot. The product catalog
    // lookup is best-effort: a catalog read failure must never block saving a
    // completed sale (items already carry their own cost snapshot).
    let prods: Product[] = [];
    try {
      prods = await this.getProducts();
    } catch (e) {
      console.warn('[FirebaseDBService] addSale(): catalog unavailable for cost enrichment, using item snapshots.', e);
    }
    const enrichedItems = (s.items || []).map(item => {
      const prod = prods.find(p => p.id === item.productId);
      // Produtos vendidos em saco e em quilo: o quilo não tem preço de compra próprio,
      // o seu custo é derivado do preço de compra do saco ÷ fator de conversão.
      const cost = item.costPrice ?? item.buyingPrice ?? (prod ? getUnitCost(prod, item.sellingUnit) : undefined) ?? (item.unitPrice * 0.6);
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

  public async addSaleWithStockDeduction(sale: Sale, deductionItems: any[]): Promise<void> {
    const saleId = String(sale.id || sale.invoiceNumber || Date.now());
    const batch = writeBatch(db);
    // 1. Deduct stock atomically
    for (const item of deductionItems) {
      if (!item || !item.productId) continue;
      const docRef = doc(db, "products", String(item.productId));
      if (item.hasConversion) {
        if (item.sellingUnit === "Bulk") {
          batch.set(docRef, { 
            stockQtyBulk: increment(-Number(item.qtyToReduce || 0)), 
            stockQty: increment(-Number(item.equivalentBaseQty || 0)) 
          }, { merge: true });
        } else {
          batch.set(docRef, { 
            stockQtyRetail: increment(-Number(item.qtyToReduce || 0)), 
            stockQty: increment(-Number(item.qtyToReduce || 0)) 
          }, { merge: true });
        }
      } else {
        batch.set(docRef, { stockQty: increment(-Number(item.qtyToReduce || 0)) }, { merge: true });
      }
    }

    // Ensure item cost snapshots (best-effort: never block the sale batch).
    let prods: Product[] = [];
    try {
      prods = await this.getProducts();
    } catch (e) {
      console.warn('[FirebaseDBService] addSaleWithStockDeduction(): catalog unavailable for cost enrichment, using item snapshots.', e);
    }
    const enrichedItems = (sale.items || []).map(item => {
      const prod = prods.find(p => String(p.id) === String(item.productId));
      const cost = item.costPrice ?? item.buyingPrice ?? (prod ? getUnitCost(prod, item.sellingUnit) : undefined) ?? (item.unitPrice * 0.6);
      return {
        ...item,
        costPrice: cost,
        buyingPrice: cost
      };
    });

    // 2. Add sale atomically in the same batch
    const sanitizedSale = this.sanitizeData({ 
      ...sale, 
      id: saleId,
      items: enrichedItems,
      createdAt: sale.createdAt || new Date().toISOString(),
      status: sale.status || 'Pendente' 
    });
    batch.set(doc(db, 'sales', saleId), sanitizedSale, { merge: true });

    await batch.commit();
    this.productsCache = null;
    this.salesCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', id: saleId } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'stock-deduct' } }));
  }

  public async cancelSaleWithStockRestoration(sale: Sale, restockItems: any[]): Promise<void> {
    const saleId = String(sale.id || sale.invoiceNumber || Date.now());
    const batch = writeBatch(db);
    // 1. Restock products atomically
    for (const item of restockItems) {
      if (!item || !item.productId) continue;
      const docRef = doc(db, "products", String(item.productId));
      if (item.hasConversion) {
        if (item.sellingUnit === "Bulk") {
          batch.set(docRef, { 
            stockQtyBulk: increment(Number(item.qtyToAdd || 0)), 
            stockQty: increment(Number(item.equivalentBaseQty || 0)) 
          }, { merge: true });
        } else {
          batch.set(docRef, { 
            stockQtyRetail: increment(Number(item.qtyToAdd || 0)), 
            stockQty: increment(Number(item.qtyToAdd || 0)) 
          }, { merge: true });
        }
      } else {
        batch.set(docRef, { stockQty: increment(Number(item.qtyToAdd || 0)) }, { merge: true });
      }
    }
    // 2. Update sale status to 'Cancelada' atomically
    const sanitizedSale = this.sanitizeData({ ...sale, id: saleId, status: 'Cancelada' });
    batch.set(doc(db, 'sales', saleId), sanitizedSale, { merge: true });

    await batch.commit();
    this.productsCache = null;
    this.salesCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', id: saleId } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'stock-restore' } }));
  }

  /**
   * CORTE DE INVENTÁRIO — grava saldos absolutos de stock em lote.
   *
   * Usa valores absolutos (e não incrementos) porque a operação é sempre precedida de
   * uma pré-visualização: o saldo que o gestor aprovou no ecrã é exactamente o saldo
   * que fica gravado, sem surpresas de concorrência.
   */
  public async applyStockCorrection(snapshots: StockCorrectionSnapshot[]): Promise<number> {
    const list = (snapshots || []).filter(s => s && s.productId);
    if (list.length === 0) return 0;

    const CHUNK = 400; // limite seguro abaixo das 500 operações por batch do Firestore
    for (let i = 0; i < list.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const snapshot of list.slice(i, i + CHUNK)) {
        const payload: Record<string, number> = { stockQty: Math.max(0, Number(snapshot.stockQty) || 0) };
        if (snapshot.stockQtyBulk !== undefined) payload.stockQtyBulk = Math.max(0, Number(snapshot.stockQtyBulk) || 0);
        if (snapshot.stockQtyRetail !== undefined) payload.stockQtyRetail = Math.max(0, Number(snapshot.stockQtyRetail) || 0);
        batch.set(doc(db, 'products', String(snapshot.productId)), payload, { merge: true });
      }
      await batch.commit();
    }

    this.productsCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'stock-correction' } }));
    return list.length;
  }

  /**
   * CORTE DE INVENTÁRIO — anula várias vendas numa só operação.
   *
   * @param sales      documentos já marcados como 'Cancelada' (ver annotateCancelledSale).
   * @param snapshots  saldos de stock a gravar em simultâneo. Deixar vazio quando a
   *                   anulação NÃO deve mexer no stock (caso típico: a contagem física
   *                   já lançada no sistema é anterior a estas vendas).
   */
  public async cancelSalesBulk(sales: Sale[], snapshots: StockCorrectionSnapshot[] = []): Promise<number> {
    const list = (sales || []).filter(Boolean);
    if (list.length === 0) return 0;

    const CHUNK = 400;
    const stockList = (snapshots || []).filter(s => s && s.productId);

    for (let i = 0; i < list.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const sale of list.slice(i, i + CHUNK)) {
        const saleId = String(sale.id || sale.invoiceNumber || uid('sale-'));
        batch.set(doc(db, 'sales', saleId), this.sanitizeData({ ...sale, id: saleId, status: 'Cancelada' }), { merge: true });
      }
      await batch.commit();
    }

    if (stockList.length > 0) {
      await this.applyStockCorrection(stockList);
    }

    this.salesCache = null;
    this.productsCache = null;
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', action: 'bulk-cancel', count: list.length } }));
    return list.length;
  }



  // --- Losses ---
  public async getLosses(): Promise<LossRecord[]> {
    if (this.lossesCache && this.lossesCache.length > 0) {
      return this.lossesCache;
    }
    const list = await this.getAll<LossRecord>('losses');
    this.lossesCache = list.sort((a, b) => safeStr(b.date).localeCompare(safeStr(a.date)));
    return this.lossesCache;
  }

  public async addLoss(l: LossRecord): Promise<void> {
    await this.upsert('losses', l.id, l);
    this.lossesCache = null;
  }

  // --- Product Transformations (Parte 4) ---
  public async getTransformations(): Promise<ProductTransformation[]> {
    if (this.transformationsCache && this.transformationsCache.length > 0) {
      return this.transformationsCache;
    }
    const list = await this.getAll<ProductTransformation>('transformations');
    this.transformationsCache = list.sort((a, b) => safeStr(b.date || b.createdAt).localeCompare(safeStr(a.date || a.createdAt)));
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
   * Atomic Transaction for Product Transformation (Parte 4):
   * 1. Deducts original product stock (both total base unit and bulk/retail).
   * 2. Adds or updates resulting products with calculated proportional costs.
   * 3. Records transformation loss if any.
   * 4. Saves the transformation record.
   * 5. Emits real-time synchronization events.
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
    }
  ): Promise<void> {
    const batch = writeBatch(db);

    // 1. Deduct Original Product Stock
    const origDocRef = doc(db, 'products', originalDeduction.productId);
    if (originalDeduction.isBulk) {
      batch.update(origDocRef, {
        stockQtyBulk: increment(-originalDeduction.qtyToDeduct),
        stockQty: increment(-(originalDeduction.equivalentBaseQty || originalDeduction.qtyToDeduct))
      });
    } else {
      batch.update(origDocRef, {
        stockQty: increment(-originalDeduction.qtyToDeduct),
        stockQtyRetail: increment(-originalDeduction.qtyToDeduct)
      });
    }

    // 2. Add / Update Resulting Products
    for (const item of itemsToCredit) {
      const prodDocRef = doc(db, 'products', item.productId);
      if (item.productData && !item.productData.id) {
        // Brand new product being created via transformation
        const newProd: Product = {
          id: item.productId,
          code: item.code || ('TRF-' + Math.floor(1000000000000 + Math.random() * 900000000000).toString()),
          name: item.name,
          category: item.category || 'Transformados',
          stockQty: item.qtyToAdd,
          stockQtyRetail: item.qtyToAdd,
          buyingPrice: item.costPrice,
          sellingPrice: item.unitPrice,
          baseUnit: item.baseUnit || 'Pacotes',
          ...item.productData
        };
        batch.set(prodDocRef, this.sanitizeData(newProd));
      } else {
        // Existing product: increase stock and update unit cost if applicable
        batch.update(prodDocRef, {
          stockQty: increment(item.qtyToAdd),
          stockQtyRetail: increment(item.qtyToAdd)
        });
      }
    }

    // 3. Record Loss in Losses collection if lossQuantity > 0
    if (transformation.lossQuantity > 0) {
      const lossId = 'loss-trf-' + transformation.id;
      const lossRecord: LossRecord = {
        id: lossId,
        productId: transformation.originalProductId,
        productName: transformation.originalProductName,
        quantity: transformation.lossQuantity,
        unit: transformation.originalUnit,
        date: transformation.date,
        reason: 'Perda em Transformação',
        responsibleEmployeeId: transformation.operatorId,
        justification: `Perda no fracionamento da transformação ${transformation.code}: ${transformation.notes || 'Sem observações'}`,
        costValue: transformation.lossValue,
        transformationId: transformation.id
      };
      batch.set(doc(db, 'losses', lossId), this.sanitizeData(lossRecord));
    }

    // 4. Save Transformation Record
    batch.set(doc(db, 'transformations', transformation.id), this.sanitizeData(transformation));

    // 5. Commit atomic transaction
    await batch.commit();

    this.productsCache = null;
    this.transformationsCache = null;

    // Dispatch update events
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'transformation' } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'transformations', id: transformation.id } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'losses', action: 'transformation-loss' } }));
  }

  /**
   * Reverses / Cancels a transformation:
   * Restores original product stock, decreases resulting product stock, and marks transformation as 'Cancelada'.
   */
  public async cancelTransformationWithStockReversal(transformation: ProductTransformation): Promise<void> {
    if (transformation.status === 'Cancelada') return;

    const batch = writeBatch(db);

    // 1. Restore Original Product Stock
    const origDocRef = doc(db, 'products', transformation.originalProductId);
    batch.update(origDocRef, {
      stockQty: increment(transformation.originalQuantity)
    });

    // 2. Deduct Resulting Products Stock
    for (const item of transformation.items) {
      const itemDocRef = doc(db, 'products', item.resultingProductId);
      batch.update(itemDocRef, {
        stockQty: increment(-item.quantity)
      });
    }

    // 3. Mark transformation as Cancelled
    const updatedTrf: ProductTransformation = {
      ...transformation,
      status: 'Cancelada',
      updatedAt: new Date().toISOString()
    };
    batch.set(doc(db, 'transformations', transformation.id), this.sanitizeData(updatedTrf));

    // 4. If loss was recorded, delete the loss record
    if (transformation.lossQuantity > 0) {
      const lossId = 'loss-trf-' + transformation.id;
      batch.delete(doc(db, 'losses', lossId));
    }

    await batch.commit();

    this.productsCache = null;
    this.transformationsCache = null;

    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', action: 'transformation-reversal' } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'transformations', id: transformation.id } }));
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'losses', action: 'transformation-reversal' } }));
  }

  // --- Employees ---
  public async getEmployees(): Promise<Employee[]> {
    if (this.employeesCache && this.employeesCache.length > 0) {
      return this.employeesCache;
    }
    const list = await this.getAll<Employee>('employees');
    this.employeesCache = list.sort((a, b) => safeStr(a.name).localeCompare(safeStr(b.name)));
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
    if (this.attendanceCache && this.attendanceCache.length > 0) {
      return this.attendanceCache;
    }
    const list = await this.getAll<Attendance>('attendance');
    this.attendanceCache = list.sort((a, b) => safeStr(b.date).localeCompare(safeStr(a.date)));
    return this.attendanceCache;
  }
  public async saveAttendance(a: Attendance): Promise<void> { 
    await this.upsert('attendance', a.id, a); 
    this.attendanceCache = null;
  }

  // --- Audit Logs ---
  public async getAuditLogs(): Promise<AuditLog[]> {
    const list = await this.getAll<AuditLog>('audit_logs');
    return list.sort((a, b) => safeStr(b.timestamp).localeCompare(safeStr(a.timestamp)));
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
    if (this.activeSessionsCache && this.activeSessionsCache.length > 0) {
      return this.activeSessionsCache;
    }
    const list = await this.getAll<ActiveSession>('active_sessions');
    this.activeSessionsCache = list.sort((a, b) => safeStr(b.loginTime).localeCompare(safeStr(a.loginTime)));
    return this.activeSessionsCache;
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
      mode: 'Online', companyName: 'AGRO - XICOMO & SERVIÇOS, LDA', logoUrl: '', stockPasswordHash: '',
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
    } catch (e) {
      console.warn('[FirebaseDBService] Falha ao obter definições do Firestore (rede/offline). Usando cache/padrão sem sobrescrever a nuvem:', e);
    }
    const def = this.getDefaultSettings();
    // NUNCA salvar def automaticamente na nuvem: isso apagava o stockPasswordHash (código do gestor)
    // sempre que um dispositivo arrancava com falha de conexão. O valor é devolvido apenas em memória.
    this.settingsCache = def;
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

    // Leitura estrita: uma falha de rede NÃO pode ser interpretada como
    // "sem contas" (isso regravava o admin inicial por cima das contas reais
    // e despoletava o reset de credenciais — Auditoria FASE 1, A-02).
    const list = await this.getAllOrFail<UserCredentials>('credentials');
    if (list && list.length > 0) {
      this.credentialsCache = list.sort((a, b) => safeStr(a.username).localeCompare(safeStr(b.username)));
      safeStorage.setItem('agro_credentials_cache', JSON.stringify(this.credentialsCache));
      return this.credentialsCache;
    }

    // Coleção realmente vazia (instalação nova). O bootstrap de contas
    // iniciais é feito exclusivamente por ensureInitialCredentials()
    // (src/utils/credentialsReset.ts), com palavra-passe temporária aleatória.
    return [];
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
    this.credentialsCache.sort((a, b) => safeStr(a.username).localeCompare(safeStr(b.username)));
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
    if (this.payrollCache && this.payrollCache.length > 0) {
      return this.payrollCache;
    }
    const list = await this.getAll<PayrollPayment>('payroll_payments');
    this.payrollCache = list.sort((a, b) => safeStr(b.paymentDate || b.date).localeCompare(safeStr(a.paymentDate || a.date)));
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
    this.customersCache = list.sort((a, b) => safeStr(a.name).localeCompare(safeStr(b.name)));
    return this.customersCache;
  }
  public async saveCustomer(c: Customer): Promise<void> { await this.upsert('customers', c.id, c); this.customersCache = null; }
  public async deleteCustomer(id: string): Promise<void> { await this.deleteRow('customers', id); this.customersCache = null; }

  // --- Paused Sales ---
  public async getPausedSales(): Promise<PausedSale[]> {
    if (this.pausedSalesCache && this.pausedSalesCache.length > 0) {
      return this.pausedSalesCache;
    }
    const list = await this.getAll<PausedSale>('paused_sales');
    this.pausedSalesCache = list.sort((a, b) => safeStr(b.date).localeCompare(safeStr(a.date)));
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
   * DESTRUTIVO: apaga vendas, quebras, presenças, salários, vendas pausadas e
   * transformações. Regra inviolável do negócio: nenhuma venda pode ser perdida.
   *
   * Proteções (Auditoria FASE 1, T-05):
   *  - Não existe qualquer entrada para esta função na interface de produção;
   *  - Exige uma frase de confirmação explícita para qualquer uso futuro de
   *    manutenção (sempre com backup prévio e aprovação documentada);
   *  - As regras do Firestore passam a negar eliminações na coleção `sales`.
   */
  public async clearSystemData(confirmPhrase: string): Promise<void> {
    if (confirmPhrase !== 'APAGAR VENDAS') {
      throw new Error('clearSystemData: frase de confirmação inválida — operação bloqueada.');
    }
    // We intentionally keep credentials and settings for safety
    const collectionsToClear = ['sales', 'losses', 'attendance', 'payroll_payments', 'paused_sales', 'transformations'];
    for (const col of collectionsToClear) {
      const docs = await this.getAll<{ id: string }>(col);
      for (const d of docs) {
        await this.deleteRow(col, d.id);
      }
    }
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'all', action: 'clear' } }));
  }

  // --- Misc Helpers ---
  /** Verdadeiro quando o navegador reporta ligação à internet. */
  public isOnline(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  /** timestamp da última escrita confirmada pelo servidor (null se nenhuma). */
  public getLastWriteAck(): number | null { return this.lastWriteAckAt; }

  /**
   * Sonda REAL de escrita/leitura no Firestore.
   * Serve para o técnico perceber, a partir da própria aplicação, se a base de
   * dados está a aceitar escritas (antes isto devolvia sempre "sucesso" falso,
   * o que escondia problemas de regras de segurança e de ligação).
   */
  public async probeDatabaseHealth(): Promise<{ ok: boolean; message: string; latencyMs?: number; code?: string }> {
    const started = Date.now();
    const probeId = 'probe';
    try {
      await this.upsert('_health', probeId, { at: new Date().toISOString(), origin: 'agro-xicomo' });
      const snap = await getDoc(doc(db, '_health', probeId));
      const latencyMs = Date.now() - started;
      if (!snap.exists()) {
        return { ok: false, message: 'A escrita foi aceite mas a leitura de confirmação não devolveu dados.', latencyMs };
      }
      try { await deleteDoc(doc(db, '_health', probeId)); } catch (e) {}
      return {
        ok: true,
        latencyMs,
        message: `Ligação OK. Escrita e leitura confirmadas em ${latencyMs} ms.`
      };
    } catch (e: any) {
      const code = String(e?.code || '').replace(/^firestore\//, '');
      let message = 'Falha na ligação à base de dados.';
      if (code === 'permission-denied') {
        message = 'A base de dados recusa escritas (regras de segurança). É necessário publicar as regras do Firestore que permitem leitura e escrita.';
      } else if (code === 'unavailable' || code === 'deadline-exceeded') {
        message = 'Sem ligação ao servidor da base de dados. Verifique a internet.';
      } else if (e && e.message) {
        message = `Falha na ligação: ${e.message}`;
      }
      return { ok: false, message, latencyMs: Date.now() - started, code };
    }
  }

  // --- Active Cart ---
  public async saveActiveCart(cartData: any): Promise<void> {
    try {
      safeStorage.setItem('agro_active_cart', JSON.stringify(cartData));
    } catch (e) {}
  }
  public async getActiveCart(): Promise<any | null> {
    try {
      const saved = safeStorage.getItem('agro_active_cart');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }
  public async clearActiveCart(): Promise<void> {
    try {
      safeStorage.removeItem('agro_active_cart');
    } catch (e) {}
  }

  // --- Catalog Reset (official inventory restore used by StockModule) ---
  public async resetProductsToInitial(): Promise<Product[]> {
    this.productsCache = null;
    safeStorage.removeItem('agro_products_cache');
    const seeded = INITIAL_PRODUCTS.map(p => ({ ...p }));
    await this.upsertBatch('products', seeded);
    return seeded;
  }
}

export const dbService = new FirebaseDBService();
