"use client";

import { isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import MermaidDiagram from "@/components/MermaidDiagram";
import "katex/dist/katex.min.css";

const remarkPlugins = [remarkGfm, remarkMath];

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
        components={{
          code({ className: codeClassName, children, ...props }) {
            const language = /language-(\w+)/i
              .exec(codeClassName ?? "")?.[1]
              ?.toLowerCase();
            const codeText = String(children).replace(/\n$/, "");

            if (language === "mermaid") {
              return <MermaidDiagram chart={codeText} />;
            }

            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          },
          pre({ children, ...props }) {
            const child = Array.isArray(children) ? children[0] : children;

            if (
              isValidElement<{ className?: string }>(child) &&
              /language-mermaid/i.test(child.props.className ?? "")
            ) {
              return <>{children}</>;
            }

            return <pre {...props}>{children}</pre>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
