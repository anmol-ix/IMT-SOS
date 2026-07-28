export const OFFLINE_DEVICE_GRACE_MS = 12 * 60 * 60 * 1000;

export type DeviceEnrollmentStatus = "PENDING" | "ACTIVE" | "REVOKED";

export type OfflineDeviceEnrollment = {
  deviceId: string;
  devicePublicId: string;
  displayName: string;
  status: DeviceEnrollmentStatus;
  lastValidatedAt: string | null;
  graceExpiresAt: string | null;
};

export type OfflineDeviceState =
  | "ACTIVE"
  | "PENDING"
  | "REVOKED"
  | "EXPIRED"
  | "UNENROLLED";

export function offlineDeviceState(
  enrollment: OfflineDeviceEnrollment | null,
  now = Date.now(),
): OfflineDeviceState {
  if (!enrollment) return "UNENROLLED";
  if (enrollment.status === "REVOKED") return "REVOKED";
  if (enrollment.status === "PENDING") return "PENDING";
  const expiresAt = enrollment.graceExpiresAt
    ? new Date(enrollment.graceExpiresAt).getTime()
    : Number.NaN;
  if (
    !Number.isFinite(expiresAt)
    || expiresAt <= now
  ) {
    return "EXPIRED";
  }
  return "ACTIVE";
}

export function graceExpiry(lastValidatedAt: Date | string): string {
  return new Date(
    new Date(lastValidatedAt).getTime() + OFFLINE_DEVICE_GRACE_MS,
  ).toISOString();
}
