import dynamic from "next/dynamic";
import NotalAuthGate from "@/components/notal/NotalAuthGate";

const NotalApp = dynamic(() => import("@/components/notal/NotalApp"), {
  ssr: false,
  loading: () => (
    <div className="notal-auth-gate">
      <p className="notal-auth-gate-text">NotAl yükleniyor…</p>
    </div>
  ),
});

export default function NotalPage() {
  return (
    <NotalAuthGate>
      <NotalApp />
    </NotalAuthGate>
  );
}
