import type { Metadata } from "next";
import { Inter } from "next/font/google";
import SiteMaintenanceOverlay from "@/components/SiteMaintenanceOverlay";
import { SITE_MAINTENANCE_ENABLED } from "@/lib/site-maintenance";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = SITE_MAINTENANCE_ENABLED
  ? {
      title: "Site düzenleniyor | rekabetli.com",
      robots: { index: false, follow: false },
    }
  : {
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
      <body className={`${inter.variable} font-sans`}>
        {SITE_MAINTENANCE_ENABLED ? <SiteMaintenanceOverlay /> : children}
      </body>
    </html>
  );
}
