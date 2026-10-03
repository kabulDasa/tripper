// Remembers the last loaded bundle on this device so a reload or relaunch keeps it.
// Best effort: private windows or blocked storage just mean nothing is remembered.

const DB = 'tripper';
const STORE = 'bundles';
const KEY = 'last';

interface Saved {
  bytes: Uint8Array;
  filename: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLast(bytes: Uint8Array, filename: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ bytes, filename } satisfies Saved, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* storage unavailable */
  }
}

export async function loadLast(): Promise<Saved | null> {
  try {
    const db = await open();
    const v = await new Promise<Saved | undefined>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as Saved | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return v && v.bytes instanceof Uint8Array ? v : null;
  } catch {
    return null;
  }
}
