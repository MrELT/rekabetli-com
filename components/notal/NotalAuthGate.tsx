"use client";

import { useEffect, useState } from "react";
import {
  createNotalAuthBrowserClient,
  notalLoginRedirectUrl,
} from "@/lib/notal/auth-browser";

type GateState = "loading" | "authenticated" | "anonymous" | "forbidden";

async function checkNotalAccess(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch("/api/notal/access", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (response.status === 404) return false;
    if (!response.ok) return false;
    const body = (await response.json()) as { allowed?: boolean };
    return Boolean(body.allowed);
  } catch {
    return false;
  }
}

export default function NotalAuthGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<GateState>("loading");

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

      const token = data.session?.access_token;
      if (!token) {
        setState("anonymous");
        return;
      }

      const allowed = await checkNotalAccess(token);
      if (cancelled) return;
      setState(allowed ? "authenticated" : "forbidden");
    }

    void check();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      const token = session?.access_token;
      if (!token) {
        setState("anonymous");
        return;
      }
      void checkNotalAccess(token).then((allowed) => {
        if (!cancelled) setState(allowed ? "authenticated" : "forbidden");
      });
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

  if (state === "forbidden") {
    return (
      <div className="notal-auth-gate">
        <p className="notal-auth-gate-text">
          NotAl şu an yalnızca admin kullanımında. Ana sayfaya dönebilirsin.
        </p>
        <p className="notal-auth-gate-text">
          <a href="/">rekabetli.com</a>
        </p>
      </div>
    );
  }

  return (
    <div className="notal-auth-gate">
      <p className="notal-auth-gate-text">
        {state === "loading"
          ? "Oturum kontrol ediliyor…"
          : "Giriş sayfasına yönlendiriliyorsun…"}
      </p>
    </div>
  );
}
