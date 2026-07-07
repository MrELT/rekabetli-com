import { PDFDocument, StandardFonts, rgb, type PDFFont } from "npm:pdf-lib@1.17.1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "self_billing_invoices";

const PDF_CHAR_MAP: Record<string, string> = {
  İ: "I",
  ı: "i",
  Ş: "S",
  ş: "s",
  Ğ: "G",
  ğ: "g",
  Ü: "U",
  ü: "u",
  Ö: "O",
  ö: "o",
  Ç: "C",
  ç: "c",
  "\u20BA": "TRY ",
};

/** Standard PDF fonts only support WinAnsi; normalize Turkish text for safe rendering. */
export function toPdfSafeText(text: string): string {
  return String(text || "")
    .split("")
    .map((char) => PDF_CHAR_MAP[char] ?? char)
    .join("")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export type SelfBillingCompany = {
  name: string;
  addressLines: string[];
  email: string;
  companyNumber: string;
  vatNumber: string;
};

export type SelfBillingInvoiceInput = {
  invoiceNumber: string;
  invoiceDate: Date;
  supplierName: string;
  amountRequested: number;
  transferFee: number;
  amountNet: number;
  currency: string;
};

export function getSelfBillingCompany(): SelfBillingCompany {
  const address = (Deno.env.get("SELF_BILLING_COMPANY_ADDRESS") || "")
    .split("|")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    name: Deno.env.get("SELF_BILLING_COMPANY_NAME")?.trim() || "ELT Global LTD",
    addressLines: address.length
      ? address
      : ["United Kingdom"],
    email: Deno.env.get("SELF_BILLING_COMPANY_EMAIL")?.trim() || "accounts@rekabetli.com",
    companyNumber: Deno.env.get("SELF_BILLING_COMPANY_NUMBER")?.trim() || "",
    vatNumber: Deno.env.get("SELF_BILLING_COMPANY_VAT")?.trim() || "",
  };
}

function formatMoney(amount: number, currency: string): string {
  const code = currency.toUpperCase() === "TRY" ? "TRY" : currency.toUpperCase();
  if (code === "TRY") {
    return `TRY ${amount.toFixed(2)}`;
  }
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

function formatInvoiceDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function generateSelfBilledInvoicePdf(
  input: SelfBillingInvoiceInput,
  company: SelfBillingCompany = getSelfBillingCompany(),
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  let y = 790;
  const width = 595.28 - margin * 2;

  const drawText = (
    text: string,
    x: number,
    size: number,
    font: PDFFont = regular,
    color = rgb(0.12, 0.14, 0.2),
  ) => {
    page.drawText(toPdfSafeText(text), { x, y, size, font, color });
  };

  drawText(company.name, margin, 16, bold);
  y -= 18;
  for (const line of company.addressLines) {
    drawText(line, margin, 10);
    y -= 14;
  }
  if (company.companyNumber) {
    drawText(`Company No: ${company.companyNumber}`, margin, 10);
    y -= 14;
  }
  if (company.vatNumber) {
    drawText(`VAT No: ${company.vatNumber}`, margin, 10);
    y -= 14;
  }
  if (company.email) {
    drawText(company.email, margin, 10);
    y -= 14;
  }

  y -= 18;
  drawText("SELF-BILLED INVOICE", margin, 22, bold, rgb(0.05, 0.2, 0.45));
  y -= 28;
  drawText(`Invoice Number: ${input.invoiceNumber}`, margin, 11, bold);
  y -= 16;
  drawText(`Invoice Date: ${formatInvoiceDate(input.invoiceDate)}`, margin, 11);
  y -= 28;

  drawText("Billed To", margin, 12, bold);
  y -= 16;
  drawText(input.supplierName, margin, 11);
  y -= 28;

  const tableTop = y;
  const colDesc = margin;
  const colQty = margin + 250;
  const colAmount = margin + 320;
  const colVat = margin + 420;

  page.drawRectangle({
    x: margin,
    y: tableTop - 18,
    width,
    height: 18,
    color: rgb(0.93, 0.95, 0.98),
  });
  drawText("Description", colDesc, 10, bold);
  page.drawText(toPdfSafeText("Qty"), { x: colQty, y: tableTop - 14, size: 10, font: bold });
  page.drawText(toPdfSafeText("Amount"), { x: colAmount, y: tableTop - 14, size: 10, font: bold });
  page.drawText(toPdfSafeText("VAT"), { x: colVat, y: tableTop - 14, size: 10, font: bold });

  y = tableTop - 36;
  drawText("Mentoring Services Provided", colDesc, 10);
  page.drawText("1", { x: colQty, y, size: 10, font: regular });
  page.drawText(toPdfSafeText(formatMoney(input.amountRequested, input.currency)), {
    x: colAmount,
    y,
    size: 10,
    font: regular,
  });
  page.drawText("0%", { x: colVat, y, size: 10, font: regular });

  y -= 28;
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + width, y },
    thickness: 0.5,
    color: rgb(0.8, 0.82, 0.86),
  });
  y -= 18;

  drawText("Subtotal", colAmount - 40, 10, bold);
  page.drawText(toPdfSafeText(formatMoney(input.amountRequested, input.currency)), {
    x: colAmount,
    y,
    size: 10,
    font: bold,
  });
  y -= 16;
  drawText("VAT (0%)", colAmount - 40, 10);
  page.drawText(toPdfSafeText(formatMoney(0, input.currency)), { x: colAmount, y, size: 10, font: regular });
  y -= 18;
  drawText("Total", colAmount - 40, 11, bold);
  page.drawText(toPdfSafeText(formatMoney(input.amountRequested, input.currency)), {
    x: colAmount,
    y,
    size: 11,
    font: bold,
  });

  y -= 28;
  if (input.transferFee > 0) {
    drawText(
      `Transfer fee deducted: ${formatMoney(input.transferFee, input.currency)}`,
      margin,
      9,
    );
    y -= 14;
    drawText(
      `Net paid via Wise: ${formatMoney(input.amountNet, input.currency)}`,
      margin,
      9,
      bold,
    );
    y -= 20;
  }

  const legal =
    "This is a self-billed invoice issued by ELT Global LTD on behalf of the supplier named above, " +
    "in accordance with the self-billing agreement accepted on the platform. " +
    "The VAT shown is your output tax. You must account for this output tax on this invoice. " +
    "If you are registered for VAT in the United Kingdom, report to HMRC; " +
    "if in Türkiye, to the Turkish Revenue Administration (GİB).";

  const wrapLegal = (text: string, maxWidth: number, size: number): string[] => {
    const words = toPdfSafeText(text).split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (regular.widthOfTextAtSize(next, size) <= maxWidth) {
        current = next;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  y = Math.min(y, 160);
  for (const line of wrapLegal(legal, width, 8)) {
    page.drawText(line, { x: margin, y, size: 8, font: regular, color: rgb(0.35, 0.38, 0.42) });
    y -= 11;
  }

  return pdf.save();
}

export function buildSelfBillingStoragePath(mentorId: string, requestId: string): string {
  return `${mentorId}/${requestId}.pdf`;
}

type TransferDetails = {
  request_id: string;
  mentor_id: string;
  amount_requested: number;
  transfer_fee: number;
  amount_net: number;
  account_holder: string;
  status: string;
  self_billed_invoice_path?: string | null;
  invoice_number?: string | null;
  processed_at?: string | null;
  created_at?: string | null;
};

export async function issueSelfBilledInvoiceForPayout(
  admin: SupabaseClient,
  requestId: string,
): Promise<{ invoiceNumber: string; storagePath: string } | null> {
  const { data: existing, error: existingError } = await admin
    .from("mentor_payout_requests")
    .select(
      "id, mentor_id, amount_requested, transfer_fee, amount_net, status, invoice_number, self_billed_invoice_path, processed_at, created_at",
    )
    .eq("id", requestId)
    .maybeSingle();

  if (existingError || !existing) {
    throw new Error(`payout_request_not_found:${existingError?.message || ""}`);
  }

  const row = existing as TransferDetails;
  if (row.status !== "completed") {
    return null;
  }

  if (row.self_billed_invoice_path && row.invoice_number) {
    return {
      invoiceNumber: row.invoice_number,
      storagePath: row.self_billed_invoice_path,
    };
  }

  const { data: transferDetails, error: detailsError } = await admin.rpc(
    "get_mentor_payout_transfer_details",
    { p_request_id: requestId },
  );
  if (detailsError || !transferDetails) {
    throw new Error(`transfer_details_failed:${detailsError?.message || ""}`);
  }

  const details = transferDetails as TransferDetails;
  const supplierName = String(details.account_holder || "").trim() || "Mentor";
  const amountRequested = Number(details.amount_requested);
  const transferFee = Number(details.transfer_fee) || 0;
  const amountNet = Number(details.amount_net);
  const mentorId = String(details.mentor_id);

  if (!Number.isFinite(amountRequested) || amountRequested <= 0) {
    throw new Error("invalid_invoice_amount");
  }

  let invoiceNumber = row.invoice_number || "";
  if (!invoiceNumber) {
    const { data: allocated, error: allocError } = await admin.rpc(
      "allocate_self_billed_invoice_number",
    );
    if (allocError || !allocated) {
      throw new Error(`invoice_number_failed:${allocError?.message || ""}`);
    }
    invoiceNumber = String(allocated);
  }

  const invoiceDateRaw = row.processed_at || row.created_at || new Date().toISOString();
  const invoiceDate = new Date(invoiceDateRaw);

  const pdfBytes = await generateSelfBilledInvoicePdf({
    invoiceNumber,
    invoiceDate,
    supplierName,
    amountRequested,
    transferFee,
    amountNet,
    currency: "TRY",
  });

  const storagePath = buildSelfBillingStoragePath(mentorId, requestId);
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`invoice_upload_failed:${uploadError.message}`);
  }

  const { error: attachError } = await admin.rpc("attach_self_billed_invoice", {
    p_request_id: requestId,
    p_storage_path: storagePath,
    p_invoice_number: invoiceNumber,
  });

  if (attachError) {
    throw new Error(`invoice_attach_failed:${attachError.message}`);
  }

  return { invoiceNumber, storagePath };
}
