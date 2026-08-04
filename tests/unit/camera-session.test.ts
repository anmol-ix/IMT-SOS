import { describe, expect, it, vi } from "vitest";
import { stopCameraSession } from "@/client/camera-session";

describe("camera session cleanup", () => {
  it("stops acquired and attached tracks even when scanner cleanup throws", () => {
    const acquiredTrack = { stop: vi.fn() };
    const attachedTrack = { stop: vi.fn() };
    const acquiredStream = { getTracks: () => [acquiredTrack] };
    const attachedStream = { getTracks: () => [attachedTrack] };
    const video = {
      pause: vi.fn(),
      srcObject: attachedStream,
    };

    stopCameraSession({
      controls: { stop: () => { throw new Error("scanner already closed"); } },
      stream: acquiredStream,
      video: video as unknown as HTMLVideoElement,
    });

    expect(acquiredTrack.stop).toHaveBeenCalledOnce();
    expect(attachedTrack.stop).toHaveBeenCalledOnce();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });

  it("does not stop the same stream twice", () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };

    stopCameraSession({
      stream,
      video: {
        pause: vi.fn(),
        srcObject: stream,
      } as unknown as HTMLVideoElement,
    });

    expect(track.stop).toHaveBeenCalledOnce();
  });
});
