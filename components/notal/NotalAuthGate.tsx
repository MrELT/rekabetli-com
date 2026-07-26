"use client";

import { useEffect, useState } from "react";
import {
  createNotalAuthBrowserClient,
  notalLoginRedirectUrl,
} from "@/lib/notal/auth-browser";

type AuthState = "loading" | "authenticated" | "anonymous";

export default function NotalAuthGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<AuthState>("loading");

  useEffect(() => {
    const supabase = createNotalAuthBrowserClient();
    if (!supabase) {
      setState("anonymous");
      return;
    }

    let cancelled = false;

    async function check() {
      const { data } = await supabase!.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token) {
        setState("authenticated");
      } else {
        setState("anonymous");
      }
    }

    void check();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setState(session?.access_token ? "authenticated" : "anonymous");
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (state !== "anonymous") return;
    window.location.replace(notalLoginRedirectUrl("/notal"));
  }, [state]);

  if (state === "authenticated") {
    return <>{children}</>;
  }

  return (
    <div className="notal-auth-gate">
      <p className="notal-auth-gate-text">
        {state === "loading" ? "Oturum kontrol ediliyor…" : "Giriş sayfasına yönlendiriliyorsun…"}
      </p>
    </div>
  );
}
