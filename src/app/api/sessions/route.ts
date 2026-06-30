import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/auth";
import { getSessionsByUser } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sessions = await getSessionsByUser(session.user.id);
    return NextResponse.json(sessions);
  } catch (error) {
    console.error("GET /api/sessions", error);
    return NextResponse.json({ error: "세션 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}
