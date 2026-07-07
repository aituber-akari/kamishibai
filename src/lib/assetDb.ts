/**
 * 素材（画像・音声のBlob）のIndexedDB永続化。
 * 起動時に全件復元することで、フォルダの登録し直しを不要にする。
 * プライベートモード等でIndexedDBが使えない場合は呼び出し側でメモリのみ運用にフォールバックする。
 */

const DB_NAME = 'kamishibai-assets';
const STORE = 'assets';

export interface StoredAsset {
  /** フォルダ構造を保った相対パス（素材ライブラリのキーと同一） */
  name: string;
  blob: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function dbPutAssets(items: StoredAsset[]): Promise<void> {
  if (items.length === 0) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const item of items) store.put(item);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function dbDeleteAsset(name: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(name);
    await txDone(tx);
  } finally {
    db.close();
  }
}

/** フォルダ（プレフィックス）配下の全素材を削除 */
export async function dbDeleteFolder(folder: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const range = IDBKeyRange.bound(folder + '/', folder + '/￿');
    store.delete(range);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function dbLoadAll(): Promise<StoredAsset[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    return await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as StoredAsset[]);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function dbClearAssets(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await txDone(tx);
  } finally {
    db.close();
  }
}
