import type { YksArea } from "@/lib/notal/student-context";

type MessageLike = { role: string; content: string };

export function detectYksAreaFromText(text: string): YksArea | null {
  const t = text.toLowerCase();
  if (t.includes("sayısal") || t.includes("sayisal")) return "Sayısal";
  if (
    t.includes("eşit ağırlık") ||
    t.includes("esit agirlik") ||
    /esit\s*agirlik|eşit\s*ağırlık/i.test(t)
  ) {
    return "Eşit Ağırlık";
  }
  if (t.includes("sözel") || t.includes("sozel")) return "Sözel";
  if (
    /(?:yks\s*)?dil\s*alan/.test(t) ||
    /dil\s*(?:alan|bölüm|bolum|puan)/.test(t) ||
    t.includes("yabancı dil alanı") ||
    t.includes("yabanci dil alani") ||
    t.includes("ydt")
  ) {
    return "Dil";
  }
  return null;
}

/** En güncel kullanıcı mesajı önceliklidir (alan değişikliği için). */
export function detectYksAreaFromMessages(
  messages: MessageLike[],
): YksArea | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const area = detectYksAreaFromText(message.content);
    if (area) return area;
  }

  const blob = messages.map((m) => m.content).join("\n");
  return detectYksAreaFromText(blob);
}

export function detectYdsIntentFromText(text: string): boolean | null {
  const t = text.toLowerCase();
  if (
    /yds.{0,24}(girmeyece|girmicem|girmeyeceğim|istemiyorum|yok)/i.test(t) ||
    /(?:girmeyece|istemiyorum).{0,30}yds/i.test(t)
  ) {
    return false;
  }
  if (
    t.includes("yds") ||
    t.includes("yabancı dil sınav") ||
    t.includes("yabanci dil sinav")
  ) {
    return true;
  }
  return null;
}

export function detectYdsIntentFromMessages(
  messages: MessageLike[],
): boolean {
  if (detectYksAreaFromMessages(messages) === "Dil") return true;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const intent = detectYdsIntentFromText(message.content);
    if (intent !== null) return intent;
  }

  return false;
}
