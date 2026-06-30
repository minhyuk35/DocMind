import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getPdfUrl, getPageImageUrl, setPageImageUrl } from "@/lib/db";
import { renderPdfPageToJpeg } from "@/lib/pdf-render";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; pageNum: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id, pageNum: pageNumStr } = await params;
  const pageNum = parseInt(pageNumStr, 10);
  if (isNaN(pageNum) || pageNum < 1) {
    return new Response(JSON.stringify({ error: "Invalid page number" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Return cached URL if available
    const cached = await getPageImageUrl(id, pageNum);
    if (cached) {
      return Response.redirect(cached);
    }

    // Fetch PDF from Vercel Blob and render the page
    const pdfUrl = await getPdfUrl(id, session.user.id);
    if (!pdfUrl) {
      return new Response(JSON.stringify({ error: "PDF를 찾지 못했습니다." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const pdfRes = await fetch(pdfUrl);
    if (!pdfRes.ok) {
      return new Response(JSON.stringify({ error: "PDF 다운로드 실패" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    const imageBuffer = await renderPdfPageToJpeg(pdfBuffer, pageNum, 2);

    const blob = await put(
      `pdfs/${id}/pages/${pageNum}.jpg`,
      imageBuffer,
      { access: "public", addRandomSuffix: false },
    );

    await setPageImageUrl(id, pageNum, blob.url);

    return Response.redirect(blob.url);
  } catch (error) {
    console.error("GET /api/sessions/[id]/pages/[pageNum]/image", error);
    return new Response(JSON.stringify({ error: "페이지 이미지 생성 실패" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
