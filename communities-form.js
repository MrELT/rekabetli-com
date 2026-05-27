document.addEventListener("DOMContentLoaded", () => {
  const DEBUG_PREFIX = "[rekabetli][communities]";

  function getSb() {
    return window.getSupabase?.() || window.sb || null;
  }

  function isSupabaseConfigured() {
    if (window.__ENV__?.SUPABASE_URL && window.__ENV__?.SUPABASE_ANON_KEY) {
      window.getSupabase?.();
      return true;
    }
    return false;
  }

  function isSupabaseReady() {
    if (!isSupabaseConfigured()) return false;
    const sb = getSb();
    return Boolean(sb && !sb._rekabetliStub);
  }

  const AVATAR_BUCKET = "avatars";
  const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

  const SIZE_LABELS = {
    "0-10": "0–10 kişi",
    "10-50": "10–50 kişi",
    "50-100": "50–100 kişi",
    "100+": "100+ kişi",
  };

  const modal = document.getElementById("community-modal");
  const form = document.getElementById("community-form");
  const closeBtn = document.getElementById("close-community-modal");
  const messageEl = document.getElementById("community-form-message");
  const submitBtn = document.getElementById("community-form-submit");
  const communityList = document.getElementById("community-list");
  const addBtn = document.getElementById("community-add-btn");

  function showCommunityListMessage(text, isError = false) {
    if (!communityList) return;
    communityList.querySelectorAll("[data-dynamic-community]").forEach((node) => node.remove());
    let el = communityList.querySelector("[data-communities-empty]");
    if (!el) {
      el = document.createElement("p");
      el.className = "empty communities-empty";
      el.dataset.communitiesEmpty = "true";
      communityList.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle("communities-load-error", isError);
    el.hidden = false;
  }

  const nameInput = document.getElementById("community-name");
  const purposeInput = document.getElementById("community-purpose");
  const sizeBandSelect = document.getElementById("community-size-band");
  const avatarInput = document.getElementById("community-avatar-input");
  const avatarPreview = document.getElementById("community-avatar-preview");
  const avatarFallback = document.getElementById("community-avatar-fallback");
  const removeAvatarBtn = document.getElementById("community-remove-avatar");

  let pendingAvatarFile = null;
  let avatarObjectUrl = null;
  let joinRequestByCommunityId = new Map();
  let memberCommunityIds = new Set();
  let communitiesAuthBound = false;

  function getCurrentUser() {
    return window.RekabetliAuth?.getUser() ?? null;
  }

  async function requireAuthUser() {
    const auth = window.RekabetliAuth;
    if (!auth) {
      console.error("[rekabetli][auth-store-missing]");
      const message =
        "Oturum sistemi yüklenemedi. Sayfayı yenileyin; sorun devam ederse bağlantınızı kontrol edin.";
      if (typeof window.rekabetliAlert === "function") {
        await window.rekabetliAlert({
          title: "Bağlantı hatası",
          message,
          showCancel: false,
          confirmLabel: "Tamam",
        });
      } else {
        window.alert(message);
      }
      return null;
    }

    let user = auth.getUser();
    if (user) return user;

    const state = await auth.whenReady();
    user = state.user;
    if (user) return user;

    window.location.href = "/login";
    return null;
  }

  function getInitials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function openCommunityModal() {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("question-modal-open");
    nameInput?.focus();
  }

  function closeCommunityModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("question-modal-open");
    form?.reset();
    resetAvatarState();
    setFormMessage("");
    const publicRadio = form?.querySelector('input[name="visibility"][value="public"]');
    if (publicRadio) publicRadio.checked = true;
  }

  window.openCommunityModal = openCommunityModal;

  window.rekabetliOpenCommunityModal = async function rekabetliOpenCommunityModal(event) {
    if (event) event.preventDefault();
    const user = await requireAuthUser();
    if (!user) return false;
    openCommunityModal();
    return false;
  };

  if (addBtn) {
    addBtn.addEventListener("click", (event) => {
      window.rekabetliOpenCommunityModal(event);
    });
  }

  function setFormMessage(text, isError = false) {
    if (!messageEl) return;
    if (!text) {
      messageEl.hidden = true;
      messageEl.textContent = "";
      messageEl.classList.remove("is-error");
      return;
    }
    messageEl.hidden = false;
    messageEl.textContent = text;
    messageEl.classList.toggle("is-error", isError);
  }

  function updateAvatarPreview(url, name) {
    if (!avatarPreview || !avatarFallback) return;
    if (url) {
      setSafeImgSrc(avatarPreview, url, { allowBlob: true });
      avatarPreview.hidden = false;
      avatarFallback.hidden = true;
      if (removeAvatarBtn) removeAvatarBtn.hidden = false;
      return;
    }
    avatarPreview.hidden = true;
    avatarPreview.removeAttribute("src");
    avatarFallback.hidden = false;
    avatarFallback.textContent = getInitials(name);
    if (removeAvatarBtn) removeAvatarBtn.hidden = true;
  }

  function resetAvatarState() {
    pendingAvatarFile = null;
    if (avatarInput) avatarInput.value = "";
    if (avatarObjectUrl) {
      URL.revokeObjectURL(avatarObjectUrl);
      avatarObjectUrl = null;
    }
    updateAvatarPreview(null, nameInput?.value || "");
  }

  function setSafeImgSrc(img, url, options) {
    return window.RekabetliSecurity?.setImgSrc(img, url, options) ?? false;
  }

  function getCardContext(row) {
    const user = getCurrentUser();
    const isOwner = Boolean(user && row.owner_id === user.id);
    const joinStatus = joinRequestByCommunityId.get(row.id) ?? null;
    const isMember = memberCommunityIds.has(row.id);
    return { isOwner, joinStatus, isMember };
  }

  function appendCommunityAction(actionsEl, row) {
    actionsEl.replaceChildren();
    const { isOwner, joinStatus, isMember } = getCardContext(row);
    const detailHref = `/community?id=${encodeURIComponent(row.id)}`;

    if (isOwner || isMember) {
      const link = document.createElement("a");
      link.href = detailHref;
      link.className = "details-btn is-member";
      link.textContent = "Topluluğa Git";
      actionsEl.appendChild(link);
      return;
    }

    if (row.visibility === "private") {
      if (joinStatus === "pending") {
        const pendingBtn = document.createElement("button");
        pendingBtn.type = "button";
        pendingBtn.className = "details-btn is-pending";
        pendingBtn.disabled = true;
        pendingBtn.textContent = "İstek gönderildi";
        actionsEl.appendChild(pendingBtn);
        return;
      }

      const requestBtn = document.createElement("button");
      requestBtn.type = "button";
      requestBtn.className = "details-btn is-request js-community-join-request";
      requestBtn.dataset.communityId = row.id;
      requestBtn.textContent =
        joinStatus === "rejected" ? "Yeniden istek gönder" : "Katılma isteği gönder";
      actionsEl.appendChild(requestBtn);
      return;
    }

    const joinBtn = document.createElement("button");
    joinBtn.type = "button";
    joinBtn.className = "details-btn js-community-join-public";
    joinBtn.dataset.communityId = row.id;
    joinBtn.textContent = "Topluluğa Katıl";
    actionsEl.appendChild(joinBtn);
  }

  function buildCommunityCard(row) {
    const sizeLabel = SIZE_LABELS[row.size_band] || row.size_band;

    const card = document.createElement("article");
    card.className = "community-card";
    card.dataset.dynamicCommunity = "true";
    card.dataset.communityId = row.id;
    card.dataset.visibility = row.visibility;
    card.dataset.ownerId = row.owner_id ?? "";

    const head = document.createElement("div");
    head.className = "card-header community-card-head";

    if (row.avatar_url) {
      const img = document.createElement("img");
      img.className = "community-card-avatar";
      img.alt = "";
      setSafeImgSrc(img, row.avatar_url);
      head.appendChild(img);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "community-card-avatar community-card-avatar-fallback";
      fallback.textContent = getInitials(row.name);
      head.appendChild(fallback);
    }

    const headText = document.createElement("div");
    headText.className = "community-card-head-text";

    const title = document.createElement("h3");
    title.className = "community-title";
    title.textContent = row.name;

    const badge = document.createElement("span");
    badge.className =
      row.visibility === "private" ? "badge badge-private" : "badge badge-public";
    badge.textContent = row.visibility === "private" ? "Gizli" : "Açık";

    headText.append(title, badge);
    head.appendChild(headText);

    const meta = document.createElement("div");
    meta.className = "community-meta";
    const metaSpan = document.createElement("span");
    metaSpan.textContent = `👥 ${sizeLabel}`;
    meta.appendChild(metaSpan);

    const desc = document.createElement("p");
    desc.className = "community-desc";
    desc.textContent = row.purpose;

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.dataset.communityActions = "true";
    appendCommunityAction(actions, row);

    card.append(head, meta, desc, actions);
    return card;
  }

  function rowFromCard(card) {
    return {
      id: card.dataset.communityId,
      visibility: card.dataset.visibility,
      owner_id: card.dataset.ownerId || null,
    };
  }

  function refreshCardAction(card, row) {
    const actions = card.querySelector("[data-community-actions]");
    if (!actions) return;
    appendCommunityAction(actions, row ?? rowFromCard(card));
  }

  async function loadUserCommunityState(userId) {
    joinRequestByCommunityId = new Map();
    memberCommunityIds = new Set();
    if (!userId) return;

    const sb = getSb();
    if (!sb) return;

    let requestsRes = { data: [] };
    let membersRes = { data: [] };

    try {
      const [reqOut, memOut] = await Promise.all([
        sb.from("community_join_requests").select("community_id, status").eq("user_id", userId),
        sb.from("community_members").select("community_id").eq("user_id", userId),
      ]);
      requestsRes = reqOut;
      membersRes = memOut;
    } catch (promiseError) {
      console.warn(
        "[rekabetli][user-state-transient-error] Mobile query failed, falling back to empty arrays:",
        promiseError
      );
    }

    if (!requestsRes.error) {
      (requestsRes.data ?? []).forEach((row) => {
        joinRequestByCommunityId.set(row.community_id, row.status);
      });
    }
    if (!membersRes.error) {
      (membersRes.data ?? []).forEach((row) => {
        memberCommunityIds.add(row.community_id);
      });
    }
  }

  function focusCommunityFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const communityId = params.get("community") || params.get("highlight");
    if (!communityId || !communityList) return;

    const card = [...communityList.querySelectorAll("[data-community-id]")].find(
      (el) => el.dataset.communityId === communityId
    );
    if (!card) return;

    card.classList.add("is-highlighted");
    window.requestAnimationFrame(() => {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    window.setTimeout(() => {
      card.classList.remove("is-highlighted");
    }, 3500);

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("community");
    cleanUrl.searchParams.delete("highlight");
    const query = cleanUrl.searchParams.toString();
    window.history.replaceState({}, "", query ? `${cleanUrl.pathname}?${query}` : cleanUrl.pathname);
  }

  async function fetchAndRenderCommunitiesList() {
    if (!communityList) return;

    if (!isSupabaseConfigured()) {
      showCommunityListMessage(
        "Bağlantı ayarları yüklenemedi. Sayfayı yenileyin; sorun devam ederse site yöneticisine bildirin.",
        true
      );
      return;
    }

    const sb = getSb();
    if (!sb) {
      showCommunityListMessage("Supabase istemcisi hazır değil. Lütfen sayfayı yenileyin.", true);
      return;
    }

    const { data, error } = await sb
      .from("communities")
      .select("id, name, purpose, size_band, visibility, avatar_url, owner_id, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Communities load error:", error.message);
      showCommunityListMessage(
        "Topluluklar yüklenemedi. Giriş yaptığınızdan ve veritabanı tablolarının kurulu olduğundan emin olun.",
        true
      );
      return;
    }

    communityList.querySelectorAll("[data-dynamic-community]").forEach((node) => node.remove());

    const rows = data ?? [];
    let emptyEl = communityList.querySelector("[data-communities-empty]");

    if (!rows.length) {
      if (!emptyEl) {
        emptyEl = document.createElement("p");
        emptyEl.className = "empty communities-empty";
        emptyEl.dataset.communitiesEmpty = "true";
        emptyEl.textContent = "Henüz topluluk yok. İlk topluluğu sen oluştur.";
        communityList.appendChild(emptyEl);
      }
      emptyEl.hidden = false;
      return;
    }

    if (emptyEl) emptyEl.hidden = true;

    rows.forEach((row) => {
      communityList.prepend(buildCommunityCard(row));
    });

    focusCommunityFromUrl();
  }

  async function hydrateCommunityCardActions(user) {
    joinRequestByCommunityId = new Map();
    memberCommunityIds = new Set();

    if (user?.id) {
      await loadUserCommunityState(user.id);
    }

    if (!communityList) return;

    communityList.querySelectorAll("[data-dynamic-community]").forEach((card) => {
      refreshCardAction(card);
    });
  }

  function bindCommunitiesAuthListener() {
    if (communitiesAuthBound || !window.RekabetliAuth) return;
    communitiesAuthBound = true;

    window.RekabetliAuth.subscribe((authState) => {
      if (!authState.ready) return;
      void hydrateCommunityCardActions(authState.user);
    });
  }

  async function bootstrapCommunitiesPage() {
    try {
      await fetchAndRenderCommunitiesList();
      bindCommunitiesAuthListener();
    } catch (err) {
      console.error("[rekabetli][critical-load-communities-error]", err);
      console.error("Communities bootstrap failed:", err);
      if (communityList) {
        communityList.querySelectorAll("[data-dynamic-community]").forEach((node) => node.remove());
      }
      showCommunityListMessage("Topluluklar yüklenirken bir hata oluştu. Sayfayı yenileyin.", true);
    }
  }

  async function joinPublicCommunity(communityId, triggerBtn) {
    const user = await requireAuthUser();
    if (!user) return;

    if (triggerBtn) triggerBtn.disabled = true;

    try {
      const sb = getSb();
      if (!sb) return;
      const { error } = await sb.from("community_members").upsert(
        [{ community_id: communityId, user_id: user.id }],
        { onConflict: "community_id,user_id" }
      );

      if (error) throw error;

      memberCommunityIds.add(communityId);
      const card = communityList?.querySelector(`[data-community-id="${communityId}"]`);
      if (card) refreshCardAction(card);

      if (typeof window.rekabetliAlert === "function") {
        await window.rekabetliAlert({
          title: "Topluluğa katıldın",
          message: "Artık bu topluluğun üyesisin. Akışa paylaşım yapabilirsin.",
          showCancel: false,
          confirmLabel: "Tamam",
        });
      }
    } catch (error) {
      console.error("Public join error:", error.message);
      if (typeof window.rekabetliAlert === "function") {
        await window.rekabetliAlert({
          title: "Katılınamadı",
          message: "Üyelik eklenemedi. Giriş yaptığınızdan ve topluluğun açık olduğundan emin olun.",
          showCancel: false,
          confirmLabel: "Tamam",
        });
      }
    } finally {
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }

  async function sendJoinRequest(communityId, triggerBtn) {
    const user = await requireAuthUser();
    if (!user) return;

    if (triggerBtn) triggerBtn.disabled = true;

    const sb = getSb();
    if (!sb) return;

    try {
      const { error } = await sb.from("community_join_requests").insert([
        { community_id: communityId, user_id: user.id, status: "pending" },
      ]);

      if (error) {
        if (error.code === "23505") {
          joinRequestByCommunityId.set(communityId, "pending");
          const card = communityList?.querySelector(`[data-community-id="${communityId}"]`);
          if (card) refreshCardAction(card, { id: communityId, visibility: "private" });
          return;
        }
        throw error;
      }

      joinRequestByCommunityId.set(communityId, "pending");
      const card = communityList?.querySelector(`[data-community-id="${communityId}"]`);
      if (card) refreshCardAction(card, { id: communityId, visibility: "private" });

      if (typeof window.rekabetliAlert === "function") {
        await window.rekabetliAlert({
          title: "İstek gönderildi",
          message: "Katılma talebin topluluk yöneticisine iletildi.",
          showCancel: false,
          confirmLabel: "Tamam",
        });
      }
    } catch (error) {
      console.error("Join request error:", error.message);
    } finally {
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }

  async function uploadCommunityAvatar(file, userId) {
    const sb = getSb();
    if (!sb) throw new Error("Supabase istemcisi hazır değil.");

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${userId}/community-${Date.now()}.${ext}`;

    if (window.RekabetliImageUploadLimit?.consumeUploadSlot) {
      await window.RekabetliImageUploadLimit.consumeUploadSlot(sb, {
        bucket: AVATAR_BUCKET,
        path,
      });
    }

    const { error: uploadError } = await sb.storage.from(AVATAR_BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: "3600",
    });
    if (uploadError) throw uploadError;
    const { data } = sb.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  }

  nameInput?.addEventListener("input", () => {
    if (!avatarPreview?.hidden) return;
    avatarFallback.textContent = getInitials(nameInput.value);
  });

  avatarInput?.addEventListener("change", () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setFormMessage("Yalnızca JPG, PNG veya WebP yükleyebilirsin.", true);
      avatarInput.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setFormMessage("Profil fotoğrafı en fazla 2 MB olabilir.", true);
      avatarInput.value = "";
      return;
    }
    pendingAvatarFile = file;
    if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
    avatarObjectUrl = URL.createObjectURL(file);
    updateAvatarPreview(avatarObjectUrl, nameInput.value);
    setFormMessage("");
  });

  removeAvatarBtn?.addEventListener("click", resetAvatarState);
  closeBtn?.addEventListener("click", closeCommunityModal);
  modal?.addEventListener("click", (event) => {
    if (event.target === modal) closeCommunityModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal && !modal.hidden) closeCommunityModal();
  });

  communityList?.addEventListener("click", (event) => {
    let target = event.target;
    if (target && target.nodeType === Node.TEXT_NODE) {
      target = target.parentElement;
    }
    if (!target || typeof target.closest !== "function") return;

    const publicBtn = target.closest(".js-community-join-public");
    if (publicBtn) {
      event.preventDefault();
      const communityId = publicBtn.dataset.communityId;
      if (communityId) joinPublicCommunity(communityId, publicBtn);
      return;
    }

    const requestBtn = target.closest(".js-community-join-request");
    if (!requestBtn) return;
    event.preventDefault();
    const communityId = requestBtn.dataset.communityId;
    if (communityId) sendJoinRequest(communityId, requestBtn);
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormMessage("");

    const user = await requireAuthUser();
    if (!user) return;

    const name = nameInput.value.trim();
    const purpose = purposeInput.value.trim();
    const sizeBand = sizeBandSelect.value;
    const visibility = form.querySelector('input[name="visibility"]:checked')?.value;

    if (!name || !purpose || !sizeBand || !visibility) {
      setFormMessage("Lütfen tüm zorunlu alanları doldurun.", true);
      return;
    }

    submitBtn.disabled = true;

    try {
      let avatarUrl = null;
      if (pendingAvatarFile) {
        try {
          avatarUrl = await uploadCommunityAvatar(pendingAvatarFile, user.id);
        } catch (uploadErr) {
          if (window.RekabetliImageUploadLimit?.isLimitError(uploadErr)) {
            setFormMessage(window.RekabetliImageUploadLimit.getLimitMessage(uploadErr), true);
            return;
          }
          throw uploadErr;
        }
      }

      const sb = getSb();
      if (!sb) {
        setFormMessage("Bağlantı hazır değil. Sayfayı yenileyin.", true);
        return;
      }

      const { data, error } = await sb
        .from("communities")
        .insert([
          {
            owner_id: user.id,
            name,
            purpose,
            size_band: sizeBand,
            visibility,
            avatar_url: avatarUrl,
          },
        ])
        .select("id, name, purpose, size_band, visibility, avatar_url, owner_id")
        .single();

      if (error) throw error;

      await sb.from("community_members").upsert(
        [{ community_id: data.id, user_id: user.id }],
        { onConflict: "community_id,user_id" }
      );

      closeCommunityModal();
      window.location.href = `/community?id=${encodeURIComponent(data.id)}`;
    } catch (error) {
      console.error("Community create error:", error.message);
      setFormMessage("Topluluk kaydedilemedi. Supabase tablolarını kontrol edin.", true);
    } finally {
      submitBtn.disabled = false;
    }
  });

  let appBootstrapped = false;
  let appRetryTimer = null;
  let appRetryCount = 0;

  function startApp() {
    console.info(`${DEBUG_PREFIX} startApp`, {
      hasEnv: Boolean(window.__ENV__?.SUPABASE_URL && window.__ENV__?.SUPABASE_ANON_KEY),
      hasSb: Boolean(getSb()),
      isReady: isSupabaseReady(),
      hasAuthStore: Boolean(window.RekabetliAuth),
    });

    if (!isSupabaseReady()) {
      if (appRetryTimer || appRetryCount >= 12) return;
      appRetryCount += 1;
      console.warn(`${DEBUG_PREFIX} waiting for Supabase readiness`, { retry: appRetryCount });
      appRetryTimer = window.setTimeout(() => {
        appRetryTimer = null;
        startApp();
      }, 300);
      return;
    }

    appRetryCount = 0;
    if (appBootstrapped) return;
    appBootstrapped = true;

    bootstrapCommunitiesPage().catch((error) => {
      console.error("[rekabetli][communities-init-flow-error]", error);
    });
  }

  startApp();
  window.addEventListener("rekabetli-env-ready", startApp);
});
