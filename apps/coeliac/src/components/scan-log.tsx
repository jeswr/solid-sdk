// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The scan → lookup → "Ate it now" flow (DESIGN §5.1.1). The camera is live on
 * open; a decoded barcode resolves through OFF (cached in the pod), and the
 * product + derived exposures render for a one-tap log. A manual barcode entry is
 * always available (scanners fail on damaged/tiny codes — RESEARCH §3.6), and an
 * OFF miss falls through to manual meal entry.
 */
import { useCallback, useState } from "react";
import { isBarcode } from "@/lib/pod/layout";
import { OffLookupError } from "@/lib/off/off";
import { resolveProduct, type ResolvedProduct } from "@/lib/off/resolve";
import { useSession } from "@/lib/session/context";
import { useBarcodeScanner } from "@/lib/scan/use-barcode-scanner";
import { ManualMeal } from "./manual-meal";
import { ProductView } from "./product-view";

type Phase = "scanning" | "resolving" | "resolved" | "notfound" | "error";

export function ScanLog({ onLogged }: { onLogged?: () => void }) {
  const { publicFetch, authedFetch, storageRoot } = useSession();
  const [phase, setPhase] = useState<Phase>("scanning");
  const [resolved, setResolved] = useState<ResolvedProduct | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleBarcode = useCallback(
    async (code: string) => {
      if (!isBarcode(code)) {
        setErrorMsg(`"${code}" doesn't look like a product barcode.`);
        setPhase("error");
        return;
      }
      setPhase("resolving");
      setErrorMsg(null);
      try {
        const result = await resolveProduct(code, { publicFetch, authedFetch, storageRoot });
        if (!result.product.found) {
          setResolved(result);
          setPhase("notfound");
          return;
        }
        setResolved(result);
        setPhase("resolved");
      } catch (err) {
        setErrorMsg(err instanceof OffLookupError ? "Couldn't reach Open Food Facts." : (err as Error).message);
        setPhase("error");
      }
    },
    [publicFetch, authedFetch, storageRoot],
  );

  const scanning = phase === "scanning";
  const { videoRef, error: cameraError } = useBarcodeScanner(handleBarcode, { active: scanning });

  const reset = () => {
    setResolved(null);
    setManualCode("");
    setErrorMsg(null);
    setPhase("scanning");
  };

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    void handleBarcode(manualCode.trim());
  }

  return (
    <section className="scan" aria-label="Scan a product">
      {scanning ? (
        <div className="scan__camera">
          <video ref={videoRef} className="scan__video" playsInline muted aria-label="Camera preview" />
          {cameraError ? <p className="scan__camera-error">{cameraError}</p> : null}
          <form className="scan__manual" onSubmit={submitManual}>
            <label htmlFor="manual-barcode">Or enter the barcode by hand</label>
            <input
              id="manual-barcode"
              inputMode="numeric"
              pattern="[0-9]*"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="e.g. 5000159407236"
            />
            <button type="submit" className="btn" disabled={!isBarcode(manualCode.trim())}>
              Look up
            </button>
          </form>
        </div>
      ) : null}

      {phase === "resolving" ? <p role="status">Looking up product…</p> : null}

      {phase === "resolved" && resolved ? (
        <>
          <ProductView product={resolved.product} source={resolved.source} onLogged={onLogged} />
          <button type="button" className="btn" onClick={reset}>
            Scan another
          </button>
        </>
      ) : null}

      {phase === "notfound" && resolved ? (
        <div className="scan__notfound">
          <p role="note">
            Barcode {resolved.product.barcode} isn&rsquo;t in Open Food Facts. Enter what you ate
            by hand:
          </p>
          <ManualMeal onLogged={onLogged} initialName="" />
          <button type="button" className="btn" onClick={reset}>
            Scan another
          </button>
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="scan__error" role="alert">
          <p>{errorMsg}</p>
          <ManualMeal onLogged={onLogged} initialName="" />
          <button type="button" className="btn" onClick={reset}>
            Try scanning again
          </button>
        </div>
      ) : null}
    </section>
  );
}
