/**
 * In-memory fake of the Firestore Web SDK surface used by src/utils/firebaseDB.ts
 * (used only by the vitest suite – never shipped to the browser bundle).
 */

type DocData = Record<string, any>;

const store: Map<string, Map<string, DocData>> = new Map();

export function __resetStore() {
  store.clear();
}

export function __collection(name: string) {
  if (!store.has(name)) store.set(name, new Map());
  return store.get(name)!;
}

export function __seed(name: string, docs: DocData[]) {
  const col = __collection(name);
  docs.forEach(d => col.set(String(d.id), { ...d }));
}

export function __dump() {
  const out: Record<string, DocData[]> = {};
  store.forEach((col, name) => {
    out[name] = Array.from(col.values()).map(d => JSON.parse(JSON.stringify(d)));
  });
  return out;
}

function clone(data: DocData): DocData {
  return data === undefined || data === null ? data : JSON.parse(JSON.stringify(data));
}

function applyIncrement(existing: any, delta: any) {
  const base = typeof existing === 'number' ? existing : 0;
  return base + (typeof delta === 'number' ? delta : 0);
}

function deepApply(target: DocData, patch: DocData) {
  Object.keys(patch).forEach(key => {
    const val = patch[key];
    if (val && typeof val === 'object' && (val as any).__increment !== undefined) {
      target[key] = applyIncrement(target[key], (val as any).__increment);
    } else if (val && typeof val === 'object' && !Array.isArray(val) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepApply(target[key], val);
    } else {
      target[key] = clone(val);
    }
  });
}

function colNameOf(ref: any): string {
  if (ref.type === 'collection') return ref.path;
  // doc(db, 'col', 'id')  ->  path = ['col','id']
  return ref.path[0];
}

function docIdOf(ref: any): string {
  return ref.path[ref.path.length - 1];
}

function makeSnapshot(collName: string) {
  const col = __collection(collName);
  const docs = Array.from(col.entries()).map(([id, data]) => ({
    id,
    data: () => clone(data),
    exists: () => true,
    ref: { type: 'doc', path: [collName, id] }
  }));
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (cb: (d: any) => void) => docs.forEach(cb)
  };
}

const listeners: Array<{ ref: any; cb: (s: any) => void }> = [];

function notify(collName: string) {
  listeners.forEach(l => {
    if (colNameOf(l.ref) === collName) {
      if (l.ref.type === 'collection') l.cb(makeSnapshot(collName));
    }
  });
}

export function __flushListeners() {
  Array.from(new Set(listeners.map(l => colNameOf(l.ref)))).forEach(notify);
}

export const __mode: { hangWrites: boolean; failWrites: boolean; error?: any } = {
  hangWrites: false,
  failWrites: false
};

export function __setMode(m: Partial<typeof __mode>) {
  Object.assign(__mode, m);
}

function guardWrite() {
  if (__mode.failWrites) {
    const err: any = new Error('FirebaseError: PERMISSION_DENIED / unavailable');
    err.code = 'permission-denied';
    throw err;
  }
  if (__mode.hangWrites) {
    return new Promise(() => {}); // never settles — emulates an offline Firestore client
  }
  return null;
}

export const firestoreMock = {
  initializeApp: (_cfg: any) => ({ mock: true, cfg: _cfg }),

  initializeFirestore: (_app: any, _opts?: any, _dbId?: string) => ({ mockFirestore: true }),

  persistentLocalCache: (_o?: any) => ({}),
  persistentMultipleTabManager: (_o?: any) => ({}),

  collection: (_db: any, name: string) => ({ type: 'collection', path: name }),

  doc: (_parent: any, ...segments: string[]) => ({ type: 'doc', path: segments }),

  async setDoc(ref: any, data: DocData, opts?: any) {
    const blocked = guardWrite();
    if (blocked) return blocked;
    const col = __collection(colNameOf(ref));
    const id = docIdOf(ref);
    if (opts && opts.merge) {
      const existing = col.get(id) || {};
      deepApply(existing, data);
      col.set(id, existing);
    } else {
      col.set(id, clone(data));
    }
    notify(colNameOf(ref));
  },

  async updateDoc(ref: any, data: DocData) {
    const blocked = guardWrite();
    if (blocked) return blocked;
    const col = __collection(colNameOf(ref));
    const id = docIdOf(ref);
    const existing = col.get(id);
    if (!existing) throw new Error(`NOT_FOUND: no document ${colNameOf(ref)}/${id}`);
    deepApply(existing, data);
    notify(colNameOf(ref));
  },

  async getDocs(ref: any) {
    return makeSnapshot(colNameOf(ref));
  },

  async getDoc(ref: any) {
    const col = __collection(colNameOf(ref));
    const id = docIdOf(ref);
    const data = col.get(id);
    return {
      exists: () => !!data,
      id,
      data: () => (data ? clone(data) : undefined)
    };
  },

  async deleteDoc(ref: any) {
    __collection(colNameOf(ref)).delete(docIdOf(ref));
    notify(colNameOf(ref));
  },

  onSnapshot(ref: any, cb: (s: any) => void, errCb?: (e: any) => void) {
    listeners.push({ ref, cb });
    // Firestore delivers an initial snapshot asynchronously
    Promise.resolve().then(() => {
      try {
        if (ref.type === 'collection') cb(makeSnapshot(colNameOf(ref)));
        else {
          const col = __collection(colNameOf(ref));
          const id = docIdOf(ref);
          const data = col.get(id);
          cb({ exists: () => !!data, id, data: () => (data ? clone(data) : undefined) });
        }
      } catch (e) {
        errCb && errCb(e);
      }
    });
    return () => {
      const i = listeners.findIndex(l => l.cb === cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  },

  writeBatch(_db: any) {
    const ops: Array<() => void> = [];
    return {
      set(ref: any, data: DocData, opts?: any) {
        ops.push(() => {
          const col = __collection(colNameOf(ref));
          const id = docIdOf(ref);
          if (opts && opts.merge) {
            const existing = col.get(id) || {};
            deepApply(existing, data);
            col.set(id, existing);
          } else {
            col.set(id, clone(data));
          }
        });
      },
      update(ref: any, data: DocData) {
        ops.push(() => {
          const col = __collection(colNameOf(ref));
          const id = docIdOf(ref);
          const existing = col.get(id);
          if (!existing) {
            // Firestore fails the whole batch when updating a missing document
            throw new Error(`NOT_FOUND: no document to update: ${colNameOf(ref)}/${id}`);
          }
          deepApply(existing, data);
        });
      },
      delete(ref: any) {
        ops.push(() => __collection(colNameOf(ref)).delete(docIdOf(ref)));
      },
      async commit() {
        const blocked = guardWrite();
        if (blocked) return blocked;
        for (const op of ops) op();
        Array.from(new Set(store.keys())).forEach(notify);
      }
    };
  },

  increment(n: number) {
    return { __increment: n };
  },

  runTransaction: async (_db: any, fn: (t: any) => Promise<any>) => {
    const t = {
      async get(ref: any) {
        const col = __collection(colNameOf(ref));
        const data = col.get(docIdOf(ref));
        return { exists: () => !!data, id: docIdOf(ref), data: () => (data ? clone(data) : undefined) };
      },
      set(ref: any, data: DocData, opts?: any) {
        return firestoreMock.setDoc(ref, data, opts);
      },
      update(ref: any, data: DocData) {
        return firestoreMock.updateDoc(ref, data);
      },
      delete(ref: any) {
        return firestoreMock.deleteDoc(ref);
      }
    };
    return fn(t);
  }
};

export default firestoreMock;
