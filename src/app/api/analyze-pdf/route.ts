import { put } from "@vercel/blob";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { generatePageSummaries, uploadPdfToGemini } from "@/lib/ai";
import { createSession, savePdfPages } from "@/lib/db";
import { safeErrorMessage } from "@/lib/errors";
import { extractPdfDocument } from "@/lib/pdf";
import { renderAndUploadAllPages } from "@/lib/pdf-render";
import { pdfEvidenceStore, summarizeDocument } from "@/lib/pdf-store";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FILE_SIZE = 200 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const authSession = await getServerSession(authOptions);
    if (!authSession?.user?.id) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    const userId = authSession.user.id;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "PDF 파일을 찾지 못했습니다." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "200MB 이하 PDF만 업로드할 수 있습니다." }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sessionId = crypto.randomUUID();
    let warning: string | undefined;

    const [geminiFile, document, blob] = await Promise.all([
      uploadPdfToGemini(buffer, file.name).catch((error) => {
        warning = `Gemini 파일 업로드 실패: ${safeErrorMessage(error, "Gemini 파일 업로드에 실패했습니다.")}`;
        return undefined;
      }),
      extractPdfDocument(buffer, file.name),
      put(`pdfs/${sessionId}/${file.name}`, buffer, { access: "public", multipart: true }),
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
      filename: file.name,
      pageCount: document.pageCount,
      totalCharacters: document.totalCharacters,
      geminiFileUri: document.geminiFileUri,
      geminiFileName: document.geminiFileName,
      geminiFileMimeType: document.geminiFileMimeType,
      pdfUrl: blob.url,
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
