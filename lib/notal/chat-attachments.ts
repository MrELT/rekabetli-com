export type ChatAttachmentKind = "image" | "pdf";

export type NotalChatAttachmentInput = {
  name: string;
  mimeType: string;
  kind: ChatAttachmentKind;
  dataBase64: string;
};

export type PendingChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: ChatAttachmentKind;
  previewUrl: string;
  dataBase64: string;
  size: number;
};

export type ChatMessageAttachmentView = {
  name: string;
  kind: ChatAttachmentKind;
  previewUrl?: string;
};

export const MAX_CHAT_ATTACHMENTS = 4;
export const MAX_CHAT_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("read_failed"));
    };
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

export function getChatAttachmentKind(mimeType: string): ChatAttachmentKind | null {
  if (ALLOWED_IMAGE_TYPES.has(mimeType)) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return null;
}

export function validateChatAttachmentFile(file: File): string | null {
  const kind = getChatAttachmentKind(file.type);
  if (!kind) {
    return "Sadece görsel (JPG, PNG, WEBP, GIF) veya PDF ekleyebilirsin.";
  }
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    return "Dosya en fazla 8 MB olabilir.";
  }
  if (!file.name.trim()) {
    return "Dosya adı geçersiz.";
  }
  return null;
}

export async function fileToPendingAttachment(
  file: File,
): Promise<PendingChatAttachment> {
  const error = validateChatAttachmentFile(file);
  if (error) throw new Error(error);

  const kind = getChatAttachmentKind(file.type);
  if (!kind) throw new Error("unsupported_file");

  const dataUrl = await readFileAsDataUrl(file);
  const commaIndex = dataUrl.indexOf(",");
  const dataBase64 =
    commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    mimeType: file.type,
    kind,
    previewUrl: dataUrl,
    dataBase64,
    size: file.size,
  };
}

export function toAttachmentInput(
  attachment: PendingChatAttachment,
): NotalChatAttachmentInput {
  return {
    name: attachment.name,
    mimeType: attachment.mimeType,
    kind: attachment.kind,
    dataBase64: attachment.dataBase64,
  };
}

export function formatStoredMessageContent(
  text: string,
  attachments: Array<Pick<PendingChatAttachment, "name">>,
): string {
  if (!attachments.length) return text.trim();
  const label = attachments.map((item) => item.name).join(", ");
  const prefix = `[Ek: ${label}]`;
  return text.trim() ? `${text.trim()}\n\n${prefix}` : prefix;
}

export function parseChatAttachments(value: unknown): NotalChatAttachmentInput[] {
  if (!Array.isArray(value) || !value.length) return [];

  const result: NotalChatAttachmentInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const mimeType =
      typeof record.mimeType === "string" ? record.mimeType.trim() : "";
    const kind = record.kind;
    const dataBase64 =
      typeof record.dataBase64 === "string" ? record.dataBase64.trim() : "";
    if (
      !name ||
      !mimeType ||
      !dataBase64 ||
      (kind !== "image" && kind !== "pdf") ||
      getChatAttachmentKind(mimeType) !== kind
    ) {
      continue;
    }
    if (dataBase64.length > MAX_CHAT_ATTACHMENT_BYTES * 1.4) continue;
    result.push({ name, mimeType, kind, dataBase64 });
    if (result.length >= MAX_CHAT_ATTACHMENTS) break;
  }
  return result;
}

export function buildOrchestratorUserContent(
  text: string,
  attachments: NotalChatAttachmentInput[],
): string | Array<Record<string, unknown>> {
  if (!attachments.length) return text;

  const parts: Array<Record<string, unknown>> = [];
  const trimmed = text.trim();
  if (trimmed) {
    parts.push({ type: "input_text", text: trimmed });
  }

  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      parts.push({
        type: "input_image",
        image_url: `data:${attachment.mimeType};base64,${attachment.dataBase64}`,
      });
      continue;
    }

    parts.push({
      type: "input_file",
      filename: attachment.name,
      file_data: `data:${attachment.mimeType};base64,${attachment.dataBase64}`,
    });
  }

  if (!parts.length) return text;
  return parts;
}
