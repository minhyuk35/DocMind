import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { safeErrorMessage } from "@/lib/errors";
import { MAX_PDF_BYTES, uploadPrefixFor } from "@/lib/upload";

export const runtime = "nodejs";

// Issues short-lived client tokens so the browser can upload PDFs directly to Vercel Blob.
export async function POST(request: Request) {
  const authSession = await getServerSession(authOptions);
  const userId = authSession?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(uploadPrefixFor(userId)) || !pathname.toLowerCase().endsWith(".pdf")) {
          throw new Error("허용되지 않은 업로드 경로입니다.");
        }
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_PDF_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: safeErrorMessage(error, "업로드를 준비하지 못했습니다.") },
      { status: 400 },
    );
  }
}
