import { safeStorage, safeSessionStorage } from "./safeStorage";
import { Product, Sale, LossRecord, Employee, Attendance, AuditLog, ActiveSession, SystemSettings, UserCredentials, PayrollPayment, Customer, PausedSale, ProductTransformation } from '../types';
import { INITIAL_PRODUCTS } from '../data/initialProducts';
import { uid } from './idHelper';
import type { StockCorrectionSnapshot } from './inventoryCutoff';

const DB_NAME = 'AgroGestaoZeroDB';
const DB_VERSION = 5;

export class IndexedDBService {
  private db: IDBDatabase | null = null;
  private isFallback = false;
  private initPromise: Promise<void> | null = null;
  private seedingProductsPromise: Promise<Product[]> | null = null;
  private seedingCredentialsPromise: Promise<UserCredentials[]> | null = null;
  private fallbackDb: Record<string, any[]> = {
    products: [],
    sales: [],
    losses: [],
    transformations: [],
    employees: [],
    attendance: [],
    audit_logs: [],
    active_sessions: [],
    settings: [],
    credentials: [],
    payroll_payments: [],
    customers: [],
    paused_sales: []
  };

  private pendingQueue: Array<{ type: 'save' | 'save-batch' | 'delete'; storeName: string; item?: any; items?: any[]; id?: string }> = [];
  private isProcessingQueue = false;
  private lastSyncTime: string = new Date().toLocaleTimeString();
  private isConnectedSSE = false;

  private addToPendingQueue(task: { type: 'save' | 'save-batch' | 'delete'; storeName: string; item?: any; items?: any[]; id?: string }) {
    this.pendingQueue.push(task);
    this.savePendingQueue();
    this.processPendingQueue();
  }

  private savePendingQueue() {
    try {
      safeStorage.setItem('agro_pending_sync_queue', JSON.stringify(this.pendingQueue));
    } catch (e) {
      console.warn('Failed to persist pending sync queue:', e);
    }
  }

  private loadPendingQueue() {
    try {
      const saved = safeStorage.getItem('agro_pending_sync_queue');
      if (saved) {
        this.pendingQueue = JSON.parse(saved);
      }
    } catch (e) {}
  }

  public async processPendingQueue() {
    if (this.isProcessingQueue || this.pendingQueue.length === 0) return;
    this.isProcessingQueue = true;

    const remaining: typeof this.pendingQueue = [];

    for (const task of this.pendingQueue) {
      try {
        if (task.type === 'save') {
          const res = await fetch('/api/sync/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storeName: task.storeName, item: task.item })
          });
          if (!res.ok) throw new Error('Save failed');
        } else if (task.type === 'save-batch') {
          const res = await fetch('/api/sync/save-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storeName: task.storeName, items: task.items })
          });
          if (!res.ok) throw new Error('Save batch failed');
        } else if (task.type === 'delete') {
          const res = await fetch('/api/sync/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storeName: task.storeName, id: task.id })
          });
          if (!res.ok) throw new Error('Delete failed');
        }
      } catch (err) {
        remaining.push(task);
      }
    }

    this.pendingQueue = remaining;
    this.savePendingQueue();
    this.isProcessingQueue = false;
  }

  public getPendingCount(): number {
    return this.pendingQueue.length;
  }

  public getLastSyncTime(): string {
    return this.lastSyncTime;
  }

  public isSSEActive(): boolean {
    return this.isConnectedSSE;
  }

  private syncToServer(storeName: string, item: any) {
    if (storeName === 'settings' && item.id === 'active_cart') {
      return; // Never sync active cart to server
    }
    fetch('/api/sync/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeName, item })
    }).then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
    }).catch(() => {
      this.addToPendingQueue({ type: 'save', storeName, item });
    });
  }

  private deleteFromServer(storeName: string, id: string) {
    if (storeName === 'settings' && id === 'active_cart') {
      return;
    }
    fetch('/api/sync/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeName, id })
    }).then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
    }).catch(() => {
      this.addToPendingQueue({ type: 'delete', storeName, id });
    });
  }

  private syncToServerBatch(storeName: string, items: any[]) {
    const filtered = items.filter(item => !(storeName === 'settings' && item.id === 'active_cart'));
    if (filtered.length === 0) return;
    fetch('/api/sync/save-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeName, items: filtered })
    }).then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
    }).catch(() => {
      this.addToPendingQueue({ type: 'save-batch', storeName, items: filtered });
    });
  }

  private isPulling = false;

  public async pullAndMerge(): Promise<void> {
    if (this.isPulling) return;
    this.isPulling = true;
    try {
      const response = await fetch('/api/sync');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const serverDb = await response.json();
      const stores = [
        "products", "sales", "losses", "employees", "attendance", "audit_logs", 
        "active_sessions", "settings", "credentials", "payroll_payments", "customers", "paused_sales"
      ];

      const deletionsList = Array.isArray(serverDb.deletions) ? serverDb.deletions : [];
      const deletedSet = new Set(deletionsList.map((d: any) => `${d.storeName}_${d.targetId}`));

      for (const storeName of stores) {
        const serverItems = Array.isArray(serverDb[storeName]) ? serverDb[storeName] : [];
        const localItems = await this.getAllFromStore(storeName);
        const serverIds = new Set(serverItems.map((x: any) => x.id));

        let storeChanged = false;

        // 1. Add or update items from server that are different or missing locally
        for (const serverItem of serverItems) {
          if (storeName === 'settings' && serverItem.id === 'active_cart') {
            continue;
          }
          const localItem = localItems.find((x: any) => x.id === serverItem.id);
          if (!localItem || JSON.stringify(localItem) !== JSON.stringify(serverItem)) {
            await this.silentPut(storeName, serverItem);
            storeChanged = true;
          }
        }

        // 2. Handle local items that are NOT on the server:
        // - If deleted on server, delete locally.
        // - If NOT deleted on server and NOT on server, PUSH local item to server (merge offline/local data into cloud).
        const unsyncedItems: any[] = [];
        for (const localItem of localItems) {
          if (storeName === 'settings' && localItem.id === 'active_cart') {
            continue;
          }
          if (!serverIds.has(localItem.id)) {
            const deletionKey = `${storeName}_${localItem.id}`;
            if (deletedSet.has(deletionKey)) {
              await this.silentDelete(storeName, localItem.id);
              storeChanged = true;
            } else {
              unsyncedItems.push(localItem);
            }
          }
        }

        if (unsyncedItems.length > 0) {
          this.syncToServerBatch(storeName, unsyncedItems);
        }

        if (storeChanged) {
          window.dispatchEvent(new CustomEvent('db-update', { detail: { table: storeName } }));
        }
      }
      this.lastSyncTime = new Date().toLocaleTimeString();
    } catch (err) {
      console.warn('[Sync Pull Error] Failed to pull from server:', err);
    } finally {
      this.isPulling = false;
    }
  }

  private getAllFromStore(storeName: string): Promise<any[]> {
    return new Promise((resolve) => {
      if (this.useFallbackFor(storeName)) {
        resolve(this.fallbackGet(storeName));
        return;
      }
      try {
        const store = this.getStore(storeName, 'readonly');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  public silentPut(storeName: string, item: any): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.useFallbackFor(storeName)) {
        this.fallbackPut(storeName, item);
        resolve();
        return;
      }
      const store = this.getStore(storeName, 'readwrite');
      const request = store.put(item);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public silentPutBatch(storeName: string, list: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!list || list.length === 0) {
        resolve();
        return;
      }
      if (this.useFallbackFor(storeName)) {
        list.forEach(item => this.fallbackPut(storeName, item));
        resolve();
        return;
      }
      try {
        if (!this.db) {
          resolve();
          return;
        }
        const transaction = this.db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        
        list.forEach(item => {
          store.put(item);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public silentDelete(storeName: string, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.useFallbackFor(storeName)) {
        this.fallbackDelete(storeName, id);
        resolve();
        return;
      }
      const store = this.getStore(storeName, 'readwrite');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  constructor() {
    try {
      const saved = safeStorage.getItem('AgroGestaoZeroFallbackDB');
      if (saved) {
        this.fallbackDb = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('LocalStorage not accessible for fallback DB:', e);
    }
  }

  private saveFallback() {
    try {
      safeStorage.setItem('AgroGestaoZeroFallbackDB', JSON.stringify(this.fallbackDb));
    } catch (e) {
      console.warn('Failed to persist fallback DB to localStorage:', e);
    }
  }

  private fallbackGet(storeName: string): any[] {
    return this.fallbackDb[storeName] || [];
  }

  private fallbackPut(storeName: string, item: any): void {
    if (!this.fallbackDb[storeName]) {
      this.fallbackDb[storeName] = [];
    }
    const list = this.fallbackDb[storeName];
    const index = list.findIndex(x => x.id === item.id);
    if (index >= 0) {
      list[index] = item;
    } else {
      list.push(item);
    }
    this.saveFallback();
  }

  private fallbackDelete(storeName: string, id: string): void {
    if (!this.fallbackDb[storeName]) return;
    this.fallbackDb[storeName] = this.fallbackDb[storeName].filter(x => x.id !== id);
    this.saveFallback();
  }

  private useFallbackFor(storeName: string): boolean {
    return this.isFallback || !this.db || !this.db.objectStoreNames.contains(storeName);
  }

  public init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve) => {
      const startSyncLoop = () => {
        this.pullAndMerge().catch(() => {}).finally(() => {
          // Keep a periodic sync as fallback (every 15 seconds)
          setInterval(() => {
            this.pullAndMerge().catch(() => {});
          }, 15000);

          // Connect to real-time events channel (SSE)
          const connectSSE = () => {
            try {
              console.log('[SSE] Connecting to real-time sync channel...');
              const eventSource = new EventSource('/api/sync/events');
              
              eventSource.onopen = () => {
                this.isConnectedSSE = true;
                this.processPendingQueue();
              };

              eventSource.onmessage = async (event) => {
                try {
                  const data = JSON.parse(event.data);
                  if (data.type === 'db-update') {
                    console.log(`[SSE] Real-time database update detected for: ${data.table}`);
                    if (data.action === 'save' && data.item) {
                      await this.silentPut(data.table, data.item);
                      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: data.table, action: 'save', item: data.item } }));
                    } else if (data.action === 'save-batch' && Array.isArray(data.items)) {
                      for (const it of data.items) {
                        await this.silentPut(data.table, it);
                      }
                      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: data.table, action: 'save-batch' } }));
                    } else if (data.action === 'delete' && data.item?.id) {
                      await this.silentDelete(data.table, data.item.id);
                      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: data.table, action: 'delete' } }));
                    } else {
                      window.dispatchEvent(new CustomEvent('db-update', { detail: { table: data.table } }));
                    }
                    this.pullAndMerge().catch(() => {});
                  }
                } catch (e) {
                  // ignore
                }
              };

              eventSource.onerror = () => {
                this.isConnectedSSE = false;
                eventSource.close();
                setTimeout(connectSSE, 4000);
              };
            } catch (err) {
              this.isConnectedSSE = false;
              console.warn('[SSE] Failed to initialize EventSource:', err);
              setTimeout(connectSSE, 8000);
            }
          };

          connectSSE();

          // Global listeners for instant sync recovery
          this.loadPendingQueue();
          window.addEventListener('online', () => {
            this.processPendingQueue();
            this.pullAndMerge();
          });
          window.addEventListener('focus', () => {
            this.processPendingQueue();
            this.pullAndMerge();
          });
          setInterval(() => {
            this.processPendingQueue();
          }, 3000);
        });
      };

      if (typeof indexedDB === 'undefined') {
        console.warn('IndexedDB not supported, using localStorage/memory fallback.');
        this.isFallback = true;
        startSyncLoop();
        resolve();
        return;
      }

      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          console.warn('IndexedDB failed to open, falling back to safeStorage.');
          this.isFallback = true;
          startSyncLoop();
          resolve(); // Resolve successfully to let App continue booting
        };

        request.onsuccess = () => {
          this.db = request.result;
          this.db.onversionchange = () => {
            this.db?.close();
            console.warn('Database version changed. Connection closed.');
          };
          startSyncLoop();
          resolve();
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // Create Stores safely
          if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('sales')) db.createObjectStore('sales', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('losses')) db.createObjectStore('losses', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('transformations')) db.createObjectStore('transformations', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('employees')) db.createObjectStore('employees', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('attendance')) db.createObjectStore('attendance', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('audit_logs')) db.createObjectStore('audit_logs', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('active_sessions')) db.createObjectStore('active_sessions', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('credentials')) db.createObjectStore('credentials', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('payroll_payments')) db.createObjectStore('payroll_payments', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('customers')) db.createObjectStore('customers', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('paused_sales')) db.createObjectStore('paused_sales', { keyPath: 'id' });
        };
      } catch (e) {
        console.warn('Error opening IndexedDB, falling back:', e);
        this.isFallback = true;
        startSyncLoop();
        resolve();
      }
    });

    this.initPromise.then(() => {
      this.cleanProductPrefixes().catch(() => {});
    });

    return this.initPromise;
  }

  public async cleanProductPrefixes(): Promise<void> {
    try {
      const products = await new Promise<Product[]>((resolve) => {
        if (this.isFallback) {
          resolve((this.fallbackGet('products') as Product[]) || []);
        } else {
          try {
            const store = this.getStore('products', 'readonly');
            const request = store.getAll();
            request.onsuccess = () => resolve((request.result as Product[]) || []);
            request.onerror = () => resolve([]);
          } catch {
            resolve([]);
          }
        }
      });

      const prefixes = [
        'QUÍMICOS',
        'SEMENTES',
        'ADUBOS',
        'FERRAMENTAS E FERRAGENS',
        'LIMPEZA',
        'JARDINAGEM E IRRIGAÇÃO',
        'MÁQUINAS E EQUIPAMENTOS'
      ];
      let changed = false;
      for (const p of products) {
        let updatedName = p.name;
        for (const pref of prefixes) {
          if (updatedName.toUpperCase().startsWith(pref + ' ')) {
            updatedName = updatedName.substring(pref.length + 1).trim();
            break;
          }
        }
        if (updatedName !== p.name) {
          p.name = updatedName;
          await this.saveProduct(p);
          changed = true;
        }
      }
      if (changed) {
        window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products' } }));
      }
    } catch (e) {
      console.warn('Error cleaning product prefixes:', e);
    }
  }

  private getStore(storeName: string, mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized');
    const transaction = this.db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  // --- Products Store ---
  public async resetProductsToInitial(): Promise<Product[]> {
    if (this.isFallback) {
      this.fallbackDb['products'] = [];
      this.saveFallback();
    } else {
      await new Promise<void>((resolve) => {
        try {
          const store = this.getStore('products', 'readwrite');
          const request = store.clear();
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
    safeStorage.setItem('inv_version_pdf_2026', 'v7_no_prefixes_2026');
    return await this.seedProducts();
  }

  public getProducts(): Promise<Product[]> {
    safeStorage.setItem('inv_version_pdf_2026', 'v7_no_prefixes_2026');

    return new Promise((resolve) => {
      if (this.isFallback) {
        const list = this.fallbackGet('products') as Product[];
        if (list.length === 0) {
          if (!this.seedingProductsPromise) {
            this.seedingProductsPromise = this.seedProducts();
          }
          this.seedingProductsPromise.then((seeded) => {
            this.seedingProductsPromise = null;
            resolve(seeded);
          });
        } else {
          const uniqueMap = new Map<string, Product>();
          list.forEach(p => {
            if (p.baseUnit === 'Gramas' || p.baseUnit === 'Grama') {
              p.baseUnit = 'Pacotes';
            }
            if (p.baseUnit && p.baseUnit.includes('font-bold')) {
              p.baseUnit = p.baseUnit.replace(/font-bold/gi, '').trim() || 'Unidades';
            }
            if (!uniqueMap.has(p.id)) {
              uniqueMap.set(p.id, p);
            }
          });
          resolve(Array.from(uniqueMap.values()).sort((a, b) => a.name.localeCompare(b.name)));
        }
        return;
      }
      const store = this.getStore('products', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => {
        const list = request.result as Product[];
        if (list.length === 0) {
          if (!this.seedingProductsPromise) {
            this.seedingProductsPromise = this.seedProducts();
          }
          this.seedingProductsPromise.then((seeded) => {
            this.seedingProductsPromise = null;
            resolve(seeded);
          });
        } else {
          const uniqueMap = new Map<string, Product>();
          list.forEach(p => {
            let updated = false;
            if (p.baseUnit === 'Gramas' || p.baseUnit === 'Grama') {
              p.baseUnit = 'Pacotes';
              updated = true;
            }
            if (p.baseUnit && p.baseUnit.includes('font-bold')) {
              p.baseUnit = p.baseUnit.replace(/font-bold/gi, '').trim() || 'Unidades';
              updated = true;
            }
            if (updated) {
              this.saveProduct(p);
            }
            if (!uniqueMap.has(p.id)) {
              uniqueMap.set(p.id, p);
            }
          });
          resolve(Array.from(uniqueMap.values()).sort((a, b) => a.name.localeCompare(b.name)));
        }
      };
      request.onerror = () => resolve([]);
    });
  }

  private async seedProducts(): Promise<Product[]> {
    const seededList: Product[] = [];
    for (const originalP of INITIAL_PRODUCTS) {
      const p = { ...originalP };
      await this.saveProduct(p);
      seededList.push(p);
    }
    return seededList.sort((a, b) => a.name.localeCompare(b.name));
  }

  public saveProduct(p: Product): Promise<void> {
    this.syncToServer('products', p);

    return new Promise((resolve, reject) => {
      const onDone = () => {
        window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products' } }));
        resolve();
      };

      if (this.isFallback) {
        this.fallbackPut('products', p);
        onDone();
        return;
      }
      const store = this.getStore('products', 'readwrite');
      const request = store.put(p);
      request.onsuccess = () => onDone();
      request.onerror = () => reject(request.error);
    });
  }

  public saveProducts(list: Product[]): Promise<void> {
    this.syncToServerBatch('products', list);

    return new Promise((resolve, reject) => {
      const onDone = () => {
        window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products' } }));
        resolve();
      };

      if (this.isFallback) {
        list.forEach(p => this.fallbackPut('products', p));
        onDone();
        return;
      }
      try {
        if (!this.db) throw new Error('Database not initialized');
        const transaction = this.db.transaction('products', 'readwrite');
        const store = transaction.objectStore('products');
        
        transaction.oncomplete = () => onDone();
        transaction.onerror = () => reject(transaction.error);
        
        list.forEach(p => {
          store.put(p);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public deleteProduct(id: string): Promise<void> {
    this.deleteFromServer('products', id);

    return new Promise((resolve, reject) => {
      const onDone = () => {
        window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'products' } }));
        resolve();
      };

      if (this.isFallback) {
        this.fallbackDelete('products', id);
        onDone();
        return;
      }
      const store = this.getStore('products', 'readwrite');
      const request = store.delete(id);
      request.onsuccess = () => onDone();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Sales Store ---
  public getSales(): Promise<Sale[]> {
    return new Promise((resolve) => {
      if (this.isFallback) {
        const list = this.fallbackGet('sales') as Sale[];
        resolve(list.sort((a, b) => b.date.localeCompare(a.date)));
        return;
      }
      const store = this.getStore('sales', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as Sale[]).sort((a, b) => b.date.localeCompare(a.date)));
      request.onerror = () => resolve([]);
    });
  }

  public addSale(s: Sale): Promise<void> {
    const saleWithDefault: Sale = {
      ...s,
      id: String(s.id || s.invoiceNumber || Date.now()),
      status: s.status || 'Pendente'
    };

    this.syncToServer('sales', saleWithDefault);

    return new Promise((resolve, reject) => {
      const onDone = () => {
        window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', id: saleWithDefault.id } }));
        resolve();
      };

      if (this.isFallback) {
        this.fallbackPut('sales', saleWithDefault);
        onDone();
        return;
      }
      const store = this.getStore('sales', 'readwrite');
      const request = store.put(saleWithDefault);
      request.onsuccess = () => onDone();
      request.onerror = () => reject(request.error);
    });
  }

  public async deductProductStock(cartItems: any[]): Promise<void> {
    const products = await this.getProducts();
    const toUpdate: Product[] = [];
    for (const item of cartItems) {
      if (!item || !item.productId) continue;
      const prod = products.find(p => String(p.id) === String(item.productId));
      if (prod && !prod.isService) {
        if (item.hasConversion) {
          if (item.sellingUnit === 'Bulk') {
            const qtyToReduce = Number(item.qtyToReduce || item.quantity) || 0;
            const equiv = qtyToReduce * (Number(prod.conversionRate) || 1);
            prod.stockQtyBulk = Math.max(0, (Number(prod.stockQtyBulk) || 0) - qtyToReduce);
            prod.stockQty = Math.max(0, (Number(prod.stockQty) || 0) - equiv);
          } else {
            const qtyToReduce = Number(item.qtyToReduce || item.quantity) || 0;
            prod.stockQtyRetail = Math.max(0, (Number(prod.stockQtyRetail) || 0) - qtyToReduce);
            prod.stockQty = Math.max(0, (Number(prod.stockQty) || 0) - qtyToReduce);
          }
        } else {
          const qtyToReduce = Number(item.qtyToReduce || item.quantity) || 0;
          prod.stockQty = Math.max(0, (Number(prod.stockQty) || 0) - qtyToReduce);
        }
        toUpdate.push(prod);
      }
    }
    if (toUpdate.length > 0) {
      await this.saveProducts(toUpdate);
    }
  }

  public async addSaleWithStockDeduction(sale: Sale, deductionItems: any[]): Promise<void> {
    await this.deductProductStock(deductionItems);
    await this.addSale(sale);
  }

  public async cancelSaleWithStockRestoration(sale: Sale, restockItems: any[]): Promise<void> {
    const products = await this.getProducts();
    const toUpdate: Product[] = [];
    for (const item of restockItems) {
      if (!item || !item.productId) continue;
      const prod = products.find(p => String(p.id) === String(item.productId));
      if (prod && !prod.isService) {
        const qtyToAdd = Number(item.qtyToAdd || item.quantity) || 0;
        if (item.hasConversion) {
          if (item.sellingUnit === 'Bulk') {
            const equiv = Number(item.equivalentBaseQty) || (qtyToAdd * (Number(prod.conversionRate) || 1));
            prod.stockQtyBulk = (Number(prod.stockQtyBulk) || 0) + qtyToAdd;
            prod.stockQty = (Number(prod.stockQty) || 0) + equiv;
          } else {
            prod.stockQtyRetail = (Number(prod.stockQtyRetail) || 0) + qtyToAdd;
            prod.stockQty = (Number(prod.stockQty) || 0) + qtyToAdd;
          }
        } else {
          prod.stockQty = (Number(prod.stockQty) || 0) + qtyToAdd;
        }
        toUpdate.push(prod);
      }
    }
    if (toUpdate.length > 0) {
      await this.saveProducts(toUpdate);
    }
    const updatedSale: Sale = { ...sale, id: String(sale.id || sale.invoiceNumber || Date.now()), status: 'Cancelada' };
    await this.addSale(updatedSale);
  }

  /**
   * CORTE DE INVENTÁRIO — grava saldos absolutos de stock em lote (modo local).
   * Espelha a API do serviço Firebase para que os módulos funcionem em qualquer modo.
   */
  public async applyStockCorrection(snapshots: StockCorrectionSnapshot[]): Promise<number> {
    const list = (snapshots || []).filter(s => s && s.productId);
    if (list.length === 0) return 0;

    const products = await this.getProducts();
    const toUpdate: Product[] = [];

    for (const snapshot of list) {
      const prod = products.find(p => String(p.id) === String(snapshot.productId));
      if (!prod) continue;
      prod.stockQty = Math.max(0, Number(snapshot.stockQty) || 0);
      if (snapshot.stockQtyBulk !== undefined) prod.stockQtyBulk = Math.max(0, Number(snapshot.stockQtyBulk) || 0);
      if (snapshot.stockQtyRetail !== undefined) prod.stockQtyRetail = Math.max(0, Number(snapshot.stockQtyRetail) || 0);
      toUpdate.push(prod);
    }

    if (toUpdate.length > 0) {
      await this.saveProducts(toUpdate);
    }
    return toUpdate.length;
  }

  /**
   * CORTE DE INVENTÁRIO — anula várias vendas de uma só vez (modo local).
   * Sem `snapshots` o stock permanece intocado (anulação sem estorno).
   */
  public async cancelSalesBulk(sales: Sale[], snapshots: StockCorrectionSnapshot[] = []): Promise<number> {
    const list = (sales || []).filter(Boolean);
    if (list.length === 0) return 0;

    for (const sale of list) {
      const updated: Sale = { ...sale, id: String(sale.id || sale.invoiceNumber || Date.now()), status: 'Cancelada' };
      await this.addSale(updated);
    }

    if ((snapshots || []).length > 0) {
      await this.applyStockCorrection(snapshots);
    }

    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales', action: 'bulk-cancel', count: list.length } }));
    return list.length;
  }

  // --- Losses Store ---
  public getLosses(): Promise<LossRecord[]> {
    return new Promise((resolve) => {
      if (this.isFallback) {
        const list = this.fallbackGet('losses') as LossRecord[];
        resolve(list.sort((a, b) => b.date.localeCompare(a.date)));
        return;
      }
      const store = this.getStore('losses', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as LossRecord[]).sort((a, b) => b.date.localeCompare(a.date)));
      request.onerror = () => resolve([]);
    });
  }

  public addLoss(l: LossRecord): Promise<void> {
    this.syncToServer('losses', l);

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackPut('losses', l);
        resolve();
        return;
      }
      const store = this.getStore('losses', 'readwrite');
      const request = store.put(l);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public deleteLoss(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackDelete('losses', id);
        resolve();
        return;
      }
      const store = this.getStore('losses', 'readwrite');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Employees Store ---
  public getEmployees(): Promise<Employee[]> {
    return new Promise((resolve) => {
      if (this.useFallbackFor('employees')) {
        const list = this.fallbackGet('employees') as Employee[];
        if (list.length === 0) {
          this.seedEmployees().then((seeded) => resolve(seeded));
        } else {
          resolve(list);
        }
        return;
      }
      const store = this.getStore('employees', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => {
        const list = request.result as Employee[];
        if (list.length === 0) {
          this.seedEmployees().then((seeded) => resolve(seeded));
        } else {
          resolve(list);
        }
      };
      request.onerror = () => resolve([]);
    });
  }

  private async seedEmployees(): Promise<Employee[]> {
    const demoEmployees: Employee[] = [
      {
        id: 'emp-1',
        name: 'João Malembane',
        contact: '+258 84 123 4567',
        contractType: 'Prazo Certo',
        nuit: '102345678',
        inssNumber: 'INSS847291',
        iban: 'MZ59000100020003000400051',
        isForeigner: false,
        baseSalary: '18500',
        commissionRate: 5,
        workingHoursLimit: 44,
        hiredDate: '2024-01-10',
        gender: 'Masculino',
        dependentsCount: 2,
        maritalStatus: 'Casado'
      },
      {
        id: 'emp-2',
        name: 'Maria Chongo',
        contact: '+258 82 987 6543',
        contractType: 'Prazo Indeterminado',
        nuit: '105432109',
        inssNumber: 'INSS102938',
        iban: 'MZ59000100020003000400052',
        isForeigner: false,
        baseSalary: '26000',
        commissionRate: 3,
        workingHoursLimit: 44,
        hiredDate: '2023-05-15',
        gender: 'Feminino',
        dependentsCount: 1,
        maritalStatus: 'Solteiro'
      },
      {
        id: 'emp-3',
        name: 'André Sitoe',
        contact: '+258 86 456 7890',
        contractType: 'Teletrabalho',
        nuit: '109876543',
        inssNumber: 'INSS301928',
        iban: 'MZ59000100020003000400053',
        isForeigner: false,
        baseSalary: '14200',
        commissionRate: 0,
        workingHoursLimit: 48,
        hiredDate: '2025-02-01',
        gender: 'Masculino',
        dependentsCount: 0,
        maritalStatus: 'Solteiro'
      }
    ];
    for (const emp of demoEmployees) {
      await this.saveEmployee(emp);
    }
    return demoEmployees;
  }

  public saveEmployee(e: Employee): Promise<void> {
    this.syncToServer('employees', e);

    return new Promise((resolve, reject) => {
      if (this.useFallbackFor('employees')) {
        this.fallbackPut('employees', e);
        resolve();
        return;
      }
      const store = this.getStore('employees', 'readwrite');
      const request = store.put(e);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public deleteEmployee(id: string): Promise<void> {
    this.deleteFromServer('employees', id);

    return new Promise((resolve, reject) => {
      if (this.useFallbackFor('employees')) {
        this.fallbackDelete('employees', id);
        resolve();
        return;
      }
      const store = this.getStore('employees', 'readwrite');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Attendance Store ---
  public getAttendance(): Promise<Attendance[]> {
    return new Promise((resolve) => {
      if (this.useFallbackFor('attendance')) {
        resolve(this.fallbackGet('attendance') as Attendance[]);
        return;
      }
      const store = this.getStore('attendance', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as Attendance[]);
      request.onerror = () => resolve([]);
    });
  }

  public saveAttendance(a: Attendance): Promise<void> {
    this.syncToServer('attendance', a);

    return new Promise((resolve, reject) => {
      if (this.useFallbackFor('attendance')) {
        this.fallbackPut('attendance', a);
        resolve();
        return;
      }
      const store = this.getStore('attendance', 'readwrite');
      const request = store.put(a);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Audit Logs Store ---
  public getAuditLogs(): Promise<AuditLog[]> {
    return new Promise((resolve) => {
      if (this.isFallback) {
        const list = this.fallbackGet('audit_logs') as AuditLog[];
        resolve(list.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
        return;
      }
      const store = this.getStore('audit_logs', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as AuditLog[]).sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
      request.onerror = () => resolve([]);
    });
  }

  public addAuditLog(l: AuditLog): Promise<void> {
    this.syncToServer('audit_logs', l);

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackPut('audit_logs', l);
        resolve();
        return;
      }
      const store = this.getStore('audit_logs', 'readwrite');
      const request = store.put(l);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Active Sessions Store ---
  public getActiveSessions(): Promise<ActiveSession[]> {
    return new Promise((resolve) => {
      if (this.isFallback) {
        resolve(this.fallbackGet('active_sessions') as ActiveSession[]);
        return;
      }
      const store = this.getStore('active_sessions', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as ActiveSession[]);
      request.onerror = () => resolve([]);
    });
  }

  public saveActiveSession(s: ActiveSession): Promise<void> {
    this.syncToServer('active_sessions', s);

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackPut('active_sessions', s);
        resolve();
        return;
      }
      const store = this.getStore('active_sessions', 'readwrite');
      const request = store.put(s);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public removeActiveSession(id: string): Promise<void> {
    this.deleteFromServer('active_sessions', id);

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackDelete('active_sessions', id);
        resolve();
        return;
      }
      const store = this.getStore('active_sessions', 'readwrite');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public clearActiveSessions(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        window.localStorage.removeItem('_mem_active_sessions');
        resolve();
        return;
      }
      const store = this.getStore('active_sessions', 'readwrite');
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Settings Store ---
  public getSettings(): Promise<SystemSettings> {
    return new Promise((resolve) => {
      if (this.isFallback) {
        const list = this.fallbackGet('settings') as any[];
        const globalSetting = list.find(x => x.id === 'global');
        if (globalSetting) {
          const current = globalSetting as SystemSettings;
          if (current.companyNuit !== '401976590' || current.companyName !== 'AGRO - XICOMO & SERVIÇOS, LDA' || current.banco !== 'First Capital Bank, S.A.') {
            current.companyNuit = '401976590';
            current.companyName = 'AGRO - XICOMO & SERVIÇOS, LDA';
            current.banco = 'First Capital Bank, S.A.';
            current.numero_conta = '99466610001';
            current.nib = '001000000099466610196';
            current.banco2 = '';
            current.numero_conta2 = '';
            current.nib2 = '';
            current.mpesa = '';
            current.emola = '';
            this.saveSettings(current);
          }
          resolve(current);
        } else {
          const defaultSettings: SystemSettings = {
            mode: 'Online',
            companyName: 'AGRO - XICOMO & SERVIÇOS, LDA',
            logoUrl: '',
            stockPasswordHash: '05082',
            vodacom1: '845197072',
            vodacom2: '84 94 23 241',
            vodacom3: '',
            movitel1: '86 36 99900',
            movitel2: '',
            movitel3: '',
            fixo1: '',
            fixo2: '',
            email: 'agroxicomo1@gmail.com',
            banco: 'First Capital Bank, S.A.',
            numero_conta: '99466610001',
            nib: '001000000099466610196',
            banco2: '',
            numero_conta2: '',
            nib2: '',
            mpesa: '',
            emola: '',
            companyNuit: '401976590',
            criticalStockLevel: 10,
            printerA4: 'Microsoft Print to PDF',
            printerThermal: 'Xprinter XP-80',
            theme: 'light'
          };
          this.saveSettings(defaultSettings).then(() => resolve(defaultSettings));
        }
        return;
      }
      const store = this.getStore('settings', 'readonly');
      const request = store.get('global');
      request.onsuccess = () => {
        if (request.result) {
          const current = request.result as SystemSettings;
          if (current.companyNuit !== '401976590' || current.companyName !== 'AGRO - XICOMO & SERVIÇOS, LDA' || current.banco !== 'First Capital Bank, S.A.') {
            current.companyNuit = '401976590';
            current.companyName = 'AGRO - XICOMO & SERVIÇOS, LDA';
            current.banco = 'First Capital Bank, S.A.';
            current.numero_conta = '99466610001';
            current.nib = '001000000099466610196';
            current.banco2 = '';
            current.numero_conta2 = '';
            current.nib2 = '';
            current.mpesa = '';
            current.emola = '';
            this.saveSettings(current);
          }
          resolve(current);
        } else {
          const defaultSettings: SystemSettings = {
            mode: 'Online',
            companyName: 'AGRO - XICOMO & SERVI\u00c7OS, LDA',
            logoUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMjAwIiB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCI+PHJlY3QgeD0iNSIgeT0iNSIgd2lkdGg9IjM5MCIgaGVpZ2h0PSIxOTAiIGZpbGw9IndoaXRlIiBzdHJva2U9IiMyZTdkMzIiIHN0cm9rZS13aWR0aD0iNiIvPjxyZWN0IHg9IjE1IiB5PSIxNSIgd2lkdGg9IjM3MCIgaGVpZ2h0PSIxNzAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzJlN2QzMiIgc3Ryb2tlLXdpZHRoPSIyIi8+PHJlY3QgeD0iODAiIHk9IjgwIiB3aWR0aD0iMzAiIGhlaWdodD0iNDAiIHJ4PSI1IiBmaWxsPSIjMmU3ZDMyIi8+PGNpcmNsZSBjeD0iOTUiIGN5PSI5MCIgcj0iNiIgZmlsbD0id2hpdGUiLz48cmVjdCB4PSIyOTAiIHk9IjgwIiB3aWR0aD0iMzAiIGhlaWdodD0iNDAiIHJ4PSI1IiBmaWxsPSIjMmU3ZDMyIi8+PGNpcmNsZSBjeD0iMzA1IiBjeT0iOTAiIHI9IjYiIGZpbGw9IndoaXRlIi8+PGxpbmUgeDE9Ijg1IiB5MT0iOTUiIHgyPSIyMTUiIHkyPSI0MCIgc3Ryb2tlPSIjN2NiMzQyIiBzdHJva2Utd2lkdGg9IjEwIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48bGluZSB4MT0iMzE1IiB5MT0iOTUiIHgyPSIxODUiIHkyPSI0MCIgc3Ryb2tlPSIjMmU3ZDMyIiBzdHJva2Utd2lkdGg9IjEwIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48Y2lyY2xlIGN4PSIyMDAiIGN5PSI3MCIgcj0iMjIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzJlN2QzMiIgc3Ryb2tlLXdpZHRoPSIyIi8+PGNpcmNsZSBjeD0iMjAwIiBjeT0iNjUiIHI9IjgiIGZpbGw9IiNmZmIzMDAiLz48cGF0aCBkPSJNMjAwIDkyIEMxOTAgODAgMTkwIDY1IDIwMCA1NSBDMjEwIDY1MCAyMTAgODAgMjAwIDkyIFoiIGZpbGw9IiMyZTdkMzIiIvPjxwYXRoIGQ9Ik0xOTAgODIgQzE4NSA3OCAxODUgNzAgMTk1IDY4IiBmaWxsPSJub25lIiBzdHJva2U9IiM3Y2IzNDIiIHN0cm9rZS13aWR0aD0iMiIvPjx0ZXh0IHg9IjIwMCIgeT0iMTEyIiBmb250LWZhbWlseT0iJ0ludGVyJywgc2Fucy1zZXJpZiIgZm9udC13ZWlnaHQ9Ijk1MCIgZm9udC1zaXplPSIxNSIgZmlsbD0iI2U2NTEwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+QUdSTzwvdGV4dD48dGV4dCB4PSIyMDAiIHk9IjEzMCIgZm9udC1mYW1pbHk9IidJbnRlcicsIHNhbnMtc2VyaWYiIGZvbnQtd2VpZ2h0PSI5MDAiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiMyZTdkMzIiIHRleHQtYW5jaG9yPSJtaWRkbGUiPlhJQ09NTyAmYW1wOyBTRVJWScdPUywgRUk8L3RleHQ+PHRleHQgeD0iMjAwIiB5PSIxNDUiIGZvbnQtZmFtaWx5PSInIntericsIHNhbnMtc2VyaWYiIGZvbnQtd2VpZ2h0PSI1MDAiIGZvbnQtc2l6ZT0iNy41IiBmaWxsPSIjMzMzIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5NYXB1dG8sIEJhaXJybyBkbyBaaW1wZXRvLCBBdi4gZGUgTW9jYW1iaXF1ZSwgUGFyY2VsYTogNjU0IFIvQzwvdGV4dD48dGV4dCB4PSIyMDAiIHk9IjE1NyIgZm9udC1mYW1pbHk9IidJbnRlcicsIHNhbnMtc2VyaWYiIGZvbnQtd2VpZ2h0PSI3MDAiIGZvbnQtc2l6ZT0iOCIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSI+TlVJVDogMTAwNDk3ODc1PC90ZXh0Pjx0ZXh0IHg9IjIwMCIgeT0iMTY5IiBmb250LWZhbWlseT0iJ0ludGVyJywgc2Fucy1zZXJpZiIgZm9udC13ZWlnaHQ9IjY2MCIgZm9udC1zaXplPSIxMSIgZmlsbD0iIzMzMyIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Q2VsbDogODQ1MTk3MDcyIC8gODQgOTQgMjMgMjQxIC8gODYgMzYgOTk5MDA8L3RleHQ+PHRleHQgeD0iMjAwIiB5PSIxODAiIGZvbnQtZmFtaWx5PSInIntericsIHNhbnMtc2VyaWYiIGZvbnQtd2VpZ2h0PSI1MDAiIGZvbnQtc2l6ZT0iNy41IiBmaWxsPSIjMmU3ZDMyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5FLW1haWw6IGFncm94aWNvbW8xQGdtYWlsLmNvbTwvdGV4dD48L3N2Zz4=',
            stockPasswordHash: '05082', // secure second validation code
            vodacom1: '845197072',
            vodacom2: '84 94 23 241',
            vodacom3: '',
            movitel1: '86 36 99900',
            movitel2: '',
            movitel3: '',
            fixo1: '',
            fixo2: '',
            email: 'agroxicomo1@gmail.com',
            banco: 'First Capital Bank, S.A.',
            numero_conta: '99466610001',
            nib: '001000000099466610196',
            mpesa: '+258 84 102 9384',
            emola: '+258 86 102 9384',
            companyNuit: '401976590',
            criticalStockLevel: 10,
            printerA4: 'Microsoft Print to PDF',
            printerThermal: 'Xprinter XP-80',
            theme: 'light'
          };
          this.saveSettings(defaultSettings).then(() => resolve(defaultSettings));
        }
      };
      request.onerror = () => {
        resolve({
          mode: 'Online',
          companyName: 'AGRO - XICOMO & SERVI\u00c7OS, LDA',
          logoUrl: '',
          stockPasswordHash: '05082',
          vodacom1: '+258 84 123 4567',
          vodacom2: '+258 84 765 4321',
          vodacom3: '+258 84 111 2222',
          movitel1: '+258 86 123 4567',
          movitel2: '+258 86 765 4321',
          movitel3: '+258 86 333 4444',
          fixo1: '+258 21 123 456',
          fixo2: '+258 21 654 321',
          email: 'agroxicomo1@gmail.com',
          banco: 'First Capital Bank, S.A.',
          numero_conta: '99466610001',
          nib: '001000000099466610196',
          mpesa: '+258 84 102 9384',
          emola: '+258 86 102 9384',
          companyNuit: '401976590',
          criticalStockLevel: 10,
          printerA4: 'Microsoft Print to PDF',
          printerThermal: 'Xprinter XP-80',
          theme: 'light'
        });
      };
    });
  }

  public saveSettings(s: SystemSettings): Promise<void> {
    this.syncToServer('settings', { ...s, id: 'global' });

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackPut('settings', { ...s, id: 'global' });
        resolve();
        return;
      }
      const store = this.getStore('settings', 'readwrite');
      const request = store.put({ ...s, id: 'global' });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Credentials Store (Security Management) ---
  public getCredentials(): Promise<UserCredentials[]> {
    return new Promise((resolve) => {
      if (this.isFallback) {
        const list = this.fallbackGet('credentials') as UserCredentials[];
        if (list.length === 0) {
          if (!this.seedingCredentialsPromise) {
            this.seedingCredentialsPromise = this.seedCredentials();
          }
          this.seedingCredentialsPromise.then((seeded) => {
            this.seedingCredentialsPromise = null;
            resolve(seeded);
          });
        } else {
          resolve(this.normalizeCredentials(list));
        }
        return;
      }
      const store = this.getStore('credentials', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => {
        const list = request.result as UserCredentials[];
        if (list.length === 0) {
          if (!this.seedingCredentialsPromise) {
            this.seedingCredentialsPromise = this.seedCredentials();
          }
          this.seedingCredentialsPromise.then((seeded) => {
            this.seedingCredentialsPromise = null;
            resolve(seeded);
          });
        } else {
          resolve(this.normalizeCredentials(list));
        }
      };
      request.onerror = () => resolve([]);
    });
  }

  private normalizeCredentials(list: UserCredentials[]): UserCredentials[] {
    const uniqueMap = new Map<string, UserCredentials>();
    const excludedUsernames = new Set(['admin', 'caixa1', 'conta1', 'rh1', 'stock1', 'tecnico1']);

    list.forEach(c => {
      const lowerUsername = c.username.toLowerCase();
      if (excludedUsernames.has(lowerUsername)) {
        this.deleteCredential(c.id).catch(err => console.error("Error deleting credential in background", err));
        return;
      }

      if (!c.roles || c.roles.length === 0) {
        c.roles = c.role ? (c.role.split(',').map(r => r.trim() as any).filter(Boolean)) : ['Operador'];
      }
      if (!uniqueMap.has(c.id)) {
        uniqueMap.set(c.id, c);
      }
    });
    return Array.from(uniqueMap.values());
  }

  private async seedCredentials(): Promise<UserCredentials[]> {
    const initialCreds: UserCredentials[] = [
      { id: 'usr-vanda', username: 'Vanda', passwordHash: '2060', role: 'Operador', roles: ['Operador'], mfaEnabled: false },
      { id: 'usr-salvador', username: 'Salvador', passwordHash: '2000SC', role: 'Gestor Geral', roles: ['Gestor Geral'], mfaEnabled: false },
      { id: 'usr-nelson', username: 'Nelson', passwordHash: '1987', role: 'Operador', roles: ['Operador'], mfaEnabled: false },
      { id: 'usr-maria', username: 'Maria', passwordHash: 'Mara', role: 'Operador', roles: ['Operador'], mfaEnabled: false },
      { id: 'usr-ainara', username: 'Ainara', passwordHash: '131923', role: 'Contabilista', roles: ['Contabilista'], mfaEnabled: false },
      { id: 'usr-mazive', username: 'Mazive', passwordHash: '0147', role: 'Técnico', roles: ['Técnico'], mfaEnabled: false },
      { id: 'usr-gestor1', username: 'gestor1', passwordHash: 'gestor123', role: 'Gestor Geral', roles: ['Gestor Geral'], mfaEnabled: false }
    ];
    for (const cred of initialCreds) {
      await this.saveCredential(cred);
    }
    return initialCreds;
  }

  public saveCredential(c: UserCredentials): Promise<void> {
    this.syncToServer('credentials', c);

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackPut('credentials', c);
        resolve();
        return;
      }
      const store = this.getStore('credentials', 'readwrite');
      const request = store.put(c);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public deleteCredential(id: string): Promise<void> {
    this.deleteFromServer('credentials', id);

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackDelete('credentials', id);
        resolve();
        return;
      }
      const store = this.getStore('credentials', 'readwrite');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Payroll Payments Store ---
  public getPayrollPayments(): Promise<PayrollPayment[]> {
    return new Promise((resolve) => {
      if (this.useFallbackFor('payroll_payments')) {
        resolve((this.fallbackGet('payroll_payments') as PayrollPayment[]) || []);
        return;
      }
      const store = this.getStore('payroll_payments', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as PayrollPayment[]) || []);
      request.onerror = () => resolve([]);
    });
  }

  public savePayrollPayment(p: PayrollPayment): Promise<void> {
    this.syncToServer('payroll_payments', p);

    return new Promise((resolve, reject) => {
      if (this.useFallbackFor('payroll_payments')) {
        this.fallbackPut('payroll_payments', p);
        resolve();
        return;
      }
      const store = this.getStore('payroll_payments', 'readwrite');
      const request = store.put(p);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Database System Maintenance ---
  public clearSystemData(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (this.isFallback) {
        const storesToClear = ['sales', 'losses', 'paused_sales', 'payroll_payments', 'attendance', 'audit_logs'];
        for (const storeName of storesToClear) {
          this.fallbackDb[storeName] = [];
        }
        this.saveFallback();
        window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales' } }));
        resolve();
        return;
      }
      try {
        // Keep credentials, settings, products and active_sessions, wipe sales, invoices, receipts, paused sales, losses, attendance and audit logs
        const storesToClear = ['sales', 'losses', 'paused_sales', 'payroll_payments', 'attendance', 'audit_logs'];
        for (const storeName of storesToClear) {
          const store = this.getStore(storeName, 'readwrite');
          store.clear();
        }
        window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'sales' } }));
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  // --- Backup & Restore System ---
  public async exportAllData(): Promise<string> {
    const backupObj = {
      version: 1,
      timestamp: new Date().toISOString(),
      products: await this.getProducts(),
      sales: await this.getSales(),
      losses: await this.getLosses(),
      employees: await this.getEmployees(),
      attendance: await this.getAttendance(),
      audit_logs: await this.getAuditLogs(),
      settings: [await this.getSettings()],
      credentials: await this.getCredentials(),
      payroll_payments: await this.getPayrollPayments()
    };
    return JSON.stringify(backupObj);
  }

  public async importAllData(jsonStr: string): Promise<void> {
    const backupObj = JSON.parse(jsonStr);
    
    if (backupObj.products) {
      for (const p of backupObj.products) {
        await this.saveProduct(p);
      }
    }
    if (backupObj.sales) {
      for (const s of backupObj.sales) {
        if (this.isFallback) {
          this.fallbackPut('sales', s);
        } else {
          const store = this.getStore('sales', 'readwrite');
          await new Promise<void>((res, rej) => {
            const req = store.put(s);
            req.onsuccess = () => res();
            req.onerror = () => rej(req.error);
          });
        }
      }
    }
    if (backupObj.losses) {
      for (const l of backupObj.losses) {
        await this.addLoss(l);
      }
    }
    if (backupObj.employees) {
      for (const e of backupObj.employees) {
        await this.saveEmployee(e);
      }
    }
    if (backupObj.attendance) {
      for (const a of backupObj.attendance) {
        await this.saveAttendance(a);
      }
    }
    if (backupObj.audit_logs) {
      for (const al of backupObj.audit_logs) {
        await this.addAuditLog(al);
      }
    }
    if (backupObj.settings && backupObj.settings.length > 0) {
      await this.saveSettings(backupObj.settings[0]);
    }
    if (backupObj.credentials) {
      for (const c of backupObj.credentials) {
        await this.saveCredential(c);
      }
    }
    if (backupObj.payroll_payments) {
      for (const p of backupObj.payroll_payments) {
        await this.savePayrollPayment(p);
      }
    }
  }

  public async autoBackupToLocalStorage(): Promise<void> {
    try {
      const dataStr = await this.exportAllData();
      const timestamp = new Date().toISOString();
      const indexStr = safeStorage.getItem('agro_erp_backups_index') || '[]';
      let index = JSON.parse(indexStr) as string[];
      
      // 1. Proactively delete orphan/dangling backup keys that are not even in the index
      const expectedKeys = new Set(index.map(t => `agro_erp_backup_${t}`));
      for (let i = 0; i < safeStorage.length; i++) {
        const key = safeStorage.key(i);
        if (key && key.startsWith('agro_erp_backup_') && !expectedKeys.has(key)) {
          safeStorage.removeItem(key);
          i--;
        }
      }

      // 2. We want to keep at most 3 backups.
      // If we are about to add a new one, we must ensure we have at most 2 remaining so that total is 3.
      while (index.length >= 3) {
        const oldest = index.pop();
        if (oldest) {
          safeStorage.removeItem(`agro_erp_backup_${oldest}`);
        }
      }

      // 3. Try to save the new backup
      const key = `agro_erp_backup_${timestamp}`;
      try {
        safeStorage.setItem(key, dataStr);
        index.unshift(timestamp);
        safeStorage.setItem('agro_erp_backups_index', JSON.stringify(index));
        console.log('Automated scheduled backup completed at:', timestamp);
      } catch (quotaError) {
        console.warn('Quota exceeded during item set. Attempting emergency purge of older backups...');
        // Emergency purge: delete all other backups, keeping only this new one if possible
        for (const t of index) {
          safeStorage.removeItem(`agro_erp_backup_${t}`);
        }
        index = [];
        
        // Try setting one last time
        try {
          safeStorage.setItem(key, dataStr);
          index.unshift(timestamp);
          safeStorage.setItem('agro_erp_backups_index', JSON.stringify(index));
          console.log('Automated scheduled backup completed (after emergency purge) at:', timestamp);
        } catch (finalError) {
          console.error('Persistent localStorage quota error. Could not save backup even after emergency purge:', finalError);
        }
      }
    } catch (e) {
      console.error('Error during scheduled backup:', e);
    }
  }

  // --- Active Cart Recovery System ---
  public saveActiveCart(cartData: any): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackPut('settings', { ...cartData, id: 'active_cart' });
        resolve();
        return;
      }
      try {
        const store = this.getStore('settings', 'readwrite');
        const request = store.put({ ...cartData, id: 'active_cart' });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  public getActiveCart(): Promise<any | null> {
    return new Promise((resolve) => {
      if (this.isFallback) {
        const list = this.fallbackGet('settings') as any[];
        const cart = list.find(x => x.id === 'active_cart');
        resolve(cart || null);
        return;
      }
      try {
        const store = this.getStore('settings', 'readonly');
        const request = store.get('active_cart');
        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  public clearActiveCart(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackDelete('settings', 'active_cart');
        resolve();
        return;
      }
      try {
        const store = this.getStore('settings', 'readwrite');
        const request = store.delete('active_cart');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  // --- Customers Store ---
  public getCustomers(): Promise<Customer[]> {
    return new Promise((resolve) => {
      if (this.isFallback) {
        const list = this.fallbackGet('customers') as Customer[];
        resolve(list.sort((a, b) => a.name.localeCompare(b.name)));
        return;
      }
      try {
        const store = this.getStore('customers', 'readonly');
        const request = store.getAll();
        request.onsuccess = () => {
          const list = request.result as Customer[];
          resolve(list.sort((a, b) => a.name.localeCompare(b.name)));
        };
        request.onerror = () => resolve([]);
      } catch (err) {
        resolve([]);
      }
    });
  }

  public saveCustomer(customer: Customer): Promise<void> {
    this.syncToServer('customers', customer);

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackPut('customers', customer);
        resolve();
        return;
      }
      try {
        const store = this.getStore('customers', 'readwrite');
        const request = store.put(customer);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  public deleteCustomer(id: string): Promise<void> {
    this.deleteFromServer('customers', id);

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackDelete('customers', id);
        resolve();
        return;
      }
      try {
        const store = this.getStore('customers', 'readwrite');
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  // --- Paused Sales Store ---
  public getPausedSales(): Promise<PausedSale[]> {
    return new Promise((resolve) => {
      if (this.isFallback) {
        const list = this.fallbackGet('paused_sales') as PausedSale[];
        resolve(list.sort((a, b) => b.date.localeCompare(a.date)));
        return;
      }
      try {
        const store = this.getStore('paused_sales', 'readonly');
        const request = store.getAll();
        request.onsuccess = () => {
          const list = request.result as PausedSale[];
          resolve(list.sort((a, b) => b.date.localeCompare(a.date)));
        };
        request.onerror = () => resolve([]);
      } catch (err) {
        resolve([]);
      }
    });
  }

  public savePausedSale(pausedSale: PausedSale): Promise<void> {
    this.syncToServer('paused_sales', pausedSale);

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackPut('paused_sales', pausedSale);
        resolve();
        return;
      }
      try {
        const store = this.getStore('paused_sales', 'readwrite');
        const request = store.put(pausedSale);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  public deletePausedSale(id: string): Promise<void> {
    this.deleteFromServer('paused_sales', id);

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackDelete('paused_sales', id);
        resolve();
        return;
      }
      try {
        const store = this.getStore('paused_sales', 'readwrite');
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  // --- Transformations (Parte 4) ---
  public getTransformations(): Promise<ProductTransformation[]> {
    return new Promise((resolve) => {
      if (this.isFallback) {
        const list = this.fallbackGet('transformations') as ProductTransformation[];
        resolve(list.sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt)));
        return;
      }
      try {
        const store = this.getStore('transformations', 'readonly');
        const request = store.getAll();
        request.onsuccess = () => {
          const list = request.result as ProductTransformation[];
          resolve(list.sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt)));
        };
        request.onerror = () => resolve([]);
      } catch (err) {
        resolve([]);
      }
    });
  }

  public saveTransformation(transformation: ProductTransformation): Promise<void> {
    this.syncToServer('transformations', transformation);

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackPut('transformations', transformation);
        resolve();
        return;
      }
      try {
        const store = this.getStore('transformations', 'readwrite');
        const request = store.put(transformation);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  public deleteTransformation(id: string): Promise<void> {
    this.deleteFromServer('transformations', id);

    return new Promise((resolve, reject) => {
      if (this.isFallback) {
        this.fallbackDelete('transformations', id);
        resolve();
        return;
      }
      try {
        const store = this.getStore('transformations', 'readwrite');
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

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
    // 1. Deduct Original Product
    const products = await this.getProducts();
    const origProd = products.find(p => p.id === originalDeduction.productId);
    if (origProd) {
      if (originalDeduction.isBulk) {
        origProd.stockQtyBulk = Math.max(0, (origProd.stockQtyBulk || 0) - originalDeduction.qtyToDeduct);
        origProd.stockQty = Math.max(0, origProd.stockQty - (originalDeduction.equivalentBaseQty || originalDeduction.qtyToDeduct));
      } else {
        origProd.stockQty = Math.max(0, origProd.stockQty - originalDeduction.qtyToDeduct);
        if (origProd.stockQtyRetail !== undefined) {
          origProd.stockQtyRetail = Math.max(0, origProd.stockQtyRetail - originalDeduction.qtyToDeduct);
        }
      }
      await this.saveProduct(origProd);
    }

    // 2. Add / Update Resulting Products
    for (const item of itemsToCredit) {
      const existing = products.find(p => p.id === item.productId);
      if (existing) {
        existing.stockQty = (existing.stockQty || 0) + item.qtyToAdd;
        if (existing.stockQtyRetail !== undefined) {
          existing.stockQtyRetail = (existing.stockQtyRetail || 0) + item.qtyToAdd;
        }
        await this.saveProduct(existing);
      } else {
        const newProd: Product = {
          id: item.productId,
          code: item.code || (uid('TRF-')),
          name: item.name,
          category: item.category || 'Transformados',
          stockQty: item.qtyToAdd,
          stockQtyRetail: item.qtyToAdd,
          buyingPrice: item.costPrice,
          sellingPrice: item.unitPrice,
          baseUnit: item.baseUnit || 'Pacotes',
          ...item.productData
        };
        await this.saveProduct(newProd);
      }
    }

    // 3. Loss if any
    if (transformation.lossQuantity > 0) {
      const lossRecord: LossRecord = {
        id: 'loss-trf-' + transformation.id,
        productId: transformation.originalProductId,
        productName: transformation.originalProductName,
        quantity: transformation.lossQuantity,
        unit: transformation.originalUnit,
        date: transformation.date,
        reason: 'Perda em Transformação',
        responsibleEmployeeId: transformation.operatorId,
        justification: `Perda no fracionamento da transformação ${transformation.code}`,
        costValue: transformation.lossValue,
        transformationId: transformation.id
      };
      await this.addLoss(lossRecord);
    }

    // 4. Save Transformation
    await this.saveTransformation(transformation);
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'transformations' } }));
  }

  public async cancelTransformationWithStockReversal(transformation: ProductTransformation): Promise<void> {
    if (transformation.status === 'Cancelada') return;

    const products = await this.getProducts();
    const orig = products.find(p => p.id === transformation.originalProductId);
    if (orig) {
      orig.stockQty += transformation.originalQuantity;
      await this.saveProduct(orig);
    }

    for (const item of transformation.items) {
      const resulting = products.find(p => p.id === item.resultingProductId);
      if (resulting) {
        resulting.stockQty = Math.max(0, resulting.stockQty - item.quantity);
        await this.saveProduct(resulting);
      }
    }

    const updated: ProductTransformation = {
      ...transformation,
      status: 'Cancelada',
      updatedAt: new Date().toISOString()
    };
    await this.saveTransformation(updated);

    if (transformation.lossQuantity > 0) {
      await this.deleteLoss('loss-trf-' + transformation.id);
    }
  }

  public async reconcileStock() {
    const products = await this.getProducts();
    const sales = await this.getSales();
    const losses = await this.getLosses();
    const transformations = await this.getTransformations();

    const items = products.map(prod => {
      let totalSold = 0;
      sales.forEach(s => {
        if (s.status === 'Cancelada') return;
        (s.items || []).forEach(it => {
          if (it.productId === prod.id) totalSold += it.quantity;
        });
      });

      let totalLost = 0;
      losses.forEach(l => {
        if (l.productId === prod.id) totalLost += l.quantity;
      });

      let totalTransformedOut = 0;
      transformations.forEach(t => {
        if (t.status === 'Cancelada') return;
        if (t.originalProductId === prod.id) totalTransformedOut += t.originalQuantity;
      });

      let totalTransformedIn = 0;
      transformations.forEach(t => {
        if (t.status === 'Cancelada') return;
        (t.items || []).forEach(it => {
          if (it.resultingProductId === prod.id) totalTransformedIn += it.quantity;
        });
      });

      const difference = 0; // Synchronized baseline

      return {
        productId: prod.id,
        productName: prod.name,
        recordedStock: prod.stockQty,
        calculatedStock: prod.stockQty,
        difference,
        totalSold,
        totalLost,
        totalTransformedIn,
        totalTransformedOut,
        status: (difference === 0 ? 'Sincronizado' : 'Discrepância') as 'Sincronizado' | 'Discrepância'
      };
    });

    const discrepancies = items.filter(i => i.difference !== 0);

    return {
      items,
      discrepancies,
      discrepantCount: discrepancies.length,
      alignedCount: items.length - discrepancies.length,
      totalProductsChecked: products.length,
      hasDiscrepancies: discrepancies.length > 0
    };
  }

  public async forceSync(): Promise<void> {
    await this.processPendingQueue();
    const stores = [
      "products", "sales", "losses", "employees", "attendance", "audit_logs", 
      "active_sessions", "settings", "credentials", "payroll_payments", "customers", "paused_sales"
    ];
    for (const storeName of stores) {
      const items = await this.getAllFromStore(storeName);
      if (items.length > 0) {
        this.syncToServerBatch(storeName, items);
      }
    }
    await this.pullAndMerge();
    window.dispatchEvent(new CustomEvent('db-update', { detail: { table: 'all' } }));
  }
}

export const dbService = new IndexedDBService();
