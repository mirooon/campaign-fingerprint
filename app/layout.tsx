import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campaign analysis — Odcisk kampanii",
  description: "Links single fraudulent ads into campaigns by shared traces of infrastructure, images and content.",
};

// System fonts only: the build must work offline (no Google Fonts download).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
