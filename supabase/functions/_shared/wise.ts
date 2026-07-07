export type WiseQuote = Record<string, unknown>;

export function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

export function getWiseBaseUrl(): string {
  const sandbox = (Deno.env.get("WISE_SANDBOX") || "").toLowerCase();
  if (sandbox === "true" || sandbox === "1") {
    return "https://api.sandbox.transferwise.tech";
  }
  return "https://api.wise.com";
}

export async function wiseRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<WiseQuote> {
  const token = requireEnv("WISE_API_TOKEN");
  const response = await fetch(`${getWiseBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json();
  if (!response.ok) {
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.error === "string"
          ? payload.error
          : JSON.stringify(payload);
    throw new Error(`wise_api:${message}`);
  }

  return payload as WiseQuote;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isWiseMockEnabled(): boolean {
  const mock = (Deno.env.get("WISE_MOCK") || "").toLowerCase();
  return mock === "true" || mock === "1";
}

export function isWiseSandboxEnabled(): boolean {
  const sandbox = (Deno.env.get("WISE_SANDBOX") || "").toLowerCase();
  return sandbox === "true" || sandbox === "1";
}

export function createMockPayoutSplit(amountRequestedTry: number): {
  amountRequested: number;
  transferFeeTry: number;
  amountNet: number;
  quoteId: string;
  quoteExpiresAt: string | null;
} {
  const amountRequested = roundMoney(amountRequestedTry);
  if (!Number.isFinite(amountRequested) || amountRequested <= 0) {
    throw new Error("payout_amount_invalid");
  }

  const transferFeeTry = roundMoney(
    Math.min(Math.max(35, amountRequested * 0.025), amountRequested * 0.15),
  );
  const amountNet = roundMoney(amountRequested - transferFeeTry);
  if (amountNet <= 0) {
    throw new Error("payout_amount_too_low_after_fee");
  }

  return {
    amountRequested,
    transferFeeTry,
    amountNet,
    quoteId: `mock-${crypto.randomUUID()}`,
    quoteExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
}

function pickPaymentOption(quote: WiseQuote): Record<string, unknown> | null {
  const options = Array.isArray(quote.paymentOptions) ? quote.paymentOptions : [];
  const balanceOption = options.find((option) => {
    const row = option as Record<string, unknown>;
    return String(row.payIn || "").toUpperCase() === "BALANCE" &&
      String(row.payOut || "").toUpperCase() === "BANK_TRANSFER";
  });
  if (balanceOption) return balanceOption as Record<string, unknown>;

  const bankOption = options.find((option) => {
    const row = option as Record<string, unknown>;
    return String(row.payOut || "").toUpperCase() === "BANK_TRANSFER";
  });
  return bankOption ? bankOption as Record<string, unknown> : null;
}

export function extractFeeTryFromQuote(quote: WiseQuote): number {
  const option = pickPaymentOption(quote);
  const fee = option?.fee as Record<string, unknown> | undefined;
  const feeTotal = Number(fee?.total ?? fee?.transferwise ?? 0);
  const rate = Number(quote.rate);
  if (!Number.isFinite(feeTotal) || feeTotal <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) {
    const sourceAmount = Number(option?.sourceAmount ?? quote.sourceAmount);
    const targetAmount = Number(option?.targetAmount ?? quote.targetAmount);
    if (sourceAmount > 0 && targetAmount > 0) {
      return roundMoney(feeTotal * (targetAmount / sourceAmount));
    }
    return roundMoney(feeTotal);
  }
  return roundMoney(feeTotal * rate);
}

export async function createTryPayoutQuote(
  profileId: number,
  targetAmountTry: number,
  sourceCurrency = (Deno.env.get("WISE_SOURCE_CURRENCY") || "GBP").toUpperCase(),
): Promise<WiseQuote> {
  const targetAmount = roundMoney(targetAmountTry);
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
    throw new Error("invalid_target_amount");
  }

  return await wiseRequest("POST", `/v3/profiles/${profileId}/quotes`, {
    sourceCurrency,
    targetCurrency: "TRY",
    targetAmount,
    payOut: "BANK_TRANSFER",
  });
}

export async function computePayoutSplit(
  profileId: number,
  amountRequestedTry: number,
): Promise<{
  amountRequested: number;
  transferFeeTry: number;
  amountNet: number;
  quoteId: string;
  quoteExpiresAt: string | null;
}> {
  if (isWiseMockEnabled()) {
    return createMockPayoutSplit(amountRequestedTry);
  }

  const amountRequested = roundMoney(amountRequestedTry);
  if (!Number.isFinite(amountRequested) || amountRequested <= 0) {
    throw new Error("payout_amount_invalid");
  }

  let amountNet = Math.max(1, roundMoney(amountRequested * 0.97));
  let transferFeeTry = 0;
  let quote = await createTryPayoutQuote(profileId, amountNet);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    transferFeeTry = extractFeeTryFromQuote(quote);
    const nextNet = roundMoney(amountRequested - transferFeeTry);
    if (nextNet <= 0) {
      throw new Error("payout_amount_too_low_after_fee");
    }
    if (Math.abs(nextNet - amountNet) < 0.05) {
      amountNet = nextNet;
      break;
    }
    amountNet = nextNet;
    quote = await createTryPayoutQuote(profileId, amountNet);
  }

  transferFeeTry = extractFeeTryFromQuote(quote);
  amountNet = roundMoney(amountRequested - transferFeeTry);
  if (amountNet <= 0) {
    throw new Error("payout_amount_too_low_after_fee");
  }

  if (Math.abs(amountNet - Number(quote.targetAmount)) > 0.05) {
    quote = await createTryPayoutQuote(profileId, amountNet);
    transferFeeTry = extractFeeTryFromQuote(quote);
    amountNet = roundMoney(amountRequested - transferFeeTry);
  }

  const quoteId = String(quote.id || "");
  if (!quoteId) throw new Error("wise_quote_invalid");

  return {
    amountRequested,
    transferFeeTry: roundMoney(transferFeeTry),
    amountNet,
    quoteId,
    quoteExpiresAt: typeof quote.expirationTime === "string" ? quote.expirationTime : null,
  };
}

/** @deprecated use computePayoutSplit */
export const computePayoutSplitFromAvailable = computePayoutSplit;
