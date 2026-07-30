type LooseOutputItem = {
  type?: string;
  name?: string;
  arguments?: unknown;
  call_id?: string;
  id?: string;
  content?: unknown;
};

function asOutputItems(output: unknown): LooseOutputItem[] {
  return Array.isArray(output) ? (output as LooseOutputItem[]) : [];
}

export function extractFunctionCalls(response: {
  output?: unknown;
}): Array<{ name: string; arguments: string; call_id: string }> {
  const calls: Array<{ name: string; arguments: string; call_id: string }> = [];
  for (const item of asOutputItems(response.output)) {
    if (item.type === "function_call" && item.name) {
      const args =
        typeof item.arguments === "string"
          ? item.arguments
          : item.arguments == null
            ? "{}"
            : JSON.stringify(item.arguments);
      calls.push({
        name: item.name,
        arguments: args || "{}",
        call_id: item.call_id || item.id || item.name,
      });
    }
  }
  return calls;
}

export function extractOutputText(response: {
  output_text?: string | null;
  output?: unknown;
}): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const parts: string[] = [];
  for (const item of asOutputItems(response.output)) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!content || typeof content !== "object") continue;
      const row = content as { type?: string; text?: string };
      if (row.type === "output_text" && row.text) {
        parts.push(row.text);
      }
    }
  }
  return parts.join("\n").trim();
}
