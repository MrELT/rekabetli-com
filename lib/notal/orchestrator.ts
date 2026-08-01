import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createNotalOpenAI,
  getNotalOrchestratorModel,
  NOTAL_ORCHESTRATOR_MODEL,
} from "@/lib/notal/openai-client";
import {
  extractFunctionCalls,
  extractOutputText,
} from "@/lib/notal/openai-helpers";
import { runPlannerAgent } from "@/lib/notal/planner/agent";
import { runPlanCommittee } from "@/lib/notal/plan-committee";
import {
  buildOrchestratorUserContent,
  type NotalChatAttachmentInput,
} from "@/lib/notal/chat-attachments";
import type { NotalStudentProfile, YksArea, YksExam } from "@/lib/notal/student-context";
import { persistStudentProfileUpdate, parseTrialExamPatch, parseTrialExamsPatch } from "@/lib/notal/student-context-server";
import {
  runQuestionSolverAgent,
  formatQuestionSolverChatReply,
  type NotalQuestionSolution,
} from "@/lib/notal/question-solver/agent";
import {
  runInsightAgent,
  type NotalKnowledgeCard,
} from "@/lib/notal/insight/agent";
import {
  resolveStudentChoicePrompt,
  type StudentChoicePrompt,
} from "@/lib/notal/student-prompts";
import {
  estimateTargetNets,
  formatTargetNetHint,
} from "@/lib/notal/target-nets";

export { NOTAL_ORCHESTRATOR_MODEL, createNotalOpenAI, getNotalOrchestratorModel };

export const NOTAL_ORCHESTRATOR_INSTRUCTIONS = `Sen NotAl orchestrator'sın (GPT-5.6 Sol).
Türkçe, net ve yardımcı konuş.

Öğrenci bağlamı:
- Kullanıcının sınıfını ve YKS hazırlık alanını öğren ve kullan.
- Sınıf bilgisi eksikse: "Kaçıncı sınıftasın?" diye sor ve ask_student_choice(question_type: class_level) çağır.
- YKS alanı eksikse: "YKS'de hangi alana hazırlanıyorsun?" diye sor ve ask_student_choice(question_type: yks_area) çağır.
- Kullanıcıya 2+ seçenek sunduğunda (saat aralığı, tercih, evet/hayır vb.) metinle sorma; ask_student_choice(question_type: custom, options: [...]) çağır.
- Seçenek sunacaksan önce ask_student_choice çağır, sonra kısa açıklama yaz; seçenekleri sadece metin olarak listeleme.
- Örnek öğle molası: options: [{label:"12:00-13:00", value:"12:00-13:00"}, {label:"12:30-13:30", value:"12:30-13:30"}, {label:"13:00-14:00", value:"13:00-14:00"}]
- Kullanıcı alan/sınav tercihini değiştirirse update_student_context aracıyla profili güncelle.
- Kullanıcı "vazgeçtim", "artık ... hazırlanacağım", "YDS'ye gireceğim/girmeyeceğim" gibi net tercih değişikliği yazarsa, yanıt vermeden önce update_student_context çağır.
- Örnek: Sayısal + YDS → yks_area: "Sayısal", enabled_exams: ["TYT","AYT","YDS"].
- Örnek: Sadece Dil → yks_area: "Dil", enabled_exams: ["YDS"].
- Sınıf bilgisi öğrenildiğinde class_level alanını da güncelle.
- Hedef sıralama eksikse öğren (örn. "İlk 10.000", "5.000") ve update_student_context(target_rank) ile kaydet.
- Hedef sıralama + YKS alanı biliniyorsa, sistem bağlamındaki "Hedef net rehberi"ni kullan. Bunun ortalama bir tahmin olduğunu ve sınavın zorluğuna göre değişebileceğini söyle; yıl referansı verme.
- Son deneme netleri eksikse öğren; en az son 1, mümkünse son 3 deneme (TYT/AYT/YDS netleri) ve update_student_context(trial_exam veya trial_exams) ile kaydet.
- Öğrenci yeni deneme sonucu paylaştığında trial_exam ile ekle; en fazla son 3 deneme tutulur.
- Eğer sınav hedefi (TYT / AYT / YDS) verilmişse bunu plana yansıt.
- Sınav hedefi (TYT / AYT / YDS) eksikse: plan/takvim isteğinde sor ve ask_student_choice(question_type: exam_target) çağır.
- Bu 2 bilgi netleşene kadar Planner'a (takvim/plan araçları) veya plan komitesine devretme; önce cevap al.

Elindeki ajanlar:
- Plan komitesi (consult_plan_committee): büyük akademik planlamada PDR + sınav uzmanından kısa görüş toplar.
  Haftalık/günlük program kurma, sıfırdan plan, ciddi plan revizyonu için önce bunu kullan.
  Komite karar vermez; nihai kararı SEN verirsin.
- Planner (delegate_to_planner): takvime yazar (ekleme/silme/taşıma). Küçük işlemlerde doğrudan,
  büyük planlamada komite görüşünden sonra senin sentezlediğin komutla çağır.

Plan komitesi kuralları:
- Büyük planlama isteğinde önce consult_plan_committee çağır.
- Dönen PDR/sınav görüşlerini oku; hard veto varsa planı olduğu gibi yazma, revize et veya eksik bilgi sor.
- Soft önerileri mümkünse planner komutuna yedir.
- Kararını verdikten sonra delegate_to_planner ile uygula; onay sorma.
- Komite tartışmasını öğrenciye uzun uzun aktarma; kısa gerekçe + yapılan plan yeterli.
- Küçük takvim işlemlerinde komite ÇAĞIRMA; doğrudan delegate_to_planner kullan.

Takvim davranışı (çok önemli):
- Takvim ekleme/güncelleme/silme için ASLA onay bekleme.
- "Onaylıyor musun?", "Ekleyeyim mi?", "İstersen yapabilirim" gibi ifadeler kullanma.
- Küçük takvim isteğinde önce delegate_to_planner ile değişikliği UYGULA, sonra ne yaptığını kısa ve net bildir.
- Sadece gerçekten eksik bilgi varsa (tarih, saat, ders) sor; bu bir onay değil, bilgi tamamlama sorusudur.
- Google Takvim bağlıysa Planner değişiklikleri otomatik senkronize eder; kullanıcıdan ayrıca onay isteme.

Takvim UI NotAl içinde "Takvim" menüsünde görünür.
Genel sohbet, motivasyon ve ders anlatımında doğrudan yanıt ver; büyük plan için komiteye, küçük takvim için Planner'a devret.
Görsel veya PDF paylaşılırsa: soru çözümü SEN YAPMA. Sadece sınıflandırıp solve_question çağır.

Soru çözme (çok kritik — asla ihlal etme):
- YKS/TYT/AYT/YDS sorusu, test sorusu, "şu soruyu çöz", seçenekli soru veya soru görseli/PDF geldiğinde ASLA kendin çözme.
- Adım adım çözüm, doğru şık, elektron dizilimi hesabı vb. üretme.
- Her zaman solve_question aracını çağır; çözüm GPT-5.6 Luna soru çözme ajanı tarafından yapılır.
- exam / branch / topic bilgisini mümkün olduğunca ver; soru metnini aktar (görsel varsa kısa not yeterli: "ekteki soruyu çöz").
- solve_question sonrası chat'te çözümü tekrar yazma; araç sonucu zaten kullanıcıya iletilir.
Matematik için LaTeX kullanabilirsin ($...$ veya $$...$$).`;

export const ORCHESTRATOR_TOOLS = [
  {
    type: "function" as const,
    strict: false,
    name: "ask_student_choice",
    description:
      "Öğrenciye tıklanabilir seçenekler gösterir. Profil soruları veya özel seçenekli sorular için kullan.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        question_type: {
          type: "string",
          enum: ["class_level", "yks_area", "exam_target", "custom"],
          description:
            "Soru tipi. Özel seçenekler için custom kullan.",
        },
        message: {
          type: "string",
          description: "Sorunun kısa metni (UI başlığında gösterilir).",
        },
        options: {
          type: "array",
          description:
            "question_type=custom iken zorunlu. En az 2 seçenek.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string", description: "Butonda görünen metin." },
              value: {
                type: "string",
                description: "Seçilince gönderilecek değer (boşsa label kullanılır).",
              },
            },
            required: ["label"],
          },
        },
      },
      required: ["question_type"],
    },
  },
  {
    type: "function" as const,
    strict: false,
    name: "update_student_context",
    description:
      "Öğrenci profilini günceller: sınıf, YKS alanı, aktif sınavlar, hedef sıralama, deneme netleri.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        class_level: {
          type: "string",
          description: "Öğrencinin sınıfı (örn. 12. Sınıf, Mezun).",
        },
        yks_area: {
          type: "string",
          enum: ["Sayısal", "Eşit Ağırlık", "Sözel", "Dil"],
          description: "Öğrencinin yeni YKS alanı.",
        },
        enabled_exams: {
          type: "array",
          description: "Öğrencinin aktif sınav listesi.",
          items: { type: "string", enum: ["TYT", "AYT", "YDS"] },
        },
        target_rank: {
          type: "string",
          description: 'Hedef sıralama (örn. "İlk 10.000", "5.000").',
        },
        trial_exam: {
          type: "object",
          description: "Tek bir deneme sonucu ekle (son 3 deneme tutulur).",
          additionalProperties: false,
          properties: {
            name: { type: "string", description: "Deneme adı veya tarih." },
            taken_at: { type: "string", description: "ISO tarih veya metin." },
            tyt_net: { type: "number" },
            ayt_net: { type: "number" },
            yds_net: { type: "number" },
          },
        },
        trial_exams: {
          type: "array",
          description: "Son denemeleri komple güncelle (en fazla 3).",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              taken_at: { type: "string" },
              tyt_net: { type: "number" },
              ayt_net: { type: "number" },
              yds_net: { type: "number" },
            },
          },
        },
      },
      required: [],
    },
  },
  {
    type: "function" as const,
    strict: false,
    name: "delegate_to_planner",
    description:
      "Küçük takvim/plan işlerini doğrudan uygular (onay beklemeden): tek blok ekleme, güncelleme, silme, listeleme. Haftalık/büyük program için consult_plan_committee kullan.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: {
          type: "string",
          description:
            "Planner'a iletilecek Türkçe komut. Tarih, saat ve işlem açık olsun. Onay isteme; doğrudan uygulat.",
        },
      },
      required: ["command"],
    },
  },
  {
    type: "function" as const,
    strict: false,
    name: "consult_plan_committee",
    description:
      "Büyük akademik planlama için PDR + sınav uzmanından paralel görüş alır. Karar vermez; görüşleri sana döner. Sen karar verip ardından delegate_to_planner çağırırsın. Küçük tek blok işlemlerinde kullanma.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        request: {
          type: "string",
          description:
            "Komiteye iletilecek planlama talebi. Öğrenci isteği + bilinen kısıtlar (müsait saatler, sınav tarihi, odak dersler) net yazılsın.",
        },
      },
      required: ["request"],
    },
  },
  {
    type: "function" as const,
    strict: false,
    name: "solve_question",
    description:
      "Soru çözme ajanına (GPT-5.6 Luna) delege eder. Orchestrator soruyu KENDİSİ çözmez; bu aracı çağırır. Çözüm + konu yerleşimi + bilgi kartı üretilir.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        exam: {
          type: "string",
          enum: ["TYT", "AYT", "YDS"],
          description: "Soru hangi sınav için? (TYT/AYT/YDS).",
        },
        branch: {
          type: "string",
          description: 'Branş adı (örn. "Kimya", "Matematik").',
        },
        topic: {
          type: "string",
          description:
            'Müfredat başlığı (örn. "Atom ve periyodik sistem"). Katalogdaki ada yakın olsun.',
        },
        question: {
          type: "string",
          description:
            "Soru metni. Görsel/PDF varsa kısa açıklama da olabilir; ekler otomatik iletilir.",
        },
      },
      required: ["exam", "topic", "question"],
    },
  },
] as const;

export type NotalChatTurn = {
  role: "user" | "assistant";
  content: string;
  attachments?: NotalChatAttachmentInput[];
};

export type NotalStudentContext = {
  classLevel?: string | null;
  educationLevel?: string | null;
  yksArea?: string | null;
  examTarget?: string | null;
  enabledExams?: YksExam[] | null;
  targetRank?: string | null;
  trialExams?: NotalStudentProfile["trialExams"];
};

export type OrchestratorStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_done"; name: string }
  | { type: "calendar_changed" }
  | {
      type: "student_context_changed";
      context: NotalStudentProfile;
    }
  | { type: "choice_prompt"; prompt: StudentChoicePrompt }
  | {
      type: "question_solution_ready";
      solution: NotalQuestionSolution;
    }
  | {
      type: "knowledge_card_ready";
      card: NotalKnowledgeCard;
    }
  | { type: "error"; message: string };

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseToolArgs(argsJson: string): Record<string, unknown> {
  try {
    return JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseYksArea(value: unknown): YksArea | null {
  return value === "Sayısal" ||
    value === "Eşit Ağırlık" ||
    value === "Sözel" ||
    value === "Dil"
    ? value
    : null;
}

function parseEnabledExams(value: unknown): YksExam[] {
  if (!Array.isArray(value)) return [];
  const result: YksExam[] = [];
  for (const item of value) {
    if (
      (item === "TYT" || item === "AYT" || item === "YDS") &&
      !result.includes(item)
    ) {
      result.push(item);
    }
  }
  return result;
}

/**
 * Tool-calling döngüsü + final yanıtı parça parça yayar.
 */
export async function* runNotalOrchestrator(options: {
  messages: NotalChatTurn[];
  supabase: SupabaseClient;
  userId: string;
  signal?: AbortSignal;
  studentContext?: NotalStudentContext;
}): AsyncGenerator<OrchestratorStreamEvent> {
  const openai = createNotalOpenAI();
  const model = getNotalOrchestratorModel();

  const studentLines: string[] = [];
  const cls = options.studentContext?.classLevel;
  const edu = options.studentContext?.educationLevel;
  const yks = options.studentContext?.yksArea;
  const exam = options.studentContext?.examTarget;
  let contextYksArea = (options.studentContext?.yksArea as YksArea | null) ?? null;
  let contextEnabledExams = options.studentContext?.enabledExams ?? [];
  let contextClassLevel = options.studentContext?.classLevel ?? null;
  let contextTargetRank = options.studentContext?.targetRank ?? null;
  let contextTrialExams = options.studentContext?.trialExams ?? [];

  if (cls) studentLines.push(`Sınıf: ${cls}`);
  if (edu) studentLines.push(`Eğitim seviyesi: ${edu}`);
  if (yks) studentLines.push(`YKS alanı: ${yks}`);
  if (contextEnabledExams.length) {
    studentLines.push(`Aktif sınavlar: ${contextEnabledExams.join(", ")}`);
  }
  if (contextTargetRank) studentLines.push(`Hedef sıralama: ${contextTargetRank}`);
  const targetNets = estimateTargetNets(contextTargetRank, contextYksArea);
  if (targetNets) {
    studentLines.push(
      `Hedef net rehberi: ${formatTargetNetHint(targetNets)}`,
    );
  }
  if (contextTrialExams.length) {
    studentLines.push(
      `Son denemeler: ${contextTrialExams
        .map((item) => {
          const parts = [item.name];
          if (item.tytNet !== null) parts.push(`TYT ${item.tytNet}`);
          if (item.aytNet !== null) parts.push(`AYT ${item.aytNet}`);
          if (item.ydsNet !== null) parts.push(`YDS ${item.ydsNet}`);
          return parts.join(" · ");
        })
        .join(" | ")}`,
    );
  }
  if (exam) studentLines.push(`Sınav hedefi: ${exam}`);
  const missing: string[] = [];
  if (!cls) missing.push("sınıf");
  if (!yks) missing.push("YKS alanı");
  if (!contextTargetRank) missing.push("hedef sıralama");
  if (!contextTrialExams.length) missing.push("deneme netleri");
  if (missing.length) studentLines.push(`Eksikler: ${missing.join(", ")}`);

  const lastUser =
    [...options.messages].reverse().find((m) => m.role === "user") ?? null;
  const lastUserMessage = lastUser?.content ?? "";
  const isMajorPlanRequest =
    /haftal[ıi]k\s*plan|çalışma\s*plan[ıi]|calisma\s*plan[ıi]|günlük\s*program|gunluk\s*program|program\s*oluştur|program\s*olustur|sıfırdan\s*plan|sifirdan\s*plan|yeniden\s*plan|planımı\s*yenile|planimi\s*yenile|yoğun\s*program|yogun\s*program|ders\s*program/i.test(
      lastUserMessage,
    );
  const isMinorCalendarRequest =
    /takvim|yarın|yarin|ekle|sil|taşı|tasi|güncelle|guncelle|blok/i.test(
      lastUserMessage,
    );
  if (isMajorPlanRequest) {
    studentLines.push(
      "Son mesaj büyük planlama isteği: önce consult_plan_committee, sonra sen karar verip delegate_to_planner ile uygula.",
    );
  } else if (isMinorCalendarRequest) {
    studentLines.push(
      "Son mesaj küçük takvim/plan isteği: delegate_to_planner ile doğrudan uygula; onay sorma; işlem sonrası yapılanı bildir.",
    );
  }
  if (
    lastUser?.attachments?.length ||
    /soru\s*çöz|coz|şu\s*soru|bu\s*soru|doğru\s*cevap|seçenek|A\)|B\)|C\)|D\)|E\)/i.test(
      lastUserMessage,
    )
  ) {
    studentLines.push(
      "Son mesaj soru çözme isteği olabilir: KENDİN ÇÖZME. Mutlaka solve_question (GPT-5.6 Luna) çağır.",
    );
  }

  const dynamicInstructions = studentLines.length
    ? `${NOTAL_ORCHESTRATOR_INSTRUCTIONS}\n\nÖğrenci bilgileri:\n- ${studentLines.join("\n- ")}`
    : NOTAL_ORCHESTRATOR_INSTRUCTIONS;

  let input: Array<Record<string, unknown>> = options.messages.map(
    (message) => {
      if (message.role === "user" && message.attachments?.length) {
        return {
          role: "user",
          content: buildOrchestratorUserContent(
            message.content,
            message.attachments,
          ),
        };
      }
      return {
        role: message.role,
        content: message.content,
      };
    },
  );

  for (let round = 0; round < 6; round += 1) {
    if (options.signal?.aborted) {
      yield { type: "error", message: "aborted" };
      return;
    }

    const response = await openai.responses.create(
      {
        model,
        instructions: dynamicInstructions,
        input: input as never,
        tools: ORCHESTRATOR_TOOLS as never,
        reasoning: { effort: "low" },
      },
      options.signal ? { signal: options.signal } : undefined,
    );

    const calls = extractFunctionCalls(response as never);
    if (!calls.length) {
      const text = extractOutputText(response as never);
      if (!text) {
        yield { type: "error", message: "empty_orchestrator_response" };
        return;
      }

      const chunkSize = 24;
      for (let i = 0; i < text.length; i += chunkSize) {
        yield { type: "delta", text: text.slice(i, i + chunkSize) };
      }
      return;
    }

    input = [
      ...input,
      ...((response.output || []) as unknown as Array<Record<string, unknown>>),
    ];

    for (const call of calls) {
      yield { type: "tool_start", name: call.name };

      let toolResult = "";
      if (call.name === "delegate_to_planner") {
        const missing: string[] = [];
        if (!contextClassLevel) missing.push("sınıf");
        if (!contextYksArea) missing.push("YKS alanı");

        if (missing.length) {
          toolResult = JSON.stringify({
            ok: false,
            error: "student_profile_incomplete",
            missing,
          });
        } else {
        const args = parseToolArgs(call.arguments);
        const command = asString(args.command);
        if (!command) {
          toolResult = JSON.stringify({ ok: false, error: "missing_command" });
        } else {
          const plannerResult = await runPlannerAgent({
            command,
            supabase: options.supabase,
            userId: options.userId,
            signal: options.signal,
            onTool: (phase, name) => {
              /* nested planner tools — UI'da sadece delegate görünür */
              void phase;
              void name;
            },
          });

          if (plannerResult.calendarChanged) {
            yield { type: "calendar_changed" };
          }

          toolResult = JSON.stringify({
            ok: plannerResult.ok,
            summary: plannerResult.summary,
            error: plannerResult.error,
          });
        }
        }
      } else if (call.name === "consult_plan_committee") {
        const missing: string[] = [];
        if (!contextClassLevel) missing.push("sınıf");
        if (!contextYksArea) missing.push("YKS alanı");

        if (missing.length) {
          toolResult = JSON.stringify({
            ok: false,
            error: "student_profile_incomplete",
            missing,
          });
        } else {
          const args = parseToolArgs(call.arguments);
          const request = asString(args.request);
          if (!request) {
            toolResult = JSON.stringify({
              ok: false,
              error: "missing_request",
            });
          } else {
            const committee = await runPlanCommittee({
              request,
              supabase: options.supabase,
              userId: options.userId,
              signal: options.signal,
              profile: {
                classLevel: contextClassLevel,
                yksArea: contextYksArea,
                enabledExams: contextEnabledExams,
                targetRank: contextTargetRank,
                trialExams: contextTrialExams,
              },
            });

            if (!committee.ok) {
              toolResult = JSON.stringify({
                ok: false,
                error: committee.error || "committee_failed",
                specialists: committee.specialists,
              });
            } else {
              toolResult = JSON.stringify({
                ok: true,
                has_hard_veto: committee.hasHardVeto,
                brief: committee.brief,
                specialists: {
                  pdr: {
                    risks: committee.specialists.pdr.risks,
                    suggestions: committee.specialists.pdr.suggestions,
                    veto: committee.specialists.pdr.veto,
                    veto_reason: committee.specialists.pdr.vetoReason,
                  },
                  exam: {
                    risks: committee.specialists.exam.risks,
                    suggestions: committee.specialists.exam.suggestions,
                    veto: committee.specialists.exam.veto,
                    veto_reason: committee.specialists.exam.vetoReason,
                  },
                },
                instruction:
                  "Sen komite başkanısın. Bu görüşleri harmanla; hard veto varsa revize et. Sonra delegate_to_planner ile uygula.",
              });
            }
          }
        }
      } else if (call.name === "ask_student_choice") {
        const args = parseToolArgs(call.arguments);
        const prompt = resolveStudentChoicePrompt(
          args.question_type,
          asString(args.message),
          args.options,
        );

        if (!prompt) {
          toolResult = JSON.stringify({
            ok: false,
            error: "invalid_question_type",
          });
        } else {
          yield { type: "choice_prompt", prompt };
          toolResult = JSON.stringify({
            ok: true,
            question_type: prompt.questionType,
            option_count: prompt.options.length,
          });
        }
      } else if (call.name === "update_student_context") {
        const args = parseToolArgs(call.arguments);
        const nextClassLevel = asString(args.class_level);
        const nextArea = parseYksArea(args.yks_area);
        const nextExams = parseEnabledExams(args.enabled_exams);
        const nextTargetRank = asString(args.target_rank);
        const nextTrialExam = parseTrialExamPatch(args.trial_exam);
        const nextTrialExams = parseTrialExamsPatch(args.trial_exams);

        if (
          !nextClassLevel &&
          !nextArea &&
          nextExams.length === 0 &&
          !nextTargetRank &&
          !nextTrialExam &&
          nextTrialExams.length === 0
        ) {
          toolResult = JSON.stringify({
            ok: false,
            error: "no_valid_context_fields",
          });
        } else {
          const result = await persistStudentProfileUpdate(options.userId, {
            classLevel: nextClassLevel ?? undefined,
            yksArea: nextArea ?? undefined,
            enabledExams: nextExams.length ? nextExams : undefined,
            targetRank: nextTargetRank ?? undefined,
            addTrialExam: nextTrialExam ?? undefined,
            trialExams: nextTrialExams.length ? nextTrialExams : undefined,
          });

          if (!result.ok) {
            toolResult = JSON.stringify({
              ok: false,
              error: result.error,
            });
          } else {
            contextClassLevel = result.profile.classLevel;
            contextYksArea = result.profile.yksArea;
            contextEnabledExams = result.profile.enabledExams;
            contextTargetRank = result.profile.targetRank;
            contextTrialExams = result.profile.trialExams;
            yield {
              type: "student_context_changed",
              context: result.profile,
            };
            toolResult = JSON.stringify({
              ok: true,
              class_level: result.profile.classLevel,
              yks_area: result.profile.yksArea,
              enabled_exams: result.profile.enabledExams,
              target_rank: result.profile.targetRank,
              trial_exams: result.profile.trialExams,
            });
          }
        }
        } else if (call.name === "solve_question") {
          const args = parseToolArgs(call.arguments);
          const examRaw = asString(args.exam);
          const branch = asString(args.branch);
          const topic = asString(args.topic);
          const question = asString(args.question);

          const exam =
            examRaw === "TYT" || examRaw === "AYT" || examRaw === "YDS"
              ? examRaw
              : null;

          if (!exam || !topic || !question) {
            toolResult = JSON.stringify({
              ok: false,
              error: "invalid_solve_question_args",
            });
          } else {
            const lastUser = [...options.messages]
              .reverse()
              .find((m) => m.role === "user");

            const solution = await runQuestionSolverAgent({
              exam,
              branch,
              topic,
              question,
              attachments: lastUser?.attachments,
              signal: options.signal,
            });

            yield {
              type: "question_solution_ready",
              solution,
            };

            try {
              const card = await runInsightAgent({
                solution,
                signal: options.signal,
              });
              yield {
                type: "knowledge_card_ready",
                card,
              };
            } catch (error) {
              console.error("[notal] insight agent failed:", error);
            }

            yield { type: "tool_done", name: call.name };

            // Chat cevabı Luna ajanından gelir; Sol orchestrator yeniden yazmaz.
            const reply = formatQuestionSolverChatReply(solution);
            const chunkSize = 48;
            for (let i = 0; i < reply.length; i += chunkSize) {
              yield { type: "delta", text: reply.slice(i, i + chunkSize) };
            }
            return;
          }
      } else {
        toolResult = JSON.stringify({ ok: false, error: "unknown_tool" });
      }

      yield { type: "tool_done", name: call.name };

      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: toolResult,
      });
    }
  }

  yield {
    type: "error",
    message: "tool_loop_limit",
  };
}
