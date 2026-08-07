export const safeStorage = {
  get length(): number {
    try {
      return window.localStorage.length;
    } catch {
      return Object.keys(window).filter(k => k.startsWith('_mem_') && !k.startsWith('_mem_sess_')).length;
    }
  },
  key(index: number): string | null {
    try {
      return window.localStorage.key(index);
    } catch {
      const keys = Object.keys(window).filter(k => k.startsWith('_mem_') && !k.startsWith('_mem_sess_'));
      return keys[index]?.replace('_mem_', '') || null;
    }
  },
  getItem(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return (window as any)[`_mem_${key}`] || null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      (window as any)[`_mem_${key}`] = value;
    }
  },
  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      delete (window as any)[`_mem_${key}`];
    }
  },
  clear(): void {
    try {
      window.localStorage.clear();
    } catch (e) {
      // no-op
    }
  }
};

export const safeSessionStorage = {
  get length(): number {
    try {
      return window.sessionStorage.length;
    } catch {
      return Object.keys(window).filter(k => k.startsWith('_mem_sess_')).length;
    }
  },
  key(index: number): string | null {
    try {
      return window.sessionStorage.key(index);
    } catch {
      const keys = Object.keys(window).filter(k => k.startsWith('_mem_sess_'));
      return keys[index]?.replace('_mem_sess_', '') || null;
    }
  },
  getItem(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key);
    } catch (e) {
      return (window as any)[`_mem_sess_${key}`] || null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (e) {
      (window as any)[`_mem_sess_${key}`] = value;
    }
  },
  removeItem(key: string): void {
    try {
      window.sessionStorage.removeItem(key);
    } catch (e) {
      delete (window as any)[`_mem_sess_${key}`];
    }
  },
  clear(): void {
    try {
      window.sessionStorage.clear();
    } catch (e) {
      // no-op
    }
  }
};
