import type { YksArea } from "@/lib/notal/student-context";

export type YksTopicsExam = "TYT" | "AYT" | "YDS";
export type { YksArea };

export type YksTopicsData = {
  branches: Array<{
    name: string;
    curriculum: string[];
  }>;
};

/** AYT'de alana göre gösterilecek branşlar (MEB test yapısına göre). */
const AYT_BRANCHES_BY_AREA: Record<YksArea, ReadonlySet<string>> = {
  Sayısal: new Set(["Matematik", "Fizik", "Kimya", "Biyoloji"]),
  "Eşit Ağırlık": new Set([
    "Matematik",
    "Türk Dili ve Edebiyatı",
    "Tarih-1",
    "Coğrafya-1",
  ]),
  Sözel: new Set([
    "Türk Dili ve Edebiyatı",
    "Tarih-1",
    "Coğrafya-1",
    "Felsefe Grubu",
    "Din Kültürü",
  ]),
  Dil: new Set(),
};

/** TYT'de alan biliniyorsa yabancı dil testi genelde hedef dışıdır. */
const TYT_EXCLUDED_BRANCHES = new Set(["Yabancı Dil (TYT)"]);

export function getFilteredYksTopics(
  exam: YksTopicsExam,
  area: YksArea | null,
  options?: { ydsEnabled?: boolean },
): YksTopicsData {
  const data = YKS_TOPICS[exam];
  if (!area) return data;

  if (exam === "YDS") {
    if (area === "Dil" || options?.ydsEnabled) return data;
    return { branches: [] };
  }

  if (exam === "TYT") {
    return {
      branches: data.branches.filter((b) => !TYT_EXCLUDED_BRANCHES.has(b.name)),
    };
  }

  return {
    branches: data.branches.filter((b) =>
      AYT_BRANCHES_BY_AREA[area].has(b.name),
    ),
  };
}

/**
 * NotAl YKS paneli için başlangıç konu/müfredat listesi.
 * (İleride istenirse MEB/TYYT güncel ünite isimleriyle genişletilebilir.)
 */
export const YKS_TOPICS: Record<YksTopicsExam, YksTopicsData> = {
  TYT: {
    branches: [
      {
        name: "Türkçe",
        curriculum: [
          "Sözcükte Anlam",
          "Cümlede Anlam",
          "Paragraf (Anlam / Ana düşünce)",
          "Paragraf (Yorum / Çıkarım)",
          "Dil Bilgisi (Yapı / Yapı özellikleri)",
          "Cümle Türleri",
          "Yazım Kuralları",
          "Noktalama İşaretleri",
        ],
      },
      {
        name: "Matematik",
        curriculum: [
          "Sayılar (Üslü-Köklü / Temel kavramlar)",
          "Oran Orantı",
          "Problemler (Yaş-Kar-Zarar-İşçi-Havuz)",
          "Temel Cebir (Basit denklemler)",
          "Basit Eşitsizlikler",
          "Fonksiyon Mantığı (Temel düzey)",
          "Üçgenler",
          "Çokgenler",
          "Çember ve Daire (Temel özellikler)",
        ],
      },
      {
        name: "Sosyal Bilimler",
        curriculum: [
          "Tarih: Tarih Bilimi ve Zaman Dizimi",
          "Tarih: İlk Çağ ve temel uygarlıklar",
          "Tarih: İslamiyet’in doğuşu ve ilk dönem",
          "Tarih: Türk-İslam devletleri (genel çerçeve)",
          "Coğrafya: Harita Bilgisi",
          "Coğrafya: İklim Bilgisi",
          "Coğrafya: Türkiye’nin coğrafi özellikleri",
          "Felsefe Grubu: Bilgi felsefesi (temel)",
          "Felsefe Grubu: Varlık felsefesi (temel)",
          "Din Kültürü: İnanç ve ibadet temel başlıklar",
          "Din Kültürü: Ahlak ve değerler",
        ],
      },
      {
        name: "Fen Bilimleri",
        curriculum: [
          "Fizik: Hareket ve kuvvet (temel düzey)",
          "Fizik: Basınç ve kaldırma kuvveti",
          "Fizik: Elektrik ve devreler (temel)",
          "Fizik: Enerji türleri ve dönüşümleri",
          "Kimya: Madde ve özellikleri",
          "Kimya: Kimyasal tepkimeler (temel kavramlar)",
          "Kimya: Karışımlar ve ayırma yöntemleri",
          "Biyoloji: Hücre (temel yapı)",
          "Biyoloji: Canlıların temel özellikleri",
          "Biyoloji: Ekoloji (besin zinciri vb.)",
        ],
      },
      {
        name: "Yabancı Dil (TYT)",
        curriculum: [
          "Kelime Bilgisi (eş anlam / zıt anlam)",
          "Dil Bilgisi (temel grammar)",
          "Okuma (paragraf anlama)",
          "Soru tipleri (boşluk doldurma / eşleştirme)",
        ],
      },
    ],
  },
  AYT: {
    branches: [
      {
        name: "Türk Dili ve Edebiyatı",
        curriculum: [
          "Dil ve Anlatım (cümle/üslup)",
          "Edebiyat Bilgisi (türler ve dönemler)",
          "Şiir bilgisi (biçim / içerik)",
          "Roman/Hikaye bilgisi (anlatım)",
          "Söz sanatları",
          "Paragraf (yorum / anlam ilişkileri)",
          "Yazım-Noktalama (ileri örnekler)",
        ],
      },
      {
        name: "Tarih-1",
        curriculum: [
          "İnkılap Tarihi genel çerçeve",
          "Osmanlı’da çözülme ve modernleşme",
          "Siyasi gelişmeler (genel başlıklar)",
          "Fikir hareketleri ve sosyal değişim",
          "20. yüzyıl temel kavramlar",
        ],
      },
      {
        name: "Coğrafya-1",
        curriculum: [
          "Harita bilgisi ve konum",
          "İklim ve hava olayları",
          "Beşeri sistemler (nüfus/yerleşme)",
          "Ekonomik faaliyetler (temel)",
          "Türkiye’nin coğrafi bölgeleri (genel)",
        ],
      },
      {
        name: "Felsefe Grubu",
        curriculum: [
          "Felsefeye giriş ve problemler",
          "Bilgi felsefesi",
          "Varlık felsefesi",
          "Bilim felsefesi (temel yaklaşımlar)",
          "Ahlak felsefesi (temel kavramlar)",
        ],
      },
      {
        name: "Din Kültürü",
        curriculum: [
          "İnanç alanı (temel kavramlar)",
          "İbadet ve değerler",
          "Ahlak ve sorumluluk",
          "Kur’an-ı Kerim okuma/yorum yaklaşımı (temel)",
        ],
      },
      {
        name: "Matematik",
        curriculum: [
          "Fonksiyonlar",
          "Polinomlar",
          "Trigonometri",
          "Logaritma (temel)",
          "Limit ve süreklilik (temel)",
          "Türev (temel uygulamalar)",
          "İntegral (temel uygulamalar)",
          "Analitik geometri (temel konikler)",
        ],
      },
      {
        name: "Fizik",
        curriculum: [
          "Kinematik ve dinamik",
          "Enerji ve momentum (temel)",
          "Dönme hareketi (temel)",
          "Elektrik ve manyetizma",
          "Dalga ve optik",
          "Modern fizik (temel kavramlar)",
        ],
      },
      {
        name: "Kimya",
        curriculum: [
          "Atom ve periyodik sistem",
          "Kimyasal türler (temel)",
          "Kimyasal tepkimeler",
          "Çözeltiler ve derişim",
          "Denge (temel kavramlar)",
          "Asit-baz ve pH (temel)",
          "Organik kimya (temel başlıklar)",
        ],
      },
      {
        name: "Biyoloji",
        curriculum: [
          "Hücre ve organeller",
          "Canlıların temel yapısı (genel)",
          "Üreme ve gelişme",
          "Fotosentez-solunum",
          "Genetik (temel problemler)",
          "Ekoloji ve popülasyon dinamikleri",
        ],
      },
    ],
  },
  YDS: {
    branches: [
      {
        name: "Dilbilgisi (Grammar)",
        curriculum: [
          "Zamanlar (Tense) ve uyum",
          "Modal fiiller (can/must/should vb.)",
          "Pasif yapı (Passive)",
          "Dolaylı anlatım (Reported Speech)",
          "Koşul cümleleri (Conditionals)",
          "Bağlaçlar ve bağlaçlı yapılar",
        ],
      },
      {
        name: "Kelime Bilgisi (Vocabulary)",
        curriculum: [
          "Eş anlamlı/ zıt anlamlı kelimeler",
          "Kelime grupları (collocations)",
          "Kalıp ifadeler (idioms) (temel)",
          "Kök/ek bilgisi (temel çıkarım)",
        ],
      },
      {
        name: "Okuduğunu Anlama (Reading)",
        curriculum: [
          "Ana fikir (Main idea)",
          "Detay / bilgi (Specific details)",
          "Çıkarım (Inference)",
          "Cümlelerin yerini belirleme (sentence logic)",
          "Boşluk doldurma (context)",
        ],
      },
      {
        name: "Soru Tipleri",
        curriculum: [
          "Boşluk doldurma",
          "Cümle tamamlama",
          "Eşleştirme / paragraf soruları",
        ],
      },
    ],
  },
};

