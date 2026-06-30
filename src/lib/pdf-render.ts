import path from "node:path";
import { pathToFileURL } from "node:url";
import { put } from "@vercel/blob";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
).href;

type NodeCanvas = {
  width: number;
  height: number;
  getContext(type: "2d"): unknown;
  toBuffer(format: "image/jpeg", quality?: number): Buffer;
};

type PdfDoc = {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
};

type PdfPage = {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(params: object): { promise: Promise<void> };
  cleanup(): void;
};

async function loadPdfDoc(buffer: Buffer, canvasFactory: object): Promise<PdfDoc> {
  return (getDocument as unknown as (p: object) => { promise: Promise<PdfDoc> })({
    data: new Uint8Array(buffer),
    canvasFactory,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;
}

function makeCanvasFactory(createCanvas: (w: number, h: number) => NodeCanvas) {
  return {
    create(width: number, height: number) {
      const canvas = createCanvas(width, height);
      return { canvas, context: canvas.getContext("2d") };
    },
    reset(cc: { canvas: NodeCanvas }, width: number, height: number) {
      cc.canvas.width = width;
      cc.canvas.height = height;
    },
    destroy(cc: { canvas: NodeCanvas }) {
      cc.canvas.width = 0;
      cc.canvas.height = 0;
    },
  };
}

// Render a batch of pages from one PDF load (memory-efficient)
async function renderPageBatch(
  buffer: Buffer,
  pageNums: number[],
  scale: number,
): Promise<Map<number, Buffer>> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const factory = makeCanvasFactory(createCanvas as unknown as (w: number, h: number) => NodeCanvas);
  const doc = await loadPdfDoc(buffer, factory);
  const result = new Map<number, Buffer>();

  try {
    await Promise.all(
      pageNums.map(async (pageNum) => {
        const safeNum = Math.max(1, Math.min(pageNum, doc.numPages));
        const page = await doc.getPage(safeNum);
        try {
          const viewport = page.getViewport({ scale });
          const canvas = (createCanvas as unknown as (w: number, h: number) => NodeCanvas)(
            Math.floor(viewport.width),
            Math.floor(viewport.height),
          );
          await page.render({ canvasContext: canvas.getContext("2d"), viewport, canvasFactory: factory }).promise;
          result.set(pageNum, canvas.toBuffer("image/jpeg", 85));
        } finally {
          page.cleanup();
        }
      }),
    );
  } finally {
    await doc.destroy();
  }

  return result;
}

// Single page render (used by on-demand API)
export async function renderPdfPageToJpeg(buffer: Buffer, pageNum: number, scale = 2): Promise<Buffer> {
  const map = await renderPageBatch(buffer, [pageNum], scale);
  const result = map.get(pageNum);
  if (!result) throw new Error(`Failed to render page ${pageNum}`);
  return result;
}

// Render ALL pages and upload to Vercel Blob; returns Map<pageNum, blobUrl>
// Runs in batches of BATCH_SIZE pages to keep memory usage reasonable
export async function renderAndUploadAllPages(
  buffer: Buffer,
  sessionId: string,
  pageCount: number,
  scale = 1.5,
): Promise<Map<number, string>> {
  const BATCH_SIZE = 4;
  const urls = new Map<number, string>();

  for (let i = 1; i <= pageCount; i += BATCH_SIZE) {
    const batch: number[] = [];
    for (let j = i; j < i + BATCH_SIZE && j <= pageCount; j++) batch.push(j);

    let pageBuffers: Map<number, Buffer>;
    try {
      pageBuffers = await renderPageBatch(buffer, batch, scale);
    } catch (err) {
      console.error(`renderPageBatch failed for pages ${batch.join(",")}:`, err);
      continue;
    }

    await Promise.all(
      Array.from(pageBuffers.entries()).map(async ([pageNum, jpeg]) => {
        try {
          const blob = await put(
            `pdfs/${sessionId}/pages/${pageNum}.jpg`,
            jpeg,
            { access: "public", addRandomSuffix: false },
          );
          urls.set(pageNum, blob.url);
        } catch (err) {
          console.error(`Blob upload failed for page ${pageNum}:`, err);
        }
      }),
    );
  }

  return urls;
}
