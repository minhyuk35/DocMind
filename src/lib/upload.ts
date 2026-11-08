// Shared rules for client-side PDF uploads to Vercel Blob.
// The browser uploads the file straight to Blob (Vercel functions reject request
// bodies over 4.5MB), then sends only the resulting URL to /api/analyze-pdf.

export const MAX_PDF_BYTES = 200 * 1024 * 1024;

function safeSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Every user uploads under their own folder, so a URL can be traced back to its owner. */
export function uploadPrefixFor(userId: string) {
  return `uploads/${safeSegment(userId)}/`;
}

export function uploadPathFor(userId: string, fileName: string) {
  const base = fileName.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80) || "document";
  return `${uploadPrefixFor(userId)}${base}.pdf`;
}

/** Accept only https URLs on this project's Blob host that sit in the caller's folder. */
export function isOwnUploadUrl(url: string, userId: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".blob.vercel-storage.com")) return false;
  const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  return pathname.startsWith(uploadPrefixFor(userId)) && !pathname.includes("..");
}
