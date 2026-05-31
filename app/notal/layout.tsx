import type { Metadata } from "next";
import Script from "next/script";
import NotalNav from "@/components/NotalNav";
import "./rekabetli-nav.css";

export const metadata: Metadata = {
  title: "NotAl — Rekabetli",
  description:
    "Rekabetli NotAl ile olimpiyat konularında yapay zeka destekli not üretin.",
  icons: {
    icon: [{ url: "/assets/rekabetli_logo.png", type: "image/png" }],
    apple: [{ url: "/assets/rekabetli_logo.png", type: "image/png" }],
  },
};

export default function NotalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Script src="/env-config.js" strategy="beforeInteractive" />
      <Script src="/env-config.local.js" strategy="beforeInteractive" />
      <Script
        src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
        strategy="beforeInteractive"
      />
      <Script src="/supabase-client.js" strategy="beforeInteractive" />
      <NotalNav />
      <div className="rekabetli-notal-shell">{children}</div>
    </>
  );
}
