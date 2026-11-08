import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { generatePageSummaries, uploadPdfToGemini } from "@/lib/ai";
import { createSession, savePdfPages } from "@/lib/db";
import { safeErrorMessage } from "@/lib/errors";
import { extractPdfDocument } from "@/lib/pdf";
import { renderAndUploadAllPages } from "@/lib/pdf-render";
import { pdfEvidenceStore, summarizeDocument } from "@/lib/pdf-store";
import { isOwnUploadUrl, MAX_PDF_BYTES } from "@/lib/upload";

export const runtime = "nodejs";
export const maxDuration = 300;

type AnalyzeRequest = { url?: unknown; fileName?: unknown };

// The PDF itself is uploaded from the browser to Vercel Blob (see /api/blob-upload);
// this route receives only the Blob URL, because Vercel rejects request bodies over 4.5MB.
export async function POST(request: Request) {
  try {
    const authSession = await getServerSession(authOptions);
    if (!authSession?.user?.id) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    const userId = authSession.user.id;

    const body = (await request.json().catch(() => ({}))) as AnalyzeRequest;
    const pdfUrl = typeof body.url === "string" ? body.url : "";
    const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : "document.pdf";

    if (!pdfUrl || !isOwnUploadUrl(pdfUrl, userId)) {
      return NextResponse.json({ error: "업로드한 PDF를 찾지 못했습니다. 다시 올려 주세요." }, { status: 400 });
    }
    if (!fileName.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
    }

    const pdfResponse = await fetch(pdfUrl, { cache: "no-store" });
    if (!pdfResponse.ok) {
      return NextResponse.json({ error: "업로드한 PDF를 불러오지 못했습니다. 다시 올려 주세요." }, { status: 502 });
    }
    const declaredSize = Number(pdfResponse.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "200MB 이하 PDF만 업로드할 수 있습니다." }, { status: 413 });
    }
    const buffer = Buffer.from(await pdfResponse.arrayBuffer());
    if (buffer.byteLength > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "200MB 이하 PDF만 업로드할 수 있습니다." }, { status: 413 });
    }

    const sessionId = crypto.randomUUID();
    let warning: string | undefined;

    const [geminiFile, document] = await Promise.all([
      uploadPdfToGemini(buffer, fileName).catch((error) => {
        warning = `Gemini 파일 업로드 실패: ${safeErrorMessage(error, "Gemini 파일 업로드에 실패했습니다.")}`;
        return undefined;
      }),
      extractPdfDocument(buffer, fileName),
    ]);

    document.id = sessionId;

    if (geminiFile) {
      document.geminiFileUri = geminiFile.uri;
      document.geminiFileName = geminiFile.name;
      document.geminiFileMimeType = geminiFile.mimeType;
    }

    // Run AI summaries and page image rendering in parallel
    const [summaries, pageImageUrls] = await Promise.all([
      generatePageSummaries(
        document.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text, preview: p.preview })),
        document.geminiFileUri && document.geminiFileMimeType
          ? { uri: document.geminiFileUri, mimeType: document.geminiFileMimeType }
          : undefined,
      ),
      renderAndUploadAllPages(buffer, sessionId, document.pageCount).catch((err) => {
        console.error("Page image rendering failed:", err);
        return new Map<number, string>();
      }),
    ]);

    for (const page of document.pages) {
      const s = summaries.get(page.pageNumber);
      if (s) page.aiSummary = s;
    }

    await createSession({
      id: sessionId,
      userId,
      filename: fileName,
      pageCount: document.pageCount,
      totalCharacters: document.totalCharacters,
      geminiFileUri: document.geminiFileUri,
      geminiFileName: document.geminiFileName,
      geminiFileMimeType: document.geminiFileMimeType,
      pdfUrl,
    });

    await savePdfPages(
      sessionId,
      document.pages.map((p) => ({
        pageNumber: p.pageNumber,
        text: p.text,
        preview: p.preview,
        charCount: p.charCount,
        aiSummary: p.aiSummary,
        pageImageUrl: pageImageUrls.get(p.pageNumber),
      })),
    );

    pdfEvidenceStore.set(sessionId, document);

    return NextResponse.json({ sessionId, document: summarizeDocument(document), warning });
  } catch (error) {
    const message = safeErrorMessage(error, "PDF 처리 중 오류가 발생했습니다.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
