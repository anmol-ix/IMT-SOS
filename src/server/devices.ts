import "server-only";

import type { CurrentUser } from "@/server/auth/current-user";
import { requireRole } from "@/server/auth/roles";
import { getDatabase } from "@/server/database";
import {
  graceExpiry,
  type DeviceEnrollmentStatus,
  type OfflineDeviceEnrollment,
} from "@/shared/offline-device";

export type AppDevice = OfflineDeviceEnrollment & {
  userId: string;
  userDisplayName: string;
  userRole: CurrentUser["role"];
  enrolledAt: string;
  lastSeenAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
};

type EnrollmentRow = {
  id: string;
  device_public_id: string;
  display_name: string;
  status: DeviceEnrollmentStatus;
  last_validated_at: Date | null;
};

type DeviceRow = {
  id: string;
  app_user_id: string;
  device_public_id: string;
  user_display_name: string;
  user_role: CurrentUser["role"];
  display_name: string;
  status: DeviceEnrollmentStatus;
  enrolled_at: Date;
  last_seen_at: Date;
  last_validated_at: Date | null;
  approved_at: Date | null;
  revoked_at: Date | null;
};

function enrollmentFromRow(row: EnrollmentRow): OfflineDeviceEnrollment {
  return {
    deviceId: row.id,
    devicePublicId: row.device_public_id,
    displayName: row.display_name,
    status: row.status,
    lastValidatedAt: row.last_validated_at?.toISOString() ?? null,
    graceExpiresAt: row.last_validated_at
      ? graceExpiry(row.last_validated_at)
      : null,
  };
}

function deviceFromRow(row: DeviceRow): AppDevice {
  return {
    ...enrollmentFromRow({
      id: row.id,
      device_public_id: row.device_public_id,
      display_name: row.display_name,
      status: row.status,
      last_validated_at: row.last_validated_at,
    }),
    userId: row.app_user_id,
    userDisplayName: row.user_display_name,
    userRole: row.user_role,
    enrolledAt: row.enrolled_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    approvedAt: row.approved_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

export async function enrollDevice(
  actor: CurrentUser,
  input: { devicePublicId: string; displayName: string },
): Promise<OfflineDeviceEnrollment> {
  const result = await getDatabase().query<EnrollmentRow>(
    "SELECT * FROM enroll_app_device($1, $2, $3)",
    [actor.id, input.devicePublicId, input.displayName],
  );
  return enrollmentFromRow(result.rows[0]);
}

export async function listDevices(actor: CurrentUser): Promise<AppDevice[]> {
  requireRole(actor.role, ["BUSINESS_OWNER"]);
  const result = await getDatabase().query<DeviceRow>(
    "SELECT * FROM list_app_devices($1)",
    [actor.id],
  );
  return result.rows.map(deviceFromRow);
}

export async function changeDeviceStatus(
  actor: CurrentUser,
  deviceId: string,
  action: "APPROVE" | "REVOKE",
): Promise<AppDevice> {
  requireRole(actor.role, ["BUSINESS_OWNER"]);
  await getDatabase().query(
    "SELECT * FROM update_app_device($1, $2, $3)",
    [actor.id, deviceId, action],
  );
  const devices = await listDevices(actor);
  const device = devices.find((item) => item.deviceId === deviceId);
  if (!device) throw new Error("Device not found after update.");
  return device;
}
