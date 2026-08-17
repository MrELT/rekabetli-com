(function initAdminPanel() {
  const supabase = window.getSupabase?.() || window.sb;
  if (!supabase) {
    window.location.href = "/";
    return;
  }

  const messageEl = document.getElementById("admin-message");
  const mentorApplicationsBody = document.getElementById("admin-mentor-applications-body");
  const vitrinReviewsBody = document.getElementById("admin-vitrin-reviews-body");
  const mentorshipRequestsBody = document.getElementById("admin-mentorship-requests-body");
  const usersBody = document.getElementById("admin-users-body");
  const communitiesBody = document.getElementById("admin-communities-body");

  const countApplications = document.getElementById("admin-count-applications");
  const countVitrinReviews = document.getElementById("admin-count-vitrin-reviews");
  const countRequests = document.getElementById("admin-count-requests");
  const countUsers = document.getElementById("admin-count-users");
  const countCommunities = document.getElementById("admin-count-communities");
  const countCampaignJobs = document.getElementById("admin-count-campaign-jobs");
  const countPanelErrorReports = document.getElementById("admin-count-panel-error-reports");
  const countContentReports = document.getElementById("admin-count-content-reports");
  const countRefunds = document.getElementById("admin-count-refunds");
  const countPayouts = document.getElementById("admin-count-payouts");
  const countPackageSales = document.getElementById("admin-count-package-sales");
  const refundsBody = document.getElementById("admin-refunds-body");
  const payoutsBody = document.getElementById("admin-payouts-body");
  const packageSalesBody = document.getElementById("admin-package-sales-body");
  const packageSalesSummary = document.getElementById("admin-package-sales-summary");
  const packageSalesCountTotal = document.getElementById("admin-package-sales-count-total");
  const packageSalesAmountTotal = document.getElementById("admin-package-sales-amount-total");
  const packageSalesCommissionTotal = document.getElementById("admin-package-sales-commission-total");
  const packageSalesPanelTotal = document.getElementById("admin-package-sales-panel-total");
  const packageSalesMeetingTotal = document.getElementById("admin-package-sales-meeting-total");
  const packageSalesReviewTotal = document.getElementById("admin-package-sales-review-total");
  const panelErrorReportsBody = document.getElementById("admin-panel-error-reports-body");
  const contentReportsBody = document.getElementById("admin-content-reports-body");
  const adminNavButtons = document.querySelectorAll("[data-admin-section].admin-nav-btn");
  const adminSectionViews = document.querySelectorAll(".admin-section-view");
  const adminSectionTitle = document.getElementById("admin-section-title");
  const adminSectionDesc = document.getElementById("admin-section-desc");
  const campaignMailForm = document.getElementById("admin-campaign-mail-form");
  const campaignMailSubmitBtn = document.getElementById("admin-campaign-mail-submit");
  const campaignMailMessage = document.getElementById("admin-campaign-mail-message");
  const campaignJobsBody = document.getElementById("admin-campaign-jobs-body");
  const campaignRecipientsBody = document.getElementById("admin-campaign-recipients-body");
  const campaignSelectedCount = document.getElementById("campaign-selected-count");
  const campaignSelectAllBtn = document.getElementById("campaign-select-all-btn");
  const campaignClearSelectionBtn = document.getElementById("campaign-clear-selection-btn");

  const mentorAssignModal = document.getElementById("admin-mentor-assign-modal");
  const mentorAssignForm = document.getElementById("admin-mentor-assign-form");
  const mentorAssignCloseBtn = document.getElementById("close-admin-mentor-assign-modal");
  const mentorAssignCommunityLabel = document.getElementById("admin-mentor-assign-community");
  const mentorSelect = document.getElementById("admin-mentor-select");
  const mentorAssignSubmitBtn = document.getElementById("admin-mentor-assign-submit");
  const mentorAssignMessage = document.getElementById("admin-mentor-assign-message");

  let mentorsCache = [];
  let selectedCommunityForMentorAssign = null;
  let usersCache = [];
  let selectedCampaignRecipientIds = new Set();

  function setMessage(text, isError = false) {
    if (!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.classList.toggle("profile-message-error", Boolean(isError));
  }

  function formatDate(isoDate) {
    if (!isoDate) return "-";
    return new Date(isoDate).toLocaleString("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function createCell(text) {
    const td = document.createElement("td");
    td.textContent = text;
    return td;
  }

  function setCampaignMailMessage(text, isError = false) {
    if (!campaignMailMessage) return;
    if (!text) {
      campaignMailMessage.hidden = true;
      campaignMailMessage.textContent = "";
      campaignMailMessage.classList.remove("is-error");
      return;
    }
    campaignMailMessage.hidden = false;
    campaignMailMessage.textContent = text;
    campaignMailMessage.classList.toggle("is-error", Boolean(isError));
  }

  function updateCampaignSelectedCount() {
    if (!campaignSelectedCount) return;
    campaignSelectedCount.textContent = `Seçilen üye: ${selectedCampaignRecipientIds.size}`;
  }

  function renderCampaignRecipients() {
    campaignRecipientsBody?.replaceChildren();
    if (!campaignRecipientsBody || !usersCache.length) {
      if (campaignRecipientsBody) clearTable(campaignRecipientsBody, "Üye listesi bulunamadı.", 3);
      updateCampaignSelectedCount();
      return;
    }

    usersCache.forEach((row) => {
      const tr = document.createElement("tr");

      const selectTd = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedCampaignRecipientIds.has(row.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedCampaignRecipientIds.add(row.id);
        } else {
          selectedCampaignRecipientIds.delete(row.id);
        }
        updateCampaignSelectedCount();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      tr.appendChild(createCell(row.display_name?.trim() || "Kullanıcı"));
      tr.appendChild(createCell(row.email?.trim() || "-"));
      campaignRecipientsBody.appendChild(tr);
    });

    updateCampaignSelectedCount();
  }

  function setMentorAssignMessage(text, isError = false) {
    if (!mentorAssignMessage) return;
    if (!text) {
      mentorAssignMessage.hidden = true;
      mentorAssignMessage.textContent = "";
      mentorAssignMessage.classList.remove("is-error");
      return;
    }
    mentorAssignMessage.hidden = false;
    mentorAssignMessage.textContent = text;
    mentorAssignMessage.classList.toggle("is-error", Boolean(isError));
  }

  const ADMIN_SECTIONS = {
    "mentor-applications": {
      title: "Mentör Başvuruları",
      desc: "Yeni mentör başvurularını inceleyin ve durumlarını takip edin.",
    },
    "mentor-vitrin-reviews": {
      title: "Mentör Vitrin İstekleri",
      desc: "Mentörlerin vitrin sayfası yayın taleplerini inceleyin, onaylayın veya reddedin.",
    },
    "mentorship-requests": {
      title: "Mentörlük Talepleri",
      desc: "Mentörlük talep formlarını ve başvuru durumlarını görüntüleyin.",
    },
    users: {
      title: "Kullanıcılar",
      desc: "Kayıtlı kullanıcıları yönetin ve mentör yetkisi verin.",
    },
    communities: {
      title: "Topluluklar",
      desc: "Toplulukları görüntüleyin ve gizli topluluklara mentör ekleyin.",
    },
    "package-sales": {
      title: "Satılan Paketler",
      desc: "Tamamlanan paket satışlarını, panel kaydını, ilk görüşmeyi ve varsa görüşme yorumunu görüntüleyin.",
    },
    "package-refunds": {
      title: "Paket İade Talepleri",
      desc: "Öğrenci iade taleplerini onaylayıp Stripe üzerinden iade başlatın.",
    },
    "mentor-payouts": {
      title: "Mentör Ödemeleri",
      desc: "Wise transfer taleplerini izleyin ve gerekirse yeniden deneyin.",
    },
    "influencer-program": {
      title: "Influencer Programı",
      desc: "Influencer başvurularını onaylayın; davet linkleri ve kayıt sayıları burada yönetilir.",
    },
    "campaign-mails": {
      title: "Fırsat Maili Gönderimi",
      desc: "Seçili üyelere toplu kampanya e-postası gönderin.",
    },
    "panel-error-reports": {
      title: "Hata Bildirimleri",
      desc: "Mentör, danışman ve influencer panellerinden gönderilen hata bildirimlerini inceleyin.",
    },
    "content-reports": {
      title: "İçerik Raporları",
      desc: "Gönderi ve yorum raporlarını inceleyin; gerekirse içeriği kaldırın.",
    },
  };

  function isKnownAdminSection(sectionId) {
    return Boolean(ADMIN_SECTIONS[sectionId]);
  }

  function resolveInitialAdminSection() {
    const hash = window.location.hash.replace("#", "").trim();
    return isKnownAdminSection(hash) ? hash : "mentor-applications";
  }

  function showAdminSection(sectionId, { updateHash = true } = {}) {
    const resolved = isKnownAdminSection(sectionId) ? sectionId : "mentor-applications";
    const meta = ADMIN_SECTIONS[resolved];

    adminSectionViews.forEach((view) => {
      const isActive = view.dataset.adminSection === resolved;
      view.hidden = !isActive;
      view.classList.toggle("is-active", isActive);
    });

    adminNavButtons.forEach((btn) => {
      const isActive = btn.dataset.adminSection === resolved;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-current", isActive ? "page" : "false");
    });

    if (adminSectionTitle) adminSectionTitle.textContent = meta.title;
    if (adminSectionDesc) adminSectionDesc.textContent = meta.desc;

    if (updateHash && window.location.hash.replace("#", "") !== resolved) {
      window.location.hash = resolved;
    }
  }

  function setupAdminNav() {
    adminNavButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const sectionId = btn.dataset.adminSection;
        if (sectionId) showAdminSection(sectionId);
      });
    });

    window.addEventListener("hashchange", () => {
      showAdminSection(resolveInitialAdminSection(), { updateHash: false });
    });

    showAdminSection(resolveInitialAdminSection(), { updateHash: false });
  }

  function clearTable(body, emptyMessage, colSpan = 6) {
    if (!body) return;
    body.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = colSpan;
    cell.className = "empty";
    cell.textContent = emptyMessage;
    row.appendChild(cell);
    body.appendChild(row);
  }

  async function ensureAdminAccess() {
    const auth = window.RekabetliAuth;
    const state = auth ? await auth.whenReady() : { user: null };
    const user = state.user;

    if (!user) {
      window.location.href = "/login?redirect=%2Fadmin";
      return null;
    }

    const { data, error } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !data) {
      window.location.href = "/";
      return null;
    }

    return user;
  }

  async function loadMentorApplications() {
    const { data, error } = await supabase
      .from("mentor_applications")
      .select("id, first_name, last_name, email, mentoring_branches, weekly_sessions, status, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("mentor applications:", error.message);
      if (countApplications) countApplications.textContent = "0";
      if (mentorApplicationsBody) clearTable(mentorApplicationsBody, "Başvurular yüklenemedi.", 6);
      throw error;
    }
    const rows = data ?? [];
    if (countApplications) countApplications.textContent = String(rows.length);

    mentorApplicationsBody?.replaceChildren();
    if (!mentorApplicationsBody || !rows.length) {
      if (mentorApplicationsBody) clearTable(mentorApplicationsBody, "Henüz başvuru yok.", 6);
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.appendChild(createCell(`${row.first_name || ""} ${row.last_name || ""}`.trim() || "-"));
      tr.appendChild(createCell(row.email || "-"));
      tr.appendChild(createCell((row.mentoring_branches || []).join(", ") || "-"));
      tr.appendChild(createCell(String(row.weekly_sessions ?? "-")));
      tr.appendChild(createCell(row.status || "-"));
      tr.appendChild(createCell(formatDate(row.created_at)));
      mentorApplicationsBody.appendChild(tr);
    });
  }

  function vitrinReviewStatusLabel(status) {
    const value = String(status || "draft").trim().toLowerCase();
    if (value === "pending") return "İnceleniyor";
    if (value === "approved") return "Onaylandı";
    if (value === "rejected") return "Reddedildi";
    return "Taslak";
  }

  async function setMentorVitrinReview(mentorId, status, note = null) {
    setMessage("");
    const { error } = await supabase.rpc("admin_set_mentor_vitrin_review", {
      p_mentor_id: mentorId,
      p_status: status,
      p_note: note,
    });
    if (error) throw error;
  }

  async function loadMentorVitrinReviews() {
    const { data: pages, error: pagesError } = await supabase
      .from("mentor_pages")
      .select(
        "user_id, vitrin_review_status, vitrin_submitted_at, vitrin_reviewed_at, vitrin_review_note, updated_at",
      )
      .in("vitrin_review_status", ["pending", "rejected", "approved"])
      .order("vitrin_submitted_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (pagesError) throw pagesError;

    const pageRows = (pages ?? []).filter((row) => row.vitrin_review_status !== "draft");
    const pendingCount = pageRows.filter((row) => row.vitrin_review_status === "pending").length;
    if (countVitrinReviews) countVitrinReviews.textContent = String(pendingCount);

    vitrinReviewsBody?.replaceChildren();
    if (!vitrinReviewsBody || !pageRows.length) {
      if (vitrinReviewsBody) clearTable(vitrinReviewsBody, "Henüz vitrin isteği yok.", 5);
      return;
    }

    const userIds = pageRows.map((row) => row.user_id);
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", userIds);

    if (profilesError) throw profilesError;

    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

    pageRows.forEach((row) => {
      const profile = profileById.get(row.user_id);
      const tr = document.createElement("tr");
      tr.appendChild(createCell(profile?.display_name?.trim() || "Mentör"));
      tr.appendChild(createCell(profile?.email?.trim() || "-"));
      tr.appendChild(createCell(vitrinReviewStatusLabel(row.vitrin_review_status)));
      tr.appendChild(
        createCell(formatDate(row.vitrin_submitted_at || row.updated_at)),
      );

      const actionsTd = document.createElement("td");
      actionsTd.className = "admin-table-actions";

      const previewLink = document.createElement("a");
      previewLink.className = "secondary admin-table-btn";
      previewLink.href = `/mentor?id=${encodeURIComponent(row.user_id)}&adminPreview=1`;
      previewLink.target = "_blank";
      previewLink.rel = "noopener noreferrer";
      previewLink.textContent = "Görüntüle";
      actionsTd.appendChild(previewLink);

      if (row.vitrin_review_status === "pending") {
        const approveBtn = document.createElement("button");
        approveBtn.type = "button";
        approveBtn.className = "admin-table-btn";
        approveBtn.textContent = "Onayla";
        approveBtn.addEventListener("click", async () => {
          try {
            approveBtn.disabled = true;
            await setMentorVitrinReview(row.user_id, "approved");
            setMessage("Vitrin sayfası onaylandı.");
            await loadMentorVitrinReviews();
          } catch (err) {
            console.error("vitrin approve:", err?.message || err);
            setMessage("Onaylama başarısız.", true);
            approveBtn.disabled = false;
          }
        });

        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "secondary admin-table-btn";
        rejectBtn.textContent = "Reddet";
        rejectBtn.addEventListener("click", async () => {
          const note = window.prompt("Red gerekçesi (mentöre iletilecek):");
          if (note === null) return;
          const trimmed = note.trim();
          if (!trimmed) {
            setMessage("Red gerekçesi zorunludur.", true);
            return;
          }
          try {
            rejectBtn.disabled = true;
            await setMentorVitrinReview(row.user_id, "rejected", trimmed);
            setMessage("Vitrin isteği reddedildi.");
            await loadMentorVitrinReviews();
          } catch (err) {
            console.error("vitrin reject:", err?.message || err);
            setMessage("Reddetme başarısız.", true);
            rejectBtn.disabled = false;
          }
        });

        actionsTd.append(approveBtn, rejectBtn);
      } else if (row.vitrin_review_note?.trim()) {
        const note = document.createElement("span");
        note.className = "admin-inline-note";
        note.textContent = row.vitrin_review_note.trim();
        actionsTd.appendChild(note);
      }

      tr.appendChild(actionsTd);
      vitrinReviewsBody.appendChild(tr);
    });
  }

  async function loadMentorshipRequests() {
    const { data, error } = await supabase
      .from("mentorship_requests")
      .select("id, first_name, last_name, email, requested_branches, monthly_sessions, status, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;
    const rows = data ?? [];
    if (countRequests) countRequests.textContent = String(rows.length);

    mentorshipRequestsBody?.replaceChildren();
    if (!mentorshipRequestsBody || !rows.length) {
      if (mentorshipRequestsBody) clearTable(mentorshipRequestsBody, "Henüz talep yok.", 6);
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.appendChild(createCell(`${row.first_name || ""} ${row.last_name || ""}`.trim() || "-"));
      tr.appendChild(createCell(row.email || "-"));
      tr.appendChild(createCell((row.requested_branches || []).join(", ") || "-"));
      tr.appendChild(createCell(String(row.monthly_sessions ?? "-")));
      tr.appendChild(createCell(row.status || "-"));
      tr.appendChild(createCell(formatDate(row.created_at)));
      mentorshipRequestsBody.appendChild(tr);
    });
  }

  async function updateMentorStatus(userId, isMentor) {
    setMessage("");
    const { error } = await supabase.rpc("set_user_mentor_status", {
      target_user_id: userId,
      mentor_status: isMentor,
    });
    if (error) throw error;
  }

  async function loadUsers() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, email, user_type, is_mentor")
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) throw error;
    const rows = (data ?? []).filter((row) => row?.id && row?.email);
    usersCache = rows;
    if (countUsers) countUsers.textContent = String(rows.length);

    usersBody?.replaceChildren();
    if (!usersBody || !rows.length) {
      if (usersBody) clearTable(usersBody, "Henüz kullanıcı yok.", 5);
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.appendChild(createCell(row.display_name?.trim() || "Kullanıcı"));
      tr.appendChild(createCell(row.email?.trim() || "-"));
      tr.appendChild(createCell(row.user_type?.trim() || "-"));
      tr.appendChild(createCell(row.is_mentor ? "Evet" : "Hayır"));

      const actionTd = document.createElement("td");
      const button = document.createElement("button");
      button.type = "button";
      button.className = row.is_mentor ? "secondary" : "nav-btn nav-btn-primary";
      button.textContent = row.is_mentor ? "Mentörlüğü Kaldır" : "Mentör Yap";
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          await updateMentorStatus(row.id, !row.is_mentor);
          setMessage("Mentör durumu güncellendi.");
          await loadUsers();
        } catch (err) {
          console.error("Mentor status update error:", err);
          setMessage("Mentör durumu güncellenemedi.", true);
        } finally {
          button.disabled = false;
        }
      });
      actionTd.appendChild(button);
      tr.appendChild(actionTd);

      usersBody.appendChild(tr);
    });

    renderCampaignRecipients();
  }

  async function loadMentorsCache() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, email, is_mentor")
      .eq("is_mentor", true)
      .order("display_name", { ascending: true })
      .limit(500);

    if (error) throw error;
    mentorsCache = data ?? [];
  }

  function openMentorAssignModal(community) {
    if (!mentorAssignModal || !mentorAssignForm || !mentorSelect) return;
    selectedCommunityForMentorAssign = community;
    mentorAssignForm.reset();
    setMentorAssignMessage("");
    mentorAssignCommunityLabel.textContent = `${community.name} (Gizli)`;
    mentorSelect.replaceChildren();

    const initial = document.createElement("option");
    initial.value = "";
    initial.textContent = "Mentör seçin";
    initial.disabled = true;
    initial.selected = true;
    mentorSelect.appendChild(initial);

    mentorsCache.forEach((mentor) => {
      const option = document.createElement("option");
      option.value = mentor.id;
      const displayName = mentor.display_name?.trim() || "Kullanıcı";
      const email = mentor.email?.trim() ? ` · ${mentor.email.trim()}` : "";
      option.textContent = `${displayName}${email}`;
      mentorSelect.appendChild(option);
    });

    mentorAssignModal.hidden = false;
    document.body.classList.add("question-modal-open");
  }

  function closeMentorAssignModal() {
    if (!mentorAssignModal) return;
    mentorAssignModal.hidden = true;
    document.body.classList.remove("question-modal-open");
    selectedCommunityForMentorAssign = null;
    setMentorAssignMessage("");
  }

  async function forceAddMentorToCommunity(communityId, mentorId) {
    const { error } = await supabase.rpc("admin_add_mentor_to_private_community", {
      target_community_id: communityId,
      mentor_user_id: mentorId,
    });
    if (error) throw error;
  }

  async function loadCommunities() {
    const { data, error } = await supabase
      .from("communities")
      .select("id, name, visibility, owner_id, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;
    const rows = data ?? [];
    if (countCommunities) countCommunities.textContent = String(rows.length);

    const ownerIds = [...new Set(rows.map((row) => row.owner_id).filter(Boolean))];
    const ownerById = new Map();

    if (ownerIds.length > 0) {
      const { data: owners, error: ownersError } = await supabase
        .from("profiles")
        .select("id, display_name, email")
        .in("id", ownerIds);
      if (ownersError) throw ownersError;
      (owners ?? []).forEach((owner) => ownerById.set(owner.id, owner));
    }

    communitiesBody?.replaceChildren();
    if (!communitiesBody || !rows.length) {
      if (communitiesBody) clearTable(communitiesBody, "Henüz topluluk yok.", 5);
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.appendChild(createCell(row.name || "-"));
      tr.appendChild(createCell(row.visibility === "private" ? "Gizli" : "Açık"));

      const owner = ownerById.get(row.owner_id);
      const ownerName = owner?.display_name?.trim() || owner?.email?.trim() || row.owner_id || "-";
      tr.appendChild(createCell(ownerName));
      tr.appendChild(createCell(formatDate(row.created_at)));

      const actionTd = document.createElement("td");
      if (row.visibility === "private") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "nav-btn nav-btn-primary";
        button.textContent = "Mentör Ekle";
        button.addEventListener("click", async () => {
          try {
            if (!mentorsCache.length) {
              await loadMentorsCache();
            }
            if (!mentorsCache.length) {
              setMessage("Sistemde mentor olarak işaretlenmiş kullanıcı bulunamadı.", true);
              return;
            }
            openMentorAssignModal({ id: row.id, name: row.name || "Topluluk" });
          } catch (err) {
            console.error("Mentor list load error:", err);
            setMessage("Mentör listesi yüklenemedi.", true);
          }
        });
        actionTd.appendChild(button);
      } else {
        actionTd.textContent = "-";
      }

      tr.appendChild(actionTd);
      communitiesBody.appendChild(tr);
    });
  }

  async function loadCampaignJobs() {
    const { data, error } = await supabase
      .from("campaign_mail_jobs")
      .select("id, subject, status, sent_count, failed_count, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    const rows = data ?? [];
    if (countCampaignJobs) countCampaignJobs.textContent = String(rows.length);

    campaignJobsBody?.replaceChildren();
    if (!campaignJobsBody || !rows.length) {
      if (campaignJobsBody) clearTable(campaignJobsBody, "Henüz kampanya gönderimi yok.", 5);
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.appendChild(createCell(formatDate(row.created_at)));
      tr.appendChild(createCell(row.subject || "-"));
      tr.appendChild(createCell(row.status || "-"));
      tr.appendChild(createCell(String(row.sent_count ?? 0)));
      tr.appendChild(createCell(String(row.failed_count ?? 0)));
      campaignJobsBody.appendChild(tr);
    });
  }

  async function sendCampaignMailFromPanel(payload) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
    }

    const functionUrl = `${window.__ENV__?.SUPABASE_URL}/functions/v1/send-campaign-email`;
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) {
      throw new Error(result?.error || "Kampanya gönderimi başarısız oldu.");
    }
    return result;
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

  function formatIban(iban) {
    const compact = String(iban || "").replace(/\s+/g, "").toUpperCase();
    if (!compact) return "—";
    return compact.replace(/(.{4})/g, "$1 ").trim();
  }

  function mapPayoutStatus(status) {
    const map = {
      pending: "Beklemede",
      processing: "İşleniyor",
      completed: "Ödendi",
      rejected: "Reddedildi",
      canceled: "İptal",
    };
    return map[String(status || "")] || String(status || "—");
  }

  async function processPackageRefund(orderId) {
    const { data, error } = await supabase.functions.invoke("process-package-refund", {
      body: { orderId },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.message || data.error);
    return data;
  }

  async function readSupabaseFunctionResult(result) {
    const { data, error } = result || {};
    if (!error) {
      return {
        data,
        errorCode: data?.error ? String(data.error) : null,
        errorMessage: data?.message ? String(data.message) : null,
      };
    }

    let payload = data;
    if (!payload && error?.context && typeof error.context.json === "function") {
      try {
        payload = await error.context.json();
      } catch {
        payload = null;
      }
    }

    return {
      data: payload,
      errorCode: payload?.error ? String(payload.error) : null,
      errorMessage: payload?.message
        ? String(payload.message)
        : error?.message
          ? String(error.message)
          : null,
    };
  }

  async function processMentorPayout(requestId) {
    const { data, error } = await supabase.functions.invoke("process-mentor-payout", {
      body: { requestId },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.message || data.error);
    return data;
  }

  async function processInfluencerPayout(requestId) {
    const { data, error } = await supabase.functions.invoke("process-influencer-payout", {
      body: { requestId },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.message || data.error);
    return data;
  }

  async function downloadAdminPayoutInvoice(requestId) {
    const result = await supabase.functions.invoke("get-mentor-payout-invoice", {
      body: { requestId },
    });
    const parsed = await readSupabaseFunctionResult(result);
    if (parsed.errorCode || result.error) {
      throw new Error(parsed.errorMessage || "Gider pusulası indirilemedi.");
    }
    const url = parsed.data?.signed_url;
    if (!url) throw new Error("Gider pusulası bağlantısı alınamadı.");
    window.open(url, "_blank", "noopener,noreferrer");
    return parsed.data;
  }

  async function loadInfluencerApplications() {
    const body = document.getElementById("admin-influencers-body");
    const countEl = document.getElementById("admin-count-influencers");
    if (!body) return;

    const { data, error } = await supabase.rpc("admin_list_influencer_applications");
    if (error) {
      clearTable(body, "Influencer listesi yüklenemedi.", 6);
      if (countEl) countEl.textContent = "0";
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    if (countEl) countEl.textContent = String(rows.filter((r) => r.status === "pending").length);

    body.replaceChildren();
    if (!rows.length) {
      clearTable(body, "Henüz influencer kaydı yok.", 6);
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const userCell = document.createElement("td");
      const nameStrong = document.createElement("strong");
      nameStrong.textContent = row.display_name || "—";
      userCell.appendChild(nameStrong);
      userCell.appendChild(document.createElement("br"));
      const userHint = document.createElement("span");
      userHint.className = "profile-hint";
      userHint.textContent = row.email || row.user_id || "";
      userCell.appendChild(userHint);
      tr.appendChild(userCell);

      const platformText = [row.social_platform, row.social_handle].filter(Boolean).join(" · ") || "—";
      tr.appendChild(createCell(platformText));
      tr.appendChild(createCell(row.status || "—"));
      tr.appendChild(createCell(row.referral_code || "—"));

      const noteCell = document.createElement("td");
      const noteParts = [
        row.follower_range ? `Takipçi: ${row.follower_range}` : "",
        row.application_note || "",
        row.contact_email ? `E-posta: ${row.contact_email}` : "",
      ].filter(Boolean);
      noteCell.textContent = noteParts.join(" — ") || formatDate(row.created_at);
      noteCell.title = noteParts.join("\n");
      tr.appendChild(noteCell);

      const actionTd = document.createElement("td");
      if (row.status === "pending") {
        const approveBtn = document.createElement("button");
        approveBtn.type = "button";
        approveBtn.className = "secondary";
        approveBtn.textContent = "Onayla";
        approveBtn.addEventListener("click", async () => {
          approveBtn.disabled = true;
          const { error: statusError } = await supabase.rpc("admin_set_influencer_status", {
            p_user_id: row.user_id,
            p_status: "approved",
            p_display_label: row.display_label || row.display_name || "",
          });
          if (statusError) {
            setMessage(statusError.message, true);
            approveBtn.disabled = false;
            return;
          }
          setMessage("Influencer onaylandı.");
          await loadInfluencerApplications();
        });
        actionTd.appendChild(approveBtn);

        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "secondary";
        rejectBtn.textContent = "Reddet";
        rejectBtn.style.marginLeft = "0.35rem";
        rejectBtn.addEventListener("click", async () => {
          const confirmed = await window.rekabetliConfirm?.({
            title: "Başvuruyu reddet",
            message: `${row.display_name || "Kullanıcı"} başvurusu reddedilsin mi?`,
            confirmLabel: "Reddet",
          });
          if (!confirmed) return;
          rejectBtn.disabled = true;
          const { error: statusError } = await supabase.rpc("admin_set_influencer_status", {
            p_user_id: row.user_id,
            p_status: "rejected",
            p_display_label: row.display_label || row.display_name || "",
          });
          if (statusError) {
            setMessage(statusError.message, true);
            rejectBtn.disabled = false;
            return;
          }
          setMessage("Başvuru reddedildi.");
          await loadInfluencerApplications();
        });
        actionTd.appendChild(rejectBtn);
      } else {
        actionTd.textContent = "—";
      }
      tr.appendChild(actionTd);
      body.appendChild(tr);
    });
  }

  const influencerAddForm = document.getElementById("admin-influencer-add-form");
  influencerAddForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const userId = document.getElementById("admin-influencer-user-id")?.value?.trim();
    const label = document.getElementById("admin-influencer-label")?.value?.trim() || "";
    if (!userId) return;

    const { error } = await supabase.rpc("admin_create_influencer_application", {
      p_user_id: userId,
      p_display_label: label,
    });
    if (error) {
      setMessage(error.message, true);
      return;
    }
    setMessage("Influencer başvurusu oluşturuldu.");
    influencerAddForm.reset();
    await loadInfluencerApplications();
  });

  function mapPackageSaleStatus(status) {
    const map = {
      paid: "Ödendi",
      refunded: "İade edildi",
    };
    return map[String(status || "")] || String(status || "—");
  }

  function createSaleFlagCell(label, tone) {
    const td = document.createElement("td");
    const flag = document.createElement("span");
    flag.className = `admin-sale-flag admin-sale-flag--${tone || "muted"}`;
    flag.textContent = label;
    td.appendChild(flag);
    return td;
  }

  function meetingHasPassed(isoDate) {
    if (!isoDate) return false;
    const at = new Date(isoDate);
    return Number.isFinite(at.getTime()) && at.getTime() <= Date.now();
  }

  function mapPackageSaleMeeting(row) {
    const status = String(row.meeting_status || "none");
    if (status === "none") {
      return { label: "Planlanmadı", tone: "warn" };
    }
    if (status === "pending") {
      return { label: "Teklif bekliyor", tone: "warn" };
    }
    if (status === "responded") {
      return { label: "Saat seçildi", tone: "warn" };
    }
    if (status === "postpone_pending") {
      return { label: "Erteleme bekliyor", tone: "warn" };
    }
    if (status === "cancelled") {
      return { label: "İptal", tone: "muted" };
    }
    if (status === "refunded") {
      return { label: "İade", tone: "muted" };
    }
    if (status === "confirmed") {
      const when = formatDate(row.meeting_at);
      if (meetingHasPassed(row.meeting_at)) {
        return { label: when === "-" ? "Yapıldı" : `Yapıldı · ${when}`, tone: "ok" };
      }
      return { label: when === "-" ? "Onaylı" : `Onaylı · ${when}`, tone: "ok" };
    }
    return { label: status, tone: "muted" };
  }

  function createSaleReviewCell(row) {
    const td = document.createElement("td");
    const rating = Number(row.review_rating);
    const hasReview = Number.isFinite(rating) && rating >= 1;
    if (hasReview) {
      const wrap = document.createElement("div");
      wrap.className = "admin-sale-review";
      const score = document.createElement("strong");
      score.className = "admin-sale-review-score";
      score.textContent = `${rating}/5`;
      wrap.appendChild(score);
      const comment = String(row.review_comment || "").trim();
      if (comment) {
        const note = document.createElement("span");
        note.className = "admin-sale-review-comment";
        note.textContent = comment;
        note.title = comment;
        wrap.appendChild(note);
      }
      td.appendChild(wrap);
      return td;
    }

    const meetingDone =
      String(row.meeting_status || "") === "confirmed" && meetingHasPassed(row.meeting_at);
    td.textContent = meetingDone ? "Yok" : "—";
    td.className = meetingDone ? "admin-sale-review-empty" : "";
    return td;
  }

  async function loadPackageSales() {
    if (!packageSalesBody) return;

    const { data, error } = await supabase.rpc("get_admin_package_sales");
    if (error) {
      console.error("package sales load:", error.message);
      clearTable(packageSalesBody, "Satışlar yüklenemedi.", 10);
      if (countPackageSales) countPackageSales.textContent = "0";
      if (packageSalesSummary) packageSalesSummary.hidden = true;
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    const paidRows = rows.filter((row) => row.order_status === "paid");
    if (countPackageSales) countPackageSales.textContent = String(paidRows.length);

    let totalGross = 0;
    let totalCommission = 0;
    let inPanelCount = 0;
    let meetingConfirmedCount = 0;
    let reviewCount = 0;
    paidRows.forEach((row) => {
      totalGross += Number(row.amount_paid ?? row.list_price) || 0;
      totalCommission += Number(row.platform_fee) || 0;
      if (row.in_panel) inPanelCount += 1;
      if (String(row.meeting_status || "") === "confirmed") meetingConfirmedCount += 1;
      if (Number(row.review_rating) >= 1) reviewCount += 1;
    });

    if (packageSalesSummary) {
      packageSalesSummary.hidden = !paidRows.length;
      if (packageSalesCountTotal) packageSalesCountTotal.textContent = String(paidRows.length);
      if (packageSalesAmountTotal) packageSalesAmountTotal.textContent = formatTryMoney(totalGross);
      if (packageSalesCommissionTotal) {
        packageSalesCommissionTotal.textContent = formatTryMoney(totalCommission);
      }
      if (packageSalesPanelTotal) {
        packageSalesPanelTotal.textContent = paidRows.length
          ? `${inPanelCount} / ${paidRows.length}`
          : "—";
      }
      if (packageSalesMeetingTotal) {
        packageSalesMeetingTotal.textContent = paidRows.length
          ? `${meetingConfirmedCount} / ${paidRows.length}`
          : "—";
      }
      if (packageSalesReviewTotal) {
        packageSalesReviewTotal.textContent = paidRows.length
          ? `${reviewCount} / ${paidRows.length}`
          : "—";
      }
    }

    packageSalesBody.replaceChildren();
    if (!rows.length) {
      clearTable(packageSalesBody, "Henüz satılan paket yok.", 10);
      return;
    }

    rows.forEach((row) => {
      const saleAmount = row.amount_paid ?? row.list_price;
      const commission = Number(row.platform_fee);
      const commissionLabel = Number.isFinite(commission)
        ? formatTryMoney(commission)
        : "—";
      const meeting = mapPackageSaleMeeting(row);
      const panelTone = row.in_panel ? "ok" : row.unenrolled_at ? "muted" : "bad";
      const panelLabel = row.in_panel ? "Panelde" : row.unenrolled_at ? "Çıkarıldı" : "Yok";

      const tr = document.createElement("tr");
      tr.appendChild(createCell(formatDate(row.paid_at || row.created_at)));
      tr.appendChild(createCell(row.mentor_name || "Mentör"));
      tr.appendChild(createCell(row.student_name || "Öğrenci"));
      tr.appendChild(createCell(row.package_title || "—"));
      tr.appendChild(createCell(formatTryMoney(saleAmount)));
      tr.appendChild(createCell(commissionLabel));
      tr.appendChild(createCell(mapPackageSaleStatus(row.order_status)));
      tr.appendChild(createSaleFlagCell(panelLabel, panelTone));
      tr.appendChild(createSaleFlagCell(meeting.label, meeting.tone));
      tr.appendChild(createSaleReviewCell(row));
      packageSalesBody.appendChild(tr);
    });
  }

  async function loadRefundQueue() {
    if (!refundsBody) return;

    const { data, error } = await supabase.rpc("get_admin_refund_queue");
    if (error) {
      clearTable(refundsBody, "İade kuyruğu yüklenemedi.", 6);
      if (countRefunds) countRefunds.textContent = "0";
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    if (countRefunds) countRefunds.textContent = String(rows.length);
    refundsBody.replaceChildren();

    if (!rows.length) {
      clearTable(refundsBody, "Bekleyen iade talebi yok.", 6);
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.appendChild(createCell(row.student_name || "—"));
      tr.appendChild(createCell(row.mentor_name || "—"));
      tr.appendChild(createCell(row.package_title || "—"));
      const paid = formatTryMoney(row.amount_paid);
      const refundNet = formatTryMoney(row.refund_amount);
      const fee = Number(row.stripe_fee_retained) || 0;
      tr.appendChild(
        createCell(
          fee > 0
            ? `${paid} → ${refundNet} (−${formatTryMoney(fee)} komisyon)`
            : paid,
        ),
      );
      tr.appendChild(createCell(formatDate(row.refund_requested_at)));

      const actionTd = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary";
      btn.textContent = "Stripe iadesi";
      btn.addEventListener("click", async () => {
        const refundNet = formatTryMoney(row.refund_amount);
        const fee = Number(row.stripe_fee_retained) || 0;
        const feeNote =
          fee > 0 ? ` Ödeme sistemi komisyonu ${formatTryMoney(fee)} düşülerek` : "";
        const confirmed = await window.rekabetliConfirm?.({
          title: "İade onayı",
          message: `${row.student_name} için${feeNote} ${refundNet} tutarında Stripe iadesi başlatılsın mı? (Ödenen: ${formatTryMoney(row.amount_paid)})`,
          confirmLabel: "İade et",
        });
        if (!confirmed) return;

        btn.disabled = true;
        try {
          await processPackageRefund(row.id);
          setMessage("İade başarıyla işlendi.");
          await loadRefundQueue();
        } catch (err) {
          console.error("process-package-refund:", err);
          setMessage(err?.message || "İade işlenemedi.", true);
          btn.disabled = false;
        }
      });
      actionTd.appendChild(btn);
      tr.appendChild(actionTd);
      refundsBody.appendChild(tr);
    });
  }

  async function loadPayoutQueue() {
    if (!payoutsBody) return;

    const { data, error } = await supabase.rpc("get_admin_payout_queue");
    if (error) {
      clearTable(payoutsBody, "Ödeme kuyruğu yüklenemedi.", 10);
      if (countPayouts) countPayouts.textContent = "0";
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    if (countPayouts) countPayouts.textContent = String(rows.length);
    payoutsBody.replaceChildren();

    if (!rows.length) {
      clearTable(payoutsBody, "Ödeme talebi yok.", 10);
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const payoutType = row.payout_type === "influencer" ? "Influencer" : "Mentör";
      const recipientLabel = row.recipient_name || row.mentor_name || "—";
      tr.appendChild(createCell(`${payoutType}: ${recipientLabel}`));
      tr.appendChild(createCell(formatTryMoney(row.amount_requested)));
      tr.appendChild(createCell(formatTryMoney(row.transfer_fee)));
      tr.appendChild(createCell(formatTryMoney(row.amount_net)));
      tr.appendChild(createCell(row.account_holder || "—"));
      tr.appendChild(createCell(row.bank_name || "—"));
      const ibanCell = createCell(formatIban(row.iban));
      ibanCell.className = "admin-iban-cell";
      tr.appendChild(ibanCell);
      const statusParts = [mapPayoutStatus(row.status)];
      if (row.failure_reason) statusParts.push(row.failure_reason);
      if (row.wise_transfer_id) statusParts.push(`#${row.wise_transfer_id}`);
      if (row.invoice_number) statusParts.push(row.invoice_number);
      tr.appendChild(createCell(statusParts.join(" · ")));
      tr.appendChild(createCell(formatDate(row.created_at)));

      const actionTd = document.createElement("td");
      if (["pending", "processing"].includes(row.status)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "secondary";
        btn.textContent = row.status === "processing" ? "Yeniden dene" : "Wise gönder";
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            if (row.payout_type === "influencer") {
              await processInfluencerPayout(row.id);
            } else {
              await processMentorPayout(row.id);
            }
            setMessage("Wise transferi başlatıldı.");
            await loadPayoutQueue();
          } catch (err) {
            console.error("process-payout:", err);
            setMessage(err?.message || "Wise transferi başarısız.", true);
            btn.disabled = false;
            await loadPayoutQueue();
          }
        });
        actionTd.appendChild(btn);
      } else if (row.status === "completed" && row.payout_type !== "influencer") {
        const invoiceBtn = document.createElement("button");
        invoiceBtn.type = "button";
        invoiceBtn.className = "secondary";
        invoiceBtn.textContent = row.has_self_billed_invoice ? "Gider pusulası" : "Pusula oluştur";
        invoiceBtn.addEventListener("click", async () => {
          invoiceBtn.disabled = true;
          try {
            const data = await downloadAdminPayoutInvoice(row.id);
            setMessage(
              data?.invoice_number
                ? `Gider pusulası açıldı: ${data.invoice_number}`
                : "Gider pusulası açıldı.",
            );
            await loadPayoutQueue();
          } catch (err) {
            console.error("get-mentor-payout-invoice:", err);
            setMessage(err?.message || "Gider pusulası indirilemedi.", true);
            invoiceBtn.disabled = false;
          }
        });
        actionTd.appendChild(invoiceBtn);
      } else {
        actionTd.textContent = "—";
      }
      tr.appendChild(actionTd);
      payoutsBody.appendChild(tr);
    });
  }

  function panelErrorRoleLabel(role) {
    const value = String(role || "").trim().toLowerCase();
    if (value === "mentor") return "Mentör";
    if (value === "student") return "Danışman";
    if (value === "influencer") return "Influencer";
    return value || "—";
  }

  async function loadPanelErrorReports() {
    const { data, error } = await supabase.rpc("get_admin_panel_error_reports");
    if (error) {
      console.error("panel error reports:", error.message);
      if (countPanelErrorReports) countPanelErrorReports.textContent = "0";
      if (panelErrorReportsBody) {
        clearTable(panelErrorReportsBody, "Hata bildirimleri yüklenemedi.", 6);
      }
      throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    if (countPanelErrorReports) countPanelErrorReports.textContent = String(rows.length);

    panelErrorReportsBody?.replaceChildren();
    if (!panelErrorReportsBody) return;

    if (!rows.length) {
      clearTable(panelErrorReportsBody, "Henüz hata bildirimi yok.", 6);
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.appendChild(createCell(formatDate(row.created_at)));
      tr.appendChild(createCell(row.reporter_name?.trim() || "Kullanıcı"));
      tr.appendChild(createCell(row.reporter_email?.trim() || "—"));
      tr.appendChild(createCell(panelErrorRoleLabel(row.panel_role)));

      const codeTd = createCell(row.error_code?.trim() || "—");
      codeTd.className = "panel-error-code-cell";
      tr.appendChild(codeTd);

      const descTd = document.createElement("td");
      descTd.className = "panel-error-desc-cell";
      descTd.textContent = row.description?.trim() || "—";
      tr.appendChild(descTd);

      panelErrorReportsBody.appendChild(tr);
    });
  }

  function contentReportStatusLabel(status) {
    if (status === "pending") return "Bekliyor";
    if (status === "removed") return "Kaldırıldı";
    if (status === "dismissed") return "Reddedildi";
    return status || "—";
  }

  async function resolveContentReport(reportId, action) {
    const { error } = await supabase.rpc("admin_resolve_content_report", {
      p_report_id: reportId,
      p_action: action,
    });
    if (error) throw error;
  }

  async function loadContentReports() {
    const { data, error } = await supabase.rpc("get_admin_content_reports");
    if (error) {
      console.error("content reports:", error.message);
      if (countContentReports) countContentReports.textContent = "0";
      if (contentReportsBody) {
        clearTable(contentReportsBody, "İçerik raporları yüklenemedi.", 8);
      }
      throw error;
    }

    const rows = Array.isArray(data) ? data : [];
    const pendingCount = rows.filter((row) => row.status === "pending").length;
    if (countContentReports) countContentReports.textContent = String(pendingCount);

    contentReportsBody?.replaceChildren();
    if (!contentReportsBody) return;

    if (!rows.length) {
      clearTable(contentReportsBody, "Henüz içerik raporu yok.", 8);
      return;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.appendChild(createCell(formatDate(row.created_at)));
      tr.appendChild(createCell(contentReportStatusLabel(row.status)));
      tr.appendChild(
        createCell(row.target_type === "comment" ? "Yorum" : "Gönderi"),
      );
      tr.appendChild(
        createCell(
          `${row.reporter_name?.trim() || "Kullanıcı"}${
            row.reporter_email ? ` (${row.reporter_email})` : ""
          }`,
        ),
      );

      const targetTd = document.createElement("td");
      const author = row.target_author_name?.trim() || "Kullanıcı";
      const community = row.community_name?.trim();
      targetTd.textContent = community ? `${author} · ${community}` : author;
      tr.appendChild(targetTd);

      const snippetTd = document.createElement("td");
      snippetTd.className = "panel-error-desc-cell";
      snippetTd.textContent = row.target_snippet?.trim() || "—";
      tr.appendChild(snippetTd);

      const reasonTd = document.createElement("td");
      reasonTd.className = "panel-error-desc-cell";
      reasonTd.textContent = row.reason?.trim() || "—";
      tr.appendChild(reasonTd);

      const actionsTd = document.createElement("td");
      actionsTd.className = "admin-table-actions";

      if (row.community_id && row.post_id && row.status === "pending") {
        const link = document.createElement("a");
        link.className = "secondary admin-table-btn";
        link.href = `/community?id=${encodeURIComponent(row.community_id)}&post=${encodeURIComponent(row.post_id)}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Gör";
        actionsTd.appendChild(link);
      }

      if (row.status === "pending") {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "admin-table-btn";
        removeBtn.textContent = "Kaldır";
        removeBtn.addEventListener("click", async () => {
          const ok = window.confirm(
            "İçerik kalıcı olarak silinecek ve raporlayan bilgilendirilecek. Devam?",
          );
          if (!ok) return;
          try {
            removeBtn.disabled = true;
            await resolveContentReport(row.id, "remove");
            setMessage("İçerik kaldırıldı; raporlayan bilgilendirildi.");
            await loadContentReports();
          } catch (err) {
            console.error("content report remove:", err?.message || err);
            setMessage("Kaldırma başarısız.", true);
            removeBtn.disabled = false;
          }
        });

        const dismissBtn = document.createElement("button");
        dismissBtn.type = "button";
        dismissBtn.className = "secondary admin-table-btn";
        dismissBtn.textContent = "Reddet";
        dismissBtn.addEventListener("click", async () => {
          try {
            dismissBtn.disabled = true;
            await resolveContentReport(row.id, "dismiss");
            setMessage("Rapor reddedildi.");
            await loadContentReports();
          } catch (err) {
            console.error("content report dismiss:", err?.message || err);
            setMessage("Reddetme başarısız.", true);
            dismissBtn.disabled = false;
          }
        });

        actionsTd.append(removeBtn, dismissBtn);
      } else {
        actionsTd.appendChild(document.createTextNode("—"));
      }

      tr.appendChild(actionsTd);
      contentReportsBody.appendChild(tr);
    });
  }

  async function bootstrapAdminPanel() {
    try {
      const adminUser = await ensureAdminAccess();
      if (!adminUser) return;

      setMessage("Yükleniyor...");
      const tasks = [
        ["Mentör başvuruları", loadMentorApplications],
        ["Vitrin istekleri", loadMentorVitrinReviews],
        ["Mentörlük talepleri", loadMentorshipRequests],
        ["Kullanıcılar", loadUsers],
        ["Topluluklar", loadCommunities],
        ["Kampanya mailleri", loadCampaignJobs],
        ["Paket satışları", loadPackageSales],
        ["İade kuyruğu", loadRefundQueue],
        ["Ödeme kuyruğu", loadPayoutQueue],
        ["Influencer", loadInfluencerApplications],
        ["Hata bildirimleri", loadPanelErrorReports],
        ["İçerik raporları", loadContentReports],
      ];

      const results = await Promise.allSettled(tasks.map(([, fn]) => fn()));
      const failures = [];
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const label = tasks[index][0];
          const reason = result.reason;
          const detail =
            reason?.message ||
            reason?.error_description ||
            reason?.details ||
            String(reason || "bilinmeyen hata");
          console.error(`Admin load failed: ${label}`, reason);
          failures.push(`${label}: ${detail}`);
        }
      });

      if (failures.length) {
        setMessage(
          `Bazı bölümler yüklenemedi (${failures.length}). ${failures[0]}`,
          true,
        );
      } else {
        setMessage("");
      }
    } catch (error) {
      console.error("Admin panel load error:", error);
      setMessage(
        `Admin paneli yüklenemedi: ${error?.message || "SQL yetkilerini kontrol edin."}`,
        true,
      );
    }
  }

  mentorAssignCloseBtn?.addEventListener("click", closeMentorAssignModal);
  mentorAssignModal?.addEventListener("click", (event) => {
    if (event.target === mentorAssignModal) closeMentorAssignModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mentorAssignModal && !mentorAssignModal.hidden) {
      closeMentorAssignModal();
    }
  });

  mentorAssignForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedCommunityForMentorAssign?.id) return;

    const mentorId = mentorSelect?.value;
    if (!mentorId) {
      setMentorAssignMessage("Lütfen bir mentör seçin.", true);
      return;
    }

    if (mentorAssignSubmitBtn) mentorAssignSubmitBtn.disabled = true;
    setMentorAssignMessage("");
    try {
      await forceAddMentorToCommunity(selectedCommunityForMentorAssign.id, mentorId);
      setMessage("Mentör gizli topluluğa doğrudan eklendi.");
      closeMentorAssignModal();
      await loadCommunities();
    } catch (err) {
      console.error("Admin add mentor to private community error:", err);
      setMentorAssignMessage("Mentör topluluğa eklenemedi.", true);
    } finally {
      if (mentorAssignSubmitBtn) mentorAssignSubmitBtn.disabled = false;
    }
  });

  campaignMailForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!campaignMailForm) return;
    setCampaignMailMessage("");

    const formData = new FormData(campaignMailForm);
    const subject = String(formData.get("subject") || "").trim();
    const preview = String(formData.get("preview") || "").trim();
    const buttonLabel = String(formData.get("buttonLabel") || "").trim();
    const buttonUrl = String(formData.get("buttonUrl") || "").trim();
    const plainMessage = String(formData.get("plainMessage") || "").trim();

    if (!subject || !preview || !buttonLabel || !buttonUrl || !plainMessage) {
      setCampaignMailMessage("Lütfen tüm alanları doldurun.", true);
      return;
    }
    if (!selectedCampaignRecipientIds.size) {
      setCampaignMailMessage("Lütfen en az bir üye seçin.", true);
      return;
    }

    if (campaignMailSubmitBtn) campaignMailSubmitBtn.disabled = true;
    try {
      const result = await sendCampaignMailFromPanel({
        subject,
        preview,
        buttonLabel,
        buttonUrl,
        plainMessage,
        recipientUserIds: Array.from(selectedCampaignRecipientIds),
      });
      setCampaignMailMessage(
        `Gönderim tamamlandı. Başarılı: ${result.sentCount ?? 0}, Hata: ${result.failedCount ?? 0}`
      );
      await loadCampaignJobs();
    } catch (error) {
      console.error("Campaign send error:", error);
      setCampaignMailMessage(error?.message || "Kampanya gönderimi başarısız.", true);
    } finally {
      if (campaignMailSubmitBtn) campaignMailSubmitBtn.disabled = false;
    }
  });

  campaignSelectAllBtn?.addEventListener("click", () => {
    selectedCampaignRecipientIds = new Set(usersCache.map((row) => row.id));
    renderCampaignRecipients();
  });

  campaignClearSelectionBtn?.addEventListener("click", () => {
    selectedCampaignRecipientIds.clear();
    renderCampaignRecipients();
  });

  setupAdminNav();
  void bootstrapAdminPanel();
})();
