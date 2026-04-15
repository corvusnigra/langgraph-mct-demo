import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { NotificationsProvider } from "./components/notifications";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-sans",
});

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
    <html lang="ru" className={inter.variable}>
      <body className={inter.className}>
        <NotificationsProvider>{children}</NotificationsProvider>
      </body>
    </html>
  );
}
