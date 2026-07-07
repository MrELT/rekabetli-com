(function initMentorMeetingProposals() {
  const MAX_NOTE = 500;
  const MAX_DATETIME_SLOTS = 5;
  const MAX_REVIEW_COMMENT = 800;

  function sb() {
    return window.getSupabase?.() || window.sb || null;
  }

  function sec() {
    return window.RekabetliSecurity;
  }

  function parseUuid(value) {
    const raw = String(value || "").trim();
    return sec()?.isValidUuid?.(raw) ? raw : null;
  }

  function sanitizePackageId(value) {
    return sec()?.sanitizePackageId?.(value) || "";
  }

  function sanitizeNote(value) {
    return sec()?.sanitizeMultilinePlainText?.(value, MAX_NOTE) || null;
  }

  function sanitizeReviewComment(value) {
    return sec()?.sanitizeMultilinePlainText?.(value, MAX_REVIEW_COMMENT) || null;
  }

  async function fetchStudentMeetingReview(proposalId) {
    const supabase = sb();
    if (!supabase || !proposalId) return null;
    const { data, error } = await supabase.rpc("get_student_meeting_review", {
      p_proposal_id: proposalId,
    });
    if (error) throw error;
    return data || null;
  }

  async function submitStudentMeetingReview({ proposalId, rating, comment }) {
    const supabase = sb();
    if (!supabase || !proposalId) throw new Error("invalid_request");
    const { data, error } = await supabase.rpc("submit_student_meeting_review", {
      p_proposal_id: proposalId,
      p_rating: rating,
      p_comment: sanitizeReviewComment(comment),
    });
    if (error) throw error;
    return data || null;
  }

  function createStudentMeetingReviewCard(proposal, { mentorName = "", packageTitle = "" } = {}) {
    const wrap = document.createElement("article");
    wrap.className = "student-meeting-review-section";

    const title = document.createElement("h3");
    title.className = "student-meeting-review-title";
    title.textContent = "Görüşme değerlendirmesi";

    const meta = document.createElement("p");
    meta.className = "student-meeting-schedule-meta";
    meta.textContent = `${mentorName || "Mentör"} · ${packageTitle || "Paket"} · ${formatDateTime(proposal.scheduled_starts_at)}`;

    const hint = document.createElement("p");
    hint.className = "profile-hint student-meeting-review-hint";
    hint.textContent =
      "5 yıldız ile puan verebilir, isterseniz yorum ekleyebilirsiniz. Yorumunuz herkese açık paylaşılır ve adınız gizlenmiş şekilde gösterilir (örn: M**** Y****).";

    const starsWrap = document.createElement("div");
    starsWrap.className = "student-meeting-review-stars";

    const commentLabel = document.createElement("label");
    commentLabel.textContent = "Yorum (isteğe bağlı)";
    commentLabel.setAttribute("for", `student-meeting-review-comment-${proposal.id}`);

    const commentInput = document.createElement("textarea");
    commentInput.id = `student-meeting-review-comment-${proposal.id}`;
    commentInput.className = "student-meeting-schedule-note-input";
    commentInput.rows = 3;
    commentInput.maxLength = MAX_REVIEW_COMMENT;
    commentInput.placeholder = "Deneyiminizi kısaca paylaşabilirsiniz…";

    const messageEl = document.createElement("p");
    messageEl.className = "profile-message empty student-meeting-schedule-message";
    messageEl.setAttribute("role", "status");

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.textContent = "Değerlendirmeyi kaydet";

    let selectedRating = 0;

    function applyStars() {
      starsWrap.querySelectorAll("button").forEach((btn, index) => {
        btn.classList.toggle("is-selected", index < selectedRating);
      });
    }

    for (let i = 1; i <= 5; i += 1) {
      const starBtn = document.createElement("button");
      starBtn.type = "button";
      starBtn.className = "student-meeting-review-star";
      starBtn.setAttribute("aria-label", `${i} yıldız`);
      starBtn.textContent = "★";
      starBtn.addEventListener("click", () => {
        selectedRating = i;
        applyStars();
      });
      starsWrap.appendChild(starBtn);
    }

    async function loadExistingReview() {
      try {
        const existingReview = await fetchStudentMeetingReview(proposal.id);
        selectedRating = Number(existingReview?.rating) || 0;
        commentInput.value = existingReview?.comment || "";
        applyStars();
        if (existingReview?.reviewed_at) {
          submitBtn.textContent = "Değerlendirmeyi güncelle";
        }
      } catch (error) {
        console.error("get_student_meeting_review:", error);
      }
    }

    submitBtn.addEventListener("click", async () => {
      if (selectedRating < 1 || selectedRating > 5) {
        messageEl.textContent = "Lütfen 1-5 arası yıldız seçin.";
        messageEl.classList.remove("empty");
        messageEl.classList.add("profile-message-error");
        return;
      }
      submitBtn.disabled = true;
      messageEl.textContent = "Değerlendirme kaydediliyor…";
      messageEl.classList.remove("empty", "profile-message-error");
      try {
        await submitStudentMeetingReview({
          proposalId: proposal.id,
          rating: selectedRating,
          comment: commentInput.value,
        });
        messageEl.textContent = "Teşekkürler, değerlendirmeniz kaydedildi.";
        submitBtn.textContent = "Değerlendirmeyi güncelle";
      } catch (error) {
        console.error("submit_student_meeting_review:", error);
        messageEl.textContent = "Değerlendirme kaydedilemedi.";
        messageEl.classList.add("profile-message-error");
      } finally {
        submitBtn.disabled = false;
        messageEl.classList.remove("empty");
      }
    });

    wrap.append(title, meta, hint, starsWrap, commentLabel, commentInput, submitBtn, messageEl);
    void loadExistingReview();
    return wrap;
  }

  function toDatetimeLocalValue(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fromDatetimeLocalValue(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("tr-TR", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatShortDate(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("tr-TR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function optionLabel(option) {
    if (isOtherOption(option)) {
      return "Diğer (alternatif zaman önerebilirim)";
    }
    const label = formatDateTime(option?.starts_at);
    return label || "Tarih/saat seçeneği";
  }

  function isOtherOption(option) {
    return option?.option_kind === "other" || option?.kind === "other";
  }

  function studentReminderInfoText() {
    return "Toplantıdan bir gün önce ve 30 dakika önce hatırlatma alacaksınız. 30 dakika öncesinde görüşme bağlantısı size iletilecektir.";
  }

  function mentorPostponeWarningText() {
    return "Erteleme talebi öğrenciye iletilir. Öğrenci yeni zaman seçebilir veya iade talep edebilir. Sık erteleme veya iade talepleri profil güvenilirlik puanınızı düşürür.";
  }

  function mentorPostponePopupMessage() {
    return [
      mentorPostponeWarningText(),
      "Öğrenci ertelemek yerine İptal ve İade Politikası kapsamında iade de talep edebilir. İade talebi profil güvenilirlik puanınızı düşürebilir.",
      "Devam ederseniz öğrenciye sunacağınız yeni tarih seçeneklerini hazırlayacaksınız.",
    ].join("\n\n");
  }

  function studentPostponeWarningText() {
    return "Mentörünüz planlanan görüşmeyi ertelemek istiyor. Yeni bir zaman seçebilir veya iade talep edebilirsiniz. İade hakkınız saklıdır; iade talebi mentörün profil güvenilirlik puanını düşürebilir.";
  }

  function createMeetingWarningAccordion({ summaryText, paragraphs = [] }) {
    const details = document.createElement("details");
    details.className = "mentor-meeting-warning-accordion";
    details.open = true;

    const summary = document.createElement("summary");
    summary.className = "mentor-meeting-warning-summary";
    const badge = document.createElement("span");
    badge.className = "mentor-meeting-warning-badge";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = "!";
    const summaryTextEl = document.createElement("span");
    summaryTextEl.className = "mentor-meeting-warning-summary-text";
    summaryTextEl.textContent = summaryText;
    const chevron = document.createElement("span");
    chevron.className = "mentor-meeting-warning-chevron";
    chevron.setAttribute("aria-hidden", "true");
    summary.append(badge, summaryTextEl, chevron);

    const body = document.createElement("div");
    body.className = "mentor-meeting-warning-body";
    paragraphs.forEach((text) => {
      const p = document.createElement("p");
      p.textContent = text;
      body.appendChild(p);
    });

    details.append(summary, body);
    return details;
  }

  function normalizeOptions(raw) {
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  async function fetchProposalOptions(proposalId) {
    const supabase = sb();
    if (!supabase || !proposalId) return [];

    const { data, error } = await supabase
      .from("mentor_meeting_proposal_options")
      .select("id, option_kind, starts_at, sort_order")
      .eq("proposal_id", proposalId)
      .order("sort_order", { ascending: true });

    if (error) throw error;
    return data ?? [];
  }

  async function fetchProposalBundle({ mentorId, packageId, studentId, proposalId = null }) {
    const supabase = sb();
    if (!supabase) return null;

    const proposalSelect =
      "id, mentor_id, student_id, package_id, note, status, scheduled_starts_at, postponed_from_at, refund_requested_at, confirmed_at, created_at, updated_at, mentor_meeting_proposal_responses(selected_option_id, student_note, responded_at)";

    let proposal = null;

    if (proposalId) {
      const { data, error } = await supabase
        .from("mentor_meeting_proposals")
        .select(proposalSelect)
        .eq("id", proposalId)
        .maybeSingle();
      if (error) throw error;
      proposal = data;
    } else {
      const { data, error } = await supabase
        .from("mentor_meeting_proposals")
        .select(proposalSelect)
        .eq("mentor_id", mentorId)
        .eq("package_id", packageId)
        .eq("student_id", studentId)
        .in("status", ["pending", "responded", "confirmed", "postpone_pending"])
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      proposal = data?.[0] || null;
    }

    if (!proposal) return null;

    const options = await fetchProposalOptions(proposal.id);
    return { ...proposal, mentor_meeting_proposal_options: options };
  }

  async function fetchStudentConfirmedMeetings(studentId) {
    const safeStudentId = parseUuid(studentId);
    const supabase = sb();
    if (!supabase || !safeStudentId) return [];

    const { data, error } = await supabase
      .from("mentor_meeting_proposals")
      .select("id, mentor_id, student_id, package_id, scheduled_starts_at, confirmed_at, status")
      .eq("student_id", safeStudentId)
      .eq("status", "confirmed")
      .order("scheduled_starts_at", { ascending: true, nullsFirst: false });

    if (error) throw error;
    return data ?? [];
  }

  const MEETING_LINK_LEAD_MS = 30 * 60 * 1000;
  const MEETING_LINK_GRACE_MS = 2 * 60 * 60 * 1000;
  const UPCOMING_MEETINGS_REFRESH_MS = 60 * 1000;

  function isUpcomingMeeting(scheduledStartsAt) {
    const start = new Date(scheduledStartsAt).getTime();
    if (Number.isNaN(start)) return false;
    return start + MEETING_LINK_GRACE_MS > Date.now();
  }

  function meetingLinkVisibleWindow(scheduledStartsAt) {
    const start = new Date(scheduledStartsAt).getTime();
    if (Number.isNaN(start)) return false;
    const now = Date.now();
    return now >= start - MEETING_LINK_LEAD_MS && now < start + MEETING_LINK_GRACE_MS;
  }

  function meetingPlatformLabel(platform) {
    const platforms = window.RekabetliMentorVitrin?.MEETING_PLATFORMS;
    const safe =
      window.RekabetliMentorVitrin?.sanitizeMeetingPlatform?.(platform) || platform || "";
    return platforms?.[safe]?.label || "Belirtilmedi";
  }

  function meetingLinkForDisplay(platform, link) {
    return window.RekabetliMentorVitrin?.sanitizeMeetingLink?.(platform, link) || null;
  }

  async function fetchUpcomingConfirmedMeetings({ mentorId, studentId, packageId } = {}) {
    const supabase = sb();
    if (!supabase) return [];

    let query = supabase
      .from("mentor_meeting_proposals")
      .select("id, mentor_id, student_id, package_id, scheduled_starts_at, confirmed_at, status")
      .eq("status", "confirmed")
      .not("scheduled_starts_at", "is", null)
      .order("scheduled_starts_at", { ascending: true });

    const safeMentorId = mentorId ? parseUuid(mentorId) : null;
    const safeStudentId = studentId ? parseUuid(studentId) : null;
    const safePackageId = packageId ? sanitizePackageId(packageId) : "";

    if (safeMentorId) query = query.eq("mentor_id", safeMentorId);
    if (safeStudentId) query = query.eq("student_id", safeStudentId);
    if (safePackageId) query = query.eq("package_id", safePackageId);

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).filter((row) => isUpcomingMeeting(row.scheduled_starts_at));
  }

  async function fetchAllConfirmedMeetings({ mentorId, studentId, packageId } = {}) {
    const supabase = sb();
    if (!supabase) return [];

    let query = supabase
      .from("mentor_meeting_proposals")
      .select("id, mentor_id, student_id, package_id, scheduled_starts_at, confirmed_at, status")
      .eq("status", "confirmed")
      .not("scheduled_starts_at", "is", null)
      .order("scheduled_starts_at", { ascending: true });

    const safeMentorId = mentorId ? parseUuid(mentorId) : null;
    const safeStudentId = studentId ? parseUuid(studentId) : null;
    const safePackageId = packageId ? sanitizePackageId(packageId) : "";

    if (safeMentorId) query = query.eq("mentor_id", safeMentorId);
    if (safeStudentId) query = query.eq("student_id", safeStudentId);
    if (safePackageId) query = query.eq("package_id", safePackageId);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async function enrichUpcomingMeetings(meetings, { enrollments = [] } = {}) {
    if (!meetings.length) return [];

    const mentorIds = [...new Set(meetings.map((m) => m.mentor_id))];
    const studentIds = [...new Set(meetings.map((m) => m.student_id))];
    const profileIds = [...new Set([...mentorIds, ...studentIds])];
    const supabase = sb();

    const [{ data: pages }, { data: profiles }] = await Promise.all([
      supabase
        .from("mentor_pages")
        .select("user_id, meeting_platform, meeting_link, packages")
        .in("user_id", mentorIds),
      supabase.from("profiles").select("id, display_name").in("id", profileIds),
    ]);

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.id, p.display_name?.trim() || ""]),
    );
    const mentorMetaMap = new Map(
      (pages ?? []).map((p) => [
        p.user_id,
        {
          platform: p.meeting_platform,
          link: p.meeting_link,
          packages: Array.isArray(p.packages) ? p.packages : [],
        },
      ]),
    );

    function packageTitleFor(mentorId, packageId) {
      const enrollment = enrollments.find(
        (row) => row.mentor_id === mentorId && row.package_id === packageId,
      );
      if (enrollment?.package_title) return enrollment.package_title;

      const meta = mentorMetaMap.get(mentorId);
      const safePkgId = sanitizePackageId(packageId);
      const pkg = meta?.packages?.find((item) => sanitizePackageId(item?.id) === safePkgId);
      return pkg?.title?.trim() || "Paket";
    }

    return meetings.map((meeting) => {
      const meta = mentorMetaMap.get(meeting.mentor_id) || {};
      const platform = meta.platform || null;
      const enrollment = enrollments.find(
        (row) =>
          row.mentor_id === meeting.mentor_id && row.package_id === meeting.package_id,
      );
      return {
        ...meeting,
        meetingPlatform: platform,
        meetingLink: meetingLinkForDisplay(platform, meta.link),
        packageTitle: packageTitleFor(meeting.mentor_id, meeting.package_id),
        studentName: profileMap.get(meeting.student_id) || "Öğrenci",
        mentorName: profileMap.get(meeting.mentor_id) || "Mentör",
        enrollmentId: enrollment?.enrollment_id || null,
      };
    });
  }

  function bindMeetingNavigation(element, meeting, onOpenMeeting) {
    if (!element || typeof onOpenMeeting !== "function") return;

    element.classList.add("meeting-nav-target", "meeting-nav-target--interactive");
    element.setAttribute("role", "button");
    element.tabIndex = 0;

    const open = () => onOpenMeeting(meeting);

    element.addEventListener("click", (event) => {
      if (event.target.closest("button, input, a, textarea")) return;
      open();
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  }

  async function copyTextToClipboard(text) {
    const value = String(text || "").trim();
    if (!value) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function createUpcomingMeetingItem(meeting, { perspective = "student", onOpenMeeting = null } = {}) {
    const article = document.createElement("article");
    article.className = "upcoming-meeting-item";

    const when = document.createElement("p");
    when.className = "upcoming-meeting-item-when";
    when.textContent = formatDateTime(meeting.scheduled_starts_at);

    const platform = document.createElement("p");
    platform.className = "upcoming-meeting-item-platform";
    platform.textContent = meetingPlatformLabel(meeting.meetingPlatform);

    const context = document.createElement("p");
    context.className = "upcoming-meeting-item-context";
    if (perspective === "mentor") {
      context.textContent = [meeting.studentName, meeting.packageTitle].filter(Boolean).join(" · ");
    } else {
      context.textContent = `${meeting.mentorName} · ${meeting.packageTitle}`;
    }

    const linkSection = document.createElement("div");
    linkSection.className = "upcoming-meeting-item-link";

    const linkNote = document.createElement("p");
    linkNote.className = "upcoming-meeting-item-link-note";
    linkNote.textContent = "Son 30 dk gösterilir";

    const linkVisible = meetingLinkVisibleWindow(meeting.scheduled_starts_at);
    const safeLink = meeting.meetingLink;

    if (linkVisible && safeLink) {
      const copyRow = document.createElement("div");
      copyRow.className = "upcoming-meeting-item-link-copy";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "upcoming-meeting-item-link-input";
      input.value = safeLink;
      input.readOnly = true;
      input.setAttribute("aria-label", "Görüşme bağlantısı");

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "secondary upcoming-meeting-item-link-copy-btn";
      copyBtn.textContent = "Kopyala";
      copyBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const ok = await copyTextToClipboard(safeLink);
        copyBtn.textContent = ok ? "Kopyalandı" : "Kopyalanamadı";
        window.setTimeout(() => {
          copyBtn.textContent = "Kopyala";
        }, 2000);
      });

      copyRow.append(input, copyBtn);
      linkSection.append(linkNote, copyRow);
    } else if (linkVisible && !safeLink) {
      const missing = document.createElement("p");
      missing.className = "upcoming-meeting-item-link-waiting";
      missing.textContent =
        perspective === "mentor"
          ? "Görüşme bağlantınızı aşağıdaki bölümden kaydedin."
          : "Mentör görüşme bağlantısını henüz kaydetmemiş.";
      linkSection.append(linkNote, missing);
    } else {
      linkSection.appendChild(linkNote);
    }

    article.append(when, platform, context, linkSection);

    if (onOpenMeeting) {
      bindMeetingNavigation(article, meeting, onOpenMeeting);
      const openHint = document.createElement("p");
      openHint.className = "upcoming-meeting-item-open-hint";
      openHint.textContent = "Paket sayfasına gitmek için tıklayın";
      article.appendChild(openHint);
    }

    return article;
  }

  function clearUpcomingMeetingsRefresh(host) {
    if (host?._upcomingMeetingsRefreshTimer) {
      clearInterval(host._upcomingMeetingsRefreshTimer);
      host._upcomingMeetingsRefreshTimer = null;
    }
  }

  function renderUpcomingMeetingsBox(
    host,
    meetings,
    { perspective = "student", onOpenMeeting = null } = {},
  ) {
    host.replaceChildren();

    if (!meetings.length) {
      host.hidden = true;
      return;
    }

    host.hidden = false;

    const box = document.createElement("section");
    box.className = "upcoming-meetings-box";
    box.setAttribute("aria-label", "Yaklaşan görüşmelerim");

    const title = document.createElement("h2");
    title.className = "upcoming-meetings-box-title";
    title.textContent = "Yaklaşan görüşmelerim";

    const list = document.createElement("div");
    list.className = "upcoming-meetings-list";
    meetings.forEach((meeting) => {
      list.appendChild(createUpcomingMeetingItem(meeting, { perspective, onOpenMeeting }));
    });

    box.append(title, list);
    host.appendChild(box);
  }

  async function mountUpcomingMeetingsBox(host, options = {}) {
    if (!host) return;

    const {
      mentorId = null,
      studentId = null,
      packageId = null,
      perspective = mentorId && !studentId ? "mentor" : "student",
      enrollments = [],
      onOpenMeeting = null,
    } = options;

    clearUpcomingMeetingsRefresh(host);

    const refresh = async () => {
      try {
        const raw = await fetchUpcomingConfirmedMeetings({ mentorId, studentId, packageId });
        const meetings = await enrichUpcomingMeetings(raw, { enrollments });
        renderUpcomingMeetingsBox(host, meetings, { perspective, onOpenMeeting });
      } catch (error) {
        console.error("upcoming meetings:", error);
        host.hidden = true;
        host.replaceChildren();
      }
    };

    await refresh();
    host._upcomingMeetingsRefreshTimer = window.setInterval(() => {
      void refresh();
    }, UPCOMING_MEETINGS_REFRESH_MS);
  }

  const CALENDAR_START_HOUR = 8;
  const CALENDAR_END_HOUR = 22;
  const CALENDAR_HOUR_HEIGHT_PX = 52;
  const DEFAULT_MEETING_DURATION_MIN = 60;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const CALENDAR_DAY_NAMES = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

  function startOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function isSameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function formatCalendarTime(date) {
    return date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatWeekRangeLabel(weekStart) {
    const weekEnd = addDays(weekStart, 6);
    const startText = weekStart.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
    const endText = weekEnd.toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `${startText} – ${endText}`;
  }

  function meetingsInWeek(meetings, weekStart) {
    const weekEnd = addDays(weekStart, 7);
    return meetings.filter((meeting) => {
      const start = new Date(meeting.scheduled_starts_at);
      return start >= weekStart && start < weekEnd;
    });
  }

  function meetingCalendarTitle(meeting, perspective) {
    if (perspective === "mentor") {
      return meeting.studentName || "Öğrenci";
    }
    return meeting.mentorName || "Mentör";
  }

  function meetingTopPx(startDate) {
    const hours = startDate.getHours();
    const minutes = startDate.getMinutes();
    const minutesFromGridStart = (hours - CALENDAR_START_HOUR) * 60 + minutes;
    return (minutesFromGridStart / 60) * CALENDAR_HOUR_HEIGHT_PX;
  }

  function meetingHeightPx(durationMin = DEFAULT_MEETING_DURATION_MIN) {
    return (durationMin / 60) * CALENDAR_HOUR_HEIGHT_PX;
  }

  function renderMeetingsCalendar(
    host,
    meetings,
    {
      perspective = "student",
      weekStart = startOfWeek(new Date()),
      onWeekChange = null,
      onOpenMeeting = null,
    } = {},
  ) {
    host.replaceChildren();
    host.hidden = false;

    const box = document.createElement("section");
    box.className = "all-meetings-calendar-box";
    box.setAttribute("aria-label", "Tüm görüşmelerim");

    const toolbar = document.createElement("header");
    toolbar.className = "meetings-calendar-toolbar";

    const title = document.createElement("h2");
    title.className = "all-meetings-calendar-title";
    title.textContent = "Tüm görüşmelerim";

    const nav = document.createElement("div");
    nav.className = "meetings-calendar-nav";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "secondary meetings-calendar-nav-btn";
    prevBtn.textContent = "← Önceki";
    prevBtn.addEventListener("click", () => {
      onWeekChange?.(addDays(weekStart, -7));
    });

    const todayBtn = document.createElement("button");
    todayBtn.type = "button";
    todayBtn.className = "secondary meetings-calendar-nav-btn";
    todayBtn.textContent = "Bu hafta";
    todayBtn.addEventListener("click", () => {
      onWeekChange?.(startOfWeek(new Date()));
    });

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "secondary meetings-calendar-nav-btn";
    nextBtn.textContent = "Sonraki →";
    nextBtn.addEventListener("click", () => {
      onWeekChange?.(addDays(weekStart, 7));
    });

    const rangeLabel = document.createElement("span");
    rangeLabel.className = "meetings-calendar-range-label";
    rangeLabel.textContent = formatWeekRangeLabel(weekStart);

    nav.append(prevBtn, todayBtn, nextBtn, rangeLabel);
    toolbar.append(title, nav);

    const weekMeetings = meetingsInWeek(meetings, weekStart);
    const totalHours = CALENDAR_END_HOUR - CALENDAR_START_HOUR;
    const gridHeight = totalHours * CALENDAR_HOUR_HEIGHT_PX;

    if (!weekMeetings.length) {
      const empty = document.createElement("p");
      empty.className = "meetings-calendar-empty";
      empty.textContent = "Bu hafta için planlanmış görüşme yok.";
      box.append(toolbar, empty);
      host.appendChild(box);
      return;
    }

    const scroll = document.createElement("div");
    scroll.className = "meetings-calendar-scroll";

    const grid = document.createElement("div");
    grid.className = "meetings-calendar-grid";
    grid.style.setProperty("--meetings-calendar-height", `${gridHeight}px`);
    grid.style.setProperty("--meetings-hour-height", `${CALENDAR_HOUR_HEIGHT_PX}px`);

    const corner = document.createElement("div");
    corner.className = "meetings-calendar-corner";
    corner.setAttribute("aria-hidden", "true");

    const dayHeaders = document.createElement("div");
    dayHeaders.className = "meetings-calendar-day-headers";

    const today = new Date();
    for (let i = 0; i < 7; i += 1) {
      const dayDate = addDays(weekStart, i);
      const header = document.createElement("div");
      header.className = "meetings-calendar-day-header";
      if (isSameDay(dayDate, today)) header.classList.add("is-today");

      const dayName = document.createElement("span");
      dayName.className = "meetings-calendar-day-name";
      dayName.textContent = CALENDAR_DAY_NAMES[i];

      const dayNum = document.createElement("span");
      dayNum.className = "meetings-calendar-day-num";
      dayNum.textContent = String(dayDate.getDate());

      header.append(dayName, dayNum);
      dayHeaders.appendChild(header);
    }

    const timeAxis = document.createElement("div");
    timeAxis.className = "meetings-calendar-time-axis";
    for (let hour = CALENDAR_START_HOUR; hour < CALENDAR_END_HOUR; hour += 1) {
      const label = document.createElement("span");
      label.className = "meetings-calendar-time-label";
      label.style.top = `${(hour - CALENDAR_START_HOUR) * CALENDAR_HOUR_HEIGHT_PX}px`;
      label.textContent = `${String(hour).padStart(2, "0")}:00`;
      timeAxis.appendChild(label);
    }

    const daysWrap = document.createElement("div");
    daysWrap.className = "meetings-calendar-days";

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const dayDate = addDays(weekStart, dayIndex);
      const column = document.createElement("div");
      column.className = "meetings-calendar-day-column";
      if (isSameDay(dayDate, today)) column.classList.add("is-today");

      const body = document.createElement("div");
      body.className = "meetings-calendar-day-body";
      body.style.height = `${gridHeight}px`;
      column.appendChild(body);

      daysWrap.appendChild(column);
    }

    weekMeetings.forEach((meeting) => {
      const start = new Date(meeting.scheduled_starts_at);
      if (Number.isNaN(start.getTime())) return;

      const dayIndex = Math.floor((startOfDay(start) - weekStart) / DAY_MS);
      if (dayIndex < 0 || dayIndex > 6) return;

      const column = daysWrap.children[dayIndex];
      const body = column?.querySelector(".meetings-calendar-day-body");
      if (!body) return;

      const minutes = start.getHours() * 60 + start.getMinutes();
      const gridStartMin = CALENDAR_START_HOUR * 60;
      const gridEndMin = CALENDAR_END_HOUR * 60;
      if (minutes < gridStartMin || minutes >= gridEndMin) return;

      const topPx = meetingTopPx(start);
      const heightPx = meetingHeightPx();

      const event = document.createElement("button");
      event.type = "button";
      event.className = "meetings-calendar-event";
      if (start.getTime() < Date.now()) event.classList.add("is-past");
      event.style.top = `${topPx}px`;
      event.style.height = `${heightPx}px`;

      const label = meetingCalendarTitle(meeting, perspective);
      const eventLabel = document.createElement("span");
      eventLabel.className = "meetings-calendar-event-label";
      eventLabel.textContent = label;
      event.title = [
        formatCalendarTime(start),
        label,
        meeting.packageTitle,
        meetingPlatformLabel(meeting.meetingPlatform),
      ]
        .filter(Boolean)
        .join(" · ");
      event.appendChild(eventLabel);

      if (onOpenMeeting) {
        event.addEventListener("click", () => onOpenMeeting(meeting));
      }

      body.appendChild(event);
    });

    grid.append(corner, dayHeaders, timeAxis, daysWrap);
    scroll.appendChild(grid);
    box.append(toolbar, scroll);
    host.appendChild(box);
  }

  async function mountAllMeetingsCalendar(host, options = {}) {
    if (!host) return;

    const {
      mentorId = null,
      studentId = null,
      packageId = null,
      perspective = mentorId && !studentId ? "mentor" : "student",
      enrollments = [],
      onOpenMeeting = null,
    } = options;

    if (!host._calendarWeekStart) {
      host._calendarWeekStart = startOfWeek(new Date());
    }

    const refresh = async () => {
      try {
        const raw = await fetchAllConfirmedMeetings({ mentorId, studentId, packageId });
        const meetings = await enrichUpcomingMeetings(raw, { enrollments });

        if (!host._calendarWeekInitialized && meetings.length) {
          const anchor =
            meetings.find((row) => new Date(row.scheduled_starts_at) >= new Date()) ||
            meetings[meetings.length - 1];
          if (anchor?.scheduled_starts_at) {
            host._calendarWeekStart = startOfWeek(new Date(anchor.scheduled_starts_at));
          }
          host._calendarWeekInitialized = true;
        }

        if (!meetings.length) {
          host.hidden = false;
          host.replaceChildren();
          const box = document.createElement("section");
          box.className = "all-meetings-calendar-box";
          box.setAttribute("aria-label", "Tüm görüşmelerim");
          const title = document.createElement("h2");
          title.className = "all-meetings-calendar-title";
          title.textContent = "Tüm görüşmelerim";
          const empty = document.createElement("p");
          empty.className = "meetings-calendar-empty";
          empty.textContent = "Henüz tarihli görüşme kaydı yok.";
          box.append(title, empty);
          host.appendChild(box);
          return;
        }

        renderMeetingsCalendar(host, meetings, {
          perspective,
          weekStart: host._calendarWeekStart,
          onOpenMeeting,
          onWeekChange: (nextWeekStart) => {
            host._calendarWeekStart = startOfWeek(nextWeekStart);
            void refresh();
          },
        });
      } catch (error) {
        console.error("meetings calendar:", error);
        host.hidden = true;
        host.replaceChildren();
      }
    };

    await refresh();
  }

  function confirmedSelectionLabel(proposal) {
    const response = proposalResponse(proposal);
    const options = sortOptions(proposal.mentor_meeting_proposal_options);
    const selected = response
      ? options.find((opt) => opt.id === response.selected_option_id)
      : null;
    return selected ? optionLabel(selected) : null;
  }

  function createPlannedMeetingCard(
    proposal,
    { mentorName = "", packageTitle = "", variant = "compact", onOpen = null } = {},
  ) {
    const card = document.createElement("article");
    card.className = `student-planned-meeting-card student-planned-meeting-card--${variant}`;

    const badge = document.createElement("p");
    badge.className = "student-planned-meeting-card-badge";
    badge.textContent = "Planlanan görüşme";

    const when = document.createElement("p");
    when.className = "student-planned-meeting-card-when";
    if (proposal.scheduled_starts_at) {
      when.textContent = formatDateTime(proposal.scheduled_starts_at);
    } else {
      const fallback = confirmedSelectionLabel(proposal);
      when.textContent = fallback || "Alternatif zaman belirlenecek";
    }

    const context = document.createElement("p");
    context.className = "student-planned-meeting-card-context";
    const contextParts = [mentorName, packageTitle].filter(Boolean);
    context.textContent = contextParts.length ? contextParts.join(" · ") : "Mentör görüşmesi";

    card.append(badge, when, context);

    if (proposal.scheduled_starts_at) {
      const reminder = document.createElement("p");
      reminder.className = "student-planned-meeting-card-reminder";
      reminder.textContent = studentReminderInfoText();
      card.appendChild(reminder);
    } else {
      const followUp = document.createElement("p");
      followUp.className = "student-planned-meeting-card-reminder";
      followUp.textContent = "Mentörünüz alternatif zaman için sizinle iletişime geçecektir.";
      card.appendChild(followUp);
    }

    if (onOpen) {
      card.classList.add("student-planned-meeting-card--interactive");
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      card.addEventListener("click", onOpen);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      });

      const openHint = document.createElement("p");
      openHint.className = "student-planned-meeting-card-open-hint";
      openHint.textContent = "Detay için tıklayın";
      card.appendChild(openHint);
    }

    return card;
  }

  function renderPlannedMeetingsList(
    host,
    meetings,
    { enrollments = [], onOpenEnrollment = null } = {},
  ) {
    host.replaceChildren();

    if (!meetings.length) {
      const empty = document.createElement("p");
      empty.className = "student-planned-meetings-empty";
      empty.textContent = "Henüz onaylanmış görüşme yok.";
      host.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "student-planned-meetings-stack";

    meetings.forEach((proposal) => {
      const enrollment = enrollments.find(
        (row) => row.mentor_id === proposal.mentor_id && row.package_id === proposal.package_id,
      );
      const card = createPlannedMeetingCard(proposal, {
        mentorName: enrollment?.mentor_display_name || "",
        packageTitle: enrollment?.package_title || "",
        variant: "aside",
        onOpen:
          enrollment && onOpenEnrollment
            ? () => onOpenEnrollment(enrollment.enrollment_id)
            : null,
      });
      list.appendChild(card);
    });

    host.appendChild(list);
  }

  function sortOptions(options = []) {
    return normalizeOptions(options).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  function createAccordionSection({ title, panelId }) {
    const section = document.createElement("section");
    section.className = "mentor-meeting-schedule-accordion activity-accordion-section";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "activity-accordion-trigger mentor-meeting-schedule-trigger";
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", panelId);

    const triggerTitle = document.createElement("span");
    triggerTitle.className = "activity-accordion-title";
    triggerTitle.textContent = title;

    const triggerMeta = document.createElement("span");
    triggerMeta.className = "activity-accordion-meta";
    const chevron = document.createElement("span");
    chevron.className = "activity-accordion-chevron";
    chevron.setAttribute("aria-hidden", "true");
    triggerMeta.appendChild(chevron);
    trigger.append(triggerTitle, triggerMeta);

    const panel = document.createElement("div");
    panel.id = panelId;
    panel.className = "activity-accordion-panel mentor-meeting-schedule-panel";
    panel.setAttribute("role", "region");

    trigger.addEventListener("click", () => {
      const willOpen = !section.classList.contains("is-open");
      section.classList.toggle("is-open", willOpen);
      trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });

    section.append(trigger, panel);
    return { section, panel, trigger };
  }

  function proposalResponse(proposal) {
    const raw = proposal?.mentor_meeting_proposal_responses;
    if (Array.isArray(raw)) return raw[0] || null;
    return raw || null;
  }

  function renderMentorStatus(host, proposal, actions = {}) {
    host.replaceChildren();
    if (!proposal) {
      const empty = document.createElement("p");
      empty.className = "mentor-meeting-schedule-empty";
      empty.textContent = "Henüz görüşme teklifi gönderilmedi.";
      host.appendChild(empty);
      return;
    }

    const card = document.createElement("div");
    card.className = "mentor-meeting-schedule-status-card";

    const head = document.createElement("p");
    head.className = "mentor-meeting-schedule-status-head";
    if (proposal.status === "confirmed") {
      head.textContent = `Görüşme onaylandı · ${formatShortDate(proposal.confirmed_at || proposal.created_at)}`;
    } else if (proposal.status === "postpone_pending") {
      head.textContent = `Erteleme talebi gönderildi · ${formatShortDate(proposal.updated_at || proposal.created_at)}`;
    } else if (proposal.status === "responded") {
      head.textContent = `Öğrenci yanıtladı · ${formatShortDate(proposalResponse(proposal)?.responded_at || proposal.created_at)}`;
    } else {
      head.textContent = `Bekleyen teklif · ${formatShortDate(proposal.created_at)}`;
    }

    const list = document.createElement("ul");
    list.className = "mentor-meeting-schedule-option-list";
    sortOptions(proposal.mentor_meeting_proposal_options).forEach((option) => {
      const li = document.createElement("li");
      li.textContent = optionLabel(option);
      list.appendChild(li);
    });

    card.append(head, list);

    if (proposal.note) {
      const note = document.createElement("p");
      note.className = "mentor-meeting-schedule-note";
      note.textContent = proposal.note;
      card.appendChild(note);
    }

    const response = proposalResponse(proposal);
    if (proposal.status === "postpone_pending") {
      if (proposal.postponed_from_at) {
        const from = document.createElement("p");
        from.className = "mentor-meeting-schedule-response";
        from.textContent = `Ertelenen görüşme: ${formatDateTime(proposal.postponed_from_at)}`;
        card.appendChild(from);
      }
      const waiting = document.createElement("p");
      waiting.className = "mentor-meeting-schedule-reminder-info";
      waiting.textContent =
        "Öğrencinin yeni zaman seçmesi veya iade talep etmesi bekleniyor. İade talebi profil güvenilirlik puanınızı düşürebilir.";
      card.appendChild(waiting);
    } else if (proposal.status === "confirmed") {
      const selected = response
        ? sortOptions(proposal.mentor_meeting_proposal_options).find(
            (opt) => opt.id === response.selected_option_id,
          )
        : null;
      const answer = document.createElement("p");
      answer.className = "mentor-meeting-schedule-response";
      if (proposal.scheduled_starts_at) {
        answer.textContent = `Onaylanan görüşme: ${formatDateTime(proposal.scheduled_starts_at)}`;
      } else {
        answer.textContent = `Onaylanan seçim: ${selected ? optionLabel(selected) : "—"}`;
      }
      card.appendChild(answer);
      if (response?.student_note) {
        const studentNote = document.createElement("p");
        studentNote.className = "mentor-meeting-schedule-student-note";
        studentNote.textContent = `Öğrenci notu: ${response.student_note}`;
        card.appendChild(studentNote);
      }
      if (proposal.scheduled_starts_at) {
        const reminder = document.createElement("p");
        reminder.className = "mentor-meeting-schedule-reminder-info";
        reminder.textContent = `Öğrenciye bildirildi: ${studentReminderInfoText()}`;
        card.appendChild(reminder);
      }

      const canPostpone =
        proposal.scheduled_starts_at && new Date(proposal.scheduled_starts_at) > new Date();
      if (canPostpone && actions.onPostpone) {
        const actionsRow = document.createElement("div");
        actionsRow.className = "mentor-meeting-schedule-actions";
        const postponeBtn = document.createElement("button");
        postponeBtn.type = "button";
        postponeBtn.className =
          "mentor-meeting-schedule-action-btn mentor-meeting-schedule-action-btn--secondary";
        postponeBtn.textContent = "Görüşmeyi ertele";
        postponeBtn.addEventListener("click", () => actions.onPostpone(proposal));
        actionsRow.appendChild(postponeBtn);
        card.appendChild(actionsRow);
      }
    } else if (proposal.status === "responded" && response) {
      const selected = sortOptions(proposal.mentor_meeting_proposal_options).find(
        (opt) => opt.id === response.selected_option_id,
      );
      const answer = document.createElement("p");
      answer.className = "mentor-meeting-schedule-response";
      answer.textContent = `Seçilen: ${selected ? optionLabel(selected) : "—"}`;
      card.appendChild(answer);
      if (response.student_note) {
        const studentNote = document.createElement("p");
        studentNote.className = "mentor-meeting-schedule-student-note";
        studentNote.textContent = `Öğrenci notu: ${response.student_note}`;
        card.appendChild(studentNote);
      }
    }

    if (proposal.status === "pending" && (actions.onEdit || actions.onRemove)) {
      const actionsRow = document.createElement("div");
      actionsRow.className =
        "mentor-meeting-schedule-actions mentor-meeting-schedule-actions--pair";

      if (actions.onEdit) {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className =
          "mentor-meeting-schedule-action-btn mentor-meeting-schedule-action-btn--secondary";
        editBtn.textContent = "Düzenle";
        editBtn.addEventListener("click", () => actions.onEdit(proposal));
        actionsRow.appendChild(editBtn);
      }

      if (actions.onRemove) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className =
          "mentor-meeting-schedule-action-btn mentor-meeting-schedule-action-btn--danger";
        removeBtn.textContent = "Kaldır";
        removeBtn.addEventListener("click", () => actions.onRemove(proposal));
        actionsRow.appendChild(removeBtn);
      }

      card.appendChild(actionsRow);
    }

    if (proposal.status === "responded" && (actions.onConfirm || actions.onNewProposal)) {
      const actionsRow = document.createElement("div");
      actionsRow.className =
        "mentor-meeting-schedule-actions mentor-meeting-schedule-actions--pair";

      if (actions.onConfirm) {
        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className =
          "mentor-meeting-schedule-action-btn mentor-meeting-schedule-action-btn--primary";
        confirmBtn.textContent = "Onayla";
        confirmBtn.addEventListener("click", () => actions.onConfirm(proposal));
        actionsRow.appendChild(confirmBtn);
      }

      if (actions.onNewProposal) {
        const newBtn = document.createElement("button");
        newBtn.type = "button";
        newBtn.className =
          "mentor-meeting-schedule-action-btn mentor-meeting-schedule-action-btn--secondary";
        newBtn.textContent = "Yeni teklif sun";
        newBtn.addEventListener("click", () => actions.onNewProposal(proposal));
        actionsRow.appendChild(newBtn);
      }

      card.appendChild(actionsRow);
    }

    host.appendChild(card);
  }

  async function mountMentorScheduleSection({ root, mentorId, packageId, studentId, startOpen = false }) {
    const safeMentorId = parseUuid(mentorId);
    const safeStudentId = parseUuid(studentId);
    const safePackageId = sanitizePackageId(packageId);
    if (!root || !safeMentorId || !safeStudentId || !safePackageId) return;

    const panelId = `mentor-meeting-schedule-panel-${safeStudentId}`;
    const { section, panel, trigger } = createAccordionSection({
      title: "Görüşme planla",
      panelId,
    });
    trigger.setAttribute("aria-labelledby", `mentor-meeting-schedule-title-${safeStudentId}`);
    panel.setAttribute("aria-labelledby", trigger.id || panelId);

    const defaultScheduleHint =
      "Tarih eklemek için saati seçip «Seçenek ekle»ye basın. Gönderirken alandaki tarih de otomatik eklenir. İsterseniz “Diğer” seçeneği de ekleyebilirsiniz.";

    const hint = document.createElement("p");
    hint.className = "profile-hint mentor-meeting-schedule-hint";
    hint.textContent = defaultScheduleHint;

    const draftList = document.createElement("ul");
    draftList.className = "mentor-meeting-schedule-draft-list";
    draftList.hidden = true;

    const builder = document.createElement("div");
    builder.className = "mentor-meeting-schedule-builder";

    const datetimeLabel = document.createElement("label");
    datetimeLabel.textContent = "Tarih ve saat";
    datetimeLabel.htmlFor = `mentor-meeting-slot-input-${safeStudentId}`;

    const datetimeInput = document.createElement("input");
    datetimeInput.type = "datetime-local";
    datetimeInput.id = `mentor-meeting-slot-input-${safeStudentId}`;
    datetimeInput.className = "mentor-meeting-schedule-datetime";

    const addSlotBtn = document.createElement("button");
    addSlotBtn.type = "button";
    addSlotBtn.className = "secondary mentor-meeting-schedule-add-btn";
    addSlotBtn.textContent = "Seçenek ekle";

    const otherWrap = document.createElement("label");
    otherWrap.className = "mentor-meeting-schedule-other-toggle";
    const otherCheckbox = document.createElement("input");
    otherCheckbox.type = "checkbox";
    otherCheckbox.checked = true;
    otherWrap.append(otherCheckbox, document.createTextNode(" Diğer seçeneği ekle"));

    const noteLabel = document.createElement("label");
    noteLabel.htmlFor = `mentor-meeting-note-${safeStudentId}`;
    noteLabel.textContent = "Not (isteğe bağlı)";
    const noteInput = document.createElement("textarea");
    noteInput.id = `mentor-meeting-note-${safeStudentId}`;
    noteInput.className = "mentor-meeting-schedule-note-input";
    noteInput.rows = 2;
    noteInput.maxLength = MAX_NOTE;
    noteInput.placeholder = "Örn. Görüşme Google Meet üzerinden yapılacaktır.";

    const messageEl = document.createElement("p");
    messageEl.className = "profile-message empty mentor-meeting-schedule-message";
    messageEl.setAttribute("role", "status");

    const sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.textContent = "Gönder";

    const cancelEditBtn = document.createElement("button");
    cancelEditBtn.type = "button";
    cancelEditBtn.className = "secondary mentor-meeting-schedule-cancel-edit-btn";
    cancelEditBtn.textContent = "İptal";
    cancelEditBtn.hidden = true;

    const composeActions = document.createElement("div");
    composeActions.className = "mentor-meeting-schedule-compose-actions";
    composeActions.append(sendBtn, cancelEditBtn);

    const statusHost = document.createElement("div");
    statusHost.className = "mentor-meeting-schedule-status-host";

    const statusTitle = document.createElement("h3");
    statusTitle.className = "mentor-meeting-schedule-subtitle";
    statusTitle.textContent = "Son teklif";

    builder.append(datetimeLabel, datetimeInput, addSlotBtn);
    panel.append(hint, draftList, builder, otherWrap, noteLabel, noteInput, composeActions, messageEl, statusTitle, statusHost);
    root.appendChild(section);

    const draftSlots = [];
    let editingProposalId = null;
    let postponingProposalId = null;

    function resetComposeForm() {
      editingProposalId = null;
      postponingProposalId = null;
      hint.textContent = defaultScheduleHint;
      draftSlots.length = 0;
      noteInput.value = "";
      datetimeInput.value = "";
      otherCheckbox.checked = true;
      renderDraftList();
      sendBtn.textContent = "Gönder";
      cancelEditBtn.hidden = true;
    }

    function beginEdit(proposal) {
      if (!proposal || proposal.status !== "pending") return;

      postponingProposalId = null;
      hint.textContent = defaultScheduleHint;
      editingProposalId = proposal.id;
      draftSlots.length = 0;

      sortOptions(proposal.mentor_meeting_proposal_options).forEach((option) => {
        if (isOtherOption(option)) return;
        draftSlots.push({ kind: "datetime", starts_at: option.starts_at });
      });

      otherCheckbox.checked = sortOptions(proposal.mentor_meeting_proposal_options).some(isOtherOption);
      noteInput.value = proposal.note || "";
      datetimeInput.value = "";
      renderDraftList();
      sendBtn.textContent = "Güncelle";
      cancelEditBtn.hidden = false;
      setMessage("");
      section.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      builder.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    async function beginPostpone(proposal) {
      if (!proposal || proposal.status !== "confirmed" || !proposal.scheduled_starts_at) return;
      if (new Date(proposal.scheduled_starts_at) <= new Date()) return;

      const confirmed = await window.rekabetliConfirm?.({
        title: "Erteleme uyarısı",
        message: mentorPostponePopupMessage(),
        confirmLabel: "Erteleme seçeneklerini hazırla",
      });
      if (confirmed === false) return;

      postponingProposalId = proposal.id;
      editingProposalId = null;
      draftSlots.length = 0;
      noteInput.value = proposal.note || "";
      datetimeInput.value = "";
      otherCheckbox.checked = true;
      renderDraftList();
      sendBtn.textContent = "Erteleme talebi gönder";
      cancelEditBtn.hidden = false;
      hint.textContent = "Aşağıya öğrenciye sunacağınız yeni tarih seçeneklerini ekleyin.";
      setMessage("");
      section.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      builder.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    async function confirmProposal(proposal) {
      if (!proposal || proposal.status !== "responded") return;

      const selected = sortOptions(proposal.mentor_meeting_proposal_options).find(
        (opt) => opt.id === proposalResponse(proposal)?.selected_option_id,
      );
      const whenLabel =
        selected && !isOtherOption(selected)
          ? formatDateTime(selected.starts_at)
          : selected
            ? "Diğer seçeneği"
            : "seçilen zaman";

      const confirmed = await window.rekabetliConfirm?.({
        title: "Görüşmeyi onayla",
        message: `Öğrencinin seçtiği ${whenLabel} için görüşmeyi onaylıyor musunuz? Öğrenciye tarih ve hatırlatma bilgisi iletilecektir.`,
        confirmLabel: "Onayla",
      });
      if (confirmed === false) return;

      setMessage("Onaylanıyor…");
      const supabase = sb();
      const { error } = await supabase.rpc("confirm_meeting_proposal", {
        p_proposal_id: proposal.id,
      });

      if (error) {
        console.error("confirm_meeting_proposal:", error);
        const code = error.message || "";
        if (code.includes("invalid_datetime")) {
          setMessage("Seçilen görüşme zamanı geçmişte. Yeni teklif sunun.", true);
        } else if (code.includes("proposal_not_found")) {
          setMessage("Teklif bulunamadı veya zaten işlendi.", true);
        } else if (code.includes("confirm_meeting_proposal")) {
          setMessage("Veritabanı kurulumu gerekli. supabase-mentor-meeting-proposals.sql dosyasını çalıştırın.", true);
        } else {
          setMessage("Görüşme onaylanamadı.", true);
        }
        return;
      }

      setMessage("Görüşme onaylandı ve öğrenciye bildirildi.");
      await refreshStatus();
    }

    async function beginNewProposal(proposal) {
      if (!proposal || proposal.status !== "responded") return;

      const confirmed = await window.rekabetliConfirm?.({
        title: "Yeni teklif sun",
        message: "Öğrencinin seçimi iptal edilip yeni bir görüşme teklifi hazırlamak istiyor musunuz?",
        confirmLabel: "Devam et",
      });
      if (confirmed === false) return;

      const supabase = sb();
      const { error } = await supabase.rpc("reopen_meeting_for_new_proposal", {
        p_proposal_id: proposal.id,
      });

      if (error) {
        console.error("reopen_meeting_for_new_proposal:", error);
        const code = error.message || "";
        if (code.includes("proposal_not_found")) {
          setMessage("Teklif bulunamadı.", true);
        } else if (code.includes("reopen_meeting_for_new_proposal")) {
          setMessage("Veritabanı kurulumu gerekli. supabase-mentor-meeting-proposals.sql dosyasını çalıştırın.", true);
        } else {
          setMessage("Yeni teklif için hazırlık yapılamadı.", true);
        }
        return;
      }

      resetComposeForm();
      setMessage("Yeni görüşme teklifi için tarih seçenekleri ekleyin.");
      section.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      hint.scrollIntoView({ behavior: "smooth", block: "nearest" });
      await refreshStatus();
    }

    async function removeProposal(proposal) {
      if (!proposal || proposal.status !== "pending") return;

      const confirmed = await window.rekabetliConfirm?.({
        title: "Teklifi kaldır",
        message: "Bekleyen görüşme teklifi öğrenciden kaldırılsın mı?",
        confirmLabel: "Kaldır",
        danger: true,
      });
      if (!confirmed) return;

      setMessage("Kaldırılıyor…");
      const supabase = sb();
      const { error } = await supabase.rpc("cancel_meeting_proposal", {
        p_proposal_id: proposal.id,
      });

      if (error) {
        console.error("cancel_meeting_proposal:", error);
        const code = error.message || "";
        if (code.includes("proposal_not_found")) {
          setMessage("Teklif bulunamadı veya zaten yanıtlanmış.", true);
        } else if (code.includes("cancel_meeting_proposal")) {
          setMessage("Veritabanı kurulumu gerekli. supabase-mentor-meeting-proposals.sql dosyasını çalıştırın.", true);
        } else {
          setMessage("Teklif kaldırılamadı.", true);
        }
        return;
      }

      if (editingProposalId === proposal.id) {
        resetComposeForm();
      }
      setMessage("Görüşme teklifi kaldırıldı.");
      await refreshStatus();
    }

    cancelEditBtn.addEventListener("click", () => {
      resetComposeForm();
      setMessage("");
    });

    function setMessage(text, isError = false) {
      messageEl.textContent = text || "";
      messageEl.classList.toggle("empty", !text);
      messageEl.classList.toggle("profile-message-error", Boolean(text && isError));
    }

    function renderDraftList() {
      draftList.replaceChildren();
      if (!draftSlots.length) {
        draftList.hidden = true;
        return;
      }
      draftList.hidden = false;
      draftSlots.forEach((slot, index) => {
        const li = document.createElement("li");
        li.className = "mentor-meeting-schedule-draft-item";

        const label = document.createElement("span");
        label.textContent =
          slot.kind === "other" ? "Diğer" : formatDateTime(slot.starts_at);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "mentor-meeting-schedule-remove-btn";
        removeBtn.textContent = "Kaldır";
        removeBtn.addEventListener("click", () => {
          draftSlots.splice(index, 1);
          renderDraftList();
        });

        li.append(label, removeBtn);
        draftList.appendChild(li);
      });
    }

    addSlotBtn.addEventListener("click", () => {
      setMessage("");
      const iso = fromDatetimeLocalValue(datetimeInput.value);
      if (!iso) {
        setMessage("Geçerli bir tarih ve saat seçin.", true);
        return;
      }
      if (new Date(iso) <= new Date()) {
        setMessage("Görüşme zamanı gelecekte olmalıdır.", true);
        return;
      }
      const datetimeCount = draftSlots.filter((s) => s.kind === "datetime").length;
      if (datetimeCount >= MAX_DATETIME_SLOTS) {
        setMessage(`En fazla ${MAX_DATETIME_SLOTS} tarih seçeneği ekleyebilirsiniz.`, true);
        return;
      }
      if (draftSlots.some((s) => s.kind === "datetime" && s.starts_at === iso)) {
        setMessage("Bu zaman zaten listede.", true);
        return;
      }
      draftSlots.push({ kind: "datetime", starts_at: iso });
      datetimeInput.value = "";
      renderDraftList();
    });

    async function refreshStatus() {
      try {
        const proposal = await fetchProposalBundle({
          mentorId: safeMentorId,
          packageId: safePackageId,
          studentId: safeStudentId,
        });
        renderMentorStatus(statusHost, proposal, {
          onEdit: beginEdit,
          onRemove: removeProposal,
          onConfirm: confirmProposal,
          onNewProposal: beginNewProposal,
          onPostpone: beginPostpone,
        });
      } catch (error) {
        console.error("meeting proposal status:", error);
        statusHost.replaceChildren();
        const err = document.createElement("p");
        err.className = "mentor-meeting-schedule-empty";
        err.textContent = "Görüşme teklifleri yüklenemedi.";
        statusHost.appendChild(err);
      }
    }

    sendBtn.addEventListener("click", async () => {
      setMessage("");
      const options = [...draftSlots];

      const pendingIso = fromDatetimeLocalValue(datetimeInput.value);
      if (pendingIso) {
        if (new Date(pendingIso) <= new Date()) {
          setMessage("Görüşme zamanı gelecekte olmalıdır.", true);
          return;
        }
        const datetimeCount = options.filter((s) => s.kind === "datetime").length;
        if (datetimeCount >= MAX_DATETIME_SLOTS) {
          setMessage(`En fazla ${MAX_DATETIME_SLOTS} tarih seçeneği ekleyebilirsiniz.`, true);
          return;
        }
        if (!options.some((s) => s.kind === "datetime" && s.starts_at === pendingIso)) {
          options.push({ kind: "datetime", starts_at: pendingIso });
        }
      }

      if (otherCheckbox.checked) {
        if (!options.some((opt) => opt.kind === "other")) {
          options.push({ kind: "other" });
        }
      }
      if (!options.length) {
        setMessage("En az bir tarih seçeneği veya “Diğer” ekleyin.", true);
        return;
      }

      sendBtn.disabled = true;
      setMessage(
        postponingProposalId
          ? "Erteleme talebi gönderiliyor…"
          : editingProposalId
            ? "Güncelleniyor…"
            : "Gönderiliyor…",
      );

      const supabase = sb();

      if (postponingProposalId) {
        const { error } = await supabase.rpc("request_meeting_postpone", {
          p_proposal_id: postponingProposalId,
          p_note: sanitizeNote(noteInput.value),
          p_options: options,
        });
        sendBtn.disabled = false;

        if (error) {
          console.error("request_meeting_postpone:", error);
          const code = error.message || "";
          if (code.includes("options_required")) {
            setMessage("En az bir seçenek ekleyin.", true);
          } else if (code.includes("invalid_datetime")) {
            setMessage("Tüm tarihler gelecekte olmalıdır.", true);
          } else if (code.includes("proposal_not_found")) {
            setMessage("Görüşme bulunamadı veya ertelenemez.", true);
          } else if (code.includes("request_meeting_postpone")) {
            setMessage(
              "Veritabanı kurulumu gerekli. supabase-mentor-meeting-postpone.sql dosyasını çalıştırın.",
              true,
            );
          } else {
            setMessage("Erteleme talebi gönderilemedi.", true);
          }
          return;
        }

        resetComposeForm();
        setMessage("Erteleme talebi öğrenciye iletildi.");
        section.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
        await refreshStatus();
        return;
      }

      const { data, error } = await supabase.rpc("send_meeting_proposal", {
        p_student_id: safeStudentId,
        p_package_id: safePackageId,
        p_note: sanitizeNote(noteInput.value),
        p_options: options,
      });

      sendBtn.disabled = false;

      if (error) {
        console.error("send_meeting_proposal:", error);
        const code = error.message || "";
        if (code.includes("options_required")) {
          setMessage("En az bir seçenek ekleyin.", true);
        } else if (code.includes("invalid_datetime")) {
          setMessage("Tüm tarihler gelecekte olmalıdır.", true);
        } else if (code.includes("mentor_meeting_proposals")) {
          setMessage("Veritabanı kurulumu gerekli. supabase-mentor-meeting-proposals.sql dosyasını çalıştırın.", true);
        } else {
          setMessage(editingProposalId ? "Teklif güncellenemedi." : "Görüşme teklifi gönderilemedi.", true);
        }
        return;
      }

      const wasEditing = Boolean(editingProposalId);
      resetComposeForm();
      setMessage(wasEditing ? "Görüşme teklifi güncellendi." : "Görüşme teklifi öğrenciye iletildi.");
      section.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      await refreshStatus();
      void data;
    });

    await refreshStatus();

    if (startOpen) {
      section.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      window.setTimeout(() => {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    }
  }

  function renderStudentProposal(host, proposal, { onResponded, sectionTitleEl = null } = {}) {
    host.replaceChildren();

    if (!proposal) {
      const empty = document.createElement("p");
      empty.className = "student-meeting-schedule-empty";
      empty.textContent = "Mentörünüz henüz görüşme seçeneği göndermedi.";
      host.appendChild(empty);
      return;
    }

    if (sectionTitleEl) {
      sectionTitleEl.textContent =
        proposal.status === "postpone_pending" ? "Görüşme erteleme talebi" : "Görüşme planlama";
    }

    const meta = document.createElement("p");
    meta.className = "student-meeting-schedule-meta";
    meta.textContent =
      proposal.status === "postpone_pending"
        ? `Erteleme talebi: ${formatShortDate(proposal.updated_at || proposal.created_at)}`
        : `Gönderildi: ${formatShortDate(proposal.created_at)}`;

    const options = sortOptions(proposal.mentor_meeting_proposal_options);
    const response = proposalResponse(proposal);

    if (proposal.status === "postpone_pending") {
      host.appendChild(
        createMeetingWarningAccordion({
          summaryText: "Erteleme ve iade hakkınız",
          paragraphs: [
            studentPostponeWarningText(),
            "Yeni bir zaman seçebilir veya iade talep edebilirsiniz. İade talebi İptal ve İade Politikası kapsamında değerlendirilir.",
          ],
        }),
      );

      if (proposal.postponed_from_at) {
        const from = document.createElement("p");
        from.className = "student-meeting-schedule-mentor-note";
        from.textContent = `Ertelenen görüşme: ${formatDateTime(proposal.postponed_from_at)}`;
        host.appendChild(from);
      }

      if (proposal.note) {
        const mentorNote = document.createElement("p");
        mentorNote.className = "student-meeting-schedule-mentor-note";
        mentorNote.textContent = `Mentör notu: ${proposal.note}`;
        host.appendChild(mentorNote);
      }

      const form = document.createElement("form");
      form.className = "student-meeting-schedule-form";

      const fieldset = document.createElement("fieldset");
      fieldset.className = "student-meeting-schedule-options";

      const legend = document.createElement("legend");
      legend.textContent = "Yeni görüşme zamanı seçin";
      fieldset.appendChild(legend);

      let firstVisibleOption = true;
      options.forEach((option) => {
        if (!option?.id) return;
        const label = document.createElement("label");
        label.className = "student-meeting-schedule-option";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "meetingPostponeOption";
        input.value = option.id;
        if (firstVisibleOption) {
          input.checked = true;
          firstVisibleOption = false;
        }
        label.append(input, document.createTextNode(` ${optionLabel(option)}`));
        fieldset.appendChild(label);
      });

      if (firstVisibleOption) {
        const empty = document.createElement("p");
        empty.className = "student-meeting-schedule-empty";
        empty.textContent = "Erteleme seçenekleri yüklenemedi.";
        host.append(meta, empty);
        return;
      }

      const noteLabel = document.createElement("label");
      noteLabel.textContent = "Not (isteğe bağlı)";
      const noteInput = document.createElement("textarea");
      noteInput.className = "student-meeting-schedule-note-input";
      noteInput.rows = 2;
      noteInput.maxLength = MAX_NOTE;

      const messageEl = document.createElement("p");
      messageEl.className = "profile-message empty student-meeting-schedule-message";
      messageEl.setAttribute("role", "status");

      const submitBtn = document.createElement("button");
      submitBtn.type = "submit";
      submitBtn.textContent = "Yeni zamanı onayla";

      form.append(fieldset, noteLabel, noteInput, submitBtn, messageEl);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const selectedId = form.querySelector('input[name="meetingPostponeOption"]:checked')?.value;
        if (!selectedId) return;

        submitBtn.disabled = true;
        messageEl.textContent = "Kaydediliyor…";
        messageEl.classList.remove("empty", "profile-message-error");

        const supabase = sb();
        const { error } = await supabase.rpc("respond_meeting_postpone", {
          p_proposal_id: proposal.id,
          p_selected_option_id: selectedId,
          p_student_note: sanitizeNote(noteInput.value),
        });

        submitBtn.disabled = false;

        if (error) {
          console.error("respond_meeting_postpone:", error);
          messageEl.textContent = "Seçim kaydedilemedi.";
          messageEl.classList.add("profile-message-error");
          messageEl.classList.remove("empty");
          return;
        }

        messageEl.textContent = "Yeni görüşme zamanı onaylandı.";
        messageEl.classList.remove("empty", "profile-message-error");
        if (onResponded) await onResponded();
      });

      const refundSection = document.createElement("div");
      refundSection.className = "student-meeting-refund-section";

      const refundTitle = document.createElement("h3");
      refundTitle.className = "student-meeting-refund-title";
      refundTitle.textContent = "İade talep et";

      const refundHint = document.createElement("p");
      refundHint.className = "profile-hint student-meeting-refund-hint";
      refundHint.append(
        document.createTextNode("Erteleme yerine "),
        Object.assign(document.createElement("a"), {
          href: "/iptal-iade-politikasi",
          target: "_blank",
          rel: "noopener noreferrer",
          textContent: "İptal ve İade Politikası",
        }),
        document.createTextNode(" kapsamında iade talep edebilirsiniz. Bu hak saklıdır."),
      );

      const refundNoteLabel = document.createElement("label");
      refundNoteLabel.textContent = "İade notu (isteğe bağlı)";
      const refundNoteInput = document.createElement("textarea");
      refundNoteInput.className = "student-meeting-schedule-note-input";
      refundNoteInput.rows = 2;
      refundNoteInput.maxLength = MAX_NOTE;

      const refundMessageEl = document.createElement("p");
      refundMessageEl.className = "profile-message empty student-meeting-schedule-message";
      refundMessageEl.setAttribute("role", "status");

      const refundBtn = document.createElement("button");
      refundBtn.type = "button";
      refundBtn.className = "secondary student-meeting-refund-btn";
      refundBtn.textContent = "İade talep et";
      refundBtn.addEventListener("click", async () => {
        const confirmed = await window.rekabetliConfirm?.({
          title: "İade talep et",
          message:
            "Erteleme yerine iade talep etmek istediğinize emin misiniz? Talebiniz değerlendirilecektir.",
          confirmLabel: "İade talep et",
          danger: true,
        });
        if (!confirmed) return;

        refundBtn.disabled = true;
        refundMessageEl.textContent = "İade talebi gönderiliyor…";
        refundMessageEl.classList.remove("empty", "profile-message-error");

        const supabase = sb();
        const { error } = await supabase.rpc("request_meeting_refund", {
          p_proposal_id: proposal.id,
          p_student_note: sanitizeNote(refundNoteInput.value),
        });

        refundBtn.disabled = false;

        if (error) {
          console.error("request_meeting_refund:", error);
          refundMessageEl.textContent = "İade talebi gönderilemedi.";
          refundMessageEl.classList.add("profile-message-error");
          refundMessageEl.classList.remove("empty");
          return;
        }

        refundMessageEl.textContent = "İade talebiniz alındı.";
        refundMessageEl.classList.remove("empty", "profile-message-error");
        if (onResponded) await onResponded();
      });

      refundSection.append(
        refundTitle,
        refundHint,
        refundNoteLabel,
        refundNoteInput,
        refundBtn,
        refundMessageEl,
      );

      host.append(meta, form, refundSection);
      return;
    }

    if (proposal.status === "confirmed") {
      const selected = response
        ? options.find((opt) => opt.id === response.selected_option_id)
        : null;
      const card = createPlannedMeetingCard(proposal, {
        mentorName: "",
        packageTitle: "",
        variant: "inline",
      });
      if (selected && !proposal.scheduled_starts_at) {
        const selection = card.querySelector(".student-planned-meeting-card-when");
        if (selection) selection.textContent = optionLabel(selected);
      }
      host.append(meta, card);
      if (response?.student_note) {
        const note = document.createElement("p");
        note.className = "student-meeting-schedule-note";
        note.textContent = `Notunuz: ${response.student_note}`;
        host.appendChild(note);
      }
      return;
    }

    if (proposal.status === "responded" && response) {
      const selected = options.find((opt) => opt.id === response.selected_option_id);
      const done = document.createElement("p");
      done.className = "student-meeting-schedule-done";
      done.textContent = `Seçiminiz iletildi: ${selected ? optionLabel(selected) : "—"}. Mentör onayı bekleniyor.`;
      host.append(meta, done);
      if (response.student_note) {
        const note = document.createElement("p");
        note.className = "student-meeting-schedule-note";
        note.textContent = `Notunuz: ${response.student_note}`;
        host.appendChild(note);
      }
      return;
    }

    if (proposal.note) {
      const mentorNote = document.createElement("p");
      mentorNote.className = "student-meeting-schedule-mentor-note";
      mentorNote.textContent = proposal.note;
      host.appendChild(mentorNote);
    }

    const form = document.createElement("form");
    form.className = "student-meeting-schedule-form";

    const fieldset = document.createElement("fieldset");
    fieldset.className = "student-meeting-schedule-options";

    const legend = document.createElement("legend");
    legend.textContent = "Size uygun seçeneği işaretleyin";
    fieldset.appendChild(legend);

    let firstVisibleOption = true;
    options.forEach((option) => {
      if (!option?.id) return;
      const label = document.createElement("label");
      label.className = "student-meeting-schedule-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "meetingOption";
      input.value = option.id;
      if (firstVisibleOption) {
        input.checked = true;
        firstVisibleOption = false;
      }
      label.append(input, document.createTextNode(` ${optionLabel(option)}`));
      fieldset.appendChild(label);
    });

    if (firstVisibleOption) {
      const empty = document.createElement("p");
      empty.className = "student-meeting-schedule-empty";
      empty.textContent = "Görüşme seçenekleri yüklenemedi. Mentörünüzden yeni teklif isteyin.";
      host.append(meta, empty);
      return;
    }

    const noteLabel = document.createElement("label");
    noteLabel.textContent = "Not (isteğe bağlı)";
    const noteInput = document.createElement("textarea");
    noteInput.className = "student-meeting-schedule-note-input";
    noteInput.rows = 2;
    noteInput.maxLength = MAX_NOTE;
    noteInput.placeholder = "Örn. Diğer seçeneği için uygun olduğum saatler…";

    const messageEl = document.createElement("p");
    messageEl.className = "profile-message empty student-meeting-schedule-message";
    messageEl.setAttribute("role", "status");

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.textContent = "Seçimi gönder";

    form.append(fieldset, noteLabel, noteInput, submitBtn, messageEl);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const selectedId = form.querySelector('input[name="meetingOption"]:checked')?.value;
      if (!selectedId) return;

      submitBtn.disabled = true;
      messageEl.textContent = "Kaydediliyor…";
      messageEl.classList.remove("empty", "profile-message-error");

      const supabase = sb();
      const { error } = await supabase.rpc("respond_meeting_proposal", {
        p_proposal_id: proposal.id,
        p_selected_option_id: selectedId,
        p_student_note: sanitizeNote(noteInput.value),
      });

      submitBtn.disabled = false;

      if (error) {
        console.error("respond_meeting_proposal:", error);
        messageEl.textContent = "Seçim kaydedilemedi.";
        messageEl.classList.add("profile-message-error");
        messageEl.classList.remove("empty");
        return;
      }

      messageEl.textContent = "Seçiminiz mentöre iletildi.";
      messageEl.classList.remove("empty", "profile-message-error");
      if (onResponded) await onResponded();
    });

    host.append(meta, form);
  }

  async function mountStudentScheduleSection({
    root,
    mentorId,
    packageId,
    studentId,
    mentorName = "",
    packageTitle = "",
  }) {
    const safeMentorId = parseUuid(mentorId);
    const safeStudentId = parseUuid(studentId);
    const safePackageId = sanitizePackageId(packageId);
    if (!root || !safeMentorId || !safeStudentId || !safePackageId) return;

    const section = document.createElement("section");
    section.className = "student-meeting-schedule-section";

    const title = document.createElement("h2");
    title.className = "mentor-package-section-title";
    title.textContent = "Görüşme planlama";

    const content = document.createElement("div");
    content.className = "student-meeting-schedule-content";

    section.append(title, content);
    root.appendChild(section);

    async function refresh() {
      try {
        const proposal = await fetchProposalBundle({
          mentorId: safeMentorId,
          packageId: safePackageId,
          studentId: safeStudentId,
        });

        section.hidden = false;
        renderStudentProposal(content, proposal, { onResponded: refresh, sectionTitleEl: title });
      } catch (error) {
        console.error("student meeting proposal:", error);
        section.hidden = false;
        content.replaceChildren();
        const err = document.createElement("p");
        err.className = "student-meeting-schedule-empty";
        err.textContent = "Görüşme planlama yüklenemedi.";
        content.appendChild(err);
      }
    }

    await refresh();
  }

  async function mountStudentMeetingReviewsSection({
    host,
    studentId,
    enrollments = [],
  }) {
    const safeStudentId = parseUuid(studentId);
    if (!host || !safeStudentId) return;
    host.replaceChildren();

    try {
      const meetings = await fetchAllConfirmedMeetings({ studentId: safeStudentId });
      const pastMeetings = meetings.filter(
        (row) => row.scheduled_starts_at && new Date(row.scheduled_starts_at) <= new Date(),
      );

      if (!pastMeetings.length) {
        host.hidden = true;
        return;
      }

      const section = document.createElement("section");
      section.className = "mentor-panel-card student-meeting-reviews-panel";
      const heading = document.createElement("h2");
      heading.className = "mentor-package-section-title";
      heading.textContent = "Görüşme değerlendirmeleri";
      const hint = document.createElement("p");
      hint.className = "profile-hint";
      hint.textContent = "Tamamlanan görüşmelerinizi burada puanlayabilirsiniz.";
      const stack = document.createElement("div");
      stack.className = "student-meeting-schedule-content";

      pastMeetings.forEach((proposal) => {
        const enrollment = enrollments.find(
          (row) => row.mentor_id === proposal.mentor_id && row.package_id === proposal.package_id,
        );
        stack.appendChild(
          createStudentMeetingReviewCard(proposal, {
            mentorName: enrollment?.mentor_display_name || "",
            packageTitle: enrollment?.package_title || "",
          }),
        );
      });

      section.append(heading, hint, stack);
      host.appendChild(section);
      host.hidden = false;
    } catch (error) {
      console.error("student meeting reviews:", error);
      const err = document.createElement("p");
      err.className = "student-meeting-schedule-empty";
      err.textContent = "Görüşme değerlendirmeleri yüklenemedi.";
      host.appendChild(err);
      host.hidden = false;
    }
  }

  window.RekabetliMentorMeetingProposals = {
    mountMentorScheduleSection,
    mountStudentScheduleSection,
    mountStudentMeetingReviewsSection,
    mountUpcomingMeetingsBox,
    mountAllMeetingsCalendar,
    fetchStudentConfirmedMeetings,
    fetchUpcomingConfirmedMeetings,
    fetchAllConfirmedMeetings,
    renderPlannedMeetingsList,
    renderUpcomingMeetingsBox,
    renderMeetingsCalendar,
    createPlannedMeetingCard,
    clearUpcomingMeetingsRefresh,
  };
})();
