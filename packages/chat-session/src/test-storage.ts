export interface MemoryStorage extends Storage {
  readonly store: Record<string, string>;
}

export const installMemoryStorage = (): MemoryStorage => {
  const store: Record<string, string> = {};
  const storage = {
    clear: () => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    },
    getItem: (key: string) => (key in store ? (store[key] ?? null) : null),
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    store,
  } satisfies MemoryStorage;

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
    writable: true,
  });
  return storage;
};
