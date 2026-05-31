import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "rekabetli.com",
  description:
    "Soru sor, topluluğunu bul, projeler geliştir ve liderlik yolunda aksiyona geç.",
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
