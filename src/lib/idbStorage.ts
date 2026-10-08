const DB_NAME = 'KuzeHentaiAppDB';
const DB_VERSION = 2;
const STORE_NAME = 'app_persistent_data';
const STORE_COVERS = 'app_covers_cache';

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
      if (!db.objectStoreNames.contains(STORE_COVERS)) {
        db.createObjectStore(STORE_COVERS);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves the entire catalog (animes, studios, genres) permanently in IndexedDB
 */
export async function saveCatalogToIDB(animes: any[], studios: any[], genres: any[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(animes, 'cached_animes');
    store.put(studios, 'cached_studios');
    store.put(genres, 'cached_genres');
    store.put(Date.now(), 'cached_catalog_timestamp');
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[IDB] Error saving catalog to IndexedDB:', err);
  }
}

/**
 * Loads the entire catalog permanently from IndexedDB (instant startup without Firebase)
 */
export async function getCatalogFromIDB(): Promise<{ animes: any[]; studios: any[]; genres: any[]; timestamp: number } | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const animesReq = store.get('cached_animes');
    const studiosReq = store.get('cached_studios');
    const genresReq = store.get('cached_genres');
    const timeReq = store.get('cached_catalog_timestamp');

    return new Promise((resolve) => {
      tx.oncomplete = () => {
        const animes = animesReq.result;
        if (Array.isArray(animes) && animes.length > 0) {
          resolve({
            animes,
            studios: Array.isArray(studiosReq.result) ? studiosReq.result : [],
            genres: Array.isArray(genresReq.result) ? genresReq.result : [],
            timestamp: typeof timeReq.result === 'number' ? timeReq.result : 0,
          });
        } else {
          resolve(null);
        }
      };
      tx.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('[IDB] Error loading catalog from IndexedDB:', err);
    return null;
  }
}

/**
 * Saves a single cover image permanently in IndexedDB
 */
export async function saveCoverToIDB(id: string, dataUrl: string): Promise<void> {
  if (!id || !dataUrl) return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_COVERS, 'readwrite');
    const store = tx.objectStore(STORE_COVERS);
    store.put(dataUrl, id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    // Silent catch to prevent UI disruption
  }
}

/**
 * Loads a cover image permanently from IndexedDB
 */
export async function getCoverFromIDB(id: string): Promise<string | null> {
  if (!id) return null;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_COVERS, 'readonly');
    const store = tx.objectStore(STORE_COVERS);
    const req = store.get(id);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

/**
 * Loads all cached covers in bulk into memory for instant 0ms access
 */
export async function getAllCoversFromIDB(): Promise<Record<string, string>> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_COVERS, 'readonly');
    const store = tx.objectStore(STORE_COVERS);
    const result: Record<string, string> = {};

    return new Promise((resolve) => {
      // Open cursor for bulk read
      const req = store.openCursor();
      req.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          result[String(cursor.key)] = cursor.value;
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      req.onerror = () => resolve(result);
    });
  } catch (err) {
    return {};
  }
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
