"use client";

import { useEffect, useId, useState } from "react";
import mermaid from "mermaid";

let mermaidInitialized = false;

function ensureMermaidInit(): void {
  if (mermaidInitialized) return;

  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "loose",
    fontFamily: "Inter, Segoe UI, Arial, sans-serif",
  });

  mermaidInitialized = true;
}

interface MermaidDiagramProps {
  chart: string;
}

export default function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const reactId = useId().replace(/:/g, "");
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    ensureMermaidInit();

    const source = chart.trim();
    if (!source) {
      setFailed(true);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const renderId = `notal-mermaid-${reactId}-${Date.now()}`;
        const { svg: rendered } = await mermaid.render(renderId, source);
        if (!cancelled) {
          setSvg(rendered);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setSvg("");
          setFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, reactId]);

  if (failed) {
    return (
      <pre className="notal-mermaid-fallback my-4 overflow-x-auto rounded-lg border border-rekabetli-border bg-rekabetli-bg-soft p-3 text-xs text-rekabetli-muted">
        {chart}
      </pre>
    );
  }

  if (!svg) {
    return (
      <div className="notal-mermaid my-4 flex h-24 items-center justify-center rounded-lg border border-dashed border-rekabetli-border text-xs text-rekabetli-muted">
        Grafik yükleniyor…
      </div>
    );
  }

  return (
    <div
      className="notal-mermaid my-4 flex justify-center overflow-x-auto rounded-lg border border-rekabetli-border/40 bg-rekabetli-bg-soft/40 p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
