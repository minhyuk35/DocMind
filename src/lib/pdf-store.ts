import type { PdfDocument } from "@/lib/types";

const globalForPdfStore = globalThis as typeof globalThis & {
  pdfEvidenceStore?: Map<string, PdfDocument>;
};

export const pdfEvidenceStore =
  globalForPdfStore.pdfEvidenceStore ?? new Map<string, PdfDocument>();

if (!globalForPdfStore.pdfEvidenceStore) {
  globalForPdfStore.pdfEvidenceStore = pdfEvidenceStore;
}

export function summarizeDocument(document: PdfDocument) {
  return {
    id: document.id,
    fileName: document.fileName,
    pageCount: document.pageCount,
    totalCharacters: document.totalCharacters,
    uploadedAt: document.uploadedAt,
    aiReady: Boolean(document.geminiFileUri),
    pages: document.pages.map((page) => ({
      pageNumber: page.pageNumber,
      preview: page.preview,
      charCount: page.charCount,
      aiSummary: page.aiSummary,
    })),
  };
}
