type CameraStream = {
  getTracks: () => Array<{ stop: () => void }>;
};

type CameraVideo = {
  pause: () => void;
  srcObject: MediaProvider | null;
};

type ScannerControls = {
  stop: () => void;
};

function isCameraStream(value: unknown): value is CameraStream {
  return Boolean(
    value
    && typeof value === "object"
    && "getTracks" in value
    && typeof value.getTracks === "function",
  );
}

export function stopCameraSession({
  controls,
  stream,
  video,
}: {
  controls?: ScannerControls | null;
  stream?: CameraStream | null;
  video?: CameraVideo | null;
}) {
  try {
    controls?.stop();
  } catch {
    // Track cleanup below remains the security boundary.
  }

  const streams = new Set<CameraStream>();
  if (stream) streams.add(stream);
  if (isCameraStream(video?.srcObject)) streams.add(video.srcObject);

  for (const activeStream of streams) {
    for (const track of activeStream.getTracks()) {
      try {
        track.stop();
      } catch {
        // Continue stopping the remaining camera tracks.
      }
    }
  }

  if (video) {
    try {
      video.pause();
    } catch {
      // Clearing srcObject still releases the preview.
    }
    video.srcObject = null;
  }
}
