"use client";

const DATABASE_NAME = "itsmytoy-offline";
const DATABASE_VERSION = 2;

export const OFFLINE_CATALOG_STORE = "catalog";
export const OFFLINE_DEVICE_STORE = "device";

export function openOfflineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OFFLINE_CATALOG_STORE)) {
        database.createObjectStore(OFFLINE_CATALOG_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(OFFLINE_DEVICE_STORE)) {
        database.createObjectStore(OFFLINE_DEVICE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function clearOfflineAccess() {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(
      [OFFLINE_CATALOG_STORE, OFFLINE_DEVICE_STORE],
      "readwrite",
    );
    transaction.objectStore(OFFLINE_CATALOG_STORE).clear();
    transaction.objectStore(OFFLINE_DEVICE_STORE).clear();
    await transactionComplete(transaction);
  } finally {
    database.close();
  }

  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("itsmytoy-device:")) localStorage.removeItem(key);
  }
}
