import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./notal-panel.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-notal-display",
});

export const metadata: Metadata = {
  title: "NotAl | rekabetli.com",
  description: "NotAl asistanı — çalışma ve not yardımcınız.",
};

export default function NotalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className={`notal-root ${montserrat.variable}`}>{children}</div>;
}
