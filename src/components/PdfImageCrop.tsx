"use client";

import { useEffect, useRef, useState } from "react";
import { getCachedPdfDoc } from "./pdf-cache";

interface Props {
  sessionId: string;
  pdfUrl?: string;
  page: number;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2] normalized 0–1
  alt?: string;
  onClick?: () => void;
}

const PADDING = 0.02;
const MAX_DISPLAY_WIDTH = 480;

export default function PdfImageCrop({ sessionId, pdfUrl, page, bbox, alt, onClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    const [x1, y1, x2, y2] = bbox;
    const px1 = Math.max(0, x1 - PADDING);
    const py1 = Math.max(0, y1 - PADDING);
    const px2 = Math.min(1, x2 + PADDING);
    const py2 = Math.min(1, y2 + PADDING);

    function cropImageToCanvas(srcImg: HTMLImageElement | HTMLCanvasElement) {
      if (cancelled || !canvasRef.current) return false;
      const w = srcImg instanceof HTMLImageElement ? srcImg.naturalWidth : srcImg.width;
      const h = srcImg instanceof HTMLImageElement ? srcImg.naturalHeight : srcImg.height;
      const srcX = Math.floor(px1 * w);
      const srcY = Math.floor(py1 * h);
      const srcW = Math.floor((px2 - px1) * w);
      const srcH = Math.floor((py2 - py1) * h);
      if (srcW <= 0 || srcH <= 0) { setFailed(true); return false; }

      const dpr = window.devicePixelRatio || 1;
      const displayW = Math.min(srcW, MAX_DISPLAY_WIDTH);
      const displayH = (srcH / srcW) * displayW;

      const canvas = canvasRef.current;
      canvas.width = Math.floor(displayW * dpr);
      canvas.height = Math.floor(displayH * dpr);
      canvas.style.width = `${displayW}px`;
      canvas.style.height = `${displayH}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx || cancelled) return false;
      ctx.drawImage(srcImg, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
      if (!cancelled) setLoading(false);
      return true;
    }

    async function render() {
      // Try pre-rendered page image from API first
      if (sessionId) {
        try {
          const img = new Image();
          img.crossOrigin = "anonymous";
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("failed"));
            img.src = `/api/sessions/${sessionId}/pages/${page}/image`;
          });
          if (!cancelled && cropImageToCanvas(img)) return;
        } catch {
          // fall through to pdfjs
        }
      }

      // Fallback: render page client-side with pdfjs and crop
      if (!pdfUrl) {
        if (!cancelled) { setLoading(false); setFailed(true); }
        return;
      }
      try {
        const doc = await getCachedPdfDoc(pdfUrl);
        if (cancelled) return;
        const pdfPage = await doc.getPage(Math.max(1, Math.min(page, doc.numPages)));
        if (cancelled) return;

        const vp = pdfPage.getViewport({ scale: 2 });
        const offscreen = document.createElement("canvas");
        offscreen.width = Math.floor(vp.width);
        offscreen.height = Math.floor(vp.height);
        const ctx = offscreen.getContext("2d")!;
        await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
        if (!cancelled) cropImageToCanvas(offscreen);
      } catch {
        if (!cancelled) { setLoading(false); setFailed(true); }
      }
    }

    void render();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, pdfUrl, page, bbox[0], bbox[1], bbox[2], bbox[3]]);

  if (failed) return null;

  return (
    <span
      className={`pdf-img-crop${onClick ? " pdf-img-crop-btn" : ""}`}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={onClick ? `${page}쪽으로 이동` : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      {loading && <span className="pdf-img-crop-skeleton" />}
      <canvas ref={canvasRef} style={{ display: loading ? "none" : "block" }} />
    </span>
  );
}
