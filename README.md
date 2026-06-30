<div align="center">

# DocMind

**PDF 문서를 업로드하고 AI와 대화하는 문서 분석 챗봇**

Google Gemini 기반으로 PDF를 분석하고, 문서 내용에 대해 자연어로 질문하고 답변받는 풀스택 웹 애플리케이션입니다.

[![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://deepmind.google/technologies/gemini/)
[![NeonDB](https://img.shields.io/badge/NeonDB-00E699?style=for-the-badge&logo=postgresql&logoColor=black)](https://neon.tech/)
[![Vercel Blob](https://img.shields.io/badge/Vercel_Blob-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/docs/storage/vercel-blob)
[![NextAuth](https://img.shields.io/badge/NextAuth.js-000000?style=for-the-badge&logo=auth0&logoColor=white)](https://next-auth.js.org/)

</div>

---

## 개요

PDF를 업로드하면 AI가 문서 전체를 분석하고, 사용자가 자연어로 질문하면 문서 내용을 근거로 답변합니다. 수식이 포함된 논문, 기술 문서, 계약서 등 복잡한 문서를 빠르게 파악하는 데 활용할 수 있습니다. Google OAuth로 로그인하면 세션별 대화 기록이 저장되어 이전 대화를 이어서 볼 수 있습니다.

---

## 주요 기능

### 📄 PDF 분석

PDF를 업로드하면 `pdf.js`로 텍스트를 페이지 단위로 추출합니다. 추출된 내용은 Gemini File API로 전송되어 문서 전체가 AI 컨텍스트로 활용됩니다. 파일 원본은 Vercel Blob에 저장되고, 페이지별 텍스트와 미리보기는 NeonDB에 기록됩니다.

### 💬 AI 채팅

Gemini 2.5 Flash 기반의 스트리밍 응답 채팅. 업로드한 문서를 컨텍스트로 삼아 문서 내 특정 내용을 질문하거나 요약을 요청할 수 있습니다. 대화 기록은 세션별로 DB에 저장되며 `role: user | assistant` 구조로 관리됩니다.

### 🔢 수식 렌더링

`remark-math` + `rehype-katex` + `KaTeX`를 적용해 AI 응답에 포함된 수식을 LaTeX 형식으로 렌더링합니다. 수식이 자주 등장하는 논문·공학 문서 분석에 적합합니다.

### 🖼️ PDF 뷰어

`pdf.js` 기반 인라인 PDF 뷰어. 사이드바에서 세션을 선택하면 원본 PDF를 바로 확인하면서 AI와 대화할 수 있습니다. 페이지 썸네일(`PdfPageThumb`)과 영역 크롭(`PdfImageCrop`) 기능을 제공합니다.

### 🔐 인증

Google OAuth 2.0 기반 로그인(NextAuth.js). 로그인한 유저의 세션과 대화 기록이 분리 저장되어 여러 PDF 프로젝트를 독립적으로 관리할 수 있습니다.

---

## 아키텍처

```
DocMind/
├── src/
│   ├── app/
│   │   ├── page.tsx              # 루트 → 로그인 여부에 따라 /chat 또는 /login으로 리다이렉트
│   │   ├── login/                # Google OAuth 로그인 페이지
│   │   ├── chat/
│   │   │   ├── page.tsx          # PDF 업로드 · 드래그앤드롭 UI
│   │   │   └── [id]/page.tsx     # 세션별 채팅 페이지
│   │   └── api/
│   │       ├── analyze-pdf/      # PDF 파싱 · 텍스트 추출 · Gemini 파일 업로드
│   │       ├── ask/              # Gemini 스트리밍 응답
│   │       ├── sessions/         # 세션 목록 조회 · 삭제
│   │       └── auth/             # NextAuth 핸들러
│   ├── components/
│   │   ├── PdfViewer.tsx         # pdf.js 기반 인라인 뷰어
│   │   ├── PdfPageThumb.tsx      # 페이지 썸네일
│   │   ├── PdfImageCrop.tsx      # 페이지 영역 크롭
│   │   ├── Sidebar.tsx           # 세션 목록 사이드바
│   │   └── AuthProvider.tsx      # NextAuth 세션 프로바이더
│   ├── auth.ts                   # NextAuth 설정 · Google OAuth
│   ├── proxy.ts                  # Vercel Blob 프록시
│   └── lib/                      # DB 연결 · 유틸
├── public/
│   ├── pdf.worker.mjs            # pdf.js 웹 워커
│   └── standard_fonts/           # pdf.js 내장 폰트
└── db-schema.sql                 # NeonDB 테이블 정의
```

---

## 데이터베이스 스키마

```
users           유저 (Google OAuth 정보)
pdf_sessions    PDF 업로드 세션 (파일명, 페이지 수, Gemini URI, Blob URL)
pdf_pages       페이지별 텍스트 · 미리보기 · AI 요약
chat_messages   대화 기록 (role: user | assistant, JSONB content)
```

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| 프레임워크 | Next.js (App Router) |
| 언어 | TypeScript |
| AI | Google Gemini 2.5 Flash (File API + 스트리밍) |
| PDF 처리 | pdf.js (pdfjs-dist) |
| 데이터베이스 | NeonDB (PostgreSQL Serverless) |
| 파일 스토리지 | Vercel Blob |
| 인증 | NextAuth.js + Google OAuth 2.0 |
| 마크다운 | react-markdown · remark-gfm |
| 수식 | remark-math · rehype-katex · KaTeX |
| 아이콘 | Lucide React |

---

## 환경 변수

```env
GEMINI_API_KEY=           # Google Gemini API 키
GEMINI_MODEL=             # 사용할 모델 (기본값: gemini-2.5-flash)
DATABASE_URL=             # NeonDB PostgreSQL 연결 문자열
GOOGLE_CLIENT_ID=         # Google OAuth 클라이언트 ID
GOOGLE_CLIENT_SECRET=     # Google OAuth 클라이언트 시크릿
NEXTAUTH_SECRET=          # NextAuth 서명 시크릿 (32자 이상)
NEXTAUTH_URL=             # 배포 URL (로컬: http://localhost:3000)
```
