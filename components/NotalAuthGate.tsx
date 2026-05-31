"use client";

import { useEffect, useRef, useState } from "react";
import { buildLoginRedirectUrl } from "@/lib/notal-auth-client";
import { waitForNotalAuthSession } from "@/lib/supabase-auth-browser";

interface NotalAuthGateProps {
  children: React.ReactNode;
}

const REDIRECT_GUARD_KEY = "rekabetli_notal_login_redirect_ts";

export default function NotalAuthGate({ children }: NotalAuthGateProps) {
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const redirectingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const session = await waitForNotalAuthSession();
      if (cancelled) return;

      if (session?.access_token) {
        setReady(true);
        return;
      }

      const lastRedirect = Number(
        sessionStorage.getItem(REDIRECT_GUARD_KEY) || "0",
      );
      if (Date.now() - lastRedirect < 15000) {
        setAuthError(
          "Oturum doğrulanamadı. Ana siteden çıkış yapıp tekrar giriş yapın veya bir süre bekleyin.",
        );
        return;
      }

      if (redirectingRef.current) return;
      redirectingRef.current = true;
      sessionStorage.setItem(REDIRECT_GUARD_KEY, String(Date.now()));
      window.location.replace(buildLoginRedirectUrl());
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (authError) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-red-400">{authError}</p>
        <a
          href="/login?redirect=%2Fnotal"
          className="text-sm text-rekabetli-primary underline"
        >
          Giriş sayfasına git
        </a>
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
