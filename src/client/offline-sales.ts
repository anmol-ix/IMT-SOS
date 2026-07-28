"use client";

import {
  OFFLINE_SALE_STORE,
  openOfflineDatabase,
  transactionComplete,
} from "@/client/offline-storage";
import type { OfflineSaleCommand } from "@/shared/offline-sale";

export async function listOfflineSales(
  userBinding: string,
): Promise<OfflineSaleCommand[]> {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(OFFLINE_SALE_STORE, "readonly");
    const request = transaction.objectStore(OFFLINE_SALE_STORE).getAll();
    const commands = await new Promise<OfflineSaleCommand[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
    return commands
      .filter((command) => command.userBinding === userBinding)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  } finally {
    database.close();
  }
}

export async function saveOfflineSale(command: OfflineSaleCommand): Promise<void> {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(OFFLINE_SALE_STORE, "readwrite");
    transaction.objectStore(OFFLINE_SALE_STORE).put(command);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function deleteOfflineSale(commandId: string): Promise<void> {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(OFFLINE_SALE_STORE, "readwrite");
    transaction.objectStore(OFFLINE_SALE_STORE).delete(commandId);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}
