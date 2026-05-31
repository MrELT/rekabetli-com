"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

const remarkPlugins = [remarkMath];

interface NotalNoteViewerProps {
  content: string;
  className?: string;
}

export default function NotalNoteViewer({
  content,
  className = "",
}: NotalNoteViewerProps) {
  return (
    <article
      className={`notal-result prose prose-invert prose-sm max-w-none sm:prose-base prose-headings:text-rekabetli-text prose-p:text-rekabetli-muted prose-strong:text-rekabetli-text prose-blockquote:border-rekabetli-primary/40 prose-blockquote:text-rekabetli-muted prose-hr:border-rekabetli-border ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
