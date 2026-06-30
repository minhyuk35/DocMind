"use client";

import type { PDFPageProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { getCachedPdfDoc } from "./pdf-cache";

type RenderTask = ReturnType<PDFPageProxy["render"]>;

interface Props {
  url: string;
  page: number;
  onClick?: () => void;
}

export default function PdfPageThumb({ url, page, onClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    getCachedPdfDoc(url)
      .then((doc) => {
        if (cancelled) return;
        const pageNum = Math.max(1, Math.min(page, doc.numPages));
        return doc.getPage(pageNum);
      })
      .then((pdfPage) => {
        if (!pdfPage || cancelled || !canvasRef.current) return;

        // Render at fixed 200px wide thumbnail
        const THUMB_WIDTH = 200;
        const unscaled = pdfPage.getViewport({ scale: 1 });
        const scale = THUMB_WIDTH / unscaled.width;
        const viewport = pdfPage.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;

        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx || cancelled) return;
        ctx.scale(dpr, dpr);

        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        return task.promise;
      })
      .then(() => {
        if (!cancelled) setLoading(false);
        renderTaskRef.current = null;
      })
      .catch((err: Error) => {
        if (err?.name === "RenderingCancelledException") return;
        if (!cancelled) {
          setLoading(false);
          setFailed(true);
        }
        renderTaskRef.current = null;
      });

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [url, page]);

  if (!url || failed) return null;

  return (
    <div
      className={`page-thumb${onClick ? " page-thumb-btn" : ""}`}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={onClick ? `${page}쪽 전체 보기` : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      {loading && <div className="page-thumb-skeleton" />}
      <canvas
        ref={canvasRef}
        className="page-thumb-canvas"
        style={{ display: loading ? "none" : "block" }}
      />
      {onClick && !loading && (
        <div className="page-thumb-overlay">
          <span>{page}쪽 보기</span>
        </div>
      )}
    </div>
  );
}
