import { APIError } from "openai";

const MAX_CONCURRENT = Math.max(
  1,
  Number(process.env.OPENAI_MAX_CONCURRENT ?? "3"),
);
const MIN_INTERVAL_MS = Math.max(
  0,
  Number(process.env.OPENAI_MIN_INTERVAL_MS ?? "250"),
);
const MAX_RETRIES = Math.max(
  1,
  Number(process.env.OPENAI_MAX_RETRIES ?? "6"),
);

let inFlight = 0;
const waitQueue: Array<() => void> = [];
let lastRequestAt = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    const waitMs = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (waitMs > 0) {
      await delay(waitMs);
    }
    inFlight += 1;
    lastRequestAt = Date.now();
    return;
  }

  await new Promise<void>((resolve) => {
    waitQueue.push(resolve);
  });
  return acquireSlot();
}

function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waitQueue.shift();
  if (next) next();
}

export function isOpenAiRateLimitError(error: unknown): boolean {
  if (error instanceof APIError) {
    return error.status === 429;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return /rate limit|429/i.test(message);
}

/** OpenAI hata metninden veya header'dan bekleme süresi (ms). */
export function parseOpenAiRetryMs(error: unknown): number {
  if (error instanceof APIError) {
    const header = error.headers?.["retry-after"];
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.ceil(seconds * 1000) + 100;
      }
    }
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  const msMatch = message.match(/try again in (\d+)\s*ms/i);
  if (msMatch?.[1]) {
    return Number(msMatch[1]) + 100;
  }

  const secMatch = message.match(/try again in ([\d.]+)\s*s/i);
  if (secMatch?.[1]) {
    return Math.ceil(Number(secMatch[1]) * 1000) + 100;
  }

  return 1500;
}

/**
 * OpenAI isteklerini sıraya alır; 429 TPM/RPM limitinde otomatik bekleyip yeniden dener.
 */
export async function guardedOpenAiRequest<T>(
  fn: () => Promise<T>,
): Promise<T> {
  let attempt = 0;

  while (true) {
    await acquireSlot();

    try {
      return await fn();
    } catch (error) {
      attempt += 1;

      if (!isOpenAiRateLimitError(error) || attempt >= MAX_RETRIES) {
        throw error;
      }

      const waitMs = parseOpenAiRetryMs(error) + attempt * 200;
      console.warn(
        `[openai] rate limit (deneme ${attempt}/${MAX_RETRIES}), ${waitMs}ms bekleniyor`,
      );
      await delay(waitMs);
    } finally {
      releaseSlot();
    }
  }
}
