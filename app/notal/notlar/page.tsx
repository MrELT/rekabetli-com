import NotalNotesList from "@/components/NotalNotesList";
import NotalAuthGate from "@/components/NotalAuthGate";

export const metadata = {
  title: "Notlarım — Rekabetli NotAl",
  description: "Oluşturduğunuz NotAl notları.",
};

export default function NotalNotlarPage() {
  return (
    <main className="min-h-screen">
      <NotalAuthGate>
        <NotalNotesList />
      </NotalAuthGate>
    </main>
  );
}
