import NotalApp from "@/components/notal/NotalApp";
import NotalAuthGate from "@/components/notal/NotalAuthGate";

export default function NotalPage() {
  return (
    <NotalAuthGate>
      <NotalApp />
    </NotalAuthGate>
  );
}
