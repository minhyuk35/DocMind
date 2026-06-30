"use client";

import {
  BarChart3,
  Brain,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Globe2,
  Loader2,
  LogOut,
  MessageCircle,
  Plus,
  Quote,
  Search,
  Send,
  Sparkles,
  Table,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { AskResponse, EvidenceItem, PdfDocumentSummary, WebSource } from "@/lib/types";
import type { StoredMessage } from "@/lib/db";
import PdfViewer from "@/components/PdfViewer";
import PdfPageThumb from "@/components/PdfPageThumb";
import PdfImageCrop from "@/components/PdfImageCrop";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  response?: AskResponse;
  streamText?: string;
  isStreaming?: boolean;
};

type SessionItem = {
  id: string;
  filename: string;
  pageCount: number;
  createdAt: string;
};

const quickPrompts = [
  "이 PDF의 핵심 주장을 근거 쪽수와 함께 정리해줘",
  "표나 그래프에서 중요한 수치를 찾아 설명해줘",
  "이 문서에서 이해하기 어려운 이론 하나를 PDF 기준으로 풀어줘",
];

export default function ChatSessionPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: authSession } = useSession();
  const pageListRef = useRef<HTMLDivElement>(null);
  const convRef = useRef<HTMLDivElement>(null);
  const pdfFrameRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  // Document / chat state
  const [documentInfo, setDocumentInfo] = useState<PdfDocumentSummary | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [selectedPage, setSelectedPage] = useState(1);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [allowWeb, setAllowWeb] = useState(true);
  const [isAsking, setIsAsking] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1.5);

  // Sidebar state
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"sessions" | "pages">("sessions");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Load sidebar session list
  useEffect(() => {
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<SessionItem[]>) : []))
      .then(setSessions)
      .catch(() => {});
  }, [sessionId]);

  // Load current session data
  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      setLoading(true);
      try {
        const docRes = await fetch(`/api/sessions/${sessionId}`);
        if (!docRes.ok) { setStatus("세션을 찾지 못했습니다."); return; }
        const { document } = (await docRes.json()) as { document: PdfDocumentSummary };
        setDocumentInfo(document);

        const pdfRes = await fetch(`/api/sessions/${sessionId}/pdf`);
        if (pdfRes.ok) {
          const blob = await pdfRes.blob();
          setPdfUrl(URL.createObjectURL(blob));
        }

        const msgRes = await fetch(`/api/sessions/${sessionId}/messages`);
        if (msgRes.ok) {
          const stored = (await msgRes.json()) as StoredMessage[];
          setMessages(
            stored.map((m) => ({
              id: m.id,
              role: m.role,
              text: m.role === "user" ? (m.content.text as string) : undefined,
              response:
                m.role === "assistant"
                  ? ({ ...m.content, selectedPages: [], model: "" } as unknown as AskResponse)
                  : undefined,
            })),
          );
        }
      } catch {
        setStatus("세션 데이터를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  // Scroll page list to active page
  useEffect(() => {
    if (sidebarTab !== "pages" || sidebarCollapsed) return;
    const btn = pageListRef.current?.querySelector<HTMLElement>(`[data-page="${selectedPage}"]`);
    btn?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedPage, sidebarTab, sidebarCollapsed]);

  // Auto-scroll conversation to latest message
  useEffect(() => {
    if (convRef.current) convRef.current.scrollTop = convRef.current.scrollHeight;
  }, [messages]);

  function onPdfPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = {
      x: e.clientX,
      y: e.clientY,
      sl: e.currentTarget.scrollLeft,
      st: e.currentTarget.scrollTop,
    };
  }

  function onPdfPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!panRef.current || !(e.buttons & 1)) return;
    e.currentTarget.scrollLeft = panRef.current.sl - (e.clientX - panRef.current.x);
    e.currentTarget.scrollTop  = panRef.current.st - (e.clientY - panRef.current.y);
  }

  function onPdfPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    panRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const selectedPagePreview = useMemo(
    () => documentInfo?.pages.find((p) => p.pageNumber === selectedPage),
    [documentInfo, selectedPage],
  );

  const handleSelectPage = useCallback((page: number) => setSelectedPage(page), []);

  async function handleDeleteSession(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("이 채팅방을 삭제할까요?")) return;
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    setSessions((cur) => cur.filter((s) => s.id !== id));
    if (sessionId === id) router.push("/chat");
  }

  async function handleAsk(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = question.trim();
    if (!documentInfo || !q || isAsking) return;

    setMessages((cur) => [...cur, { id: crypto.randomUUID(), role: "user", text: q }]);
    setQuestion("");
    setIsAsking(true);
    setStatus("근거를 찾고 답변을 작성하는 중...");

    const msgId = crypto.randomUUID();
    setMessages((cur) => [...cur, { id: msgId, role: "assistant", isStreaming: true, streamText: "" }]);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: sessionId, question: q, allowWeb }),
      });

      if (!res.ok || !res.body) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "질문 처리에 실패했습니다.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let pendingEvidence: EvidenceItem[] = [];
      let pendingConfidence: "high" | "medium" | "low" = "medium";
      let pendingPdfSufficient = true;
      let fullAnswer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(part.slice(6)) as Record<string, unknown>; }
          catch { continue; }

          if (event.type === "chunk") {
            const text = event.text as string;
            fullAnswer += text;
            setMessages((cur) =>
              cur.map((m) => m.id === msgId ? { ...m, streamText: (m.streamText ?? "") + text } : m),
            );
          } else if (event.type === "meta") {
            pendingEvidence = (event.evidence as EvidenceItem[]) ?? [];
            pendingConfidence = (event.confidence as "high" | "medium" | "low") ?? "medium";
            pendingPdfSufficient = (event.pdfSufficient as boolean) ?? true;
          } else if (event.type === "done") {
            const selectedPages = (event.selectedPages as number[]) ?? [];
            const fullResponse: AskResponse = {
              answer: fullAnswer,
              confidence: pendingConfidence,
              pdfSufficient: pendingPdfSufficient,
              usedWeb: (event.usedWeb as boolean) ?? false,
              evidence: pendingEvidence,
              webSources: (event.webSources as WebSource[]) ?? [],
              selectedPages,
              model: (event.model as string) ?? "gemini",
              warning: event.warning as string | undefined,
            };
            setMessages((cur) =>
              cur.map((m) =>
                m.id === msgId
                  ? { ...m, isStreaming: false, streamText: undefined, response: fullResponse }
                  : m,
              ),
            );
            if (selectedPages[0]) setSelectedPage(selectedPages[0]);
            setStatus(fullResponse.warning ?? "답변 완료.");
          } else if (event.type === "error") {
            throw new Error(event.message as string);
          }
        }
      }
    } catch (error) {
      setMessages((cur) => cur.filter((m) => m.id !== msgId));
      setStatus(error instanceof Error ? error.message : "질문 처리에 실패했습니다.");
    } finally {
      setIsAsking(false);
    }
  }

  // ── Sidebar JSX (shared between loading and loaded states) ────────────────
  const sidebarJsx = (
    <aside className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
      <div className="sidebar-top">
        {!sidebarCollapsed && <span className="sidebar-brand">PDF Evidence AI</span>}
        <Link href="/chat" className="sidebar-new-btn" title="새 채팅">
          <Plus size={15} />
        </Link>
        <button
          className="sidebar-collapse-btn"
          type="button"
          onClick={() => setSidebarCollapsed((v) => !v)}
          title={sidebarCollapsed ? "펼치기" : "접기"}
        >
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {!sidebarCollapsed && (
        <div className="sidebar-tab-bar">
          <button
            className={`sidebar-tab-btn${sidebarTab === "sessions" ? " active" : ""}`}
            type="button"
            onClick={() => setSidebarTab("sessions")}
          >
            채팅방
          </button>
          <button
            className={`sidebar-tab-btn${sidebarTab === "pages" ? " active" : ""}`}
            type="button"
            onClick={() => setSidebarTab("pages")}
          >
            페이지 목록
          </button>
        </div>
      )}

      {(sidebarTab === "sessions" || sidebarCollapsed) && (
        <nav className="sidebar-list">
          {sessions.length === 0 ? (
            <p className="sidebar-empty">채팅방이 없습니다</p>
          ) : (
            sessions.map((s) => (
              <Link
                key={s.id}
                href={`/chat/${s.id}`}
                className={`sidebar-item${sessionId === s.id ? " active" : ""}`}
                title={sidebarCollapsed ? s.filename.replace(/\.pdf$/i, "") : undefined}
              >
                <FileText size={14} className="sidebar-item-icon" />
                <span className="sidebar-item-name">{s.filename.replace(/\.pdf$/i, "")}</span>
                <button
                  className="sidebar-del-btn"
                  type="button"
                  title="삭제"
                  onClick={(e) => void handleDeleteSession(e, s.id)}
                >
                  <Trash2 size={12} />
                </button>
              </Link>
            ))
          )}
        </nav>
      )}

      {sidebarTab === "pages" && !sidebarCollapsed && (
        <div ref={pageListRef} className="sidebar-list sidebar-page-list">
          {documentInfo ? (
            documentInfo.pages.map((page) => (
              <button
                key={page.pageNumber}
                data-page={page.pageNumber}
                className={`sidebar-page-item${selectedPage === page.pageNumber ? " active" : ""}`}
                type="button"
                onClick={() => handleSelectPage(page.pageNumber)}
              >
                <span className="sidebar-page-num">{page.pageNumber}</span>
                <p className="sidebar-page-summary">
                  {page.aiSummary || page.preview || "내용 없음"}
                </p>
              </button>
            ))
          ) : (
            <p className="sidebar-empty">페이지 없음</p>
          )}
        </div>
      )}

      <div className="sidebar-footer">
        {authSession?.user?.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={authSession.user.image}
            alt={authSession.user.name ?? ""}
            className="sidebar-avatar"
            referrerPolicy="no-referrer"
          />
        )}
        {!sidebarCollapsed && (
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">
              {authSession?.user?.name ?? authSession?.user?.email}
            </span>
          </div>
        )}
        <button
          className="sidebar-logout"
          type="button"
          title="로그아웃"
          onClick={() => void signOut({ callbackUrl: "/login" })}
        >
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  );

  if (loading) {
    return (
      <div className="app-shell">
        {sidebarJsx}
        <div className="chat-main session-loading">
          <Loader2 className="spin" size={28} />
          <span>세션 불러오는 중...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {sidebarJsx}

      <main className="chat-main">
        <div className="session-workspace">
          <div className="studio-grid-2">

            {/* ── Chat panel ── */}
            <section className="panel chat-panel" aria-label="질문 답변">
              <div className="chat-header">
                <div className="chat-header-left">
                  <span className="eyebrow">Ask</span>
                  <span className="chat-title">PDF 기반 답변</span>
                </div>
                <label className="web-toggle">
                  <input
                    type="checkbox"
                    checked={allowWeb}
                    onChange={(e) => setAllowWeb(e.target.checked)}
                  />
                  <span className="toggle-track" />
                  <Globe2 size={13} />
                  <span>웹 검색</span>
                </label>
              </div>

              <div className="prompt-list">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    className="prompt-btn"
                    type="button"
                    onClick={() => setQuestion(prompt)}
                    disabled={isAsking}
                  >
                    <Sparkles size={11} />
                    {prompt}
                  </button>
                ))}
              </div>

              <div ref={convRef} className="conversation" aria-live="polite">
                {messages.length === 0 ? (
                  <div className="conv-empty">
                    <Brain size={26} />
                    <p>질문을 입력하면 PDF 쪽수와<br />근거가 함께 정리됩니다</p>
                  </div>
                ) : (
                  messages.map((msg) =>
                    msg.role === "user" ? (
                      <article className="msg msg-user" key={msg.id}>
                        <MessageCircle className="msg-user-icon" size={14} />
                        <p>{msg.text}</p>
                      </article>
                    ) : msg.isStreaming ? (
                      <StreamingMessage
                        key={msg.id}
                        text={msg.streamText ?? ""}
                        sessionId={sessionId}
                        pdfUrl={pdfUrl}
                        onSelectPage={handleSelectPage}
                      />
                    ) : (
                      <AssistantMessage
                        key={msg.id}
                        response={msg.response}
                        sessionId={sessionId}
                        pdfUrl={pdfUrl}
                        onSelectPage={handleSelectPage}
                      />
                    ),
                  )
                )}
              </div>

              <div className="ask-form-wrap">
                <form className="ask-form" onSubmit={handleAsk}>
                  <Search className="ask-icon" size={15} />
                  <input
                    className="ask-input"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="PDF에 대해 질문하기..."
                    disabled={isAsking}
                  />
                  {question && (
                    <button
                      className="ask-clear"
                      type="button"
                      onClick={() => setQuestion("")}
                      aria-label="지우기"
                    >
                      <X size={13} />
                    </button>
                  )}
                  <button
                    className="ask-submit"
                    type="submit"
                    disabled={!question || isAsking}
                  >
                    {isAsking ? <Loader2 className="spin" size={14} /> : <Send size={14} />}
                    질문
                  </button>
                </form>
                <p className="status-line">{status || "대기 중"}</p>
              </div>
            </section>

            {/* ── PDF Preview ── */}
            <aside className="panel preview-panel" aria-label="PDF 미리보기">
              <div className="preview-header">
                <div className="preview-page-info">
                  <span className="eyebrow">Page</span>
                  <span className="preview-page-num">
                    {selectedPage}쪽{documentInfo && ` / ${documentInfo.pageCount}`}
                  </span>
                </div>
                <div className="page-nav">
                  <button
                    className="nav-btn"
                    type="button"
                    onClick={() => handleSelectPage(Math.max(1, selectedPage - 1))}
                    disabled={selectedPage <= 1}
                    aria-label="이전 페이지"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    className="nav-btn"
                    type="button"
                    onClick={() =>
                      handleSelectPage(Math.min(documentInfo?.pageCount ?? selectedPage, selectedPage + 1))
                    }
                    disabled={selectedPage >= (documentInfo?.pageCount ?? 1)}
                    aria-label="다음 페이지"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <span className="nav-sep" />
                  <button
                    className="nav-btn"
                    type="button"
                    onClick={() => setZoom((v) => Math.max(0.5, +(v - 0.25).toFixed(2)))}
                    aria-label="축소"
                    title="축소"
                  >
                    −
                  </button>
                  <button
                    className="zoom-reset"
                    type="button"
                    onClick={() => setZoom(1.0)}
                    title="맞춤 너비로 초기화"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    className="nav-btn"
                    type="button"
                    onClick={() => setZoom((v) => Math.min(4, +(v + 0.25).toFixed(2)))}
                    aria-label="확대"
                    title="확대"
                  >
                    +
                  </button>
                </div>
              </div>

              <div
                ref={pdfFrameRef}
                className="pdf-frame"
                onPointerDown={onPdfPointerDown}
                onPointerMove={onPdfPointerMove}
                onPointerUp={onPdfPointerUp}
                onPointerCancel={onPdfPointerUp}
              >
                <PdfViewer url={pdfUrl} page={selectedPage} scaleMultiplier={zoom} />
              </div>

              <div className="page-excerpt">
                <div className="excerpt-label">
                  <Quote size={11} />
                  {selectedPagePreview?.aiSummary ? "AI 요약" : "페이지 미리보기"}
                </div>
                <p className="excerpt-text">
                  {selectedPagePreview?.aiSummary ||
                    selectedPagePreview?.preview ||
                    "선택된 페이지의 내용이 여기에 표시됩니다."}
                </p>
              </div>
            </aside>

          </div>
        </div>
      </main>
    </div>
  );
}

// Replace bare | inside $...$ with \mid so GFM table parser doesn't split math cells
function escapePipesInMath(md: string): string {
  return md.replace(/\$([^$\n]+)\$/g, (_, inner: string) =>
    `$${inner.replace(/\|/g, "\\mid ")}$`,
  );
}

// ── Shared markdown components ─────────────────────────────────────────────

function mdComponents(sessionId: string, pdfUrl: string, onSelectPage: (page: number) => void): Components {
  return {
    table({ children }) {
      return <div className="md-table-wrap"><table>{children}</table></div>;
    },
    img({ alt, src }) {
      const srcStr = typeof src === "string" ? src : undefined;
      if (srcStr?.startsWith("page:") && sessionId) {
        const parts = srcStr.split(",").map((s) => s.trim());
        const pageNum = parseInt(parts[0].slice(5), 10);
        if (!isNaN(pageNum) && pageNum > 0) {
          const pageImageSrc = `/api/sessions/${sessionId}/pages/${pageNum}/image`;

          if (parts.length === 5) {
            const coords = parts.slice(1).map(Number);
            const valid = coords.every((n) => !isNaN(n) && n >= 0 && n <= 1);
            if (valid) {
              const [x1, y1, x2, y2] = coords as [number, number, number, number];
              return (
                <span className="img-page-block">
                  <PdfImageCrop sessionId={sessionId} pdfUrl={pdfUrl} page={pageNum} bbox={[x1, y1, x2, y2]} onClick={() => onSelectPage(pageNum)} />
                  {alt && <span className="img-page-caption">{alt} — {pageNum}쪽</span>}
                </span>
              );
            }
          }

          // No coordinates → show full page thumbnail via client-side pdfjs
          return (
            <span className="img-page-block">
              <PdfPageThumb url={pdfUrl} page={pageNum} onClick={() => onSelectPage(pageNum)} />
              {alt && <span className="img-page-caption">{alt} — {pageNum}쪽</span>}
            </span>
          );
        }
      }
      return null;
    },
  };
}


function StreamingMessage({
  text,
  sessionId,
  pdfUrl,
  onSelectPage,
}: {
  text: string;
  sessionId: string;
  pdfUrl: string;
  onSelectPage: (page: number) => void;
}) {
  return (
    <article className="msg msg-ai msg-streaming">
      <div className="msg-answer md-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={mdComponents(sessionId, pdfUrl, onSelectPage)}
        >
          {escapePipesInMath(text || " ")}
        </ReactMarkdown>
        <span className="stream-cursor" aria-hidden />
      </div>
    </article>
  );
}

function AssistantMessage({
  response,
  sessionId,
  pdfUrl,
  onSelectPage,
}: {
  response?: AskResponse;
  sessionId: string;
  pdfUrl: string;
  onSelectPage: (page: number) => void;
}) {
  if (!response) return null;
  return (
    <article className="msg msg-ai">
      <div className="msg-meta">
        <span className={`badge ${response.confidence}`}>
          {{ high: "확실", medium: "보통", low: "불확실" }[response.confidence]}
        </span>
        <span className="msg-source">{response.usedWeb ? "PDF + Web" : "PDF only"}</span>
      </div>
      <div className="msg-answer md-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={mdComponents(sessionId, pdfUrl, onSelectPage)}
        >
          {escapePipesInMath(response.answer)}
        </ReactMarkdown>
      </div>
      {response.evidence.some((e) => e.kind === "figure" || e.kind === "chart") && (
        <div className="evidence-figures">
          {response.evidence
            .filter((e) => e.kind === "figure" || e.kind === "chart")
            .map((item, i) => (
              <span
                key={`fig-${i}-${item.page}`}
                className="img-page-block img-page-block-btn"
              >
                <PdfPageThumb url={pdfUrl} page={item.page} onClick={() => onSelectPage(item.page)} />
                <span className="img-page-caption">{item.title || `그림`} — {item.page}쪽</span>
              </span>
            ))}
        </div>
      )}
      {response.evidence.length > 0 && (
        <div className="evidence-grid">
          {response.evidence.map((item, i) => (
            <EvidenceCard
              key={`${i}-${item.page}-${item.title}`}
              item={item}
              pdfUrl={pdfUrl}
              onSelectPage={onSelectPage}
            />
          ))}
        </div>
      )}
      {response.webSources.length > 0 && (
        <div className="source-row">
          {response.webSources.map((src) => (
            <a
              className="source-link"
              href={src.url}
              target="_blank"
              rel="noreferrer"
              key={src.url}
            >
              <ExternalLink size={11} />
              {src.title}
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

function EvidenceCard({
  item,
  onSelectPage,
}: {
  item: EvidenceItem;
  pdfUrl: string;
  onSelectPage: (page: number) => void;
}) {
  const Icon = item.kind === "table" ? Table : item.kind === "chart" ? BarChart3 : FileText;
  return (
    <button
      className="ev-card"
      type="button"
      title={`${item.page}쪽으로 이동`}
      onClick={() => onSelectPage(item.page)}
    >
      <span className="ev-kind"><Icon size={12} />{item.kind}</span>
      <span className="ev-page">{item.page}쪽</span>
      <strong className="ev-title">{item.title}</strong>
      <p className="ev-quote">{item.quote}</p>
      <small className="ev-why">{item.why}</small>
    </button>
  );
}
