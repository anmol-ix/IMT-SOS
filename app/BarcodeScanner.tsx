"use client";

import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
};

type BarcodeDetectorConstructor = new () => BarcodeDetectorLike;

type Props = {
  onClose: () => void;
  onDetected: (barcode: string) => void;
};

function cameraErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Camera permission was blocked. Allow camera access or use manual search.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No camera was found. Use manual SKU, barcode or name search.";
  }
  return "The camera could not start. Use manual SKU, barcode or name search.";
}

export default function BarcodeScanner({ onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectedRef = useRef(onDetected);
  const [status, setStatus] = useState("Point the rear camera at the complete barcode.");

  useEffect(() => {
    detectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let stopped = false;
    let controls: IScannerControls | undefined;
    let timer: number | undefined;

    function stopVideo() {
      if (timer !== undefined) window.clearTimeout(timer);
      controls?.stop();
      const stream = videoRef.current?.srcObject;
      if (stream instanceof MediaStream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    function finish(value: string) {
      const barcode = value.trim();
      if (!barcode || stopped) return;
      stopped = true;
      stopVideo();
      detectedRef.current(barcode);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera unavailable");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      const Detector = (
        window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }
      ).BarcodeDetector;
      if (Detector) {
        const detector = new Detector();
        const detect = async () => {
          if (stopped) return;
          try {
            const [result] = await detector.detect(video);
            if (result) {
              finish(result.rawValue);
              return;
            }
          } catch {
            // A frame without a readable barcode is expected while aiming.
          }
          timer = window.setTimeout(detect, 150);
        };
        await detect();
        return;
      }

      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result) finish(result.getText());
      });
    }

    start().catch((error) => {
      if (stopped) return;
      stopVideo();
      setStatus(cameraErrorMessage(error));
    });

    return () => {
      stopped = true;
      stopVideo();
    };
  }, []);

  return (
    <section className="barcode-scanner" aria-labelledby="scanner-heading">
      <div className="scanner-heading">
        <div>
          <p className="eyebrow">Camera scanner</p>
          <h2 id="scanner-heading">Scan product barcode</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close camera scanner">
          Close
        </button>
      </div>
      <div className="scanner-viewport">
        <video ref={videoRef} muted playsInline aria-label="Live camera preview" />
        <span className="scanner-target" aria-hidden="true" />
      </div>
      <p role="status">{status}</p>
    </section>
  );
}
