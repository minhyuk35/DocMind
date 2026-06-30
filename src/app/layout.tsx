import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import AuthProvider from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "PDF Evidence AI",
  description: "PDF 근거 기반 질문 응답 인터페이스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
