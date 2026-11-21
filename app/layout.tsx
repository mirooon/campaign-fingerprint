import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Graf kampanii — starter OSINT",
  description: "Łączenie pojedynczych reklam w kampanie na podstawie śladów infrastruktury, obrazów i treści.",
};

// System fonts only: the build must work offline (no Google Fonts download).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className="h-full antialiased">
      <body className="h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
