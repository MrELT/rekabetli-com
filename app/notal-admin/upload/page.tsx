import NotalAuthGate from "@/components/NotalAuthGate";
import NotalAdminTextIngest from "@/components/NotalAdminTextIngest";

export default function NotalAdminUploadPage() {
  return (
    <main className="min-h-[calc(100vh-4rem)] px-4 py-8">
      <NotalAuthGate>
        <NotalAdminTextIngest />
      </NotalAuthGate>
    </main>
  );
}
