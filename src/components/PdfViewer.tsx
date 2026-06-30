"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { FileText, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getCachedPdfDoc } from "./pdf-cache";

type RenderTask = ReturnType<PDFPageProxy["render"]>;

interface Props {
  url: string;
  page: number;
  scaleMultiplier?: number;
}

export default function PdfViewer({ url, page, scaleMultiplier = 1 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);

  useEffect(() => {
    if (!url) { setPdfDoc(null); return; }
    let cancelled = false;
    setLoadingDoc(true);
    getCachedPdfDoc(url)
      .then((doc) => { if (!cancelled) { setPdfDoc(doc); setLoadingDoc(false); } })
      .catch(() => { if (!cancelled) setLoadingDoc(false); });
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!pdfDoc || !canvas || !container) return;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    let cancelled = false;
    setLoadingPage(true);

    const pageNum = Math.max(1, Math.min(page, pdfDoc.numPages));

    pdfDoc
      .getPage(pageNum)
      .then((pdfPage) => {
        if (cancelled) return;

        const containerWidth = container.parentElement?.clientWidth || container.clientWidth || 600;
        const unscaledVp = pdfPage.getViewport({ scale: 1 });
        const fitScale = containerWidth / unscaledVp.width;
        const scale = fitScale * scaleMultiplier;
        const viewport = pdfPage.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;

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
      .then(() => { if (!cancelled) setLoadingPage(false); renderTaskRef.current = null; })
      .catch((err: Error) => {
        if (err?.name !== "RenderingCancelledException" && !cancelled) setLoadingPage(false);
        renderTaskRef.current = null;
      });

    return () => {
      cancelled = true;
      if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
    };
  }, [pdfDoc, page, scaleMultiplier]);

  if (!url) {
    return (
      <div className="pdf-placeholder">
        <FileText size={32} />
        <span>PDF Preview</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="pdf-canvas-wrap">
      {(loadingDoc || loadingPage) && (
        <div className="pdf-canvas-loading">
          <Loader2 className="spin" size={22} />
        </div>
      )}
      <canvas ref={canvasRef} className="pdf-canvas" />
    </div>
  );
}
