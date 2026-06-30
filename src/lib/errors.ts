export function safeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;

  if (/incorrect api key|invalid api key|api key|API_KEY_INVALID|GOOGLE_API_KEY|GEMINI_API_KEY/i.test(message)) {
    return "Gemini API 키를 확인해 주세요.";
  }

  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/AIza[0-9A-Za-z_-]+/g, "[redacted]");
}
