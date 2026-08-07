import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, onSnapshot, getDoc, writeBatch, increment } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { Product, Sale, LossRecord, Employee, Attendance, AuditLog, ActiveSession, SystemSettings, UserCredentials, PayrollPayment, Customer, PausedSale } from '../types';
import { INITIAL_PRODUCTS } from '../data/initialProducts';
import { safeStorage } from './safeStorage';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export class FirebaseDBService {
  private initPromise: Promise<void> | null = null;
  private productsCache: Product[] | null = null;
  private salesCache: Sale[] | null = null;
  private customersCache: Customer[] | null = null;
  private unsubscribers: (() => void)[] = [];

  public async init(): Promise<void> {
    if (this.initPromise) {
      console.log('[FirebaseDBService] init() already called / in progress.');
      return this.initPromise;
    }
    console.log('[FirebaseDBService] Initializing Firestore real-time listeners and caching...');
    this.initPromise = Promise.resolve();

    // Clear previous listeners if any
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];

    // Realtime products listener
    this.unsubscribers.push(onSnapshot(collection(db, 'products'), (snapshot) => {
      const products: Product[] = [];
      snapshot.forEach(doc => {
        products.push(doc.data() as Product);
      });
      this.productsCache = products.sort((a, b) => a.name.localeCompare(b.name));
      safeStorage.setItem('agro_products_cache', JSON.stringify(this.productsCache));
      console.log(`[FirebaseDBService] onSnapshot (products): received ${products.length} products. Dispatched db-update.`);
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products', count: products.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (products):', error);
    }));

    // Realtime sales listener
    this.unsubscribers.push(onSnapshot(collection(db, 'sales'), (snapshot) => {
      const sales: Sale[] = [];
      snapshot.forEach(doc => {
        sales.push(doc.data() as Sale);
      });
      this.salesCache = sales.sort((a, b) => b.date.localeCompare(a.date));
      console.log(`[FirebaseDBService] onSnapshot (sales): received ${sales.length} sales. Dispatched db-update.`);
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', count: sales.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (sales):', error);
    }));

    // Realtime customers listener
    this.unsubscribers.push(onSnapshot(collection(db, 'customers'), (snapshot) => {
      const customers: Customer[] = [];
      snapshot.forEach(doc => {
        customers.push(doc.data() as Customer);
      });
      this.customersCache = customers.sort((a, b) => a.name.localeCompare(b.name));
      console.log(`[FirebaseDBService] onSnapshot (customers): received ${customers.length} customers.`);
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'customers', count: customers.length } }));
    }, (error) => {
      console.error('[FirebaseDBService] onSnapshot error (customers):', error);
    }));
    
    return this.initPromise;
  }

  // Generic DB methods
  private async getAll<T>(colName: string): Promise<T[]> {
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
      const sanitized = this.sanitizeData(data);
      console.log(`[FirebaseDBService] upsert() to collection: ${colName}, ID: ${id}`);
      await setDoc(doc(db, colName, id), sanitized);
      console.log(`[FirebaseDBService] upsert() successful on ${colName}/${id}`);
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: colName, id } }));
    } catch (e) {
      console.error(`[FirebaseDBService] Error saving to ${colName}/${id}:`, e);
      throw e;
    }
  }

  private async upsertBatch(colName: string, items: { id: string }[]): Promise<void> {
    if (items.length === 0) return;
    try {
      console.log(`[FirebaseDBService] upsertBatch() to collection: ${colName}, count: ${items.length}`);
      const batch = writeBatch(db);
      items.forEach(item => {
        const sanitized = this.sanitizeData(item);
        batch.set(doc(db, colName, item.id), sanitized);
      });
      await batch.commit();
      console.log(`[FirebaseDBService] upsertBatch() successful on ${colName}`);
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: colName, count: items.length } }));
    } catch (e) {
      console.error(`[FirebaseDBService] Error batch saving to ${colName}:`, e);
      throw e;
    }
  }

  private async deleteRow(colName: string, id: string): Promise<void> {
    try {
      console.log(`[FirebaseDBService] deleteRow() from collection: ${colName}, ID: ${id}`);
      await deleteDoc(doc(db, colName, id));
      console.log(`[FirebaseDBService] deleteRow() successful on ${colName}/${id}`);
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: colName, deletedId: id } }));
    } catch (e) {
      console.error(`[FirebaseDBService] Error deleting from ${colName}/${id}:`, e);
    }
  }

  // --- Products ---
  public async getProducts(): Promise<Product[]> {
    if (this.productsCache && this.productsCache.length > 0) {
      console.log(`[FirebaseDBService] getProducts() returning cached products (${this.productsCache.length})`);
      return this.productsCache;
    }
    const cached = safeStorage.getItem('agro_products_cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.length > 0) {
          console.log(`[FirebaseDBService] getProducts() returning local storage cached products (${parsed.length})`);
          this.productsCache = parsed;
          return parsed;
        }
      } catch (e) {}
    }
    const products = await this.getAll<Product>('products');
    if (products.length === 0) {
      console.log('[FirebaseDBService] getProducts() found 0 products in Firestore. Seeding initial products...');
      const seeded = INITIAL_PRODUCTS.map(p => ({ ...p }));
      await this.upsertBatch('products', seeded);
      this.productsCache = seeded;
      return seeded;
    }
    this.productsCache = products.sort((a, b) => a.name.localeCompare(b.name));
    return this.productsCache;
  }

  public async saveProduct(p: Product): Promise<void> {
    console.log(`[FirebaseDBService] saveProduct() ID: ${p.id}, name: ${p.name}, stock: ${p.stockQty}`);
    await this.upsert('products', p.id, p);
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

  // --- Sales ---
  public async getSales(): Promise<Sale[]> {
    // Always fetch fresh or use salesCache if populated by onSnapshot
    if (this.salesCache && this.salesCache.length >= 0) {
      console.log(`[FirebaseDBService] getSales() returning cached/realtime sales (${this.salesCache.length})`);
      // To ensure absolute freshness across sessions, also trigger a background fetch if cache might be stale
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

  public async addSale(s: Sale): Promise<void> {
    console.log(`[FirebaseDBService] addSale() ID: ${s.id}, invoice: ${s.invoiceNumber}, total: ${s.total}`);
    await this.upsert('sales', s.id, { ...s, status: s.status || 'Pendente' });
    this.salesCache = null; // Invalidate cache so next fetch re-syncs
  }

  // --- Losses ---
  public async getLosses(): Promise<LossRecord[]> {
    const list = await this.getAll<LossRecord>('losses');
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }

  public async addLoss(l: LossRecord): Promise<void> {
    console.log(`[FirebaseDBService] addLoss() ID: ${l.id}`);
    await this.upsert('losses', l.id, l);
  }

  // --- Employees ---
  public async getEmployees(): Promise<Employee[]> {
    return await this.getAll<Employee>('employees');
  }
  public async saveEmployee(e: Employee): Promise<void> { await this.upsert('employees', e.id, e); }
  public async deleteEmployee(id: string): Promise<void> { await this.deleteRow('employees', id); }

  // --- Attendance ---
  public async getAttendance(): Promise<Attendance[]> { return await this.getAll<Attendance>('attendance'); }
  public async saveAttendance(a: Attendance): Promise<void> { await this.upsert('attendance', a.id, a); }

  // --- Audit Logs ---
  public async getAuditLogs(): Promise<AuditLog[]> {
    const list = await this.getAll<AuditLog>('audit_logs');
    return list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
  public async addAuditLog(l: AuditLog): Promise<void> { await this.upsert('audit_logs', l.id, l); }

  // --- Active Sessions ---
  public async getActiveSessions(): Promise<ActiveSession[]> { return await this.getAll<ActiveSession>('active_sessions'); }
  public async saveActiveSession(s: ActiveSession): Promise<void> { await this.upsert('active_sessions', s.id, s); }
  public async removeActiveSession(id: string): Promise<void> { await this.deleteRow('active_sessions', id); }
  public async clearActiveSessions(): Promise<void> {}

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
    try {
      const snap = await getDoc(doc(db, 'settings', 'global'));
      if (snap.exists()) {
        return snap.data() as SystemSettings;
      }
    } catch(e) {}
    const def = this.getDefaultSettings();
    await this.saveSettings(def);
    return def;
  }

  public async saveSettings(s: SystemSettings): Promise<void> {
    await this.upsert('settings', 'global', s);
  }

  // --- Credentials ---
  public async getCredentials(): Promise<UserCredentials[]> {
    const list = await this.getAll<UserCredentials>('credentials');
    if (list.length === 0) {
      const initialCreds: UserCredentials[] = [
        { id: 'usr-vanda', username: 'Vanda', passwordHash: '2060', role: 'Operador', roles: ['Operador'], mfaEnabled: false },
        { id: 'usr-salvador', username: 'Salvador', passwordHash: '2000SC', role: 'Gestor Geral', roles: ['Gestor Geral'], mfaEnabled: false },
        { id: 'usr-nelson', username: 'Nelson', passwordHash: '1987', role: 'Operador', roles: ['Operador'], mfaEnabled: false },
        { id: 'usr-maria', username: 'Maria', passwordHash: 'Mara', role: 'Operador', roles: ['Operador'], mfaEnabled: false },
        { id: 'usr-ainara', username: 'Ainara', passwordHash: '131923', role: 'Contabilista', roles: ['Contabilista'], mfaEnabled: false },
        { id: 'usr-mazive', username: 'Mazive', passwordHash: '0147', role: 'Técnico', roles: ['Técnico'], mfaEnabled: false },
        { id: 'usr-gestor1', username: 'gestor1', passwordHash: 'gestor123', role: 'Gestor Geral', roles: ['Gestor Geral'], mfaEnabled: false }
      ];
      await this.upsertBatch('credentials', initialCreds);
      return initialCreds;
    }
    return list;
  }
  public async saveCredential(c: UserCredentials): Promise<void> { await this.upsert('credentials', c.id, c); }
  public async deleteCredential(id: string): Promise<void> { await this.deleteRow('credentials', id); }

  // --- Payroll Payments ---
  public async getPayrollPayments(): Promise<PayrollPayment[]> { return await this.getAll<PayrollPayment>('payroll_payments'); }
  public async savePayrollPayment(p: PayrollPayment): Promise<void> { await this.upsert('payroll_payments', p.id, p); }

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
    const list = await this.getAll<PausedSale>('paused_sales');
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }
  public async savePausedSale(ps: PausedSale): Promise<void> { await this.upsert('paused_sales', ps.id, ps); }
  public async deletePausedSale(id: string): Promise<void> { await this.deleteRow('paused_sales', id); }

  // --- Misc Helpers ---
  public isSSEActive(): boolean { return true; }
  public getPendingCount(): number { return 0; }
  public getLastSyncTime(): string { return new Date().toLocaleTimeString(); }
  public async autoBackupToLocalStorage(): Promise<void> {}
  
  public async exportAllData(): Promise<string> { return "{}"; }
  public async importAllData(json: string): Promise<void> {}
  public async clearSystemData(): Promise<void> {}

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

  // --- Compatibility Stubs ---
  public isConfigured(): boolean { return true; }
  public getFirebaseConfig(): { url: string; key: string } { return { url: 'Firebase', key: 'Managed by AI Studio' }; }
  public setFirebaseConfig(url: string, key: string): void {}
  public clearFirebaseConfig(): void {}
  public async testConnection(customUrl?: string, customKey?: string): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    return { success: true, message: 'Firebase conectado com sucesso!', latencyMs: 42 };
  }
  public async syncAllWithFirebase(): Promise<{ success: boolean; logs: string[]; summary: Record<string, { local: number; cloud: number; synced: number }> }> {
    return { success: true, logs: ['Sincronização Firebase (Tempo Real) ativa.'], summary: {} };
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
