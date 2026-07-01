import NotalAuthGate from "@/components/NotalAuthGate";
import NotalExamPrepApp from "@/components/NotalExamPrepApp";

export default function NotAlPage() {
  return (
    <main className="min-h-[calc(100vh-4rem)]">
      <NotalAuthGate>
        <NotalExamPrepApp />
      </NotalAuthGate>
    </main>
  );
}
