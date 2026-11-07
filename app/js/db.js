// Tiny IndexedDB wrapper. All writes for one user action go through a single
// transaction so stock and history never get out of step.

const DB_NAME = 'tee-inventory';
const DB_VERSION = 1;
let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('events')) {
          const ev = db.createObjectStore('events', { keyPath: 'id' });
          ev.createIndex('ts', 'ts');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export async function getAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function commit({ products = [], events = [], deleteProducts = [], deleteEvents = [] } = {}) {
  const db = await openDB();
  const tx = db.transaction(['products', 'events'], 'readwrite');
  const ps = tx.objectStore('products');
  const es = tx.objectStore('events');
  products.forEach((p) => ps.put(p));
  events.forEach((e) => es.put(e));
  deleteProducts.forEach((id) => ps.delete(id));
  deleteEvents.forEach((id) => es.delete(id));
  return done(tx);
}

export async function replaceAll({ products = [], events = [] }) {
  const db = await openDB();
  const tx = db.transaction(['products', 'events'], 'readwrite');
  const ps = tx.objectStore('products');
  const es = tx.objectStore('events');
  ps.clear();
  es.clear();
  products.forEach((p) => ps.put(p));
  events.forEach((e) => es.put(e));
  return done(tx);
}
