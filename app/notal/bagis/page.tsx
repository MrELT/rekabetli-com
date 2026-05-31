import PdfDonationForm from "@/components/PdfDonationForm";
import NotalAuthGate from "@/components/NotalAuthGate";

export const metadata = {
  title: "Kütüphaneye Katkı — Rekabetli NotAl",
  description:
    "Akademik PDF dokümanlarını Rekabetli kütüphanesine bağışlayın.",
};

export default function NotalBagisPage() {
  return (
    <main className="min-h-screen">
      <NotalAuthGate>
        <PdfDonationForm />
      </NotalAuthGate>
    </main>
  );
}
