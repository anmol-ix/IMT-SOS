"use client";

import type { OfflineCatalogSnapshot } from "@/shared/offline-catalog";

const DATABASE_NAME = "itsmytoy-offline";
const STORE_NAME = "catalog";
const RECORD_KEY = "current";

type StoredCatalog = OfflineCatalogSnapshot & {
  key: typeof RECORD_KEY;
  cacheKey: string;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveOfflineCatalog(
  cacheKey: string,
  snapshot: OfflineCatalogSnapshot,
) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    store.put({ ...snapshot, key: RECORD_KEY, cacheKey } satisfies StoredCatalog);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function readOfflineCatalog(
  cacheKey: string,
): Promise<OfflineCatalogSnapshot | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(RECORD_KEY);
    const stored = await new Promise<StoredCatalog | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return stored?.cacheKey === cacheKey
      ? { asOf: stored.asOf, products: stored.products }
      : null;
  } finally {
    database.close();
  }
}
