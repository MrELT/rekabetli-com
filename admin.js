(function initAdminPanel() {
  const supabase = window.getSupabase?.() || window.sb;
  if (!supabase) {
    window.location.href = "/";
    return;
  }

  const messageEl = document.getElementById("admin-message");
  const mentorApplicationsBody = document.getElementById("admin-mentor-applications-body");
  const mentorshipRequestsBody = document.getElementById("admin-mentorship-requests-body");
  const usersBody = document.getElementById("admin-users-body");
  const communitiesBody = document.getElementById("admin-communities-body");

  const countApplications = document.getElementById("admin-count-applications");
  const countRequests = document.getElementById("admin-count-requests");
  const countUsers = document.getElementById("admin-count-users");
  const countCommunities = document.getElementById("admin-count-communities");
  const countCampaignJobs = document.getElementById("admin-count-campaign-jobs");
  const accordionSections = document.querySelectorAll(".activity-accordion-section");
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

  function setAccordionOpen(sectionName, isOpen) {
    const section = document.querySelector(`.activity-accordion-section[data-section="${sectionName}"]`);
    if (!section) return;
    section.classList.toggle("is-open", isOpen);
    const trigger = section.querySelector(".activity-accordion-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }

  function setupAccordions() {
    accordionSections.forEach((section) => {
      const trigger = section.querySelector(".activity-accordion-trigger");
      if (!trigger) return;
      trigger.addEventListener("click", () => {
        const shouldOpen = !section.classList.contains("is-open");
        accordionSections.forEach((sec) => {
          const secName = sec.dataset.section;
          if (secName) setAccordionOpen(secName, false);
        });
        const name = section.dataset.section;
        if (name) setAccordionOpen(name, shouldOpen);
      });
    });
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

    if (error) throw error;
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

  async function bootstrapAdminPanel() {
    try {
      const adminUser = await ensureAdminAccess();
      if (!adminUser) return;

      setMessage("Yükleniyor...");
      await Promise.all([
        loadMentorApplications(),
        loadMentorshipRequests(),
        loadUsers(),
        loadCommunities(),
        loadCampaignJobs(),
      ]);
      setMessage("");
    } catch (error) {
      console.error("Admin panel load error:", error);
      setMessage("Admin paneli yüklenemedi. SQL yetkilerini kontrol edin.", true);
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

  setupAccordions();
  void bootstrapAdminPanel();
})();
