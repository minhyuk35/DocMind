import { neon } from "@neondatabase/serverless";
import type { PdfDocument } from "./types";

function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return neon(process.env.DATABASE_URL);
}

// ── Users ──────────────────────────────────────────────────────────────────

export async function upsertUser(user: {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}) {
  const db = sql();
  await db`
    INSERT INTO users (id, email, name, image)
    VALUES (${user.id}, ${user.email}, ${user.name ?? null}, ${user.image ?? null})
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      name  = EXCLUDED.name,
      image = EXCLUDED.image
  `;
}

// ── Sessions ───────────────────────────────────────────────────────────────

export type SessionListItem = {
  id: string;
  filename: string;
  pageCount: number;
  createdAt: string;
};

export type FullSession = {
  id: string;
  userId: string;
  filename: string;
  pageCount: number;
  totalCharacters: number;
  geminiFileUri?: string;
  geminiFileName?: string;
  geminiFileMimeType?: string;
  createdAt: string;
  pages: Array<{
    pageNumber: number;
    text: string;
    preview: string;
    charCount: number;
    aiSummary?: string;
  }>;
};

export async function createSession(data: {
  id: string;
  userId: string;
  filename: string;
  pageCount: number;
  totalCharacters: number;
  geminiFileUri?: string;
  geminiFileName?: string;
  geminiFileMimeType?: string;
  pdfUrl: string;
}) {
  const db = sql();
  await db`
    INSERT INTO pdf_sessions (
      id, user_id, filename, page_count, total_characters,
      gemini_file_uri, gemini_file_name, gemini_file_mime_type, pdf_url
    ) VALUES (
      ${data.id}, ${data.userId}, ${data.filename}, ${data.pageCount}, ${data.totalCharacters},
      ${data.geminiFileUri ?? null}, ${data.geminiFileName ?? null}, ${data.geminiFileMimeType ?? null},
      ${data.pdfUrl}
    )
  `;
}

export async function getSessionsByUser(userId: string): Promise<SessionListItem[]> {
  const db = sql();
  const rows = await db`
    SELECT id, filename, page_count, created_at
    FROM pdf_sessions
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return rows.map((r) => ({
    id: r.id as string,
    filename: r.filename as string,
    pageCount: r.page_count as number,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

export async function getSession(sessionId: string, userId: string): Promise<FullSession | null> {
  const db = sql();
  const rows = await db`
    SELECT id, user_id, filename, page_count, total_characters,
           gemini_file_uri, gemini_file_name, gemini_file_mime_type, created_at
    FROM pdf_sessions
    WHERE id = ${sessionId} AND user_id = ${userId}
  `;
  const s = rows[0];
  if (!s) return null;

  const pages = await db`
    SELECT page_number, text_content, preview, char_count, ai_summary
    FROM pdf_pages
    WHERE session_id = ${sessionId}
    ORDER BY page_number
  `;

  return {
    id: s.id as string,
    userId: s.user_id as string,
    filename: s.filename as string,
    pageCount: s.page_count as number,
    totalCharacters: s.total_characters as number,
    geminiFileUri: (s.gemini_file_uri as string) || undefined,
    geminiFileName: (s.gemini_file_name as string) || undefined,
    geminiFileMimeType: (s.gemini_file_mime_type as string) || undefined,
    createdAt: new Date(s.created_at as string).toISOString(),
    pages: pages.map((p) => ({
      pageNumber: p.page_number as number,
      text: p.text_content as string,
      preview: p.preview as string,
      charCount: p.char_count as number,
      aiSummary: (p.ai_summary as string) || undefined,
    })),
  };
}

export async function getPdfUrl(sessionId: string, userId: string): Promise<string | null> {
  const db = sql();
  const rows = await db`
    SELECT pdf_url FROM pdf_sessions
    WHERE id = ${sessionId} AND user_id = ${userId}
  `;
  return (rows[0]?.pdf_url as string) || null;
}

export async function deleteSession(sessionId: string, userId: string) {
  const db = sql();
  await db`DELETE FROM pdf_sessions WHERE id = ${sessionId} AND user_id = ${userId}`;
}

// ── Pages ──────────────────────────────────────────────────────────────────

export async function savePdfPages(
  sessionId: string,
  pages: Array<{ pageNumber: number; text: string; preview: string; charCount: number; aiSummary?: string; pageImageUrl?: string }>,
) {
  if (pages.length === 0) return;
  const db = sql();

  const pageNumbers = pages.map((p) => p.pageNumber);
  const texts = pages.map((p) => p.text);
  const previews = pages.map((p) => p.preview);
  const charCounts = pages.map((p) => p.charCount);
  const summaries = pages.map((p) => p.aiSummary ?? null);
  const imageUrls = pages.map((p) => p.pageImageUrl ?? null);

  await db`
    INSERT INTO pdf_pages (session_id, page_number, text_content, preview, char_count, ai_summary, page_image_url)
    SELECT ${sessionId}, t.page_number, t.text_content, t.preview, t.char_count, t.ai_summary, t.page_image_url
    FROM UNNEST(
      ${pageNumbers}::int[],
      ${texts}::text[],
      ${previews}::text[],
      ${charCounts}::int[],
      ${summaries}::text[],
      ${imageUrls}::text[]
    ) AS t(page_number, text_content, preview, char_count, ai_summary, page_image_url)
    ON CONFLICT (session_id, page_number) DO UPDATE SET
      text_content    = EXCLUDED.text_content,
      preview         = EXCLUDED.preview,
      char_count      = EXCLUDED.char_count,
      ai_summary      = EXCLUDED.ai_summary,
      page_image_url  = COALESCE(EXCLUDED.page_image_url, pdf_pages.page_image_url)
  `;
}

export async function getPageImageUrl(sessionId: string, pageNum: number): Promise<string | null> {
  const db = sql();
  const rows = await db`
    SELECT page_image_url FROM pdf_pages
    WHERE session_id = ${sessionId} AND page_number = ${pageNum}
  `;
  return (rows[0]?.page_image_url as string) || null;
}

export async function setPageImageUrl(sessionId: string, pageNum: number, url: string): Promise<void> {
  const db = sql();
  await db`
    UPDATE pdf_pages SET page_image_url = ${url}
    WHERE session_id = ${sessionId} AND page_number = ${pageNum}
  `;
}

// ── Messages ───────────────────────────────────────────────────────────────

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: Record<string, unknown>;
  createdAt: string;
};

export async function getMessages(sessionId: string): Promise<StoredMessage[]> {
  const db = sql();
  const rows = await db`
    SELECT id, role, content, created_at
    FROM chat_messages
    WHERE session_id = ${sessionId}
    ORDER BY created_at ASC
  `;
  return rows.map((r) => ({
    id: r.id as string,
    role: r.role as "user" | "assistant",
    content: r.content as Record<string, unknown>,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

export async function saveMessage(
  sessionId: string,
  message: { role: "user" | "assistant"; content: object },
) {
  const db = sql();
  await db`
    INSERT INTO chat_messages (id, session_id, role, content)
    VALUES (${crypto.randomUUID()}, ${sessionId}, ${message.role}, ${JSON.stringify(message.content)})
  `;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function sessionToDocument(session: FullSession): PdfDocument {
  return {
    id: session.id,
    fileName: session.filename,
    pageCount: session.pageCount,
    totalCharacters: session.totalCharacters,
    pages: session.pages.map((p) => ({
      pageNumber: p.pageNumber,
      text: p.text,
      preview: p.preview,
      charCount: p.charCount,
      aiSummary: p.aiSummary,
    })),
    geminiFileUri: session.geminiFileUri,
    geminiFileName: session.geminiFileName,
    geminiFileMimeType: session.geminiFileMimeType,
    uploadedAt: session.createdAt,
  };
}
