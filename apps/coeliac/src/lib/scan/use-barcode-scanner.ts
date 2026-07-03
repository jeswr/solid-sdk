// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * Live camera barcode scanning with `zxing-wasm` (client-side, DESIGN §5.1/§5.2).
 * Opens the rear camera, samples frames onto an offscreen canvas, and decodes
 * product barcodes (EAN/UPC). On the first valid decode it fires `onDetect(code)`
 * and stops — the 5-second scan path. Progressive enhancement: if the camera is
 * unavailable / denied, `error` is set and the caller falls back to manual entry.
 *
 * Camera + wasm are browser-only, so this hook is not unit-tested; the scan flow
 * is exercised in tests via the manual-entry path (same `onDetect` sink).
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Product barcode symbologies (kept narrow — food packaging). */
const FORMATS = ["EAN-13", "EAN-8", "UPC-A", "UPC-E"] as const;

export interface BarcodeScannerState {
  /** Attach to a `<video>` element. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Whether the camera is currently live. */
  scanning: boolean;
  /** A human message if the camera is unavailable / denied. */
  error: string | null;
  /** Stop the camera + decode loop. */
  stop: () => void;
}

export function useBarcodeScanner(
  onDetect: (code: string) => void,
  options: { active: boolean } = { active: true },
): BarcodeScannerState {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectedRef = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => {
    if (!options.active) return;
    detectedRef.current = false;
    let cancelled = false;
    let readBarcodes: typeof import("zxing-wasm/reader").readBarcodes;

    async function tick() {
      const video = videoRef.current;
      if (cancelled || detectedRef.current || !video || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const canvas = (canvasRef.current ??= document.createElement("canvas"));
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w === 0 || h === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const image = ctx.getImageData(0, 0, w, h);
      try {
        const results = await readBarcodes(image, {
          formats: [...FORMATS],
          tryHarder: true,
        });
        const hit = results.find((r) => r.isValid && r.text);
        if (hit && !detectedRef.current) {
          detectedRef.current = true;
          onDetectRef.current(hit.text);
          stop();
          return;
        }
      } catch {
        // transient decode error — keep sampling
      }
      if (!cancelled) rafRef.current = requestAnimationFrame(tick);
    }

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Camera not available on this device — enter the barcode by hand.");
          return;
        }
        ({ readBarcodes } = await import("zxing-wasm/reader"));
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        setScanning(true);
        setError(null);
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        setError("Couldn't open the camera — check permissions, or enter the barcode by hand.");
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [options.active, stop]);

  return { videoRef, scanning, error, stop };
}
