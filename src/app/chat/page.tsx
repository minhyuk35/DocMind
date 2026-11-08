"use client";

import { upload } from "@vercel/blob/client";
import { Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Sidebar from "@/components/Sidebar";
import { MAX_PDF_BYTES, uploadPathFor } from "@/lib/upload";

type UploadResponse = {
  sessionId?: string;
  error?: string;
  warning?: string;
};

// Vercel answers oversized or failed requests with plain text, so never assume JSON.
async function readJson(res: Response): Promise<UploadResponse> {
  const text = await res.text();
  try {
    return JSON.parse(text) as UploadResponse;
  } catch {
    if (res.status === 413) return { error: "파일이 너무 커서 서버가 받지 못했습니다." };
    if (res.status === 504) return { error: "분석 시간이 너무 오래 걸렸습니다. 더 작은 PDF로 다시 시도해 주세요." };
    return { error: `서버 응답을 읽지 못했습니다. (HTTP ${res.status})` };
  }
}

export default function NewChatPage() {
  const { data: authSession } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState("");

  async function uploadPdf(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setStatus("PDF 파일만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setStatus("200MB 이하 PDF만 업로드할 수 있습니다.");
      return;
    }
    const userId = authSession?.user?.id;
    if (!userId) {
      setStatus("로그인이 필요합니다.");
      return;
    }
    setIsUploading(true);
    setStatus("PDF 올리는 중...");

    try {
      const blob = await upload(uploadPathFor(userId, file.name), file, {
        access: "public",
        handleUploadUrl: "/api/blob-upload",
        contentType: "application/pdf",
        multipart: file.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => setStatus(`PDF 올리는 중... ${Math.round(percentage)}%`),
      });

      setStatus("PDF 분석 중...");
      const res = await fetch("/api/analyze-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: blob.url, fileName: file.name }),
      });
      const data = await readJson(res);
      if (!res.ok || data.error) throw new Error(data.error ?? "업로드에 실패했습니다.");
      router.push(`/chat/${data.sessionId}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "업로드에 실패했습니다.");
      setIsUploading(false);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void uploadPdf(file);
    e.target.value = "";
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadPdf(file);
  }

  const user = {
    name: authSession?.user?.name,
    email: authSession?.user?.email,
    image: authSession?.user?.image,
  };

  return (
    <div className="app-shell">
      <Sidebar user={user} />
      <div className="chat-main">
        <div className="new-chat-shell">
          <div className="new-chat-card">
            <h2 className="new-chat-title">새 채팅 시작</h2>
            <p className="new-chat-sub">PDF를 업로드하면 AI가 분석하고 질문에 답합니다</p>

            <div
              className={`new-chat-drop${isDragging ? " dragging" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileChange}
              />
              {isUploading
                ? <Loader2 className="new-chat-icon spin" size={32} />
                : <Upload className="new-chat-icon" size={32} />}
              <p className="new-chat-drop-label">
                {isUploading ? status : "클릭하거나 PDF를 여기에 끌어다 놓으세요"}
              </p>
              <p className="new-chat-drop-hint">200MB 이하 · PDF만 지원</p>
            </div>

            {status && !isUploading && (
              <p className="new-chat-error">{status}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
