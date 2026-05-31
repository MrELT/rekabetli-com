"use client";

import { useEffect, useState } from "react";
import { buildLoginRedirectUrl } from "@/lib/notal-auth-client";
import { getNotalAuthSession } from "@/lib/supabase-auth-browser";

interface NotalAuthGateProps {
  children: React.ReactNode;
}

export default function NotalAuthGate({ children }: NotalAuthGateProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const session = await getNotalAuthSession();
      if (!session?.access_token) {
        window.location.href = buildLoginRedirectUrl();
        return;
      }
      setReady(true);
    })();
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center px-4">
        <p className="text-sm text-rekabetli-muted">Oturum kontrol ediliyor…</p>
      </div>
    );
  }

  return <>{children}</>;
}
