"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getNotalAuthBrowserClient,
  notalLoginRedirectUrl,
  readNotalSession,
  type NotalSessionRead,
} from "@/lib/notal/auth-browser";

type GateState =
  | "loading"
  | "authenticated"
  | "anonymous"
  | "forbidden"
  | "error";

type AccessCheckResult = "allowed" | "denied" | "unauthorized" | "error";

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 15000;
const ACCESS_TIMEOUT_MS = 15000;

async function checkNotalAccess(
  accessToken: string,
): Promise<AccessCheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCESS_TIMEOUT_MS);
  try {
    const response = await fetch("/api/notal/access", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      // Yetki Bearer token ile; çerez göndermek başlıkları şişirip 431'e yol açıyor.
      credentials: "omit",
      signal: controller.signal,
    });

    if (response.status === 401) return "unauthorized";
    if (response.status === 403 || response.status === 404) return "denied";
    if (!response.ok) return "error";

    const body = (await response.json()) as { allowed?: boolean };
    return body.allowed ? "allowed" : "denied";
  } catch {
    // Ağ hatası / sunucu ayakta değil — kalıcı red ile karıştırmayalım.
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

function stateFromResult(result: AccessCheckResult): GateState {
  if (result === "allowed") return "authenticated";
  if (result === "unauthorized") return "anonymous";
  if (result === "denied") return "forbidden";
  return "error";
}

export default function NotalAuthGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<GateState>("loading");
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<NotalSessionRead | null>(null);

  const retryNow = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const supabase = getNotalAuthBrowserClient();
    if (!supabase) {
      setSession({ status: "none" });
      return;
    }

    let cancelled = false;

    void readNotalSession().then((value) => {
      if (!cancelled) setSession(value);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      const token = next?.access_token;
      setSession(token ? { status: "ok", token } : { status: "none" });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [attempt]);

  useEffect(() => {
    if (!session) return;
    if (session.status === "none") {
      setState("anonymous");
      return;
    }
    if (session.status === "unavailable") {
      setState("error");
      return;
    }

    let cancelled = false;
    void checkNotalAccess(session.token).then((result) => {
      if (!cancelled) setState(stateFromResult(result));
    });

    return () => {
      cancelled = true;
    };
  }, [session]);

  // Geçici ağ/sunucu hatalarında kendi kendine toparlanır.
  useEffect(() => {
    if (state !== "error") return;

    const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
    const timer = setTimeout(retryNow, delay);
    window.addEventListener("online", retryNow);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", retryNow);
    };
  }, [state, attempt, retryNow]);

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

  if (state === "error") {
    return (
      <div className="notal-auth-gate">
        <p className="notal-auth-gate-text">
          Sunucuya ulaşılamadı; bağlantı yeniden deneniyor…
        </p>
        <button
          type="button"
          className="notal-auth-gate-retry"
          onClick={retryNow}
        >
          Şimdi dene
        </button>
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
