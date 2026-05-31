import NotalNoteDetail from "@/components/NotalNoteDetail";
import NotalAuthGate from "@/components/NotalAuthGate";

export const metadata = {
  title: "Not — Rekabetli NotAl",
};

export default function NotalNotePage() {
  return (
    <main className="min-h-screen">
      <NotalAuthGate>
        <NotalNoteDetail />
      </NotalAuthGate>
    </main>
  );
}
