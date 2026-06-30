export type PdfPage = {
  pageNumber: number;
  text: string;
  preview: string;
  charCount: number;
  aiSummary?: string;
};

export type PdfDocument = {
  id: string;
  fileName: string;
  pageCount: number;
  totalCharacters: number;
  pages: PdfPage[];
  geminiFileUri?: string;
  geminiFileName?: string;
  geminiFileMimeType?: string;
  uploadedAt: string;
};

export type PdfDocumentSummary = {
  id: string;
  fileName: string;
  pageCount: number;
  totalCharacters: number;
  uploadedAt: string;
  aiReady: boolean;
  pages: Array<Omit<PdfPage, "text">>;
};

export type EvidenceKind =
  | "paragraph"
  | "table"
  | "chart"
  | "figure"
  | "formula"
  | "definition"
  | "unknown";

export type EvidenceItem = {
  page: number;
  kind: EvidenceKind;
  title: string;
  quote: string;
  why: string;
};

export type WebSource = {
  title: string;
  url: string;
};

export type AskResponse = {
  answer: string;
  confidence: "high" | "medium" | "low";
  pdfSufficient: boolean;
  usedWeb: boolean;
  evidence: EvidenceItem[];
  webSources: WebSource[];
  selectedPages: number[];
  model: string;
  warning?: string;
};

export type RankedChunk = {
  page: number;
  text: string;
  score: number;
};
