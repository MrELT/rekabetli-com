"use client";

import { useEffect, useState } from "react";
import { buildLoginRedirectUrl } from "@/lib/notal-auth-client";
import {
  createSupabaseAuthBrowserClient,
  waitForNotalAuthSession,
} from "@/lib/supabase-auth-browser";

interface NotalAuthGateProps {
  children: React.ReactNode;
}

export default function NotalAuthGate({ children }: NotalAuthGateProps) {
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const supabase = createSupabaseAuthBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setAuthError(
            "Supabase yapılandırması eksik. Lütfen daha sonra tekrar deneyin.",
          );
        }
        return;
      }

      const session = await waitForNotalAuthSession();
      if (cancelled) return;

      if (session?.access_token) {
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("rekabetli_notal_auth_bounce");
        }
        setReady(true);
        return;
      }

      window.location.replace(buildLoginRedirectUrl());
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (authError) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center px-4">
        <p className="text-sm text-red-400">{authError}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center px-4">
        <p className="text-sm text-rekabetli-muted">Oturum kontrol ediliyor…</p>
      </div>
    );
  }

  return <>{children}</>;
}
