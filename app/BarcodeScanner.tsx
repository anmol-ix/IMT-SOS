"use client";

import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import type { Worker } from "tesseract.js";
import { stopCameraSession } from "@/client/camera-session";
import {
  matchPrintedLabel,
  type LabelRecognitionCandidate,
} from "@/shared/label-recognition";

export type BarcodeScanOutcome = {
  kind: "success" | "warning";
  message: string;
};

type ScannerState = "starting" | "scanning" | "checking" | "success" | "warning" | "error";

type Props = {
  onComplete: () => void;
  onDetected: (barcode: string) => Promise<BarcodeScanOutcome>;
  onManualSearch: () => void;
  labelCandidates: LabelRecognitionCandidate[];
};

type ScannerFeedback = {
  state: ScannerState;
  title: string;
  message: string;
};

const tonePatterns = {
  ready: [{ frequency: 620, duration: 0.07 }],
  success: [
    { frequency: 880, duration: 0.09 },
    { frequency: 1180, duration: 0.12 },
  ],
  warning: [
    { frequency: 520, duration: 0.11 },
    { frequency: 420, duration: 0.14 },
  ],
  error: [
    { frequency: 260, duration: 0.16 },
    { frequency: 220, duration: 0.2 },
  ],
} as const;

function playScannerTone(tone: keyof typeof tonePatterns) {
  try {
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    let startsAt = context.currentTime;

    for (const note of tonePatterns[tone]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, startsAt);
      gain.gain.setValueAtTime(0.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(0.12, startsAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + note.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startsAt);
      oscillator.stop(startsAt + note.duration);
      startsAt += note.duration + 0.04;
    }

    window.setTimeout(() => void context.close(), Math.ceil((startsAt - context.currentTime + 0.1) * 1000));
  } catch {
    // Sound feedback is an enhancement; scanning must still work without it.
  }
}

function cameraErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Camera permission is blocked. Allow camera access in the browser, then try again.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No camera was found on this device. Search using the SKU or product name instead.";
  }
  return "The camera could not start. Try again or search using the SKU or product name.";
}

function feedbackIcon(state: ScannerState) {
  if (state === "success") return "✓";
  if (state === "warning") return "!";
  if (state === "error") return "×";
  return "⌁";
}

function captureLabel(video: HTMLVideoElement) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const cropWidth = Math.round(sourceWidth * 0.9);
  const cropHeight = Math.round(sourceHeight * 0.62);
  const cropX = Math.round((sourceWidth - cropWidth) / 2);
  const cropY = Math.round((sourceHeight - cropHeight) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = 1400;
  canvas.height = Math.max(420, Math.round((cropHeight / cropWidth) * canvas.width));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(
    video,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

export default function BarcodeScanner({
  onComplete,
  onDetected,
  onManualSearch,
  labelCandidates,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const guidanceTimerRef = useRef<number | undefined>(undefined);
  const labelTimerRef = useRef<number | undefined>(undefined);
  const quaggaTimerRef = useRef<number | undefined>(undefined);
  const completionTimerRef = useRef<number | undefined>(undefined);
  const ocrWorkerRef = useRef<Worker | null>(null);
  const detectedRef = useRef(onDetected);
  const completeRef = useRef(onComplete);
  const labelCandidatesRef = useRef(labelCandidates);
  const [scanAttempt, setScanAttempt] = useState(0);
  const [feedback, setFeedback] = useState<ScannerFeedback>({
    state: "starting",
    title: "Starting camera",
    message: "Keep the barcode ready while the camera starts.",
  });

  useEffect(() => {
    detectedRef.current = onDetected;
    completeRef.current = onComplete;
    labelCandidatesRef.current = labelCandidates;
  }, [labelCandidates, onComplete, onDetected]);

  useEffect(() => {
    let cancelled = false;
    let finished = false;
    let quaggaBusy = false;

    function clearTimers() {
      if (guidanceTimerRef.current !== undefined) {
        window.clearTimeout(guidanceTimerRef.current);
        guidanceTimerRef.current = undefined;
      }
      if (labelTimerRef.current !== undefined) {
        window.clearTimeout(labelTimerRef.current);
        labelTimerRef.current = undefined;
      }
      if (quaggaTimerRef.current !== undefined) {
        window.clearTimeout(quaggaTimerRef.current);
        quaggaTimerRef.current = undefined;
      }
      if (completionTimerRef.current !== undefined) {
        window.clearTimeout(completionTimerRef.current);
        completionTimerRef.current = undefined;
      }
    }

    function stopVideo() {
      clearTimers();
      stopCameraSession({
        controls: controlsRef.current,
        stream: streamRef.current,
        video: videoRef.current,
      });
      controlsRef.current = null;
      streamRef.current = null;
      const worker = ocrWorkerRef.current;
      ocrWorkerRef.current = null;
      if (worker) void worker.terminate();
    }

    async function finish(value: string) {
      const barcode = value.trim();
      if (!barcode || cancelled || finished) return;
      finished = true;
      stopVideo();
      setFeedback({
        state: "checking",
        title: "Barcode read",
        message: `Checking ${barcode} in the product catalogue…`,
      });

      try {
        const outcome = await detectedRef.current(barcode);
        if (cancelled) return;
        setFeedback({
          state: outcome.kind,
          title: outcome.kind === "success" ? "Product added" : "Product not found",
          message: outcome.message,
        });
        playScannerTone(outcome.kind);
        if (outcome.kind === "success") {
          completionTimerRef.current = window.setTimeout(() => completeRef.current(), 850);
        }
      } catch {
        if (cancelled) return;
        setFeedback({
          state: "error",
          title: "Could not check this barcode",
          message: "The barcode was read, but the catalogue could not be checked. Try again or search manually.",
        });
        playScannerTone("error");
      }
    }

    async function tryQuaggaFrame(video: HTMLVideoElement) {
      if (cancelled || finished || quaggaBusy) return;
      const canvas = captureLabel(video);
      if (!canvas) return;
      quaggaBusy = true;
      try {
        const imported = await import("@ericblade/quagga2");
        const result = await imported.default.decodeSingle({
          src: canvas.toDataURL("image/jpeg", 0.94),
          inputStream: {
            size: 1400,
            singleChannel: false,
          },
          locate: true,
          numOfWorkers: 0,
          decoder: {
            readers: [
              "code_128_reader",
              "code_39_reader",
              "ean_reader",
              "ean_8_reader",
              "upc_reader",
              "upc_e_reader",
            ],
          },
        });
        const code = result?.codeResult?.code?.trim();
        if (code) await finish(code);
      } catch {
        // A missed frame is normal; the next camera frame will be tried.
      } finally {
        quaggaBusy = false;
      }
    }

    async function tryPrintedLabel(video: HTMLVideoElement) {
      if (cancelled || finished || ocrWorkerRef.current) return;
      const canvas = captureLabel(video);
      if (!canvas) return;

      setFeedback({
        state: "checking",
        title: "Reading the printed label",
        message: "The barcode is unclear, so the scanner is checking the SKU and product name.",
      });

      try {
        const { createWorker, PSM } = await import("tesseract.js");
        const worker = await createWorker("eng");
        if (cancelled || finished) {
          await worker.terminate();
          return;
        }
        ocrWorkerRef.current = worker;
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          preserve_interword_spaces: "1",
        });
        const { data } = await worker.recognize(canvas);
        if (cancelled || finished) return;

        const match = matchPrintedLabel(data.text, labelCandidatesRef.current);
        if (match) {
          setFeedback({
            state: "checking",
            title: match.matchedBy === "sku" ? "SKU recognized" : "Product name recognized",
            message: `Checking ${match.candidate.name} in the catalogue…`,
          });
          await finish(match.candidate.code);
          return;
        }

        setFeedback({
          state: "warning",
          title: "Label could not be identified",
          message: "Try once more with the label flat, or search using the printed SKU.",
        });
        playScannerTone("warning");
      } catch {
        if (cancelled || finished) return;
        setFeedback({
          state: "warning",
          title: "Label could not be identified",
          message: "Try once more with the label flat, or search using the printed SKU.",
        });
        playScannerTone("warning");
      } finally {
        const worker = ocrWorkerRef.current;
        ocrWorkerRef.current = null;
        if (worker) await worker.terminate();
      }
    }

    async function start() {
      setFeedback({
        state: "starting",
        title: "Starting camera",
        message: "Keep the barcode ready while the camera starts.",
      });
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      if (cancelled) {
        stopVideo();
        return;
      }

      const video = videoRef.current;
      if (!video) {
        stopVideo();
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (cancelled) {
        stopVideo();
        return;
      }

      setFeedback({
        state: "scanning",
        title: "Ready to scan",
        message: "Keep the complete barcode flat, close and free from glare.",
      });
      playScannerTone("ready");
      guidanceTimerRef.current = window.setTimeout(() => {
        if (cancelled || finished) return;
        setFeedback({
          state: "warning",
          title: "Barcode is not clear yet",
          message: "Move closer, hold steady and tilt the pack slightly to remove glare.",
        });
        playScannerTone("warning");
      }, 4500);

      const runQuagga = () => {
        if (cancelled || finished) return;
        void tryQuaggaFrame(video).finally(() => {
          if (!cancelled && !finished) {
            quaggaTimerRef.current = window.setTimeout(runQuagga, 650);
          }
        });
      };
      quaggaTimerRef.current = window.setTimeout(runQuagga, 350);

      labelTimerRef.current = window.setTimeout(() => {
        if (!cancelled && !finished) void tryPrintedLabel(video);
      }, 6200);

      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      if (cancelled) {
        stopVideo();
        return;
      }
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 120,
      });
      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result) void finish(result.getText());
      });
      if (cancelled || finished) {
        controls.stop();
        stopVideo();
        return;
      }
      controlsRef.current = controls;
    }

    start().catch((error) => {
      if (cancelled) {
        stopVideo();
        return;
      }
      stopVideo();
      setFeedback({
        state: "error",
        title: "Camera unavailable",
        message: cameraErrorMessage(error),
      });
      playScannerTone("error");
    });

    return () => {
      cancelled = true;
      stopVideo();
    };
  }, [scanAttempt]);

  const canRetry = feedback.state === "warning" || feedback.state === "error";

  return (
    <section
      className="barcode-scanner"
      aria-label="Live barcode camera"
      data-state={feedback.state}
    >
      <div className="scanner-viewport">
        <video ref={videoRef} muted playsInline aria-label="Live camera preview" />
        <span className="scanner-target" aria-hidden="true" />
        <span className="scanner-beam" aria-hidden="true" />
      </div>

      <div
        className="scanner-feedback"
        role={feedback.state === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        <span className="scanner-feedback-icon" aria-hidden="true">
          {feedbackIcon(feedback.state)}
        </span>
        <span>
          <strong>{feedback.title}</strong>
          <small>{feedback.message}</small>
        </span>
      </div>

      {canRetry && (
        <div className="scanner-actions">
          <button type="button" onClick={() => setScanAttempt((attempt) => attempt + 1)}>
            Scan again
          </button>
          <button type="button" className="scanner-manual" onClick={onManualSearch}>
            Search manually
          </button>
        </div>
      )}

      <p className="scanner-privacy">
        Camera and sound stop automatically when this window closes or a product is added.
      </p>
    </section>
  );
}
