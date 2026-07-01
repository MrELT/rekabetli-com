import type { Metadata } from "next";
import Script from "next/script";
import NotalNav from "@/components/NotalNav";
import "../notal/rekabetli-nav.css";

export const metadata: Metadata = {
  title: "NotAl Admin — PDF Görsel Arşivi",
  description: "MEB kitap PDF yükleme ve görsel RAG arşivi yönetimi.",
};

export default function NotalAdminLayout({
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
