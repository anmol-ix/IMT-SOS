"use client";

import {
  OFFLINE_DEVICE_STORE,
  openOfflineDatabase,
  transactionComplete,
} from "@/client/offline-storage";
import type { OfflineDeviceEnrollment } from "@/shared/offline-device";

const RECORD_KEY = "current";

export type StoredOfflineDevice = OfflineDeviceEnrollment & {
  key: typeof RECORD_KEY;
  cacheKey: string;
};

async function readStoredDevice(): Promise<StoredOfflineDevice | null> {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(OFFLINE_DEVICE_STORE, "readonly");
    const request = transaction.objectStore(OFFLINE_DEVICE_STORE).get(RECORD_KEY);
    return await new Promise<StoredOfflineDevice | null>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function getDevicePublicId(cacheKey: string): Promise<string> {
  const storageKey = `itsmytoy-device:${cacheKey}`;
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(storageKey, created);
  return created;
}

export async function saveOfflineDevice(
  cacheKey: string,
  enrollment: OfflineDeviceEnrollment,
) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(OFFLINE_DEVICE_STORE, "readwrite");
    transaction.objectStore(OFFLINE_DEVICE_STORE).put({
      ...enrollment,
      key: RECORD_KEY,
      cacheKey,
    } satisfies StoredOfflineDevice);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function readOfflineDevice(
  cacheKey: string,
): Promise<OfflineDeviceEnrollment | null> {
  const stored = await readStoredDevice();
  if (!stored || stored.cacheKey !== cacheKey) return null;
  const {
    deviceId,
    devicePublicId,
    displayName,
    status,
    lastValidatedAt,
    graceExpiresAt,
  } = stored;
  return {
    deviceId,
    devicePublicId,
    displayName,
    status,
    lastValidatedAt,
    graceExpiresAt,
  };
}

export function browserDeviceName(): string {
  const userAgent = navigator.userAgent;
  const browser = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("Chrome/")
      ? "Chrome"
      : userAgent.includes("Firefox/")
        ? "Firefox"
        : userAgent.includes("Safari/")
          ? "Safari"
          : "Browser";
  const device = /iPhone|iPad/.test(userAgent)
    ? "iPhone or iPad"
    : /Android/.test(userAgent)
      ? "Android"
      : /Macintosh/.test(userAgent)
        ? "Mac"
        : /Windows/.test(userAgent)
          ? "Windows"
          : "device";
  return `${browser} on ${device}`;
}
