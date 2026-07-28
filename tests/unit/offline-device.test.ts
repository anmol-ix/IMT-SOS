import { describe, expect, it } from "vitest";
import {
  graceExpiry,
  OFFLINE_DEVICE_GRACE_MS,
  offlineDeviceState,
  type OfflineDeviceEnrollment,
} from "@/shared/offline-device";

function enrollment(
  overrides: Partial<OfflineDeviceEnrollment> = {},
): OfflineDeviceEnrollment {
  return {
    deviceId: "45ee4c95-a774-49c7-b3df-4a24c0bcaefd",
    devicePublicId: "21e97c07-c082-4c89-9f82-5e862df4ce99",
    displayName: "Safari on iPhone",
    status: "ACTIVE",
    lastValidatedAt: "2026-07-28T03:00:00.000Z",
    graceExpiresAt: "2026-07-28T15:00:00.000Z",
    ...overrides,
  };
}

describe("offline device validation", () => {
  it("limits an active device validation to twelve hours", () => {
    const validatedAt = "2026-07-28T03:00:00.000Z";
    expect(graceExpiry(validatedAt)).toBe("2026-07-28T15:00:00.000Z");
    expect(
      new Date(graceExpiry(validatedAt)).getTime()
        - new Date(validatedAt).getTime(),
    ).toBe(OFFLINE_DEVICE_GRACE_MS);
  });

  it("expires at the boundary and never treats pending or revoked as active", () => {
    expect(offlineDeviceState(enrollment(), Date.parse("2026-07-28T14:59:59.999Z")))
      .toBe("ACTIVE");
    expect(offlineDeviceState(enrollment(), Date.parse("2026-07-28T15:00:00.000Z")))
      .toBe("EXPIRED");
    expect(offlineDeviceState(enrollment({ status: "PENDING" }))).toBe("PENDING");
    expect(offlineDeviceState(enrollment({ status: "REVOKED" }))).toBe("REVOKED");
    expect(offlineDeviceState(enrollment({ graceExpiresAt: "invalid" }))).toBe("EXPIRED");
    expect(offlineDeviceState(null)).toBe("UNENROLLED");
  });
});
