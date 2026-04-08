import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Консультант МКТ — демо",
  description: "LangGraph + Claude — образовательный агент по темам МКТ",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
