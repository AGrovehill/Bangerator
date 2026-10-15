// IndexedDB: user samples (audio bytes) and the on-device project library.

const DB_NAME = 'bangerator';
let dbPromise = null;

function db() {
  dbPromise ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('samples')) d.createObjectStore('samples');
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects'); // id -> { id, name, updated, project, cloud? }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbPromise = null; rej(r.error); };
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

export const idbGet = (store, key) => run(store, 'readonly', s => s.get(key));
export const idbPut = (store, key, value) => run(store, 'readwrite', s => s.put(value, key));
export const idbDelete = (store, key) => run(store, 'readwrite', s => s.delete(key));
export const idbAll = store => run(store, 'readonly', s => s.getAll());

export const saveSampleData = (id, name, arrayBuffer) => idbPut('samples', id, { name, data: arrayBuffer });
export const loadSampleData = id => idbGet('samples', id);
