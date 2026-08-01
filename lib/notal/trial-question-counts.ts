import type { YksArea, YksExam } from "@/lib/notal/student-context";

/** ÖSYM test yapılarına göre resmi soru sayıları. */
const EXAM_QUESTION_COUNT: Record<YksExam, number> = {
  TYT: 120,
  AYT: 80,
  YDS: 80,
};

const BRANCH_QUESTION_COUNT: Record<string, number> = {
  // TYT
  Türkçe: 40,
  Matematik: 40, // TYT Mat / AYT Mat aynı ad; bağlam exam ile ayrılır
  "Sosyal Bilimler": 20,
  "Fen Bilimleri": 20,
  "Yabancı Dil (TYT)": 80,

  // AYT
  "Türk Dili ve Edebiyatı": 24,
  "Tarih-1": 10,
  "Coğrafya-1": 6,
  "Tarih-2": 11,
  "Coğrafya-2": 11,
  "Felsefe Grubu": 12,
  "Din Kültürü": 6,
  Fizik: 14,
  Kimya: 13,
  Biyoloji: 13,

  // YDS/YDT — alt alanların resmi sabit kotası yok; genel 80 kullanılır
};

/** AYT Matematik 40; TYT Matematik da 40 — aynı. */
const AYT_MATH = 40;

export function getExamQuestionCount(exam: YksExam): number {
  return EXAM_QUESTION_COUNT[exam];
}

/**
 * Net = doğru − yanlış/4
 * doğru = soru − yanlış − boş
 * ⇒ net = soru − boş − 1.25×yanlış
 */
export function computeNetFromWrongBlank(
  questionCount: number,
  wrongCount: number,
  blankCount: number,
): { ok: true; net: number } | { ok: false; error: string } {
  if (!Number.isInteger(wrongCount) || wrongCount < 0) {
    return { ok: false, error: "Yanlış sayısı 0 veya pozitif tam sayı olmalı." };
  }
  if (!Number.isInteger(blankCount) || blankCount < 0) {
    return { ok: false, error: "Boş sayısı 0 veya pozitif tam sayı olmalı." };
  }
  if (wrongCount + blankCount > questionCount) {
    return {
      ok: false,
      error: `Yanlış + boş (${wrongCount + blankCount}), ${questionCount} soruyu aşamaz.`,
    };
  }
  const net = Math.round((questionCount - blankCount - 1.25 * wrongCount) * 4) / 4;
  if (net > questionCount + 0.01 || net < -questionCount / 4 - 0.01) {
    return { ok: false, error: "Hesaplanan net geçersiz." };
  }
  return { ok: true, net };
}

export function getBranchQuestionCount(
  exam: YksExam,
  branch: string,
  _area?: YksArea | null,
): number | null {
  const name = branch.trim();
  if (!name) return null;

  if (exam === "YDS") {
    // Branş denemesinde alt beceri kotası belirsiz; sıkı toplam doğrulaması yapma.
    return null;
  }

  if (exam === "AYT" && name === "Matematik") return AYT_MATH;
  if (exam === "TYT" && name === "Matematik") return 40;

  const count = BRANCH_QUESTION_COUNT[name];
  return typeof count === "number" ? count : null;
}

export type TrialStatFields = {
  net: number | null;
  wrongCount: number | null;
  blankCount: number | null;
};

export type TrialStatValidation = {
  ok: boolean;
  error?: string;
  /** Bilinen soru sayısı (yoksa null). */
  questionCount: number | null;
};

function nearlyEqual(a: number, b: number, eps = 0.02): boolean {
  return Math.abs(a - b) <= eps;
}

function isQuarterStep(n: number): boolean {
  return nearlyEqual(n * 4, Math.round(n * 4), 0.001);
}

/**
 * Net = doğru − yanlış/4 ve doğru+yanlış+boş = soru sayısı.
 * => net + boş + 1.25×yanlış = soru sayısı
 */
export function validateTrialStats(
  fields: TrialStatFields,
  questionCount: number | null,
  label = "Bu alan",
): TrialStatValidation {
  const { net, wrongCount, blankCount } = fields;
  const hasNet = net !== null;
  const hasWrong = wrongCount !== null;
  const hasBlank = blankCount !== null;

  if (!hasNet && !hasWrong && !hasBlank) {
    return { ok: true, questionCount };
  }

  if (hasNet && (!Number.isFinite(net) || !isQuarterStep(net!))) {
    return {
      ok: false,
      questionCount,
      error: `${label}: net 0.25’lik adımlarla girilmeli (örn. 28.5).`,
    };
  }

  if (hasWrong && (!Number.isInteger(wrongCount!) || wrongCount! < 0)) {
    return {
      ok: false,
      questionCount,
      error: `${label}: yanlış sayısı 0 veya pozitif tam sayı olmalı.`,
    };
  }

  if (hasBlank && (!Number.isInteger(blankCount!) || blankCount! < 0)) {
    return {
      ok: false,
      questionCount,
      error: `${label}: boş sayısı 0 veya pozitif tam sayı olmalı.`,
    };
  }

  if (questionCount === null) {
    // Toplam bilinmiyor: üçü birlikte varsa tutarlı doğru çıkarımı yap.
    if (hasNet && hasWrong) {
      const correct = net! + wrongCount! / 4;
      if (correct < -0.01) {
        return {
          ok: false,
          questionCount,
          error: `${label}: net ve yanlış birlikte tutarsız.`,
        };
      }
      if (hasBlank) {
        const total = correct + wrongCount! + blankCount!;
        if (total <= 0 || !nearlyEqual(total, Math.round(total))) {
          return {
            ok: false,
            questionCount,
            error: `${label}: net, yanlış ve boş birlikte tutarsız.`,
          };
        }
      }
    }
    return { ok: true, questionCount };
  }

  const T = questionCount;

  if (hasNet && (net! > T + 0.01 || net! < -T / 4 - 0.01)) {
    return {
      ok: false,
      questionCount,
      error: `${label}: net ${-T / 4} ile ${T} arasında olmalı (${T} soru).`,
    };
  }
  if (hasWrong && wrongCount! > T) {
    return {
      ok: false,
      questionCount,
      error: `${label}: yanlış sayısı en fazla ${T} olabilir.`,
    };
  }
  if (hasBlank && blankCount! > T) {
    return {
      ok: false,
      questionCount,
      error: `${label}: boş sayısı en fazla ${T} olabilir.`,
    };
  }

  // Üçü de varsa: net + boş + 1.25×yanlış = T
  if (hasNet && hasWrong && hasBlank) {
    const lhs = net! + blankCount! + 1.25 * wrongCount!;
    if (!nearlyEqual(lhs, T)) {
      const correct = net! + wrongCount! / 4;
      return {
        ok: false,
        questionCount,
        error: `${label}: ${T} soruda net=${net}, yanlış=${wrongCount}, boş=${blankCount} tutarsız (doğru ≈ ${correct.toFixed(2)}; toplam denklemi sağlanmıyor).`,
      };
    }
    const correct = net! + wrongCount! / 4;
    if (correct < -0.01 || correct > T + 0.01) {
      return {
        ok: false,
        questionCount,
        error: `${label}: hesaplanan doğru sayısı geçersiz.`,
      };
    }
    return { ok: true, questionCount };
  }

  // net + boş → yanlış = 0.8 × (T − net − boş) ≥ 0 ve neredeyse tam sayı
  if (hasNet && hasBlank && !hasWrong) {
    const rawWrong = 0.8 * (T - net! - blankCount!);
    if (rawWrong < -0.02) {
      return {
        ok: false,
        questionCount,
        error: `${label}: ${net} net ve ${blankCount} boş, ${T} soruluk testte mümkün değil.`,
      };
    }
    if (!nearlyEqual(rawWrong, Math.round(rawWrong))) {
      return {
        ok: false,
        questionCount,
        error: `${label}: ${net} net ve ${blankCount} boş bu soru sayısına uymuyor.`,
      };
    }
    const W = Math.round(rawWrong);
    const correct = net! + W / 4;
    if (correct < -0.01 || correct + W + blankCount! > T + 0.02) {
      return {
        ok: false,
        questionCount,
        error: `${label}: net ve boş birlikte tutarsız.`,
      };
    }
    return { ok: true, questionCount };
  }

  // net + yanlış → boş = T − net − 1.25×yanlış ≥ 0
  if (hasNet && hasWrong && !hasBlank) {
    const rawBlank = T - net! - 1.25 * wrongCount!;
    if (rawBlank < -0.02) {
      return {
        ok: false,
        questionCount,
        error: `${label}: ${net} net ve ${wrongCount} yanlış, ${T} soruluk testte mümkün değil.`,
      };
    }
    if (!nearlyEqual(rawBlank, Math.round(rawBlank))) {
      return {
        ok: false,
        questionCount,
        error: `${label}: ${net} net ve ${wrongCount} yanlış bu soru sayısına uymuyor.`,
      };
    }
    return { ok: true, questionCount };
  }

  // yanlış + boş (net yok) → net = T − boş − 1.25×yanlış, aralık kontrolü
  if (!hasNet && hasWrong && hasBlank) {
    const impliedNet = T - blankCount! - 1.25 * wrongCount!;
    if (impliedNet > T + 0.01 || impliedNet < -T / 4 - 0.01) {
      return {
        ok: false,
        questionCount,
        error: `${label}: ${wrongCount} yanlış ve ${blankCount} boş bu test için mümkün değil.`,
      };
    }
    if (wrongCount! + blankCount! > T) {
      return {
        ok: false,
        questionCount,
        error: `${label}: yanlış + boş en fazla ${T} olabilir.`,
      };
    }
    return { ok: true, questionCount };
  }

  // yalnız net / yalnız yanlış / yalnız boş — üst sınırlar yukarıda
  return { ok: true, questionCount };
}

export function validateBranchStatsAgainstTotal(options: {
  exam: YksExam;
  total: TrialStatFields;
  branches: Array<TrialStatFields & { branch: string }>;
}): TrialStatValidation {
  const examCount = getExamQuestionCount(options.exam);
  const totalCheck = validateTrialStats(
    options.total,
    examCount,
    `${options.exam} toplam`,
  );
  if (!totalCheck.ok) return totalCheck;

  const filled = options.branches.filter(
    (row) =>
      row.net !== null || row.wrongCount !== null || row.blankCount !== null,
  );

  for (const row of filled) {
    const q = getBranchQuestionCount(options.exam, row.branch);
    const check = validateTrialStats(
      row,
      q,
      row.branch,
    );
    if (!check.ok) return check;
  }

  // Doldurulmuş branş netleri toplamı, genel neti aşmamalı
  if (options.total.net !== null) {
    const branchNetSum = filled.reduce(
      (sum, row) => sum + (row.net ?? 0),
      0,
    );
    const allBranchesHaveNet = filled.every((row) => row.net !== null);
    if (allBranchesHaveNet && filled.length > 0) {
      // Tüm girilen branşlarda net varsa ve genel net de varsa:
      // kısmi branş setinde toplam ≤ genel net; hepsi doluysa ≈ eşit beklenmez
      // (öğrenci sadece zayıf branşları girebilir).
      if (branchNetSum > options.total.net + 0.26) {
        return {
          ok: false,
          questionCount: examCount,
          error: `Branş netleri toplamı (${branchNetSum}) ${options.exam} netinden (${options.total.net}) büyük olamaz.`,
        };
      }
    } else if (branchNetSum > options.total.net + 0.26) {
      return {
        ok: false,
        questionCount: examCount,
        error: `Branş netleri toplamı (${branchNetSum}) ${options.exam} netinden (${options.total.net}) büyük olamaz.`,
      };
    }
  }

  if (options.total.wrongCount !== null) {
    const sum = filled.reduce((s, r) => s + (r.wrongCount ?? 0), 0);
    if (sum > options.total.wrongCount) {
      return {
        ok: false,
        questionCount: examCount,
        error: `Branş yanlışları toplamı (${sum}), genel yanlıştan (${options.total.wrongCount}) büyük olamaz.`,
      };
    }
  }

  if (options.total.blankCount !== null) {
    const sum = filled.reduce((s, r) => s + (r.blankCount ?? 0), 0);
    if (sum > options.total.blankCount) {
      return {
        ok: false,
        questionCount: examCount,
        error: `Branş boşları toplamı (${sum}), genel boştan (${options.total.blankCount}) büyük olamaz.`,
      };
    }
  }

  return { ok: true, questionCount: examCount };
}
