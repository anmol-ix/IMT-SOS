"use client";

import {
  OFFLINE_CATALOG_STORE,
  openOfflineDatabase,
  transactionComplete,
} from "@/client/offline-storage";
import type { OfflineCatalogSnapshot } from "@/shared/offline-catalog";

const RECORD_KEY = "current";

type StoredCatalog = OfflineCatalogSnapshot & {
  key: typeof RECORD_KEY;
  cacheKey: string;
};

export async function saveOfflineCatalog(
  cacheKey: string,
  snapshot: OfflineCatalogSnapshot,
) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(OFFLINE_CATALOG_STORE, "readwrite");
    const store = transaction.objectStore(OFFLINE_CATALOG_STORE);
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
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(OFFLINE_CATALOG_STORE, "readonly");
    const request = transaction.objectStore(OFFLINE_CATALOG_STORE).get(RECORD_KEY);
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
