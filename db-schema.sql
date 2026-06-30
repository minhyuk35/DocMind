-- Run this SQL in your NeonDB SQL console once before first use.

CREATE TABLE IF NOT EXISTS users (
  id           TEXT        PRIMARY KEY,
  email        TEXT        UNIQUE NOT NULL,
  name         TEXT,
  image        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pdf_sessions (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename               TEXT        NOT NULL,
  page_count             INTEGER     NOT NULL DEFAULT 0,
  total_characters       INTEGER     NOT NULL DEFAULT 0,
  gemini_file_uri        TEXT,
  gemini_file_name       TEXT,
  gemini_file_mime_type  TEXT,
  pdf_url                TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pdf_pages (
  id           SERIAL      PRIMARY KEY,
  session_id   UUID        NOT NULL REFERENCES pdf_sessions(id) ON DELETE CASCADE,
  page_number  INTEGER     NOT NULL,
  text_content TEXT        NOT NULL DEFAULT '',
  preview      TEXT        NOT NULL DEFAULT '',
  char_count   INTEGER     NOT NULL DEFAULT 0,
  ai_summary   TEXT,
  UNIQUE (session_id, page_number)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID        NOT NULL REFERENCES pdf_sessions(id) ON DELETE CASCADE,
  role         TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content      JSONB       NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdf_sessions_user ON pdf_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_pdf_pages_session ON pdf_pages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

-- ── Migration: pdf_data → pdf_url (Vercel Blob) ───────────────────────────
-- Run this once in NeonDB SQL console if the table already exists:
--
--   ALTER TABLE pdf_sessions ADD COLUMN IF NOT EXISTS pdf_url TEXT;
--   ALTER TABLE pdf_sessions DROP COLUMN IF EXISTS pdf_data;
