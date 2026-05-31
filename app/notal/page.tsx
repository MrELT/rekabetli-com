import NotAlGenerator from "@/components/NotAlGenerator";
import NotalAuthGate from "@/components/NotalAuthGate";

export default function NotAlPage() {
  return (
    <main className="min-h-screen">
      <NotalAuthGate>
        <NotAlGenerator />
      </NotalAuthGate>
    </main>
  );
}
