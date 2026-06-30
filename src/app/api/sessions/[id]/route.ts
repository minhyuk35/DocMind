import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { deleteSession, getSession } from "@/lib/db";
import { summarizeDocument, pdfEvidenceStore } from "@/lib/pdf-store";
import { sessionToDocument } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const data = await getSession(id, session.user.id);
    if (!data) {
      return NextResponse.json({ error: "세션을 찾지 못했습니다." }, { status: 404 });
    }

    // Warm the in-memory store for subsequent /api/ask calls
    if (!pdfEvidenceStore.has(id)) {
      pdfEvidenceStore.set(id, sessionToDocument(data));
    }

    return NextResponse.json({ document: summarizeDocument(sessionToDocument(data)) });
  } catch (error) {
    console.error("GET /api/sessions/[id]", error);
    return NextResponse.json({ error: "세션 데이터를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await deleteSession(id, session.user.id);
    pdfEvidenceStore.delete(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/sessions/[id]", error);
    return NextResponse.json({ error: "세션 삭제에 실패했습니다." }, { status: 500 });
  }
}
