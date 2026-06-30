import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getEvidenceMeta, getWebSupplement, streamAnswerText } from "@/lib/ai";
import { getSession, saveMessage, sessionToDocument } from "@/lib/db";
import { safeErrorMessage } from "@/lib/errors";
import { rankPdfChunks } from "@/lib/pdf";
import { pdfEvidenceStore } from "@/lib/pdf-store";

export const runtime = "nodejs";
export const maxDuration = 120;

const enc = new TextEncoder();

function sseChunk(data: object): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    documentId?: string;
    question?: string;
    allowWeb?: boolean;
  };

  if (!body.documentId) {
    return new Response(JSON.stringify({ error: "분석된 PDF ID가 없습니다." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const question = body.question?.trim();
  if (!question) {
    return new Response(JSON.stringify({ error: "질문을 입력해 주세요." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Try in-memory store first, fall back to DB
  let document = pdfEvidenceStore.get(body.documentId);
  if (!document) {
    const authSession = await getServerSession(authOptions);
    if (!authSession?.user?.id) {
      return new Response(JSON.stringify({ error: "로그인이 필요합니다." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const dbSession = await getSession(body.documentId, authSession.user.id);
    if (!dbSession) {
      return new Response(
        JSON.stringify({ error: "PDF 세션을 찾지 못했습니다. 파일을 다시 업로드해 주세요." }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    document = sessionToDocument(dbSession);
    pdfEvidenceStore.set(body.documentId, document);
  }

  const sessionId = body.documentId;

  const rankedChunks = rankPdfChunks(document, question);
  const allowWeb = body.allowWeb ?? true;
  const hasApiKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(sseChunk(data));

      try {
        if (!hasApiKey) {
          // No API key — text-mode fallback
          const fallbackText =
            rankedChunks.length > 0
              ? `"${question}"와 관련된 PDF 근거를 찾았습니다. AI 답변을 사용하려면 .env에 GEMINI_API_KEY를 설정하세요.`
              : "PDF에서 검색 가능한 텍스트를 찾지 못했습니다.";

          send({ type: "chunk", text: fallbackText });

          const fallbackEvidence = rankedChunks.slice(0, 3).map((chunk) => ({
            page: chunk.page,
            kind: "paragraph" as const,
            title: `${chunk.page}쪽 추출 문단`,
            quote: chunk.text.slice(0, 200),
            why: "질문과 가장 유사한 PDF 텍스트 조각입니다.",
          }));

          const selectedPages = Array.from(new Set(fallbackEvidence.map((e) => e.page)));
          send({ type: "meta", evidence: fallbackEvidence, confidence: "low", pdfSufficient: false });
          send({
            type: "done",
            selectedPages,
            model: "text-mode",
            usedWeb: false,
            webSources: [],
            warning: "GEMINI_API_KEY가 없어 텍스트 모드로 실행됩니다.",
          });
          controller.close();
          return;
        }

        // Start evidence extraction in parallel with answer streaming
        const metaPromise = getEvidenceMeta({ document, question, rankedChunks });

        // Stream the answer text (accumulate for DB save)
        let fullAnswer = "";
        for await (const chunk of streamAnswerText({ document, question, rankedChunks })) {
          fullAnswer += chunk;
          send({ type: "chunk", text: chunk });
        }

        // Evidence is usually ready by the time streaming finishes
        const meta = await metaPromise;

        // Web supplement if needed
        let usedWeb = false;
        let webSources = meta.webSources;

        if (allowWeb && (!meta.pdfSufficient || meta.needsWeb)) {
          try {
            const web = await getWebSupplement({ question, document, meta });
            if (web.text) {
              const webChunk = `\n\n---\n\n**🌐 웹 보강**\n\n${web.text}`;
              fullAnswer += webChunk;
              send({ type: "chunk", text: webChunk });
              webSources = [...meta.webSources, ...web.sources].slice(0, 6);
            }
            usedWeb = true;
          } catch {
            // web supplement failure is non-fatal
          }
        }

        const selectedPages = Array.from(new Set(meta.evidence.map((e) => e.page))).slice(0, 5);

        send({ type: "meta", evidence: meta.evidence, confidence: meta.confidence, pdfSufficient: meta.pdfSufficient });
        send({ type: "done", selectedPages, model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash", usedWeb, webSources });

        // Persist messages to DB (non-fatal)
        try {
          await saveMessage(sessionId, { role: "user", content: { text: question } });
          await saveMessage(sessionId, {
            role: "assistant",
            content: { answer: fullAnswer, evidence: meta.evidence, confidence: meta.confidence, pdfSufficient: meta.pdfSufficient, usedWeb, webSources },
          });
        } catch { /* DB save failure is non-fatal */ }
      } catch (error) {
        send({ type: "error", message: safeErrorMessage(error, "답변 생성 중 오류가 발생했습니다.") });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
