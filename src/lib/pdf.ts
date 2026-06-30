import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfDocument, PdfPage, RankedChunk } from "@/lib/types";

type TextItemLike = {
  str?: string;
  transform?: number[];
};

type LineToken = {
  x: number;
  y: number;
  str: string;
};

const MAX_PREVIEW_LENGTH = 260;
const CHUNK_SIZE = 1300;
const CHUNK_OVERLAP = 180;

GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
).href;

export async function extractPdfDocument(
  buffer: Buffer,
  fileName: string,
  geminiFile?: {
    uri: string;
    name?: string;
    mimeType: string;
  },
): Promise<PdfDocument> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pages: PdfPage[] = [];
  const BATCH_SIZE = 8;

  try {
    const indices = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    for (let i = 0; i < indices.length; i += BATCH_SIZE) {
      const batch = indices.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (index) => {
          const page = await pdf.getPage(index);
          const content = await page.getTextContent();
          const text = textContentToText(content.items as TextItemLike[]);
          const normalized = normalizeWhitespace(text);
          page.cleanup();
          return {
            pageNumber: index,
            text: normalized,
            preview: makePreview(normalized),
            charCount: normalized.length,
          };
        }),
      );
      pages.push(...results);
    }
  } finally {
    await pdf.destroy();
  }

  return {
    id: crypto.randomUUID(),
    fileName,
    pageCount: pages.length,
    totalCharacters: pages.reduce((sum, page) => sum + page.charCount, 0),
    pages,
    geminiFileUri: geminiFile?.uri,
    geminiFileName: geminiFile?.name,
    geminiFileMimeType: geminiFile?.mimeType,
    uploadedAt: new Date().toISOString(),
  };
}

export function rankPdfChunks(document: PdfDocument, question: string): RankedChunk[] {
  const queryTerms = tokenize(question);
  const chunks = document.pages.flatMap((page) =>
    splitIntoChunks(page.text).map((text) => ({
      page: page.pageNumber,
      text,
      score: scoreChunk(text, queryTerms, question),
    })),
  );

  return chunks
    .sort((a, b) => b.score - a.score || a.page - b.page)
    .slice(0, 10);
}

function textContentToText(items: TextItemLike[]) {
  const tokens: LineToken[] = items
    .filter((item) => item.str?.trim() && item.transform)
    .map((item) => ({
      str: item.str?.trim() ?? "",
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }));

  const rows: LineToken[][] = [];
  for (const token of tokens.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((candidate) => Math.abs(candidate[0].y - token.y) < 3);
    if (row) {
      row.push(token);
    } else {
      rows.push([token]);
    }
  }

  return rows
    .map((row) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((token) => token.str)
        .join(" "),
    )
    .join("\n");
}

function normalizeWhitespace(text: string) {
  return text
    .replace(/\x00/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function makePreview(text: string) {
  if (!text) {
    return "이 페이지에서 추출 가능한 텍스트를 찾지 못했습니다.";
  }

  return text.length > MAX_PREVIEW_LENGTH
    ? `${text.slice(0, MAX_PREVIEW_LENGTH).trim()}...`
    : text;
}

function splitIntoChunks(text: string) {
  if (!text.trim()) {
    return [];
  }

  const lines = text.split("\n").filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    if ((current + line).length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(-CHUNK_OVERLAP);
    }

    current += `${current ? "\n" : ""}${line}`;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function tokenize(value: string) {
  return Array.from(
    new Set(value.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []),
  ).slice(0, 40);
}

function scoreChunk(text: string, queryTerms: string[], rawQuestion: string) {
  const lowerText = text.toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    if (lowerText.includes(term)) {
      score += term.length > 4 ? 4 : 2;
    }
  }

  const questionPhrases = rawQuestion
    .split(/[?.!,\n]/)
    .map((phrase) => phrase.trim().toLowerCase())
    .filter((phrase) => phrase.length >= 6);

  for (const phrase of questionPhrases) {
    if (lowerText.includes(phrase)) {
      score += 8;
    }
  }

  if (/\d/.test(rawQuestion) && /\d/.test(text)) {
    score += 1;
  }

  return score;
}
