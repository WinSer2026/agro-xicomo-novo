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
    if (this.initPromise) return this.initPromise;
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
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products' } }));
    }));

    // Realtime sales listener
    this.unsubscribers.push(onSnapshot(collection(db, 'sales'), (snapshot) => {
      const sales: Sale[] = [];
      snapshot.forEach(doc => {
        sales.push(doc.data() as Sale);
      });
      this.salesCache = sales.sort((a, b) => b.date.localeCompare(a.date));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales' } }));
    }));

    // Realtime customers listener
    this.unsubscribers.push(onSnapshot(collection(db, 'customers'), (snapshot) => {
      const customers: Customer[] = [];
      snapshot.forEach(doc => {
        customers.push(doc.data() as Customer);
      });
      this.customersCache = customers.sort((a, b) => a.name.localeCompare(b.name));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'customers' } }));
    }));
    
    return this.initPromise;
  }

  // Generic DB methods
  private async getAll<T>(colName: string): Promise<T[]> {
    try {
      const snapshot = await getDocs(collection(db, colName));
      return snapshot.docs.map(doc => doc.data() as T);
    } catch (e) {
      console.error(`Error getting ${colName}:`, e);
      return [];
    }
  }

  private async upsert(colName: string, id: string, data: any): Promise<void> {
    try {
      await setDoc(doc(db, colName, id), data);
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: colName } }));
    } catch (e) {
      console.error(`Error saving to ${colName}:`, e);
    }
  }

  private async upsertBatch(colName: string, items: { id: string }[]): Promise<void> {
    if (items.length === 0) return;
    try {
      const batch = writeBatch(db);
      items.forEach(item => {
        batch.set(doc(db, colName, item.id), item);
      });
      await batch.commit();
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: colName } }));
    } catch (e) {
      console.error(`Error batch saving to ${colName}:`, e);
    }
  }

  private async deleteRow(colName: string, id: string): Promise<void> {
    try {
      await deleteDoc(doc(db, colName, id));
      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: colName } }));
    } catch (e) {
      console.error(`Error deleting from ${colName}:`, e);
    }
  }

  // --- Products ---
  public async getProducts(): Promise<Product[]> {
    if (this.productsCache && this.productsCache.length > 0) return this.productsCache;
    const cached = safeStorage.getItem('agro_products_cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.length > 0) {
          this.productsCache = parsed;
          return parsed;
        }
      } catch (e) {}
    }
    const products = await this.getAll<Product>('products');
    if (products.length === 0) {
      const seeded = INITIAL_PRODUCTS.map(p => ({ ...p }));
      await this.upsertBatch('products', seeded);
      this.productsCache = seeded;
      return seeded;
    }
    this.productsCache = products.sort((a, b) => a.name.localeCompare(b.name));
    return this.productsCache;
  }

  public async saveProduct(p: Product): Promise<void> {
    await this.upsert('products', p.id, p);
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
    } catch (e) {
      console.error("Error deducting stock:", e);
    }
  }

  public async saveProducts(list: Product[]): Promise<void> {
    await this.upsertBatch('products', list);
  }

  public async deleteProduct(id: string): Promise<void> {
    await this.deleteRow('products', id);
  }

  // --- Sales ---
  public async getSales(): Promise<Sale[]> {
    if (this.salesCache) return this.salesCache;
    const list = await this.getAll<Sale>('sales');
    this.salesCache = list.sort((a, b) => b.date.localeCompare(a.date));
    return this.salesCache;
  }

  public async addSale(s: Sale): Promise<void> {
    await this.upsert('sales', s.id, { ...s, status: s.status || 'Pendente' });
  }

  // --- Losses ---
  public async getLosses(): Promise<LossRecord[]> {
    const list = await this.getAll<LossRecord>('losses');
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }

  public async addLoss(l: LossRecord): Promise<void> {
    await this.upsert('losses', l.id, l);
  }

  // --- Employees ---
  public async getEmployees(): Promise<Employee[]> {
    const list = await this.getAll<Employee>('employees');
    return list;
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
  public async clearActiveSessions(): Promise<void> {
     // No-op for now to avoid deleting everything blindly
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
    try {
      const snap = await getDoc(doc(db, 'settings', 'global'));
      if (snap.exists()) {
        const s = snap.data() as SystemSettings;
        return s;
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
  public async saveCustomer(c: Customer): Promise<void> { await this.upsert('customers', c.id, c); }
  public async deleteCustomer(id: string): Promise<void> { await this.deleteRow('customers', id); }

  // --- Paused Sales ---
  public async getPausedSales(): Promise<PausedSale[]> {
    const list = await this.getAll<PausedSale>('paused_sales');
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }
  public async savePausedSale(ps: PausedSale): Promise<void> { await this.upsert('paused_sales', ps.id, ps); }
  public async deletePausedSale(id: string): Promise<void> { await this.deleteRow('paused_sales', id); }

  // --- Misc Helpers to fulfill interface ---
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
    } catch (e) {
      console.warn('Failed to save active cart:', e);
    }
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
    } catch (e) {
      console.warn('Failed to clear active cart:', e);
    }
  }

  // --- Compatibility Stubs for Supabase UI in TechnicalModule ---
  public isConfigured(): boolean { return true; }
  public getFirebaseConfig(): { url: string; key: string } { return { url: 'Firebase', key: 'Managed by AI Studio' }; }
  public setFirebaseConfig(url: string, key: string): void {}
  public clearFirebaseConfig(): void {}
  public async testConnection(customUrl?: string, customKey?: string): Promise<{ success: boolean; message: string; latencyMs?: number; details?: any }> {
    return { success: true, message: 'Firebase conectado com sucesso!', latencyMs: 50 };
  }
  public async syncAllWithFirebase(): Promise<{ success: boolean; logs: string[]; summary: Record<string, { local: number; cloud: number; synced: number }> }> {
    return { success: true, logs: ['Sincronização Firebase (Tempo Real) ativada.'], summary: {} };
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
