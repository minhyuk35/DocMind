import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getPdfUrl } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id } = await params;

  try {
    const url = await getPdfUrl(id, session.user.id);
    if (!url) {
      return new Response(JSON.stringify({ error: "PDF를 찾지 못했습니다." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return Response.redirect(url);
  } catch (error) {
    console.error("GET /api/sessions/[id]/pdf", error);
    return new Response(JSON.stringify({ error: "PDF를 불러오지 못했습니다." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
