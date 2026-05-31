import NotalNav from "@/components/NotalNav";
import "./rekabetli-nav.css";

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
