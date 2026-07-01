import type { ProgressUpdate } from "@/lib/exam-prep/progress";

export type NdjsonStreamEvent =
  | ({ type: "progress" } & ProgressUpdate)
  | { type: "complete"; result: unknown }
  | { type: "error"; error: string };

export async function readNdjsonResponse<T>(
  response: Response,
  onProgress?: (update: ProgressUpdate) => void,
): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("ndjson")) {
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(
        (data as { error?: string }).error ?? "İstek başarısız.",
      );
    }
    return data;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Akış okunamadı.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: T | null = null;
  let streamError: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const event = JSON.parse(trimmed) as NdjsonStreamEvent;

      if (event.type === "progress") {
        onProgress?.({
          step: event.step,
          label: event.label,
          percent: event.percent,
          detail: event.detail,
        });
        continue;
      }

      if (event.type === "complete") {
        finalResult = event.result as T;
        continue;
      }

      if (event.type === "error") {
        streamError = event.error;
      }
    }
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer.trim()) as NdjsonStreamEvent;
    if (event.type === "complete") {
      finalResult = event.result as T;
    } else if (event.type === "error") {
      streamError = event.error;
    } else if (event.type === "progress") {
      onProgress?.({
        step: event.step,
        label: event.label,
        percent: event.percent,
        detail: event.detail,
      });
    }
  }

  if (streamError) {
    throw new Error(streamError);
  }

  if (!finalResult) {
    throw new Error("Sunucu sonuç döndürmedi.");
  }

  return finalResult;
}
