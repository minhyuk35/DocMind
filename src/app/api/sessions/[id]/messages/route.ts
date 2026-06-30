import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { getMessages, getSession } from "@/lib/db";

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

  // Verify ownership before returning messages
  const sessionData = await getSession(id, session.user.id);
  if (!sessionData) {
    return NextResponse.json({ error: "세션을 찾지 못했습니다." }, { status: 404 });
  }

  try {
    const messages = await getMessages(id);
    return NextResponse.json(messages);
  } catch (error) {
    console.error("GET /api/sessions/[id]/messages", error);
    return NextResponse.json({ error: "메시지를 불러오지 못했습니다." }, { status: 500 });
  }
}
