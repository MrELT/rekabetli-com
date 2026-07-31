(function initStudentPanelPage() {
  const supabase = window.getSupabase?.() || window.sb;
  if (!supabase) return;

  const statusEl = document.getElementById("ogrenci-sayfam-status");
  const mentorsListEl = document.getElementById("student-mentors-list");
  const upcomingMeetingsHost = document.getElementById("student-upcoming-meetings-host");
  const allMeetingsCalendarHost = document.getElementById("student-all-meetings-calendar-host");
  const meetingReviewsTopHost = document.getElementById("student-meeting-reviews-host-top");
  const meetingReviewsBottomHost = document.getElementById("student-meeting-reviews-host-bottom");
  const subnavEl = document.getElementById("student-enrollment-subnav");
  const panelsRoot = document.getElementById("student-enrollment-panels");

  const ENROLLMENT_PREFIX = "kayit-";
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  let currentUser = null;
  let enrollments = [];
  let enrollmentsAccordionOpen = true;
  let showPanel = () => {};
  let meetingReviewsAtBottom = false;

  function setStatus(text) {
    if (!statusEl) return;
    if (!text) {
      statusEl.hidden = true;
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
  }

  function enrollmentPanelId(enrollmentId) {
    return `${ENROLLMENT_PREFIX}${enrollmentId}`;
  }

  function parseEnrollmentPanelId(panelId) {
    const raw = String(panelId || "");
    if (!raw.startsWith(ENROLLMENT_PREFIX)) return null;
    const enrollmentId = raw.slice(ENROLLMENT_PREFIX.length);
    if (!UUID_RE.test(enrollmentId)) return null;
    return enrollmentId;
  }

  function isKnownPanelId(panelId) {
    if (
      panelId === "profil" ||
      panelId === "mentorlerim" ||
      panelId === "cuzdanim" ||
      panelId === "hata-bildir"
    ) {
      return true;
    }
    return Boolean(parseEnrollmentPanelId(panelId));
  }

  function isEnrollmentPanel(panelId) {
    return Boolean(parseEnrollmentPanelId(panelId));
  }

  function findEnrollment(enrollmentId) {
    return enrollments.find((row) => row.enrollment_id === enrollmentId) || null;
  }

  async function loadEnrollments() {
    const { data, error } = await supabase.rpc("get_student_enrolled_packages");
    if (error) throw error;
    enrollments = Array.isArray(data) ? data : [];
    return enrollments;
  }

  async function loadEnrollmentsWithRetry({ targetEnrollmentId = null, maxAttempts = 8 } = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await loadEnrollments();
      if (!targetEnrollmentId || findEnrollment(targetEnrollmentId)) {
        return enrollments;
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
    }
    return enrollments;
  }

  function createEnrollmentSubnavButton(row) {
    const panelId = enrollmentPanelId(row.enrollment_id);
    const labelText = `${row.mentor_display_name || "Mentör"} · ${row.package_title || "Paket"}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mentor-panel-nav-btn mentor-panel-nav-btn--sub";
    btn.dataset.studentPanel = panelId;
    btn.dataset.enrollmentId = row.enrollment_id;
    btn.dataset.mentorId = row.mentor_id;
    btn.setAttribute("aria-current", "false");

    const label = document.createElement("span");
    label.className = "mentor-panel-subnav-label";
    label.textContent = labelText;
    label.title = labelText;

    const countBadge = document.createElement("span");
    countBadge.className = "mentor-panel-subnav-count";
    countBadge.hidden = true;
    countBadge.setAttribute("aria-label", "Okunmamış bildirim");

    btn.append(label, countBadge);

    const statusBadge = createEnrollmentStatusBadge(row);
    if (statusBadge) btn.appendChild(statusBadge);

    return btn;
  }

  function ensureMentorlerimNavCountEl() {
    const parentBtn = document.querySelector('[data-student-panel="mentorlerim"]');
    if (!parentBtn) return null;

    let badge = parentBtn.querySelector(".mentor-panel-nav-unread-count");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "mentor-panel-subnav-count mentor-panel-nav-unread-count";
      badge.hidden = true;
      badge.setAttribute("aria-label", "Okunmamış bildirim");
      parentBtn.appendChild(badge);
    }
    return badge;
  }

  async function refreshStudentPanelNotificationBadges() {
    const api = window.RekabetliStudentPanelNotifications;
    if (!currentUser?.id || !api) return;

    const total = await api.countUnreadTotal(currentUser.id);
    const parentBadge = ensureMentorlerimNavCountEl();
    if (parentBadge) {
      if (total > 0) {
        parentBadge.hidden = false;
        parentBadge.textContent = total > 9 ? "9+" : String(total);
      } else {
        parentBadge.hidden = true;
      }
    }

    const subButtons = document.querySelectorAll(
      ".mentor-panel-nav-btn--sub[data-enrollment-id]",
    );
    for (const btn of subButtons) {
      const count = await api.countUnreadForEnrollment({
        enrollmentId: btn.dataset.enrollmentId,
        mentorId: btn.dataset.mentorId,
        userId: currentUser.id,
      });
      const badge = btn.querySelector(".mentor-panel-subnav-count");
      if (!badge) continue;
      if (count > 0) {
        badge.hidden = false;
        badge.textContent = count > 9 ? "9+" : String(count);
      } else {
        badge.hidden = true;
      }
    }
  }

  function createEnrollmentListCard(row) {
    const panelId = enrollmentPanelId(row.enrollment_id);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "student-mentor-card";
    card.dataset.studentPanel = panelId;

    const head = document.createElement("div");
    head.className = "student-mentor-card-head";

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "mentor-package-students-avatar student-mentor-card-avatar";
    const img = document.createElement("img");
    img.className = "mentor-package-students-avatar-img";
    img.alt = "";
    img.hidden = true;
    const fallback = document.createElement("span");
    fallback.className = "mentor-package-students-avatar-fallback";
    fallback.textContent = "?";
    avatarWrap.append(img, fallback);

    if (window.RekabetliAvatars?.applyUserAvatar) {
      window.RekabetliAvatars.applyUserAvatar({
        imgEl: img,
        fallbackEl: fallback,
        avatarUrl: row.mentor_avatar_url,
        displayName: row.mentor_display_name,
        seed: row.mentor_id,
      });
    }

    const body = document.createElement("div");
    body.className = "student-mentor-card-body";

    const mentorName = document.createElement("p");
    mentorName.className = "student-mentor-card-mentor";
    mentorName.textContent = row.mentor_display_name || "Mentör";

    const packageName = document.createElement("p");
    packageName.className = "student-mentor-card-package";
    packageName.textContent = row.package_title || "Paket";

    const meta = document.createElement("p");
    meta.className = "student-mentor-card-meta";
    meta.textContent = row.enrolled_at
      ? `Kayıt: ${new Date(row.enrolled_at).toLocaleDateString("tr-TR")}`
      : "Pakete kayıtlı";

    const statusLabel = getEnrollmentStatusLabel(row);

    if (getEnrollmentAccessStatus(row) === "refunded") {
      card.classList.add("student-mentor-card--refunded");
    }

    body.append(mentorName, packageName, meta);

    if (statusLabel) {
      const status = document.createElement("p");
      status.className = "student-mentor-card-status";
      status.textContent = statusLabel;
      body.appendChild(status);
    }
    head.append(avatarWrap, body);
    card.appendChild(head);
    return card;
  }

  function createEnrollmentPanelSection(row) {
    const panelId = enrollmentPanelId(row.enrollment_id);
    const title = `${row.mentor_display_name || "Mentör"} — ${row.package_title || "Paket"}`;

    const section = document.createElement("section");
    section.id = `student-panel-${panelId}`;
    section.className = "mentor-panel-view student-enrollment-view";
    section.dataset.studentPanelView = panelId;
    section.hidden = true;
    section.setAttribute("aria-label", title);

    const main = document.createElement("main");
    main.className = "mentor-panel-grid-layout";

    const grid = document.createElement("div");
    grid.className = "mentor-panel-grid";

    const panel = document.createElement("section");
    panel.className = "mentor-panel-card mentor-panel-card--span-full student-enrollment-panel";

    const heading = document.createElement("h1");
    heading.className = "student-enrollment-page-title";
    heading.textContent = title;

    const hint = document.createElement("p");
    hint.className = "profile-hint student-enrollment-hint";
    hint.textContent = "Mentörünüzle mesajlaşın ve size atanan görevleri buradan takip edin.";

    const root = document.createElement("div");
    root.id = `student-enrollment-root-${row.enrollment_id}`;
    root.className = "student-enrollment-root";

    panel.append(heading, hint, root);
    grid.appendChild(panel);
    main.appendChild(grid);
    section.appendChild(main);
    return section;
  }

  function renderMentorsList() {
    if (!mentorsListEl) return;
    mentorsListEl.replaceChildren();

    if (!enrollments.length) {
      const empty = document.createElement("p");
      empty.className = "mentor-inbox-empty";
      empty.textContent =
        "Henüz bir mentör paketine kayıtlı değilsiniz. Mentörünüz sizi kod ile eklediğinde burada görünür.";
      mentorsListEl.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "student-mentors-list-grid";
    enrollments.forEach((row) => {
      list.appendChild(createEnrollmentListCard(row));
    });
    mentorsListEl.appendChild(list);
  }

  function openStudentMeeting(meeting) {
    if (!meeting) return;
    const enrollment =
      enrollments.find(
        (row) =>
          row.mentor_id === meeting.mentor_id && row.package_id === meeting.package_id,
      ) ||
      (meeting.enrollmentId
        ? enrollments.find((row) => row.enrollment_id === meeting.enrollmentId)
        : null);
    if (!enrollment) return;
    showPanel(enrollmentPanelId(enrollment.enrollment_id), { updateHash: true });
  }

  async function renderUpcomingMeetings() {
    if (!upcomingMeetingsHost || !currentUser) return;

    if (!window.RekabetliMentorMeetingProposals?.mountUpcomingMeetingsBox) {
      upcomingMeetingsHost.hidden = true;
      return;
    }

    await window.RekabetliMentorMeetingProposals.mountUpcomingMeetingsBox(upcomingMeetingsHost, {
      studentId: currentUser.id,
      perspective: "student",
      enrollments,
      onOpenMeeting: openStudentMeeting,
    });
  }

  async function renderAllMeetingsCalendar() {
    if (!allMeetingsCalendarHost || !currentUser) return;

    if (!window.RekabetliMentorMeetingProposals?.mountAllMeetingsCalendar) {
      allMeetingsCalendarHost.hidden = true;
      return;
    }

    await window.RekabetliMentorMeetingProposals.mountAllMeetingsCalendar(allMeetingsCalendarHost, {
      studentId: currentUser.id,
      perspective: "student",
      enrollments,
      onOpenMeeting: openStudentMeeting,
    });
  }

  async function renderMeetingReviews() {
    if (!meetingReviewsTopHost || !meetingReviewsBottomHost || !currentUser) return;
    if (!window.RekabetliMentorMeetingProposals?.mountStudentMeetingReviewsSection) {
      meetingReviewsTopHost.hidden = true;
      meetingReviewsBottomHost.hidden = true;
      return;
    }

    const activeHost = meetingReviewsAtBottom ? meetingReviewsBottomHost : meetingReviewsTopHost;
    const inactiveHost = meetingReviewsAtBottom ? meetingReviewsTopHost : meetingReviewsBottomHost;
    inactiveHost.replaceChildren();
    inactiveHost.hidden = true;

    await window.RekabetliMentorMeetingProposals.mountStudentMeetingReviewsSection({
      host: activeHost,
      studentId: currentUser.id,
      enrollments,
    });

    if (!meetingReviewsAtBottom) {
      const panel = activeHost.querySelector(".student-meeting-reviews-panel");
      if (panel) {
        panel.querySelector(".student-meeting-reviews-dismiss")?.remove();
        const dismissBtn = document.createElement("button");
        dismissBtn.type = "button";
        dismissBtn.className = "student-meeting-reviews-dismiss";
        dismissBtn.setAttribute("aria-label", "Değerlendirme kutusunu alta taşı");
        dismissBtn.textContent = "×";
        dismissBtn.addEventListener("click", () => {
          meetingReviewsAtBottom = true;
          void renderMeetingReviews();
        });
        panel.appendChild(dismissBtn);
      }
    }
  }

  function formatTryMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function formatWalletDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleString("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function getEnrollmentAccessStatus(row) {
    if (!row) return "active";
    if (row.order_status === "refunded" || row.unenrolled_at) return "refunded";
    if (row.refund_requested_at) return "refund_pending";
    return "active";
  }

  function getEnrollmentStatusLabel(row) {
    const status = getEnrollmentAccessStatus(row);
    if (status === "refunded") return "İade edildi";
    if (status === "refund_pending") return "İade talebi alındı";
    return "";
  }

  function createEnrollmentStatusBadge(row) {
    const label = getEnrollmentStatusLabel(row);
    if (!label) return null;

    const badge = document.createElement("span");
    badge.className = "enrollment-status-badge";
    if (getEnrollmentAccessStatus(row) === "refunded") {
      badge.classList.add("enrollment-status-badge--refunded");
    } else {
      badge.classList.add("enrollment-status-badge--pending");
    }
    badge.textContent = label;
    return badge;
  }

  function renderRefundedEnrollmentNotice(root, {
    title,
    subtitle,
    refundedAt = null,
    refundAmount = null,
  }) {
    root.replaceChildren();

    const panel = document.createElement("div");
    panel.className = "enrollment-refunded-panel";

    const badge = document.createElement("p");
    badge.className = "enrollment-status-badge enrollment-status-badge--refunded enrollment-status-badge--large";
    badge.textContent = "İade edildi";

    const heading = document.createElement("h2");
    heading.className = "enrollment-refunded-title";
    heading.textContent = title;

    const copy = document.createElement("p");
    copy.className = "profile-hint enrollment-refunded-copy";
    copy.textContent =
      subtitle
      || "Bu paket için iade işlemi tamamlandı. Paket erişiminiz kapatıldı; mesaj ve görüşme planlama kullanılamaz.";

    panel.append(badge, heading, copy);

    if (refundedAt) {
      const when = document.createElement("p");
      when.className = "profile-hint enrollment-refunded-meta";
      when.textContent = `İade tarihi: ${formatWalletDate(refundedAt)}`;
      panel.appendChild(when);
    }

    if (Number.isFinite(Number(refundAmount)) && Number(refundAmount) > 0) {
      const amount = document.createElement("p");
      amount.className = "profile-hint enrollment-refunded-meta";
      amount.textContent = `İade edilen tutar: ${formatTryMoney(refundAmount)}`;
      panel.appendChild(amount);
    }

    root.appendChild(panel);
  }

  function getOrderStatusLabel(order) {
    if (order.status === "refunded") return "İade edildi";
    if (order.refund_requested_at) return "İade talebi alındı";
    return "Ödendi";
  }

  function getOrderInvoiceUrl(order) {
    const hosted = String(order?.stripe_hosted_invoice_url || "").trim();
    const pdf = String(order?.stripe_invoice_pdf_url || "").trim();
    if (/^https:\/\//i.test(hosted)) return hosted;
    if (/^https:\/\//i.test(pdf)) return pdf;
    return null;
  }

  function mountStudentOrderInvoiceAction(item, order, actionsEl = null) {
    const invoiceUrl = getOrderInvoiceUrl(order);
    if (!invoiceUrl) return;

    const link = document.createElement("a");
    link.href = invoiceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "secondary student-wallet-invoice-btn";
    link.textContent = "Faturayı görüntüle";

    if (actionsEl) {
      actionsEl.insertBefore(link, actionsEl.firstChild);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "student-wallet-transaction-actions";
    wrap.appendChild(link);
    item.appendChild(wrap);
  }

  async function loadStudentWallet() {
    const { data, error } = await supabase.rpc("get_my_package_orders");
    if (error) {
      console.error("get_my_package_orders:", error.message);
      return null;
    }
    return data;
  }

  function renderStudentWallet(summary) {
    const totalEl = document.getElementById("student-wallet-total-spent");
    const statsEl = document.getElementById("student-wallet-stats");
    const emptyEl = document.getElementById("student-wallet-empty");
    const listEl = document.getElementById("student-wallet-transactions");
    const orders = Array.isArray(summary?.orders) ? summary.orders : [];
    const refundWindowDays = Number(summary?.refund_window_days) || 14;

    if (totalEl) totalEl.textContent = formatTryMoney(summary?.total_spent);

    if (statsEl) {
      statsEl.hidden = false;
      statsEl.replaceChildren();
      const items = [
        { label: "Satın alma", value: String(summary?.purchase_count || 0) },
        { label: "İade süresi", value: `${refundWindowDays} gün` },
      ];
      items.forEach((item) => {
        const chip = document.createElement("div");
        chip.className = "mentor-wallet-stat";
        const label = document.createElement("span");
        label.className = "mentor-wallet-stat-label";
        label.textContent = item.label;
        const value = document.createElement("strong");
        value.className = "mentor-wallet-stat-value";
        value.textContent = item.value;
        chip.append(label, value);
        statsEl.appendChild(chip);
      });
    }

    if (!emptyEl || !listEl) return;

    listEl.replaceChildren();
    if (!orders.length) {
      emptyEl.hidden = false;
      listEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    listEl.hidden = false;

    orders.forEach((order) => {
      const item = document.createElement("li");
      item.className = "mentor-wallet-transaction student-wallet-transaction";

      const head = document.createElement("div");
      head.className = "mentor-wallet-transaction-head";

      const title = document.createElement("p");
      title.className = "mentor-wallet-transaction-title";
      title.textContent = order.is_renewal
        ? `Paket yenilemesi · ${order.package_title || "Paket"}`
        : order.package_title || "Paket satın alımı";

      const amount = document.createElement("p");
      amount.className = "mentor-wallet-transaction-net";
      const amountPaid = Number(order.amount_paid) || 0;
      const creditApplied = Number(order.referral_credit_applied) || 0;
      const priceText =
        creditApplied > 0
          ? `${formatTryMoney(amountPaid)} (${formatTryMoney(creditApplied)} davet indirimi)`
          : formatTryMoney(amountPaid);
      amount.textContent = priceText;

      head.append(title, amount);

      const meta = document.createElement("p");
      meta.className = "mentor-wallet-transaction-meta";
      meta.textContent = `${order.mentor_name || "Mentör"} · ${formatWalletDate(order.paid_at || order.created_at)}`;

      const status = document.createElement("p");
      status.className = "student-wallet-order-status";
      const statusLabel = getOrderStatusLabel(order);
      status.textContent = statusLabel;
      if (order.status === "refunded") {
        status.classList.add("is-refunded");
      } else if (order.refund_requested_at) {
        status.classList.add("is-refund-pending");
      }

      item.append(head, meta, status);

      if (order.status === "refunded") {
        const refundedNet = Number(order.refunded_amount);
        const refundedFee = Number(order.refunded_stripe_fee_retained) || 0;
        if (Number.isFinite(refundedNet) && refundedNet > 0) {
          const refundedNote = document.createElement("p");
          refundedNote.className = "profile-hint student-wallet-refund-hint";
          refundedNote.textContent =
            refundedFee > 0
              ? `İade edilen tutar: ${formatTryMoney(refundedNet)} (ödeme sistemi komisyonu ${formatTryMoney(refundedFee)} düşüldü).`
              : `İade edilen tutar: ${formatTryMoney(refundedNet)}.`;
          item.appendChild(refundedNote);
        }
        mountStudentOrderInvoiceAction(item, order);
        listEl.appendChild(item);
        return;
      }

      if (order.refund_requested_at) {
        mountStudentOrderInvoiceAction(item, order);
        listEl.appendChild(item);
        return;
      }

      const paidAt = order.paid_at ? new Date(order.paid_at) : null;
      const windowExpired =
        paidAt && paidAt < new Date(Date.now() - refundWindowDays * 24 * 60 * 60 * 1000);

      if (windowExpired) {
        const expiredNote = document.createElement("p");
        expiredNote.className = "profile-hint student-wallet-refund-hint";
        expiredNote.textContent = `${refundWindowDays} günlük iade süresi doldu.`;
        item.appendChild(expiredNote);
        mountStudentOrderInvoiceAction(item, order);
        listEl.appendChild(item);
        return;
      }

      if (order.refund_eligible) {
        const feeRetained = Number(order.stripe_fee_retained) || 0;
        const refundNet = Number(order.refund_amount) || Number(order.amount_paid);

        const actions = document.createElement("div");
        actions.className = "student-wallet-transaction-actions";

        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "secondary student-wallet-refund-toggle";
        toggleBtn.textContent = "İade oluştur";
        toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn.setAttribute("aria-controls", `student-wallet-refund-${order.id}`);

        const refundBox = document.createElement("div");
        refundBox.id = `student-wallet-refund-${order.id}`;
        refundBox.className = "student-wallet-refund-box";
        refundBox.hidden = true;

        const refundPreview = document.createElement("p");
        refundPreview.className = "profile-hint student-wallet-refund-hint";
        if (feeRetained > 0) {
          refundPreview.textContent =
            `İade gerekçeniz incelenip kabul edilirse kartınıza %100 (${formatTryMoney(order.amount_paid)}) iade edilir. ` +
            `Aksi durumda ${formatTryMoney(refundNet)} iade edilir ve ödeme sistemi komisyonu (${formatTryMoney(feeRetained)}) düşülür. ` +
            "Paket erişiminiz kaldırılır.";
        } else {
          refundPreview.textContent =
            "İade gerekçeniz incelenip kabul edilirse %100 iade yapılır. Aksi durumda ödeme sistemi komisyonu düşülerek iade yapılır. Paket erişiminiz kaldırılır.";
        }

        const noteLabel = document.createElement("label");
        noteLabel.setAttribute("for", `student-wallet-refund-note-${order.id}`);
        noteLabel.textContent = "İade gerekçesi (isteğe bağlı)";
        const noteInput = document.createElement("textarea");
        noteInput.id = `student-wallet-refund-note-${order.id}`;
        noteInput.className = "student-meeting-schedule-note-input";
        noteInput.rows = 2;
        noteInput.maxLength = 500;
        noteInput.placeholder = "İade talebinize eklemek istediğiniz not…";

        const messageEl = document.createElement("p");
        messageEl.className = "profile-message empty student-wallet-refund-message";
        messageEl.setAttribute("role", "status");

        const refundBtn = document.createElement("button");
        refundBtn.type = "button";
        refundBtn.className = "secondary student-wallet-refund-btn";
        refundBtn.textContent = "İade talep et";

        toggleBtn.addEventListener("click", () => {
          const willOpen = refundBox.hidden;
          listEl.querySelectorAll(".student-wallet-refund-box").forEach((panel) => {
            panel.hidden = true;
          });
          listEl.querySelectorAll(".student-wallet-refund-toggle").forEach((btn) => {
            btn.setAttribute("aria-expanded", "false");
            btn.textContent = "İade oluştur";
            btn.classList.remove("is-open");
          });

          if (willOpen) {
            refundBox.hidden = false;
            toggleBtn.setAttribute("aria-expanded", "true");
            toggleBtn.textContent = "Kapat";
            toggleBtn.classList.add("is-open");
            noteInput.focus();
          }
        });

        refundBtn.addEventListener("click", async () => {
          const feeText =
            feeRetained > 0
              ? ` Kartınıza yansıyacak tutar: ${formatTryMoney(refundNet)} (ödeme sistemi komisyonu ${formatTryMoney(feeRetained)} düşülür).`
              : " Ödeme sistemi komisyonu düşülerek iade yapılır.";
          const confirmed = await window.rekabetliConfirm?.({
            title: "İade talebi",
            message: `${order.package_title || "Paket"} için iade talebi oluşturulsun mu? Onay sonrası paket erişiminiz kaldırılır.${feeText}`,
            confirmLabel: "Talep et",
          });
          if (!confirmed) return;

          refundBtn.disabled = true;
          toggleBtn.disabled = true;
          messageEl.textContent = "İade talebi gönderiliyor…";
          messageEl.classList.remove("empty", "profile-message-error");

          const { error: refundError } = await supabase.rpc("request_package_refund", {
            p_order_id: order.id,
            p_note: noteInput.value.trim(),
          });

          refundBtn.disabled = false;
          toggleBtn.disabled = false;

          if (refundError) {
            const msg = refundError.message || "";
            const friendly = msg.includes("package_refund_already_requested")
              ? "İade talebi zaten gönderildi."
              : msg.includes("package_refund_window_expired")
                ? `${refundWindowDays} günlük iade süresi doldu.`
                : `İade talebi gönderilemedi: ${msg}`;
            messageEl.textContent = friendly;
            messageEl.classList.add("profile-message-error");
            return;
          }

          const refreshed = await loadStudentWallet();
          if (refreshed) renderStudentWallet(refreshed);
        });

        refundBox.append(refundPreview, noteLabel, noteInput, refundBtn, messageEl);
        actions.appendChild(toggleBtn);
        mountStudentOrderInvoiceAction(item, order, actions);
        item.append(actions, refundBox);
      } else {
        mountStudentOrderInvoiceAction(item, order);
      }

      listEl.appendChild(item);
    });
  }

  function buildReferralLink(codeOrPath) {
    const raw = String(codeOrPath || "").trim();
    if (!raw) return "";
    if (raw.startsWith("/r/")) {
      return `${window.location.origin.replace(/\/$/, "")}${raw}`;
    }
    const normalized = raw.toUpperCase().replace(/\s+/g, "");
    return `${window.location.origin.replace(/\/$/, "")}/r/${encodeURIComponent(normalized)}`;
  }

  function mapStudentReferralCreditPhase(phase) {
    const map = {
      pending_meeting: "Görüşme bekleniyor",
      pending_hold: "14 gün kilit",
      available: "Kullanılabilir",
      reserved: "Ödeme bekleniyor",
      used: "Kullanıldı",
      revoked: "İptal",
    };
    return map[String(phase || "")] || String(phase || "—");
  }

  function renderStudentReferralWallet(wallet) {
    const balanceWrap = document.getElementById("student-referral-balance");
    const availableEl = document.getElementById("student-referral-available");
    const statsEl = document.getElementById("student-referral-balance-stats");
    const emptyEl = document.getElementById("student-referral-credits-empty");
    const listEl = document.getElementById("student-referral-credits-list");
    if (!balanceWrap || !availableEl) return;

    const available = Number(wallet?.available_balance) || 0;
    const pendingMeeting = Number(wallet?.pending_meeting_balance) || 0;
    const pendingHold = Number(wallet?.pending_hold_balance) || 0;
    const usedTotal = Number(wallet?.used_total) || 0;
    const items = Array.isArray(wallet?.items) ? wallet.items : [];

    balanceWrap.hidden = false;
    availableEl.textContent = formatTryMoney(available);

    if (statsEl) {
      statsEl.replaceChildren();
      const chips = [
        { label: "Görüşme bekleyen", value: formatTryMoney(pendingMeeting) },
        { label: "14 gün bekleyen", value: formatTryMoney(pendingHold) },
        { label: "Kullanılan", value: formatTryMoney(usedTotal) },
      ];
      chips.forEach((chip) => {
        const el = document.createElement("span");
        el.className = "student-referral-balance-stat";
        el.textContent = `${chip.label}: ${chip.value}`;
        statsEl.appendChild(el);
      });
    }

    if (!listEl || !emptyEl) return;
    listEl.replaceChildren();

    if (!items.length) {
      emptyEl.hidden = false;
      listEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    listEl.hidden = false;

    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = `student-referral-credit-item is-${item.phase || "unknown"}`;

      const main = document.createElement("div");
      main.className = "student-referral-credit-main";

      const title = document.createElement("p");
      title.className = "student-referral-credit-title";
      title.textContent = formatTryMoney(item.amount);

      const meta = document.createElement("p");
      meta.className = "student-referral-credit-meta";
      const when =
        item.phase === "pending_hold" && item.activates_at
          ? ` · ${formatWalletDate(item.activates_at)} tarihinde açılır`
          : "";
      meta.textContent =
        `${item.buyer_name || "Davetli"} · ${item.package_title || "Paket"} · ${mapStudentReferralCreditPhase(item.phase)}${when}`;

      main.append(title, meta);
      li.appendChild(main);
      listEl.appendChild(li);
    });
  }

  async function loadStudentReferralWallet() {
    const { data, error } = await supabase.rpc("get_my_student_referral_wallet");
    if (error) {
      console.error("get_my_student_referral_wallet:", error.message);
      return null;
    }
    return data;
  }

  async function loadStudentReferralProgram() {
    const panel = document.getElementById("student-referral-panel");
    const linkInput = document.getElementById("student-referral-link");
    const copyBtn = document.getElementById("student-referral-copy");
    const signupsEl = document.getElementById("student-referral-signups");
    if (!panel || !linkInput) return;

    const { data, error } = await supabase.rpc("get_my_referral_program");
    if (error) {
      console.error("get_my_referral_program:", error.message);
      panel.hidden = true;
      return;
    }
    if (data?.campaign_type === "mentor") {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    linkInput.value = buildReferralLink(data?.code || data?.link_path);
    if (signupsEl) signupsEl.textContent = `${Number(data?.signup_count) || 0} kayıt`;

    const wallet = await loadStudentReferralWallet();
    if (wallet) renderStudentReferralWallet(wallet);

    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = "1";
      copyBtn.addEventListener("click", async () => {
        if (!linkInput.value) return;
        try {
          await navigator.clipboard.writeText(linkInput.value);
        } catch {
          linkInput.select();
          document.execCommand("copy");
        }
      });
    }
  }

  async function mountStudentWallet() {
    const data = await loadStudentWallet();
    if (data) renderStudentWallet(data);
    await loadStudentReferralProgram();
  }

  async function mountEnrollmentView(enrollmentId) {
    const row = findEnrollment(enrollmentId);
    const root = document.getElementById(`student-enrollment-root-${enrollmentId}`);
    if (!row || !root || !currentUser) return;

    if (getEnrollmentAccessStatus(row) === "refunded") {
      renderRefundedEnrollmentNotice(root, {
        title: `${row.mentor_display_name || "Mentör"} · ${row.package_title || "Paket"}`,
        refundedAt: row.refunded_at,
        refundAmount: row.refund_amount,
      });
      return;
    }

    if (!window.RekabetliMentorMessaging?.mountStudentEnrollmentPanel) {
      root.replaceChildren();
      const err = document.createElement("p");
      err.className = "mentor-inbox-empty";
      err.textContent = "Paket görünümü yüklenemedi.";
      root.appendChild(err);
      return;
    }

    await window.RekabetliMentorMessaging.mountStudentEnrollmentPanel({
      root,
      enrollmentId: row.enrollment_id,
      mentorId: row.mentor_id,
      packageId: row.package_id,
      packageTitle: row.package_title,
      mentorName: row.mentor_display_name,
      mentorAvatarUrl: row.mentor_avatar_url,
      studentId: currentUser.id,
      enrolledAt: row.enrolled_at,
      openMessagesOnMount: shouldOpenEnrollmentMessages(),
    });

    if (window.RekabetliStudentPanelNotifications) {
      await window.RekabetliStudentPanelNotifications.markEnrollmentNotificationsRead({
        enrollmentId: row.enrollment_id,
        mentorId: row.mentor_id,
        userId: currentUser.id,
      });
      await refreshStudentPanelNotificationBadges();
      window.rekabetliNotifications?.refresh?.();
    }
  }

  function shouldOpenEnrollmentMessages() {
    const deepLink = window.RekabetliMentorMessaging?.parseStudentMessagingDeepLink?.();
    return Boolean(deepLink?.openMessaging);
  }

  async function renderEnrollmentNavAndPanels() {
    if (!subnavEl || !panelsRoot) return;

    subnavEl.replaceChildren();
    panelsRoot.replaceChildren();

    if (!enrollments.length) {
      const empty = document.createElement("p");
      empty.className = "mentor-panel-subnav-empty";
      empty.textContent = "Henüz mentör yok";
      subnavEl.appendChild(empty);
      subnavEl.hidden = !enrollmentsAccordionOpen;
      return;
    }

    enrollments.forEach((row) => {
      subnavEl.appendChild(createEnrollmentSubnavButton(row));
      panelsRoot.appendChild(createEnrollmentPanelSection(row));
    });

    subnavEl.hidden = !enrollmentsAccordionOpen;
    await refreshStudentPanelNotificationBadges();
  }

  function setEnrollmentsAccordionOpen(open) {
    enrollmentsAccordionOpen = open;
    const navGroup = document.querySelector('[data-student-nav-group="mentorlerim"]');
    const toggleBtn = navGroup?.querySelector('[data-student-accordion-toggle="mentorlerim"]');
    if (subnavEl) subnavEl.hidden = !open;
    navGroup?.classList.toggle("is-open", open);
    toggleBtn?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function resolveInitialPanelId() {
    const hashPanel = window.location.hash.replace("#", "");
    if (isKnownPanelId(hashPanel)) return hashPanel;
    return "mentorlerim";
  }

  function initStudentPanelNav() {
    const nav = document.querySelector(".mentor-panel-nav");
    if (!nav) return;

    showPanel = function showPanelImpl(panelId, { updateHash = true } = {}) {
      const resolvedId = isKnownPanelId(panelId) ? panelId : "mentorlerim";
      const enrollmentId = parseEnrollmentPanelId(resolvedId);
      const isEnrollment = Boolean(enrollmentId);

      document.querySelectorAll("[data-student-panel]").forEach((btn) => {
        const isActive = btn.dataset.studentPanel === resolvedId;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-current", isActive ? "page" : "false");
      });

      document.querySelectorAll(".mentor-panel-nav-btn--sub").forEach((btn) => {
        const isActive = btn.dataset.studentPanel === resolvedId;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-current", isActive ? "page" : "false");
      });

      const navGroup = document.querySelector('[data-student-nav-group="mentorlerim"]');
      if (navGroup) {
        const parentBtn = navGroup.querySelector('[data-student-panel="mentorlerim"]');
        parentBtn?.classList.toggle("is-active", resolvedId === "mentorlerim");
        parentBtn?.classList.toggle("is-active-group", resolvedId === "mentorlerim" || isEnrollment);
        navGroup.classList.toggle("has-active-child", isEnrollment);
      }

      document.querySelectorAll("[data-student-panel-view]").forEach((view) => {
        const isActive = view.dataset.studentPanelView === resolvedId;
        view.hidden = !isActive;
        view.classList.toggle("is-active", isActive);
      });

      if (updateHash) {
        const nextHash = `#${resolvedId}`;
        if (window.location.hash !== nextHash) {
          history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
        }
      }

      if (resolvedId === "mentorlerim" || isEnrollment) {
        setEnrollmentsAccordionOpen(true);
      }

      if (resolvedId === "mentorlerim") {
        void renderUpcomingMeetings();
        void renderAllMeetingsCalendar();
        void renderMeetingReviews();
      }

      if (resolvedId === "cuzdanim") {
        void mountStudentWallet();
      }

      if (isEnrollment && enrollmentId) {
        void mountEnrollmentView(enrollmentId);
      }
    };

    nav.addEventListener("click", (event) => {
      const accordionToggle = event.target.closest("[data-student-accordion-toggle]");
      if (accordionToggle && nav.contains(accordionToggle)) {
        setEnrollmentsAccordionOpen(!enrollmentsAccordionOpen);
        return;
      }

      const btn = event.target.closest("[data-student-panel]");
      if (!btn) return;
      if (nav.contains(btn)) {
        showPanel(btn.dataset.studentPanel);
        return;
      }
    });

    document.addEventListener("click", (event) => {
      const card = event.target.closest(".student-mentor-card[data-student-panel]");
      if (!card) return;
      showPanel(card.dataset.studentPanel);
    });

    window.addEventListener("hashchange", () => {
      const hashPanel = window.location.hash.replace("#", "");
      if (isKnownPanelId(hashPanel)) showPanel(hashPanel, { updateHash: false });
    });
  }

  initStudentPanelNav();

  async function boot() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      window.location.href = `/login?redirect=${encodeURIComponent("/ogrenci-sayfam")}`;
      return;
    }

    currentUser = session.user;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("display_name, is_mentor, user_type")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (profileError) {
      console.error("ogrenci-sayfam profile:", profileError.message);
      setStatus("Profil yüklenemedi.");
      return;
    }

    const canManageMentorPage =
      Boolean(profile?.is_mentor) ||
      String(profile?.user_type || "").trim().toLowerCase() === "mentor";

    if (canManageMentorPage) {
      window.location.replace("/mentor-sayfam");
      return;
    }

    const hashEnrollmentId = parseEnrollmentPanelId(window.location.hash.replace("#", ""));

    try {
      await loadEnrollmentsWithRetry({
        targetEnrollmentId: hashEnrollmentId,
        maxAttempts: hashEnrollmentId ? 8 : 1,
      });
    } catch (error) {
      console.error("student enrollments:", error.message);
      setStatus(
        error.message?.includes("get_student_enrolled_packages")
          ? "Panel için veritabanı kurulumu gerekli."
          : "Kayıtlar yüklenemedi.",
      );
      return;
    }

    setStatus("");
    if (window.RekabetliStudentPanelNotifications) {
      window.RekabetliStudentPanelNotifications.onGlobalRefresh = refreshStudentPanelNotificationBadges;
    }
    await renderEnrollmentNavAndPanels();
    renderMentorsList();
    await renderUpcomingMeetings();
    await renderAllMeetingsCalendar();
    await renderMeetingReviews();

    window.addEventListener("rekabetli:student-open-meeting", (event) => {
      openStudentMeeting(event.detail?.meeting);
    });

    const initialPanel = resolveInitialPanelId();
    showPanel(initialPanel, {
      updateHash: initialPanel !== "mentorlerim" || Boolean(window.location.hash),
    });
  }

  void boot();
})();
