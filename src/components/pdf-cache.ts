import type { PDFDocumentProxy } from "pdfjs-dist";

// Module-level singletons so PdfViewer and PdfPageThumb share the same loaded doc
let libPromise: Promise<typeof import("pdfjs-dist")> | null = null;
const docCache = new Map<string, Promise<PDFDocumentProxy>>();

export function loadPdfjsLib() {
  if (!libPromise) {
    libPromise = import("pdfjs-dist").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
      return lib;
    });
  }
  return libPromise;
}

export function getCachedPdfDoc(url: string): Promise<PDFDocumentProxy> {
  if (!docCache.has(url)) {
    const promise = loadPdfjsLib().then((lib) =>
      lib.getDocument({ url, standardFontDataUrl: "/standard_fonts/" }).promise,
    );
    docCache.set(url, promise);
  }
  return docCache.get(url)!;
}
