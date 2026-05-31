import type { Metadata } from "next";
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
      <NotalNav />
      <div className="rekabetli-notal-shell">{children}</div>
    </>
  );
}
