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
  let backdropEl = null;
  let lastUnreadCount = 0;
  let dismissBtn = null;

  function isMobileNotificationsLayout() {
    return window.matchMedia("(max-width: 1000px)").matches;
  }

  function ensurePopupPortal() {
    if (popup.parentElement !== document.body) {
      document.body.appendChild(popup);
    }
  }

  function ensureBackdrop() {
    if (backdropEl) return backdropEl;
    backdropEl = document.createElement("div");
    backdropEl.id = "notifications-backdrop";
    backdropEl.className = "notifications-backdrop";
    backdropEl.hidden = true;
    backdropEl.addEventListener("click", () => closePopup());
    document.body.appendChild(backdropEl);
    return backdropEl;
  }

  function showBackdropIfMobile() {
    if (!isMobileNotificationsLayout()) return;
    ensureBackdrop().hidden = false;
  }

  function hideBackdrop() {
    if (backdropEl) backdropEl.hidden = true;
  }

  function clearPopupInlinePosition() {
    popup.style.position = "";
    popup.style.top = "";
    popup.style.right = "";
    popup.style.left = "";
    popup.style.bottom = "";
    popup.style.width = "";
  }

  function setBodyScrollLocked(locked) {
    document.body.classList.toggle("notifications-open", locked);
  }

  function positionPopup(anchorEl) {
    const isMobile = isMobileNotificationsLayout();
    popup.classList.toggle("notifications-popup--mobile", isMobile);

    if (isMobile) {
      clearPopupInlinePosition();
      return;
    }

    const anchor = anchorEl && !anchorEl.hidden ? anchorEl : btn;
    if (!anchor || anchor.hidden) {
      popup.style.position = "fixed";
      popup.style.top = "4.5rem";
      popup.style.right = "0.9rem";
      popup.style.left = "auto";
      return;
    }

    const rect = anchor.getBoundingClientRect();
    popup.style.position = "fixed";
    popup.style.top = `${rect.bottom + 8}px`;
    popup.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    popup.style.left = "auto";
  }

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
    if (row.type === "answer_reply") {
      return `${name} yanıtınıza yorum yaptı.`;
    }
    if (row.type === "community_join_request") {
      return `${name} topluluğunuza katılmak istiyor.`;
    }
    if (row.type === "community_join_rejected") {
      const communityName = row.actor_name || "Topluluk";
      return `${communityName} topluluğuna katılma isteğiniz reddedildi.`;
    }
    if (row.type === "community_post") {
      return `${name} topluluğunuzda yeni bir paylaşım yaptı.`;
    }
    if (row.type === "mentor_package_request") {
      return `${name} paketiniz için ön talep oluşturdu.`;
    }
    if (row.type === "mentor_student_message") {
      return `${name} size bir soru sordu.`;
    }
    if (row.type === "mentor_mentor_reply") {
      return `${name} sorunuza yanıt verdi.`;
    }
    return `${name} sorunuzu beğendi.`;
  }

  function isSafeUuid(value) {
    return window.RekabetliSecurity?.isValidUuid?.(value) || false;
  }

  function buildFeedNotificationHref(row) {
    const params = new URLSearchParams();

    if (isSafeUuid(row.community_id)) {
      params.set("id", row.community_id);
    }
    if (isSafeUuid(row.post_id)) {
      params.set("post", row.post_id);
    }
    if (isSafeUuid(row.comment_id)) {
      params.set("comment", row.comment_id);
    }

    if (isSafeUuid(row.community_id)) {
      const query = params.toString();
      return query ? `/community?${query}` : "/communities";
    }

    const query = params.toString();
    return query ? `/?${query}` : "/";
  }

  function notificationHref(row) {
    if (row.type === "mentor_package_request") {
      const params = new URLSearchParams({ inbox: "requests" });
      if (isSafeUuid(row.package_request_id)) {
        params.set("request", row.package_request_id);
      }
      return `/mentor-sayfam?${params.toString()}`;
    }
    if (row.type === "mentor_student_message") {
      const params = new URLSearchParams({ inbox: "messages" });
      if (isSafeUuid(row.conversation_id)) {
        params.set("conversation", row.conversation_id);
      }
      if (isSafeUuid(row.message_id)) {
        params.set("message", row.message_id);
      }
      return `/mentor-sayfam?${params.toString()}`;
    }
    if (row.type === "mentor_mentor_reply") {
      const params = new URLSearchParams({ openMessaging: "1" });
      if (isSafeUuid(row.mentor_id)) {
        params.set("id", row.mentor_id);
      }
      if (isSafeUuid(row.conversation_id)) {
        params.set("conversation", row.conversation_id);
      }
      if (isSafeUuid(row.message_id)) {
        params.set("message", row.message_id);
      }
      return params.has("id") ? `/mentor?${params.toString()}` : "/mentors";
    }
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
    if (
      row.type === "comment" ||
      row.type === "like" ||
      row.type === "answer_reply" ||
      row.type === "community_post"
    ) {
      return buildFeedNotificationHref(row);
    }
    return "/";
  }

  async function resolveNotificationHref(row) {
    const feedTypes = new Set(["comment", "like", "answer_reply", "community_post"]);
    if (!feedTypes.has(row.type) || isSafeUuid(row.community_id) || !isSafeUuid(row.post_id)) {
      return notificationHref(row);
    }

    const { data, error } = await supabase
      .from("posts")
      .select("community_id")
      .eq("id", row.post_id)
      .maybeSingle();

    if (error) {
      console.error("Notification post lookup error:", error.message);
      return notificationHref(row);
    }

    return buildFeedNotificationHref({
      ...row,
      community_id: data?.community_id ?? null,
    });
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
    lastUnreadCount = Math.max(0, Number(unreadCount) || 0);
    if (!badgeEl) {
      updateDismissButtonVisibility();
      return;
    }
    if (lastUnreadCount > 0) {
      badgeEl.textContent = lastUnreadCount > 9 ? "9+" : String(lastUnreadCount);
      badgeEl.hidden = false;
    } else {
      badgeEl.hidden = true;
    }
    updateDismissButtonVisibility();
  }

  function updateDismissButtonVisibility() {
    if (!dismissBtn) return;
    dismissBtn.hidden = lastUnreadCount === 0;
    dismissBtn.disabled = lastUnreadCount === 0;
  }

  function ensureDismissButton() {
    if (dismissBtn) return;

    const header = popup.querySelector(".notifications-popup-header");
    if (!header || !closeBtn) return;

    let actions = header.querySelector(".notifications-popup-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "notifications-popup-actions";
      actions.append(closeBtn);
      header.appendChild(actions);
    }

    dismissBtn = document.createElement("button");
    dismissBtn.id = "dismiss-notifications";
    dismissBtn.type = "button";
    dismissBtn.className = "notifications-dismiss-btn";
    dismissBtn.textContent = "Yoksay";
    dismissBtn.setAttribute("aria-label", "Okunmamış bildirimleri yoksay");
    dismissBtn.hidden = true;
    dismissBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await dismissAllUnread();
    });

    actions.insertBefore(dismissBtn, closeBtn);
    updateDismissButtonVisibility();
  }

  async function dismissAllUnread() {
    if (!currentUserId || lastUnreadCount === 0) return;

    if (dismissBtn) dismissBtn.disabled = true;

    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", currentUserId)
      .is("read_at", null);

    if (error) {
      console.error("Dismiss notifications error:", error.message);
      if (dismissBtn) dismissBtn.disabled = lastUnreadCount === 0;
      return;
    }

    updateBadge(0);
    listEl.querySelectorAll(".notification-item.unread").forEach((item) => {
      item.classList.remove("unread");
    });
    updateDismissButtonVisibility();
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
        window.location.href = await resolveNotificationHref(row);
      });

      li.appendChild(button);
      listEl.appendChild(li);
    });
  }

  async function loadNotificationsList() {
    if (!currentUserId) return;

    const { data, error } = await supabase
      .from("notifications")
      .select(
        "id, actor_name, type, post_id, comment_id, community_id, join_request_id, mentor_id, package_request_id, conversation_id, message_id, read_at, created_at",
      )
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

  function openPopup(anchorEl) {
    ensurePopupPortal();
    notificationsOpen = true;
    popup.hidden = false;
    positionPopup(anchorEl);
    showBackdropIfMobile();
    setBodyScrollLocked(true);
    loadNotificationsList();
  }

  function closePopup() {
    notificationsOpen = false;
    popup.hidden = true;
    hideBackdrop();
    setBodyScrollLocked(false);
  }

  function togglePopup(anchorEl) {
    if (notificationsOpen) closePopup();
    else openPopup(anchorEl);
  }

  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!currentUserId) {
      window.location.href = "/login";
      return;
    }
    togglePopup(btn);
  });

  mobileBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const mobileMenu = document.getElementById("mobile-menu");
    if (mobileMenu) mobileMenu.hidden = true;
    if (!currentUserId) {
      window.location.href = "/login";
      return;
    }
    togglePopup(mobileBtn);
  });

  closeBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    closePopup();
  });

  document.addEventListener("click", (event) => {
    if (!notificationsOpen) return;
    let target = event.target;
    if (target && target.nodeType === Node.TEXT_NODE) target = target.parentElement;
    if (!target || typeof target.closest !== "function") return;
    if (target.closest(".notifications-popup")) return;
    if (target.closest("#notifications-btn")) return;
    if (target.closest("#mobile-notifications-btn")) return;
    closePopup();
  });

  window.addEventListener("resize", () => {
    if (!notificationsOpen || isMobileNotificationsLayout()) return;
    positionPopup(btn.hidden ? mobileBtn : btn);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && notificationsOpen) closePopup();
  });

  function applyAuthState(authState) {
    if (!authState.ready) return;

    currentUserId = authState.user?.id ?? null;

    setNavVisible(Boolean(currentUserId));

    if (!currentUserId) {
      if (notificationsOpen) closePopup();
      updateBadge(0);
      return;
    }

    void refreshBadge();
  }

  function initAuthBinding() {
    const auth = window.RekabetliAuth;
    if (!auth) {
      setNavVisible(false);
      return;
    }

    auth.subscribe(applyAuthState);

    const initial = auth.getState();
    if (initial.ready) {
      applyAuthState(initial);
    } else {
      void auth.whenReady().then(applyAuthState);
    }
  }

  initAuthBinding();

  ensurePopupPortal();
  ensureDismissButton();

  window.rekabetliNotifications = {
    refresh: refreshBadge,
    close: closePopup,
  };
})();
