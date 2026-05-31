export const NOTAL_SUBJECTS = [
  "Fizik",
  "Astronomi",
  "Matematik",
  "Kimya",
  "Biyoloji",
  "Bilgisayar Bilimi",
  "Diğer",
] as const;

export type NotalSubject = (typeof NOTAL_SUBJECTS)[number];

export function isValidNotalSubject(value: string): value is NotalSubject {
  return (NOTAL_SUBJECTS as readonly string[]).includes(value as NotalSubject);
}

export function normalizeNotalSubject(value: string): NotalSubject {
  const t = value.trim();
  if (isValidNotalSubject(t)) return t;
  return "Diğer";
}

export interface SavedNotalNote {
  id: string;
  title: string;
  subject: string;
  depth: string;
  content: string;
  created_at: string;
}

export interface NotalNoteListItem {
  id: string;
  title: string;
  subject: string;
  depth: string;
  created_at: string;
}
