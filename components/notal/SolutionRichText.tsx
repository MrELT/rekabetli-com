"use client";

import { Fragment, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

type Props = {
  text: string;
  className?: string;
};

const OPTION_LINE =
  /^\s*(?:[-*•]\s*)?(?:\*\*)?([A-Ea-e])(?:\*\*)?\s*[:.)]\s*(?:\*\*)?\s*(.*)$/;

function normalizeMathText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("$")) return trimmed;

  // Bare TeX formula without delimiters (common in formula field).
  if (/[\\^_{}]|\\frac|\\log|\\sqrt|\\cdot|\\times/.test(trimmed)) {
    return `$$${trimmed}$$`;
  }
  return trimmed;
}

function renderLatex(source: string, displayMode: boolean): string {
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
  } catch {
    return source;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\*\*[^*]+?\*\*)/g);

  parts.forEach((part, index) => {
    if (!part) return;
    const key = `${keyPrefix}-${index}`;

    if (part.startsWith("$$") && part.endsWith("$$")) {
      const latex = part.slice(2, -2).trim();
      nodes.push(
        <span
          key={key}
          className="notal-rich-math notal-rich-math--block"
          dangerouslySetInnerHTML={{
            __html: renderLatex(latex, true),
          }}
        />,
      );
      return;
    }

    if (part.startsWith("$") && part.endsWith("$")) {
      const latex = part.slice(1, -1).trim();
      nodes.push(
        <span
          key={key}
          className="notal-rich-math notal-rich-math--inline"
          dangerouslySetInnerHTML={{
            __html: renderLatex(latex, false),
          }}
        />,
      );
      return;
    }

    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(
        <strong key={key} className="notal-rich-strong">
          {part.slice(2, -2)}
        </strong>,
      );
      return;
    }

    nodes.push(<Fragment key={key}>{part}</Fragment>);
  });

  return nodes;
}

function parseBlocks(text: string): Array<
  | { type: "option"; letter: string; body: string }
  | { type: "paragraph"; body: string }
  | { type: "answer"; body: string }
> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Array<
    | { type: "option"; letter: string; body: string }
    | { type: "paragraph"; body: string }
    | { type: "answer"; body: string }
  > = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const body = paragraph.join("\n").trim();
    paragraph = [];
    if (!body) return;

    if (
      /^\**\s*doğru\s+cevap/i.test(body) ||
      /^\**\s*final\s+answer/i.test(body)
    ) {
      blocks.push({
        type: "answer",
        body: body.replace(/^\*+|\*+$/g, "").trim(),
      });
      return;
    }

    blocks.push({ type: "paragraph", body });
  };

  for (const line of lines) {
    const optionMatch = line.match(OPTION_LINE);
    if (optionMatch) {
      flushParagraph();
      blocks.push({
        type: "option",
        letter: optionMatch[1]!.toUpperCase(),
        body: optionMatch[2]!.replace(/\*\*/g, "").trim(),
      });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

export default function SolutionRichText({ text, className }: Props) {
  const normalized = normalizeMathText(text);
  const blocks = parseBlocks(normalized);

  return (
    <div className={className ?? "notal-rich-text"}>
      {blocks.map((block, index) => {
        if (block.type === "option") {
          return (
            <div key={`opt-${index}`} className="notal-rich-option">
              <span className="notal-rich-option-letter" aria-hidden="true">
                {block.letter}
              </span>
              <div className="notal-rich-option-body">
                {renderInline(block.body, `opt-body-${index}`)}
              </div>
            </div>
          );
        }

        if (block.type === "answer") {
          return (
            <div key={`ans-${index}`} className="notal-rich-answer">
              {renderInline(block.body, `ans-${index}`)}
            </div>
          );
        }

        return (
          <p key={`p-${index}`} className="notal-rich-paragraph">
            {renderInline(block.body, `p-${index}`)}
          </p>
        );
      })}
    </div>
  );
}
