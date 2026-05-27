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

  const countApplications = document.getElementById("admin-count-applications");
  const countRequests = document.getElementById("admin-count-requests");
  const countUsers = document.getElementById("admin-count-users");

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

  function clearTable(body, emptyMessage) {
    if (!body) return;
    body.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
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
      if (mentorApplicationsBody) clearTable(mentorApplicationsBody, "Henüz başvuru yok.");
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
      if (mentorshipRequestsBody) clearTable(mentorshipRequestsBody, "Henüz talep yok.");
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
    const rows = data ?? [];
    if (countUsers) countUsers.textContent = String(rows.length);

    usersBody?.replaceChildren();
    if (!usersBody || !rows.length) {
      if (usersBody) clearTable(usersBody, "Henüz kullanıcı yok.");
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
  }

  async function bootstrapAdminPanel() {
    try {
      const adminUser = await ensureAdminAccess();
      if (!adminUser) return;

      setMessage("Yükleniyor...");
      await Promise.all([loadMentorApplications(), loadMentorshipRequests(), loadUsers()]);
      setMessage("");
    } catch (error) {
      console.error("Admin panel load error:", error);
      setMessage("Admin paneli yüklenemedi. SQL yetkilerini kontrol edin.", true);
    }
  }

  void bootstrapAdminPanel();
})();
