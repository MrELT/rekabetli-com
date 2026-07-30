type ResponseOutputItem = {
  type?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  id?: string;
  content?: Array<{ type?: string; text?: string }>;
};

export function extractFunctionCalls(response: {
  output?: ResponseOutputItem[];
}): Array<{ name: string; arguments: string; call_id: string }> {
  const calls: Array<{ name: string; arguments: string; call_id: string }> = [];
  for (const item of response.output || []) {
    if (item.type === "function_call" && item.name) {
      calls.push({
        name: item.name,
        arguments: item.arguments || "{}",
        call_id: item.call_id || item.id || item.name,
      });
    }
  }
  return calls;
}

export function extractOutputText(response: {
  output_text?: string;
  output?: ResponseOutputItem[];
}): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const parts: string[] = [];
  for (const item of response.output || []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}
