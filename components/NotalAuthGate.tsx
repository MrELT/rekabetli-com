"use client";

import { useEffect, useState } from "react";
import { buildLoginRedirectUrl } from "@/lib/notal-auth-client";
import {
  createSupabaseAuthBrowserClient,
  getNotalAuthSession,
} from "@/lib/supabase-auth-browser";

interface NotalAuthGateProps {
  children: React.ReactNode;
}

export default function NotalAuthGate({ children }: NotalAuthGateProps) {
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

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

      const session = await getNotalAuthSession();
      if (cancelled) return;

      if (session?.access_token) {
        setReady(true);
        return;
      }

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, nextSession) => {
        if (cancelled) return;
        if (nextSession?.access_token) {
          setReady(true);
          return;
        }
        if (event === "INITIAL_SESSION" && !nextSession) {
          window.location.replace(buildLoginRedirectUrl());
        }
      });

      unsubscribe = () => subscription.unsubscribe();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
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
