const DB_NAME = 'sorosoro-db';
const DB_VERSION = 1;
const STORES = { items: 'items', history: 'history', settings: 'settings' };
let dbPromise;

export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.items)) {
        const items = db.createObjectStore(STORES.items, { keyPath: 'id' });
        items.createIndex('tab', 'tab');
        items.createIndex('active', 'active');
      }
      if (!db.objectStoreNames.contains(STORES.history)) {
        const history = db.createObjectStore(STORES.history, { keyPath: 'id' });
        history.createIndex('itemId', 'itemId');
        history.createIndex('performedDate', 'performedDate');
      }
      if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('データベースの更新がブロックされました'));
  });
  return dbPromise;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('保存処理が中断されました'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

export async function getOne(storeName, key) {
  const db = await openDatabase();
  return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

export async function putOne(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
  return value;
}

export async function deleteOne(storeName, key) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  await transactionDone(tx);
}

export async function saveItemWithHistory(item, historyEntry = null) {
  const db = await openDatabase();
  const tx = db.transaction([STORES.items, STORES.history], 'readwrite');
  tx.objectStore(STORES.items).put(item);
  if (historyEntry) tx.objectStore(STORES.history).put(historyEntry);
  await transactionDone(tx);
}

export async function deleteItemAndHistory(itemId) {
  const db = await openDatabase();
  const tx = db.transaction([STORES.items, STORES.history], 'readwrite');
  tx.objectStore(STORES.items).delete(itemId);
  const cursorRequest = tx.objectStore(STORES.history).index('itemId').openKeyCursor(IDBKeyRange.only(itemId));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (cursor) { tx.objectStore(STORES.history).delete(cursor.primaryKey); cursor.continue(); }
  };
  await transactionDone(tx);
}

export async function getHistoryForItem(itemId) {
  const db = await openDatabase();
  return requestResult(db.transaction(STORES.history, 'readonly').objectStore(STORES.history).index('itemId').getAll(itemId));
}

export { STORES, DB_VERSION };

