import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GoogleGenAI, createPartFromUri, type File as GeminiFile, type Part } from "@google/genai";
import { safeErrorMessage } from "@/lib/errors";
import type { AskResponse, EvidenceItem, PdfDocument, RankedChunk, WebSource } from "@/lib/types";

type ModelAnswer = {
  answer: string;
  confidence: "high" | "medium" | "low";
  pdfSufficient: boolean;
  needsWeb: boolean;
  evidence: EvidenceItem[];
  webSources?: WebSource[];
};

type GeminiFileRef = {
  uri: string;
  name?: string;
  mimeType: string;
};

export type EvidenceMeta = {
  confidence: "high" | "medium" | "low";
  pdfSufficient: boolean;
  needsWeb: boolean;
  evidence: EvidenceItem[];
  webSources: WebSource[];
};

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const PDF_MIME_TYPE = "application/pdf";

const answerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "confidence", "pdfSufficient", "needsWeb", "evidence", "webSources"],
  properties: {
    answer: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    pdfSufficient: { type: "boolean" },
    needsWeb: { type: "boolean" },
    evidence: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "kind", "title", "quote", "why"],
        properties: {
          page: { type: "integer", minimum: 1 },
          kind: {
            type: "string",
            enum: ["paragraph", "table", "chart", "figure", "formula", "definition", "unknown"],
          },
          title: { type: "string" },
          quote: { type: "string" },
          why: { type: "string" },
        },
      },
    },
    webSources: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
        },
      },
    },
  },
} as const;

const evidenceMetaSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["confidence", "pdfSufficient", "needsWeb", "evidence", "webSources"],
  properties: {
    confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
    pdfSufficient: { type: "boolean" as const },
    needsWeb: { type: "boolean" as const },
    evidence: {
      type: "array" as const,
      maxItems: 5,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["page", "kind", "title", "quote", "why"],
        properties: {
          page: { type: "integer" as const, minimum: 1 },
          kind: { type: "string" as const, enum: ["paragraph", "table", "chart", "figure", "formula", "definition", "unknown"] },
          title: { type: "string" as const },
          quote: { type: "string" as const },
          why: { type: "string" as const },
        },
      },
    },
    webSources: {
      type: "array" as const,
      maxItems: 6,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["title", "url"],
        properties: {
          title: { type: "string" as const },
          url: { type: "string" as const },
        },
      },
    },
  },
};

const pageSummarySchema = {
  type: "object" as const,
  required: ["pages"],
  additionalProperties: false,
  properties: {
    pages: {
      type: "array" as const,
      items: {
        type: "object" as const,
        required: ["pageNumber", "summary"],
        additionalProperties: false,
        properties: {
          pageNumber: { type: "integer" as const },
          summary: { type: "string" as const },
        },
      },
    },
  },
};

function buildStreamAnswerPrompt(document: PdfDocument, question: string, rankedChunks: RankedChunk[]): string {
  const context = rankedChunks
    .map((chunk, i) => `[근거 ${i + 1} | ${chunk.page}쪽]\n${chunk.text}`)
    .join("\n\n---\n\n");

  return [
    "너는 PDF를 기반으로 답변하는 한국어 학습·리서치 어시스턴트다.",
    "다음 질문에 PDF 근거를 우선으로 **Markdown 형식**으로 답하라.",
    "",
    "【이미지 태그 규칙】",
    "그림·사진·그래프·차트를 언급할 때: 설명 바로 위 줄에 ![짧은설명](page:N) 태그를 단독 줄로 삽입하라.",
    "N=그림이 있는 쪽 번호(정수). []와() 사이 공백 없음. 예) ![그림1 낙상클래스](page:3)",
    "",
    "【작성 규칙】",
    "- 쪽 인용: 본문 내 (N쪽) 형식으로 명시",
    "- 수식: 인라인 $...$, 블록 $$\\n...\\n$$",
    "- 표/데이터: | 헤더 | ... | Markdown 표",
    "- 표 셀 안 수식의 | 기호는 반드시 \\mid 로 대체. 예) $p(x \\mid y)$ ← 올바름 / $p(x | y)$ ← 표 깨짐",
    "- 비교·대조 (A vs B, 두 방법·모델·알고리즘·개념 이상 비교): 반드시 Markdown 표로 정리. 예) 첫 열=비교 항목(정확도·속도 등), 이후 열=각 대상. 표 위에 ## 소제목으로 무엇과 무엇의 비교인지 명시",
    "- 강조: **굵게**, *기울임*",
    "- 목록: - 또는 1. 형식",
    "- 소제목 필요 시: ## 또는 ###",
    "- PDF에서 확인되지 않으면 명시적으로 알릴 것",
    "",
    `문서명: ${document.fileName} (총 ${document.pageCount}쪽)`,
    `질문: ${question}`,
    `\nPDF 근거:\n${context || "텍스트 근거가 없습니다. 첨부 PDF를 직접 참조하세요."}`,
  ].join("\n");
}

function buildEvidenceMetaPrompt(document: PdfDocument, question: string, rankedChunks: RankedChunk[]): string {
  const context = rankedChunks
    .map((chunk, i) => `[근거 ${i + 1} | ${chunk.page}쪽]\n${chunk.text}`)
    .join("\n\n---\n\n");

  return [
    "PDF와 질문에 대해 근거 메타데이터만 JSON으로 반환하라.",
    "",
    "evidence: 질문과 관련된 PDF 쪽 번호·종류·인용문·이유 (최대 5개)",
    "- kind: paragraph/table/chart/figure/formula/definition/unknown 중 하나",
    "- quote: PDF에서 가져온 실제 텍스트 (1~2문장, 50자 이내)",
    "- why: 이 근거가 질문과 왜 관련 있는지 구체적으로 1문장",
    "- title: 간결한 근거 제목 (예: '3쪽 실험 결과', '표 2 성능 비교')",
    "confidence: 답변 신뢰도 (high=PDF 직접 근거 충분, medium=부분 근거, low=간접적)",
    "pdfSufficient: PDF만으로 완전한 답변이 가능하면 true",
    "needsWeb: 최신 정보나 외부 정의가 필요하면 true",
    `문서명: ${document.fileName}`,
    `질문: ${question}`,
    `\nPDF 근거:\n${context || "텍스트 근거가 없습니다."}`,
  ].join("\n");
}

export async function* streamAnswerText({
  document,
  question,
  rankedChunks,
}: {
  document: PdfDocument;
  question: string;
  rankedChunks: RankedChunk[];
}): AsyncGenerator<string> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return;

  const ai = new GoogleGenAI({ apiKey });
  const parts: Part[] = [];

  if (document.geminiFileUri && document.geminiFileMimeType) {
    parts.push(createPartFromUri(document.geminiFileUri, document.geminiFileMimeType));
  }
  parts.push({ text: buildStreamAnswerPrompt(document, question, rankedChunks) });

  const streamResult = await ai.models.generateContentStream({
    model: DEFAULT_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction:
        "【필수 규칙】 너는 이미지를 직접 표시하는 것이 아니다. " +
        "그림·그래프·차트를 설명할 때는 설명 바로 위 줄에 아래 형식의 텍스트 태그를 반드시 출력하라. " +
        "이 태그는 웹 앱 프론트엔드가 해석해서 이미지를 자동 표시한다. 너는 텍스트를 출력하기만 하면 된다: " +
        "![짧은설명](page:N) — N은 그림이 있는 쪽 번호(정수), []와() 사이 공백 없음. " +
        "예) ![그림1 낙상클래스 레이블링](page:3) " +
        "이탤릭체(*그림 1*)나 (그림 1 참조)처럼 텍스트로만 대체하는 것은 금지.",
    },
  });

  for await (const chunk of streamResult) {
    const text = (chunk as { text?: string }).text;
    if (text) yield text;
  }
}

export async function getEvidenceMeta({
  document,
  question,
  rankedChunks,
}: {
  document: PdfDocument;
  question: string;
  rankedChunks: RankedChunk[];
}): Promise<EvidenceMeta> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { confidence: "low", pdfSufficient: false, needsWeb: false, evidence: [], webSources: [] };
  }

  const ai = new GoogleGenAI({ apiKey });
  const parts: Part[] = [];

  if (document.geminiFileUri && document.geminiFileMimeType) {
    parts.push(createPartFromUri(document.geminiFileUri, document.geminiFileMimeType));
  }
  parts.push({ text: buildEvidenceMetaPrompt(document, question, rankedChunks) });

  try {
    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: evidenceMetaSchema,
      },
    });

    const parsed = parseModelJson(extractOutputText(response)) as EvidenceMeta;
    return {
      ...parsed,
      evidence: normalizeEvidence(parsed.evidence, document, rankedChunks),
      webSources: mergeSources(parsed.webSources ?? []),
    };
  } catch {
    return { confidence: "low", pdfSufficient: false, needsWeb: false, evidence: normalizeEvidence(undefined, document, rankedChunks), webSources: [] };
  }
}

export async function getWebSupplement({
  question,
  document,
  meta,
}: {
  question: string;
  document: PdfDocument;
  meta: EvidenceMeta;
}): Promise<{ text: string; sources: WebSource[] }> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return { text: "", sources: [] };

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "PDF 기반 답변을 보완하기 위해 Google Search로 최신 정보만 짧게 추가하세요.",
              "PDF 내용을 반복하지 말고, 최신 동향·정의·외부 맥락만 한국어로 설명하세요.",
              "이미지·그림·태그에 대한 언급은 하지 마세요. 텍스트 정보만 제공하면 됩니다.",
              `문서명: ${document.fileName}`,
              `질문: ${question}`,
              `PDF 신뢰도: ${meta.confidence}`,
            ].join("\n\n"),
          },
        ],
      },
    ],
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  return {
    text: extractOutputText(response),
    sources: extractGroundingSources(response),
  };
}

export async function generatePageSummaries(
  pages: Array<{ pageNumber: number; text: string; preview: string }>,
  geminiFileRef?: { uri: string; mimeType: string },
): Promise<Map<number, string>> {
  const apiKey = getGeminiApiKey();
  if (!apiKey || pages.length === 0) {
    return new Map();
  }

  const ai = new GoogleGenAI({ apiKey });
  const parts: Part[] = [];

  if (geminiFileRef) {
    parts.push(createPartFromUri(geminiFileRef.uri, geminiFileRef.mimeType));
    parts.push({
      text: [
        "이 PDF 문서에서 각 페이지의 핵심 내용을 한국어 1~2문장으로 요약하라.",
        `대상 페이지: ${pages.map((p) => p.pageNumber).join(", ")} (총 ${pages.length}쪽)`,
        '반드시 JSON만 반환: {"pages": [{"pageNumber": 1, "summary": "..."}, ...]}',
      ].join("\n"),
    });
  } else {
    const chunks = pages
      .map((p) => `[${p.pageNumber}쪽] ${p.text.slice(0, 500)}`)
      .join("\n\n");
    parts.push({
      text: [
        "아래 페이지 텍스트를 기반으로 각 페이지를 한국어 1~2문장으로 요약하라.",
        '반드시 JSON만 반환: {"pages": [{"pageNumber": 1, "summary": "..."}, ...]}',
        "텍스트:",
        chunks,
      ].join("\n"),
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: pageSummarySchema,
      },
    });

    const text = extractOutputText(response);
    const parsed = JSON.parse(text) as { pages: Array<{ pageNumber: number; summary: string }> };
    return new Map(parsed.pages.map((p) => [p.pageNumber, p.summary]));
  } catch {
    return new Map();
  }
}

export async function uploadPdfToGemini(buffer: Buffer, fileName: string): Promise<GeminiFileRef | undefined> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return undefined;
  }

  const ai = new GoogleGenAI({ apiKey });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pdf-evidence-ai-"));
  const tempPath = path.join(tempDir, safeFileName(fileName));

  try {
    await writeFile(tempPath, buffer);

    const uploaded = await ai.files.upload({
      file: tempPath,
      config: {
        mimeType: PDF_MIME_TYPE,
        displayName: fileName,
      },
    });
    const readyFile = await waitForGeminiFile(ai, uploaded);

    if (!readyFile.uri || !readyFile.mimeType) {
      throw new Error("Gemini 파일 URI를 받지 못했습니다.");
    }

    return {
      uri: readyFile.uri,
      name: readyFile.name,
      mimeType: readyFile.mimeType,
    };
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

export async function answerWithPdfContext({
  document,
  question,
  rankedChunks,
  allowWeb,
}: {
  document: PdfDocument;
  question: string;
  rankedChunks: RankedChunk[];
  allowWeb: boolean;
}): Promise<AskResponse> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return localFallback(
      document,
      question,
      rankedChunks,
      "GEMINI_API_KEY 또는 GOOGLE_API_KEY가 없어 PDF 근거 조각만 표시합니다.",
    );
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const pdfOnly = await runPdfModel({
      ai,
      document,
      question,
      rankedChunks,
    });

    const evidence = normalizeEvidence(pdfOnly.evidence, document, rankedChunks);
    let answer = pdfOnly.answer;
    let usedWeb = false;
    let webSources: WebSource[] = mergeSources(pdfOnly.webSources ?? []);

    if (allowWeb && (!pdfOnly.pdfSufficient || pdfOnly.needsWeb)) {
      const webSupplement = await runWebSupplement({
        ai,
        question,
        document,
        pdfOnly,
      });

      if (webSupplement.text) {
        answer = `${answer}\n\n웹 최신 정보 보강:\n${webSupplement.text}`;
      }
      usedWeb = true;
      webSources = mergeSources(webSources, webSupplement.sources);
    }

    return {
      answer,
      confidence: pdfOnly.confidence,
      pdfSufficient: pdfOnly.pdfSufficient,
      usedWeb,
      evidence,
      webSources,
      selectedPages: Array.from(new Set(evidence.map((item) => item.page))).slice(0, 5),
      model: DEFAULT_MODEL,
    };
  } catch (error) {
    const message = safeErrorMessage(error, "알 수 없는 Gemini 응답 오류");
    return localFallback(document, question, rankedChunks, `Gemini 응답 중 오류가 발생했습니다: ${message}`);
  }
}

async function runPdfModel({
  ai,
  document,
  question,
  rankedChunks,
}: {
  ai: GoogleGenAI;
  document: PdfDocument;
  question: string;
  rankedChunks: RankedChunk[];
}) {
  const parts: Part[] = [];

  if (document.geminiFileUri && document.geminiFileMimeType) {
    parts.push(createPartFromUri(document.geminiFileUri, document.geminiFileMimeType));
  }

  parts.push({
    text: buildPdfPrompt(document, question, rankedChunks),
  });

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: answerSchema,
    },
  });

  return parseModelJson(extractOutputText(response)) as ModelAnswer;
}

async function runWebSupplement({
  ai,
  question,
  document,
  pdfOnly,
}: {
  ai: GoogleGenAI;
  question: string;
  document: PdfDocument;
  pdfOnly: ModelAnswer;
}) {
  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "PDF 기반 답변만으로 부족한 부분을 Google Search grounding으로 최신 정보만 짧게 보강하세요.",
              "PDF 답변을 반복하지 말고, 최신 정의/변경 사항/외부 맥락이 필요한 부분만 한국어로 설명하세요.",
              "출처 URL은 응답 본문에 길게 나열하지 않아도 됩니다. grounding metadata에서 별도로 표시됩니다.",
              `문서명: ${document.fileName}`,
              `사용자 질문: ${question}`,
              `PDF 전용 답변: ${JSON.stringify(pdfOnly, null, 2)}`,
            ].join("\n\n"),
          },
        ],
      },
    ],
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  return {
    text: extractOutputText(response),
    sources: extractGroundingSources(response),
  };
}

function buildPdfPrompt(document: PdfDocument, question: string, rankedChunks: RankedChunk[]) {
  const context = rankedChunks
    .map((chunk, index) => `[근거 ${index + 1} | ${chunk.page}쪽]\n${chunk.text}`)
    .join("\n\n---\n\n");

  return [
    "너는 PDF를 먼저 읽고 근거를 확인하는 한국어 학습/리서치 어시스턴트다.",
    "항상 PDF 내부 근거를 우선 사용한다.",
    "",
    "【이미지 태그 규칙】",
    "그림·사진·그래프·차트를 언급할 때: answer 필드에서 설명 바로 위 줄에 ![짧은설명](page:N) 태그를 단독 줄로 삽입하라.",
    "N=그림이 있는 쪽 번호(정수). []와() 사이 공백 없음. 예) ![그림1 낙상클래스](page:3)",
    "",
    "【answer 필드 작성 규칙 — 반드시 Markdown 형식】",
    "- 수식: 인라인은 $...$ , 블록 수식은 $$\\n...\\n$$ (LaTeX 문법)",
    "- 표/데이터: | 헤더 | ... | 형식의 Markdown 표로 작성",
    "- 표 셀 안 수식의 | 기호는 반드시 \\mid 로 대체. 예) $p(x \\mid y)$ ← 올바름 / $p(x | y)$ ← 표 깨짐",
    "- 강조: **굵게**, *기울임*",
    "- 목록: - 또는 1. 형식",
    "- 구분이 필요하면 ## 소제목 사용",
    "",
    "evidence에는 문단/표/그래프/그림/수식/정의 중 가장 가까운 종류를 넣는다.",
    "evidence.page는 반드시 PDF 쪽 번호다. 확실하지 않으면 제공된 근거 조각의 쪽 번호만 사용한다.",
    "quote는 PDF에서 가져온 짧은 문장, 표 행, 축/범례/캡션 설명, 또는 그래프 주변 문맥이어야 한다.",
    "PDF만으로 충분하면 pdfSufficient=true, needsWeb=false다.",
    "PDF 정보가 낡았거나 용어/이론 설명에 최신 동향 또는 외부 정의가 필요하면 pdfSufficient=false, needsWeb=true다.",
    "이번 단계에서는 웹을 사용하지 말고, 부족하면 needsWeb=true로 표시한다.",
    `문서명: ${document.fileName}`,
    `페이지 수: ${document.pageCount}`,
    `사용자 질문: ${question}`,
    `검색된 PDF 텍스트 근거 조각:\n${context || "추출된 텍스트 근거가 거의 없습니다. 첨부 PDF를 시각적으로 확인할 수 있으면 그 범위에서만 답하세요."}`,
    "반드시 지정된 JSON 스키마만 반환한다.",
  ].join("\n\n");
}

async function waitForGeminiFile(ai: GoogleGenAI, file: GeminiFile) {
  let current = file;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!current.state || current.state === "ACTIVE") {
      return current;
    }

    if (current.state === "FAILED") {
      throw new Error("Gemini 파일 처리에 실패했습니다.");
    }

    if (!current.name) {
      return current;
    }

    await sleep(1200);
    current = await ai.files.get({ name: current.name });
  }

  return current;
}

function extractOutputText(response: unknown) {
  const text = (response as { text?: string }).text;
  if (text) {
    return text;
  }

  const candidates = (response as { candidates?: Array<Record<string, unknown>> }).candidates ?? [];
  const parts =
    ((candidates[0]?.content as { parts?: Array<Record<string, unknown>> } | undefined)?.parts ?? []);
  const joined = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");

  if (joined) {
    return joined;
  }

  throw new Error("Gemini 응답 텍스트를 찾지 못했습니다.");
}

function extractGroundingSources(response: unknown): WebSource[] {
  const candidates = (response as { candidates?: Array<Record<string, unknown>> }).candidates ?? [];
  const chunks =
    ((candidates[0]?.groundingMetadata as { groundingChunks?: Array<Record<string, unknown>> } | undefined)
      ?.groundingChunks ?? []);

  return chunks
    .map((chunk) => {
      const web = chunk.web as { title?: string; uri?: string } | undefined;
      const retrieved = chunk.retrievedContext as { title?: string; uri?: string } | undefined;
      const title = web?.title || retrieved?.title || web?.uri || retrieved?.uri || "";
      const url = web?.uri || retrieved?.uri || "";
      return { title, url };
    })
    .filter((source) => source.url);
}

function parseModelJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(text.slice(first, last + 1));
    }
  }

  throw new Error("Gemini JSON 응답을 해석하지 못했습니다.");
}

function normalizeEvidence(
  evidence: EvidenceItem[] | undefined,
  document: PdfDocument,
  rankedChunks: RankedChunk[],
) {
  const pageNumbers = new Set(document.pages.map((page) => page.pageNumber));
  const normalized = (evidence ?? [])
    .filter((item) => pageNumbers.has(item.page))
    .map((item) => ({
      ...item,
      title: item.title || `${item.page}쪽 근거`,
      quote: item.quote || findPagePreview(document, item.page),
      why: item.why || "질문과 직접 관련된 PDF 근거입니다.",
    }))
    .slice(0, 5);

  if (normalized.length > 0) {
    return normalized;
  }

  return rankedChunks.slice(0, 3).map((chunk) => ({
    page: chunk.page,
    kind: "paragraph" as const,
    title: `${chunk.page}쪽 추출 문단`,
    quote: chunk.text.slice(0, 420),
    why: "질문과 가장 유사한 PDF 텍스트 조각입니다.",
  }));
}

function findPagePreview(document: PdfDocument, pageNumber: number) {
  return document.pages.find((page) => page.pageNumber === pageNumber)?.preview ?? "";
}

function localFallback(
  document: PdfDocument,
  question: string,
  rankedChunks: RankedChunk[],
  warning: string,
): AskResponse {
  const evidence = normalizeEvidence(undefined, document, rankedChunks);
  const pages = Array.from(new Set(evidence.map((item) => item.page))).slice(0, 5);

  return {
    answer:
      rankedChunks.length > 0
        ? `"${question}"와 관련된 PDF 근거 조각을 찾았습니다. 정확한 자연어 답변과 그래프/표 해석, 최신 웹 보강을 사용하려면 .env에 GEMINI_API_KEY를 설정한 뒤 서버를 다시 실행하세요.`
        : "PDF에서 검색 가능한 텍스트를 거의 찾지 못했습니다. 스캔본이라면 OCR 처리가 필요할 수 있습니다.",
    confidence: "low",
    pdfSufficient: false,
    usedWeb: false,
    evidence,
    webSources: [],
    selectedPages: pages,
    model: DEFAULT_MODEL,
    warning,
  };
}

function mergeSources(...sourceGroups: WebSource[][]) {
  const seen = new Set<string>();
  const merged: WebSource[] = [];

  for (const source of sourceGroups.flat()) {
    if (!source.url || seen.has(source.url)) {
      continue;
    }

    seen.add(source.url);
    merged.push(source);
  }

  return merged.slice(0, 6);
}

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

function safeFileName(fileName: string) {
  const cleaned = fileName.replace(/[^\w.-]+/g, "_");
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
