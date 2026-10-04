const DB_NAME = 'KuzeHentaiAppDB';
const DB_VERSION = 1;
const STORE_NAME = 'app_persistent_data';

/**
 * Requests browser permission to grant persistent storage (protects IndexedDB from cache eviction)
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persist();
      return isPersisted;
    } catch (e) {
      console.warn('[Storage] Could not request persistent storage:', e);
    }
  }
  return false;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves the user's "Mi Lista" anime IDs to IndexedDB (Application Database Storage)
 */
export async function saveMyListToIDB(listIds: string[], userId?: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const key = userId ? `my_list_ids_${userId}` : 'my_list_ids_guest';
    store.put(listIds, key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[IDB] Error saving my list to IndexedDB:', err);
  }
}

/**
 * Saves full "Mi Lista" anime items (including covers) locally on the user's device
 */
export async function saveMyListAnimesToIDB(animes: any[], userId?: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const key = userId ? `my_list_animes_${userId}` : 'my_list_animes_guest';
    store.put(animes, key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[IDB] Error saving my list animes to IndexedDB:', err);
  }
}

/**
 * Loads "Mi Lista" animes (with local covers) from IndexedDB
 */
export async function getMyListAnimesFromIDB(userId?: string): Promise<any[] | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const key = userId ? `my_list_animes_${userId}` : 'my_list_animes_guest';
    const request = store.get(key);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('[IDB] Error loading my list animes from IndexedDB:', err);
    return null;
  }
}

/**
 * Loads "Mi Lista" anime IDs from IndexedDB
 */
export async function getMyListFromIDB(userId?: string): Promise<string[] | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const key = userId ? `my_list_ids_${userId}` : 'my_list_ids_guest';
    const request = store.get(key);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('[IDB] Error loading my list from IndexedDB:', err);
    return null;
  }
}
