(function initNotificationsModule() {
  const btn = document.getElementById("notifications-btn");
  const popup = document.getElementById("notifications-popup");
  const closeBtn = document.getElementById("close-notifications");
  const listEl = document.getElementById("notifications-list");
  const emptyEl = document.getElementById("notifications-empty");
  const badgeEl = document.getElementById("notifications-badge");
  const mobileBtn = document.getElementById("mobile-notifications-btn");

  if (!btn || !popup || !listEl) return;

  const supabase = window.getSupabase?.() || window.sb;
  if (!supabase) return;
  let currentUserId = null;
  let notificationsOpen = false;

  function formatRelativeDate(isoDate) {
    const diff = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Az önce";
    if (minutes < 60) return `${minutes} dk önce`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} sa önce`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} gün önce`;
    return new Date(isoDate).toLocaleDateString("tr-TR");
  }

  function notificationMessage(row) {
    const name = row.actor_name || "Biri";
    if (row.type === "comment") {
      return `${name} sorunuza yanıt verdi.`;
    }
    if (row.type === "community_join_request") {
      return `${name} topluluğunuza katılmak istiyor.`;
    }
    if (row.type === "community_join_rejected") {
      const communityName = row.actor_name || "Topluluk";
      return `${communityName} topluluğuna katılma isteğiniz reddedildi.`;
    }
    return `${name} sorunuzu beğendi.`;
  }

  function notificationHref(row) {
    if (row.type === "community_join_request") {
      return row.community_id
        ? `/community?id=${encodeURIComponent(row.community_id)}`
        : "/communities";
    }
    if (row.type === "community_join_rejected") {
      return row.community_id
        ? `/communities?community=${encodeURIComponent(row.community_id)}`
        : "/communities";
    }
    const params = new URLSearchParams({ tab: "questions", post: row.post_id });
    if (row.type === "comment" && row.comment_id) {
      params.set("comment", row.comment_id);
    }
    return `/profile?${params.toString()}`;
  }

  function setNavVisible(isLoggedIn) {
    btn.hidden = !isLoggedIn;
    if (mobileBtn) mobileBtn.hidden = !isLoggedIn;
    if (!isLoggedIn) {
      closePopup();
      if (badgeEl) badgeEl.hidden = true;
    }
  }

  function updateBadge(unreadCount) {
    if (!badgeEl) return;
    if (unreadCount > 0) {
      badgeEl.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
      badgeEl.hidden = false;
    } else {
      badgeEl.hidden = true;
    }
  }

  async function refreshBadge() {
    if (!currentUserId) {
      updateBadge(0);
      return;
    }

    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", currentUserId)
      .is("read_at", null);

    if (error) {
      console.error("Notification count error:", error.message);
      return;
    }

    updateBadge(count ?? 0);
  }

  async function markAsRead(notificationId) {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId)
      .eq("user_id", currentUserId);
  }

  function renderList(rows) {
    listEl.replaceChildren();
    const hasItems = rows.length > 0;
    emptyEl.hidden = hasItems;

    rows.forEach((row) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `notification-item${row.read_at ? "" : " unread"}`;

      const text = document.createElement("span");
      text.className = "notification-text";
      text.textContent = notificationMessage(row);

      const time = document.createElement("span");
      time.className = "notification-time";
      time.textContent = formatRelativeDate(row.created_at);

      button.append(text, time);

      button.addEventListener("click", async () => {
        await markAsRead(row.id);
        closePopup();
        window.location.href = notificationHref(row);
      });

      li.appendChild(button);
      listEl.appendChild(li);
    });
  }

  async function loadNotificationsList() {
    if (!currentUserId) return;

    const { data, error } = await supabase
      .from("notifications")
      .select("id, actor_name, type, post_id, comment_id, community_id, join_request_id, read_at, created_at")
      .eq("user_id", currentUserId)
      .order("created_at", { ascending: false })
      .limit(40);

    if (error) {
      console.error("Notifications load error:", error.message);
      emptyEl.hidden = false;
      emptyEl.textContent = "Bildirimler yüklenemedi.";
      return;
    }

    emptyEl.textContent = "Bildirim yok.";
    renderList(data ?? []);
    await refreshBadge();
  }

  function openPopup() {
    notificationsOpen = true;
    popup.hidden = false;
    loadNotificationsList();
  }

  function closePopup() {
    notificationsOpen = false;
    popup.hidden = true;
  }

  function togglePopup() {
    if (notificationsOpen) closePopup();
    else openPopup();
  }

  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!currentUserId) {
      window.location.href = "/login";
      return;
    }
    togglePopup();
  });

  mobileBtn?.addEventListener("click", () => {
    const mobileMenu = document.getElementById("mobile-menu");
    if (mobileMenu) mobileMenu.hidden = true;
    if (!currentUserId) {
      window.location.href = "/login";
      return;
    }
    openPopup();
  });

  closeBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    closePopup();
  });

  document.addEventListener("click", (event) => {
    if (!notificationsOpen) return;
    if (event.target.closest(".notifications-wrap")) return;
    closePopup();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && notificationsOpen) closePopup();
  });

  async function syncSession() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    currentUserId = session?.user?.id ?? null;
    setNavVisible(Boolean(currentUserId));
    if (currentUserId) await refreshBadge();
  }

  supabase.auth.onAuthStateChange(() => {
    syncSession();
  });

  syncSession();

  window.rekabetliNotifications = {
    refresh: refreshBadge,
    close: closePopup,
  };
})();
