import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "NotAl — Rekabetli",
  description:
    "Olimpiyat çıkmış sorularından ve arşiv notlarından konu bazlı özet notlar üret.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="dark">
      <body className={`${inter.variable} font-sans`}>{children}</body>
    </html>
  );
}
