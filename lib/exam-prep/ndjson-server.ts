import type { ProgressUpdate } from "@/lib/exam-prep/progress";

export type NdjsonStreamEvent =
  | ({ type: "progress" } & ProgressUpdate)
  | { type: "complete"; result: unknown }
  | { type: "error"; error: string };

export function createNdjsonStream(
  handler: (
    send: (event: NdjsonStreamEvent) => void,
  ) => Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const send = (event: NdjsonStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        await handler(send);
      } catch (error) {
        send({
          type: "error",
          error:
            error instanceof Error ? error.message : "Beklenmeyen sunucu hatası.",
        });
      } finally {
        controller.close();
      }
    },
  });
}

export function ndjsonStreamResponse(
  stream: ReadableStream<Uint8Array>,
): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
