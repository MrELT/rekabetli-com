// --- 1. MENÜ KONTROLÜ (Garanti Yöntem) ---
document.addEventListener("click", (event) => {
  const mobileMenu = document.getElementById("mobile-menu");
  if (!mobileMenu) return;

  // Menüyü Açma (Hamburger ikonu)
  if (event.target.closest("#open-mobile-menu")) {
    mobileMenu.hidden = false;
  }
  
  // Menüyü Kapatma (X ikonu veya siyah arka plan)
  if (event.target.closest("#close-mobile-menu") || event.target.id === "mobile-menu") {
    mobileMenu.hidden = true;
  }
});

// --- 2. SUPABASE (tek paylaşımlı istemci: supabase-client.js) ---
function getSb() {
  return window.getSupabase?.() || window.sb || null;
}

// --- 3. DOM ELEMANLARI VE DEĞİŞKENLER ---
const form = document.getElementById("question-form");
const questionList = document.getElementById("question-list");
const template = document.getElementById("question-template");
const questionModal = document.getElementById("question-modal");
const openQuestionModalButtons = document.querySelectorAll(".js-open-question-modal");
const closeQuestionModalBtn = document.getElementById("close-question-modal");
const desktopProfileBtn = document.getElementById("desktop-profile-btn");
const mobileProfileBtn = document.getElementById("mobile-profile-btn");
const pageMain = document.getElementById("community-page-main");
const pageError = document.getElementById("community-page-error");
const communityNameEl = document.getElementById("community-name");
const communityPurposeEl = document.getElementById("community-purpose");
const communityMetaEl = document.getElementById("community-meta");
const communityVisibilityBadge = document.getElementById("community-visibility-badge");
const communityAdminNote = document.getElementById("community-admin-note");
const communityAvatarImg = document.getElementById("community-avatar-img");
const communityAvatarFallback = document.getElementById("community-avatar-fallback");
const panelMembers = document.getElementById("panel-members");
const countMembers = document.getElementById("count-members");
const feedGate = document.getElementById("community-feed-gate");
const feedShareBtn = document.getElementById("feed-share-btn");
const navShareBtn = document.getElementById("nav-share-btn");
const mobileShareBtn = document.getElementById("mobile-share-btn");
const panelAccordion = document.getElementById("community-panel-accordion");
const joinRequestsSection = document.getElementById("join-requests-section");
const panelJoinRequests = document.getElementById("panel-join-requests");
const countJoinRequests = document.getElementById("count-join-requests");
const communityJoinActions = document.getElementById("community-join-actions");
const communityJoinBtn = document.getElementById("community-join-btn");

const SIZE_LABELS = {
  "0-10": "0–10 kişi",
  "10-50": "10–50 kişi",
  "50-100": "50–100 kişi",
  "100+": "100+ kişi",
};

const communityId = new URLSearchParams(window.location.search).get("id");

let questions = [];
let isUserLoggedIn = false;
let currentUserId = null;
let currentUserDisplayName = null;
let currentUserAvatarUrl = null;
let currentUserIsMentor = false;
let questionContentQuill = null;
let community = null;
let isCommunityAdmin = false;
let isCommunityMember = false;
let canViewFeed = false;
let canPostInCommunity = false;
const POST_CONTENT_MAX_LENGTH = 1800;
let membersLoadSeq = 0;
let myJoinRequestStatus = null;
let communityFeedAuthBound = false;
let skipInitialFeedAuthHydrate = true;

function sameUserId(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}

// --- 4. YARDIMCI FONKSİYONLAR ---
function formatDate(isoDate) {
  return new Date(isoDate).toLocaleString("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getCurrentAuthorName() {
  return currentUserDisplayName?.trim() || "Kullanıcı";
}

function setSafeImgSrc(img, url, options) {
  return window.RekabetliSecurity?.setImgSrc(img, url, options) ?? false;
}

function createMentorBadge() {
  const badge = document.createElement("span");
  badge.className = "mentor-badge";
  badge.textContent = "Mentör";
  return badge;
}

function showEmptyListMessage(container, text) {
  if (!container) return;
  container.replaceChildren();
  window.RekabetliSecurity?.appendEmptyMessage(container, text, "empty");
}

function openQuestionModal() {
  if (questionModal) questionModal.hidden = false;
  document.body.classList.add("question-modal-open");
}

function closeQuestionModal() {
  if (questionModal) questionModal.hidden = true;
  document.body.classList.remove("question-modal-open");
  if (questionContentQuill) window.RekabetliQuill?.clear(questionContentQuill);
}

function initQuestionContentEditor() {
  const host = document.getElementById("question-content-editor");
  if (!host || questionContentQuill || !window.RekabetliQuill) return;

  questionContentQuill = RekabetliQuill.create(host, {
    placeholder: "Sorunun detaylarını yaz...",
    maxLength: POST_CONTENT_MAX_LENGTH,
  });

  if (!questionContentQuill) {
    console.error("Soru detay editörü başlatılamadı.");
  }
}

async function editorUnavailableAlert() {
  await rekabetliAlert({
    title: "Düzenleyici yüklenemedi",
    message: "Metin düzenleyici açılamadı. Sayfayı yenileyip tekrar deneyin.",
  });
}

function getAuthorInitials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function applyQuestionAvatar(container, avatarUrl, authorName) {
  const imgEl = container.querySelector(".question-avatar-img");
  const fallbackEl = container.querySelector(".question-avatar-fallback");
  if (!imgEl || !fallbackEl) return;

  fallbackEl.textContent = getAuthorInitials(authorName);

  if (avatarUrl && setSafeImgSrc(imgEl, avatarUrl)) {
    imgEl.alt = `${authorName} profil fotoğrafı`;
    imgEl.hidden = false;
    fallbackEl.hidden = true;
    return;
  }

  imgEl.hidden = true;
  imgEl.removeAttribute("src");
  fallbackEl.hidden = false;
}

// --- 5. OTURUM KONTROLÜ (Merkezi Auth Store) ---
async function syncFeedUserContext(user) {
  isUserLoggedIn = Boolean(user?.id);
  currentUserId = user?.id ?? null;
  currentUserDisplayName = null;
  currentUserAvatarUrl = null;
  currentUserIsMentor = false;

  if (currentUserId) {
    const { data: profile } = await getSb()
      .from("profiles")
      .select("display_name, avatar_url, is_mentor")
      .eq("id", currentUserId)
      .maybeSingle();
    const emailName = user?.email?.split("@")[0] ?? "";
    currentUserDisplayName = profile?.display_name?.trim() || emailName || "Kullanıcı";
    currentUserAvatarUrl = profile?.avatar_url?.trim() || null;
    currentUserIsMentor = Boolean(profile?.is_mentor);
  }

  updateShareButtons();
}

function updateShareButtons() {
  const show = canPostInCommunity;
  [feedShareBtn, navShareBtn, mobileShareBtn, ...openQuestionModalButtons].forEach((el) => {
    if (el) el.hidden = !show;
  });
}

const JOIN_ACTION_CLASSES = [
  "js-community-join-public",
  "js-community-leave",
  "js-community-close",
  "js-community-join-request",
  "is-danger",
  "is-leave",
  "is-pending",
];

function resetJoinActionButton() {
  if (!communityJoinBtn) return;
  communityJoinBtn.disabled = false;
  JOIN_ACTION_CLASSES.forEach((cls) => communityJoinBtn.classList.remove(cls));
  communityJoinBtn.className = "details-btn";
}

function updateJoinActions() {
  if (!communityJoinActions || !communityJoinBtn || !community) return;

  resetJoinActionButton();

  if (isCommunityAdmin) {
    communityJoinActions.hidden = false;
    communityJoinBtn.textContent = "Topluluğu kapat";
    communityJoinBtn.classList.add("is-danger", "js-community-close");
    return;
  }

  if (isCommunityMember) {
    communityJoinActions.hidden = false;
    communityJoinBtn.textContent = "Topluluktan ayrıl";
    communityJoinBtn.classList.add("is-leave", "js-community-leave");
    return;
  }

  if (community.visibility === "private") {
    communityJoinActions.hidden = false;

    if (!isUserLoggedIn) {
      communityJoinBtn.textContent = "Giriş yap ve istek gönder";
      communityJoinBtn.classList.add("js-community-join-request");
      return;
    }

    if (myJoinRequestStatus === "pending") {
      communityJoinBtn.textContent = "İstek gönderildi";
      communityJoinBtn.disabled = true;
      communityJoinBtn.classList.add("is-pending");
      return;
    }

    const label =
      myJoinRequestStatus === "rejected" ? "Yeniden istek gönder" : "Katılma isteği gönder";
    communityJoinBtn.textContent = label;
    communityJoinBtn.classList.add("is-request", "js-community-join-request");
    return;
  }

  communityJoinActions.hidden = false;
  if (!isUserLoggedIn) {
    communityJoinBtn.textContent = "Giriş yap ve katıl";
  } else {
    communityJoinBtn.textContent = "Topluluğa Katıl";
  }
  communityJoinBtn.classList.add("js-community-join-public");
}

async function loadMyJoinRequestStatus() {
  myJoinRequestStatus = null;
  if (!currentUserId || !communityId || !getSb() || isCommunityAdmin || isCommunityMember) {
    return;
  }

  const { data, error } = await getSb()
    .from("community_join_requests")
    .select("status")
    .eq("community_id", communityId)
    .eq("user_id", currentUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data?.status) {
    myJoinRequestStatus = data.status;
  }
}

async function joinPublicCommunity() {
  if (!communityId || !getSb()) return;

  if (!isUserLoggedIn) {
    window.location.href = "/login";
    return;
  }

  if (communityJoinBtn) communityJoinBtn.disabled = true;

  try {
    const { error } = await getSb().from("community_members").upsert(
      [{ community_id: communityId, user_id: currentUserId }],
      { onConflict: "community_id,user_id" }
    );
    if (error) throw error;

    isCommunityMember = true;
    updateAccessFlags();
    renderCommunityHeader();
    await loadMembers();
    if (canViewFeed) await loadPosts();

    await rekabetliAlert({
      title: "Topluluğa katıldın",
      message: "Artık bu topluluğun üyesisin.",
      showCancel: false,
      confirmLabel: "Tamam",
    });
  } catch (error) {
    console.error("Public join error:", error.message);
    await rekabetliAlert({
      title: "Katılınamadı",
      message: "Üyelik eklenemedi. Topluluğun açık olduğundan emin olun.",
      showCancel: false,
      confirmLabel: "Tamam",
    });
  } finally {
    updateJoinActions();
  }
}

async function sendJoinRequestPrivate() {
  if (!communityId || !getSb()) return;

  if (!isUserLoggedIn) {
    window.location.href = "/login";
    return;
  }

  if (communityJoinBtn) communityJoinBtn.disabled = true;

  try {
    const { error } = await getSb().from("community_join_requests").insert([
      { community_id: communityId, user_id: currentUserId, status: "pending" },
    ]);

    if (error) {
      if (error.code === "23505") {
        myJoinRequestStatus = "pending";
        updateJoinActions();
        return;
      }
      throw error;
    }

    myJoinRequestStatus = "pending";
    updateJoinActions();

    await rekabetliAlert({
      title: "İstek gönderildi",
      message: "Katılma talebin topluluk yöneticisine iletildi.",
      showCancel: false,
      confirmLabel: "Tamam",
    });
  } catch (error) {
    console.error("Join request error:", error.message);
    await rekabetliAlert({
      title: "İstek gönderilemedi",
      message: "Katılma talebi iletilemedi. Bağlantıyı kontrol edin.",
      showCancel: false,
      confirmLabel: "Tamam",
    });
  } finally {
    updateJoinActions();
  }
}

async function leaveCommunity() {
  if (!communityId || !getSb() || !isUserLoggedIn || isCommunityAdmin) return;

  if (
    !(await rekabetliConfirm({
      title: "Topluluktan ayrıl",
      message: "Bu topluluktan ayrılmak istediğine emin misin?",
      confirmLabel: "Ayrıl",
      cancelLabel: "Vazgeç",
    }))
  ) {
    return;
  }

  if (communityJoinBtn) communityJoinBtn.disabled = true;

  try {
    const { error: memberError } = await getSb()
      .from("community_members")
      .delete()
      .eq("community_id", communityId)
      .eq("user_id", currentUserId);

    if (memberError) throw memberError;

    await getSb()
      .from("community_join_requests")
      .delete()
      .eq("community_id", communityId)
      .eq("user_id", currentUserId);

    window.location.href = "/communities";
    return;
  } catch (error) {
    console.error("Leave community error:", error.message);
    await rekabetliAlert({
      title: "Ayrılamadın",
      message: "Topluluktan ayrılamadın. supabase-community-member-leave.sql dosyasını çalıştırdığınızdan emin olun.",
      showCancel: false,
      confirmLabel: "Tamam",
    });
  } finally {
    updateJoinActions();
  }
}

async function closeCommunity() {
  if (!communityId || !getSb() || !isCommunityAdmin) return;

  if (
    !(await rekabetliConfirm({
      title: "Topluluğu kapat",
      message:
        "Bu topluluk ve içindeki tüm paylaşımlar kalıcı olarak silinecek. Bu işlem geri alınamaz.",
      confirmLabel: "Topluluğu kapat",
      cancelLabel: "Vazgeç",
      danger: true,
    }))
  ) {
    return;
  }

  if (communityJoinBtn) communityJoinBtn.disabled = true;

  try {
    const { error } = await getSb().from("communities").delete().eq("id", communityId);

    if (error) throw error;

    window.location.href = "/communities";
  } catch (error) {
    console.error("Close community error:", error.message);
    await rekabetliAlert({
      title: "Kapatılamadı",
      message: "Topluluk silinemedi. Yetkileri kontrol edin.",
      showCancel: false,
      confirmLabel: "Tamam",
    });
    if (communityJoinBtn) communityJoinBtn.disabled = false;
  }
}

function showPageError(message) {
  if (pageError) {
    pageError.hidden = false;
    pageError.textContent = message;
  }
  if (pageMain) pageMain.hidden = true;
}

function getCommunityInitials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function updateCommunityMetaLine(memberCount) {
  if (!communityMetaEl || !community) return;
  const capacity = SIZE_LABELS[community.size_band] || community.size_band;
  const countPart =
    typeof memberCount === "number" ? ` · ${memberCount} üye` : "";
  communityMetaEl.textContent = `Kapasite: ${capacity}${countPart}`;
}

function renderCommunityHeader() {
  if (!community) return;

  document.title = `${community.name} | rekabetli.com`;
  if (communityNameEl) communityNameEl.textContent = community.name;
  if (communityPurposeEl) communityPurposeEl.textContent = community.purpose;
  updateCommunityMetaLine();

  const isPrivate = community.visibility === "private";
  if (communityVisibilityBadge) {
    communityVisibilityBadge.textContent = isPrivate ? "Gizli topluluk" : "Açık topluluk";
    communityVisibilityBadge.className = `community-visibility-badge ${isPrivate ? "is-private" : "is-public"}`;
  }

  if (communityAvatarImg && communityAvatarFallback && community.avatar_url && setSafeImgSrc(communityAvatarImg, community.avatar_url)) {
    communityAvatarImg.hidden = false;
    communityAvatarFallback.hidden = true;
  } else if (communityAvatarImg && communityAvatarFallback) {
    communityAvatarImg.hidden = true;
    communityAvatarFallback.hidden = false;
    communityAvatarFallback.textContent = getCommunityInitials(community.name);
  }

  communityAdminNote.hidden = !isCommunityAdmin;
  updateJoinActions();
}

function setupCommunityPanelAccordion() {
  if (!panelAccordion) return;

  panelAccordion.querySelectorAll(".activity-accordion-section").forEach((section) => {
    const trigger = section.querySelector(".activity-accordion-trigger");
    if (!trigger || trigger.dataset.accordionBound === "true") return;

    trigger.dataset.accordionBound = "true";
    trigger.addEventListener("click", () => {
      const willOpen = !section.classList.contains("is-open");
      section.classList.toggle("is-open", willOpen);
      trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
  });
}

function updateJoinRequestsSectionVisibility() {
  if (!joinRequestsSection || !community) return;

  const show = isCommunityAdmin && community.visibility === "private";
  joinRequestsSection.hidden = !show;
}

function renderJoinRequestItem({ id, displayName, avatarUrl, createdAt }) {
  const item = document.createElement("div");
  item.className = "community-member-item community-join-request-item";
  item.dataset.requestId = id;

  const avatarWrap = document.createElement("div");
  avatarWrap.className = "community-member-avatar";
  const img = document.createElement("img");
  const fallback = document.createElement("span");
  fallback.className = "community-member-avatar-fallback";

  if (avatarUrl && setSafeImgSrc(img, avatarUrl)) {
    img.alt = "";
    avatarWrap.appendChild(img);
  } else {
    fallback.textContent = getCommunityInitials(displayName);
    avatarWrap.appendChild(fallback);
  }

  const body = document.createElement("div");
  body.className = "community-member-body";
  const nameEl = document.createElement("strong");
  nameEl.textContent = displayName;
  const metaEl = document.createElement("span");
  metaEl.className = "community-member-role";
  metaEl.textContent = `İstek · ${formatDate(createdAt)}`;
  body.append(nameEl, metaEl);

  const actions = document.createElement("div");
  actions.className = "community-join-request-actions";

  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "community-join-approve-btn js-approve-join-request";
  approveBtn.dataset.requestId = id;
  approveBtn.textContent = "Kabul et";
  approveBtn.setAttribute("aria-label", `${displayName} isteğini kabul et`);

  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.className = "community-join-reject-btn js-reject-join-request";
  rejectBtn.dataset.requestId = id;
  rejectBtn.textContent = "Reddet";
  rejectBtn.setAttribute("aria-label", `${displayName} isteğini reddet`);

  actions.append(approveBtn, rejectBtn);
  item.append(avatarWrap, body, actions);
  return item;
}

async function loadJoinRequests() {
  if (!panelJoinRequests || !community || !isCommunityAdmin || community.visibility !== "private") {
    return;
  }

  const { data: requests, error } = await getSb()
    .from("community_join_requests")
    .select("id, user_id, created_at, status")
    .eq("community_id", community.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Join requests load error:", error.message);
    panelJoinRequests.replaceChildren();
    const err = document.createElement("p");
    err.className = "empty";
    err.textContent = "İstekler yüklenemedi.";
    panelJoinRequests.appendChild(err);
    if (countJoinRequests) countJoinRequests.textContent = "0";
    return;
  }

  const pending = requests ?? [];
  if (countJoinRequests) countJoinRequests.textContent = String(pending.length);

  panelJoinRequests.replaceChildren();

  if (!pending.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Bekleyen katılma isteği yok.";
    panelJoinRequests.appendChild(empty);
    return;
  }

  const userIds = [...new Set(pending.map((row) => row.user_id))];
  let profilesById = new Map();

  if (userIds.length > 0) {
    const { data: profiles } = await getSb()
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", userIds);

    (profiles ?? []).forEach((profile) => {
      profilesById.set(profile.id, profile);
    });
  }

  pending.forEach((row) => {
    const profile = profilesById.get(row.user_id);
    panelJoinRequests.appendChild(
      renderJoinRequestItem({
        id: row.id,
        displayName: profile?.display_name?.trim() || "Kullanıcı",
        avatarUrl: profile?.avatar_url?.trim() || null,
        createdAt: row.created_at,
      })
    );
  });
}

async function approveJoinRequest(requestId) {
  if (!requestId || !getSb()) return;

  const { error } = await getSb().rpc("approve_community_join_request", {
    request_id: requestId,
  });

  if (error) {
    console.error("Approve join request error:", error.message);
    await rekabetliAlert({
      title: "Kabul edilemedi",
      message: "İstek onaylanamadı. Yetkileri veya bağlantıyı kontrol edin.",
      showCancel: false,
      confirmLabel: "Tamam",
    });
    return;
  }

  await loadMembers();
  await loadJoinRequests();
  window.rekabetliNotifications?.refresh();
}

async function rejectJoinRequest(requestId) {
  if (!requestId || !getSb()) return;

  const row = panelJoinRequests?.querySelector(
    `[data-request-id="${CSS.escape(String(requestId))}"]`
  );
  const displayName =
    row?.querySelector(".community-member-body strong")?.textContent?.trim() || "Bu kullanıcı";

  if (
    !(await rekabetliConfirm({
      title: "İsteği reddet",
      message: `${displayName} kullanıcısının katılma isteği reddedilsin mi?`,
      confirmLabel: "Reddet",
      cancelLabel: "Vazgeç",
    }))
  ) {
    return;
  }

  const { error } = await getSb().rpc("reject_community_join_request", {
    request_id: requestId,
  });

  if (error) {
    console.error("Reject join request error:", error.message);
    await rekabetliAlert({
      title: "Reddedilemedi",
      message: "İstek reddedilemedi. SQL dosyasını çalıştırdığınızdan emin olun.",
      showCancel: false,
      confirmLabel: "Tamam",
    });
    return;
  }

  await loadJoinRequests();
}

function renderMemberItem({ id, displayName, avatarUrl, roleLabel, joinedAt, removable, isMentor }) {
  const item = document.createElement("div");
  item.className = "community-member-item";

  const avatarWrap = document.createElement("div");
  avatarWrap.className = "community-member-avatar";
  const img = document.createElement("img");
  const fallback = document.createElement("span");
  fallback.className = "community-member-avatar-fallback";

  if (avatarUrl && setSafeImgSrc(img, avatarUrl)) {
    img.alt = "";
    avatarWrap.appendChild(img);
  } else {
    fallback.textContent = getCommunityInitials(displayName);
    avatarWrap.appendChild(fallback);
  }

  const body = document.createElement("div");
  body.className = "community-member-body";
  const nameEl = document.createElement("strong");
  nameEl.textContent = displayName;
  if (isMentor) {
    nameEl.appendChild(document.createTextNode(" "));
    nameEl.appendChild(createMentorBadge());
  }
  const metaEl = document.createElement("span");
  metaEl.className = "community-member-role";
  metaEl.textContent = roleLabel + (joinedAt ? ` · ${formatDate(joinedAt)}` : "");

  body.append(nameEl, metaEl);
  item.append(avatarWrap, body);

  if (removable) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "community-member-remove-btn js-remove-community-member";
    removeBtn.dataset.userId = id;
    removeBtn.setAttribute("aria-label", `${displayName} üyeliğini kaldır`);
    removeBtn.textContent = "Çıkar";
    item.append(removeBtn);
  }

  return item;
}

async function removeCommunityMember(userId) {
  if (!community || !getSb() || !isCommunityAdmin || !userId) return;
  if (userId === community.owner_id) return;

  const memberRow = panelMembers?.querySelector(
    `.js-remove-community-member[data-user-id="${userId}"]`
  )?.closest(".community-member-item");
  const displayName =
    memberRow?.querySelector(".community-member-body strong")?.textContent?.trim() || "Bu üye";

  if (
    !(await rekabetliConfirm({
      title: "Üyeyi kaldır",
      message: `${displayName} topluluktan çıkarılsın mı?`,
      confirmLabel: "Kaldır",
      cancelLabel: "Vazgeç",
    }))
  ) {
    return;
  }

  const { error } = await getSb()
    .from("community_members")
    .delete()
    .eq("community_id", community.id)
    .eq("user_id", userId);

  if (error) {
    console.error("Remove member error:", error.message);
    await rekabetliAlert({
      title: "Kaldırılamadı",
      message: "Üye çıkarılamadı. Yetkileri kontrol edin.",
      showCancel: false,
      confirmLabel: "Tamam",
    });
    return;
  }

  await loadMembers();
}

async function loadMembers() {
  if (!panelMembers || !community) return;

  const seq = ++membersLoadSeq;

  const { data: ownerProfile } = await getSb()
    .from("profiles")
    .select("id, display_name, avatar_url, is_mentor")
    .eq("id", community.owner_id)
    .maybeSingle();

  if (seq !== membersLoadSeq) return;

  const memberRows = [
    {
      id: community.owner_id,
      displayName: ownerProfile?.display_name?.trim() || "Kurucu",
      avatarUrl: ownerProfile?.avatar_url?.trim() || null,
      isMentor: Boolean(ownerProfile?.is_mentor),
      roleLabel: "Kurucu · Admin",
      joinedAt: community.created_at,
    },
  ];
  const seenUserIds = new Set([String(community.owner_id).toLowerCase()]);

  const { data: membersData, error } = await getSb()
    .from("community_members")
    .select("user_id, joined_at")
    .eq("community_id", community.id)
    .order("joined_at", { ascending: true });

  if (seq !== membersLoadSeq) return;

  if (error) {
    console.error("Members load error:", error.message);
  } else {
    const uniqueMembers = new Map();
    (membersData ?? []).forEach((row) => {
      const uid = String(row.user_id).toLowerCase();
      if (seenUserIds.has(uid)) return;
      if (!uniqueMembers.has(uid)) uniqueMembers.set(uid, row);
    });

    const otherIds = [...uniqueMembers.values()].map((row) => row.user_id);

    let profilesById = new Map();
    if (otherIds.length > 0) {
      const { data: profiles } = await getSb()
        .from("profiles")
        .select("id, display_name, avatar_url, is_mentor")
        .in("id", otherIds);

      if (seq !== membersLoadSeq) return;

      (profiles ?? []).forEach((p) => profilesById.set(p.id, p));
    }

    uniqueMembers.forEach((row) => {
      const uid = String(row.user_id).toLowerCase();
      if (seenUserIds.has(uid)) return;
      seenUserIds.add(uid);
      const profile = profilesById.get(row.user_id);
      memberRows.push({
        id: row.user_id,
        displayName: profile?.display_name?.trim() || "Üye",
        avatarUrl: profile?.avatar_url?.trim() || null,
        isMentor: Boolean(profile?.is_mentor),
        roleLabel: "Üye",
        joinedAt: row.joined_at,
      });
    });
  }

  if (seq !== membersLoadSeq) return;

  panelMembers.replaceChildren();

  const totalMembers = memberRows.length;
  if (countMembers) countMembers.textContent = String(totalMembers);
  updateCommunityMetaLine(totalMembers);

  if (!memberRows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Henüz üye yok.";
    panelMembers.appendChild(empty);
    return;
  }

  memberRows.forEach((row) => {
    const isOwnerRow = row.id === community.owner_id;
    panelMembers.appendChild(
      renderMemberItem({
        ...row,
        removable: isCommunityAdmin && !isOwnerRow,
      })
    );
  });
}

function updateAccessFlags() {
  if (!community) return;

  isCommunityAdmin = Boolean(currentUserId && community.owner_id === currentUserId);
  if (isCommunityAdmin) {
    isCommunityMember = true;
  }

  const isPublic = community.visibility === "public";
  canViewFeed = isPublic || isCommunityAdmin || isCommunityMember;
  canPostInCommunity = Boolean(currentUserId && (isCommunityAdmin || isCommunityMember));

  if (feedGate) {
    if (!canViewFeed) {
      feedGate.hidden = false;
      feedGate.textContent = isPublic
        ? "Akışı görmek için giriş yapmalısın."
        : "Bu gizli topluluğun akışını yalnızca üyeler görebilir.";
      if (questionList) questionList.replaceChildren();
    } else {
      feedGate.hidden = true;
    }
  }

  updateShareButtons();
  updateJoinActions();
  updateJoinRequestsSectionVisibility();
}

async function loadCommunity() {
  if (!communityId) {
    showPageError("Topluluk bulunamadı. Geçerli bir bağlantı kullanın.");
    return false;
  }

  if (!getSb()) {
    showPageError("Bağlantı kurulamadı. Sayfayı yenileyin.");
    return false;
  }

  try {
    const { data, error } = await getSb()
      .from("communities")
      .select("id, owner_id, name, purpose, size_band, visibility, avatar_url, created_at")
      .eq("id", communityId)
      .maybeSingle();

    if (error || !data) {
      showPageError("Bu topluluk bulunamadı veya görüntüleme yetkiniz yok.");
      return false;
    }

    community = data;

    if (currentUserId) {
      const { data: membership } = await getSb()
        .from("community_members")
        .select("user_id")
        .eq("community_id", communityId)
        .eq("user_id", currentUserId)
        .maybeSingle();

      isCommunityMember =
        Boolean(membership) || sameUserId(community.owner_id, currentUserId);
    }

    await loadMyJoinRequestStatus();
    updateAccessFlags();
    renderCommunityHeader();
    await loadMembers();
    setupCommunityPanelAccordion();
    updateJoinRequestsSectionVisibility();
    if (isCommunityAdmin && community.visibility === "private") {
      await loadJoinRequests();
    }

    if (pageMain) pageMain.hidden = false;
    return true;
  } catch (error) {
    console.error("Community load failed:", error);
    showPageError("Topluluk yüklenirken bir hata oluştu. Sayfayı yenileyin.");
    return false;
  }
}

async function applyAuthToCommunityAccess(user) {
  await syncFeedUserContext(user);
  if (!community) return;

  isCommunityMember = false;
  myJoinRequestStatus = null;

  if (currentUserId) {
    const { data: membership } = await getSb()
      .from("community_members")
      .select("user_id")
      .eq("community_id", communityId)
      .eq("user_id", currentUserId)
      .maybeSingle();

    isCommunityMember = Boolean(membership) || sameUserId(community.owner_id, currentUserId);
  }

  await loadMyJoinRequestStatus();
  updateAccessFlags();
  renderCommunityHeader();
  await loadMembers();
  setupCommunityPanelAccordion();
  updateJoinRequestsSectionVisibility();

  if (isCommunityAdmin && community.visibility === "private") {
    await loadJoinRequests();
  }
}

async function hydrateCommunityFeedAuth(user) {
  try {
    if (!community) return;
    await applyAuthToCommunityAccess(user);
    await loadPosts();
  } catch (error) {
    console.error("[rekabetli][community-feed-auth-hydrate-error]", error);
  }
}

function bindCommunityFeedAuthListener() {
  if (communityFeedAuthBound || !window.RekabetliAuth) return;
  communityFeedAuthBound = true;

  window.RekabetliAuth.subscribe((state) => {
    if (!state.ready) return;
    if (skipInitialFeedAuthHydrate) {
      skipInitialFeedAuthHydrate = false;
      return;
    }
    void hydrateCommunityFeedAuth(state.user);
  });
}

async function bootstrapCommunityFeedPage() {
  try {
    if (!getSb()) {
      showPageError("Bağlantı kurulamadı.");
      return;
    }

    const auth = window.RekabetliAuth;
    const state = auth ? await auth.whenReady() : { user: null };

    await syncFeedUserContext(state.user);
    const ok = await loadCommunity();
    if (!ok) return;
    await loadPosts();
    bindCommunityFeedAuthListener();
  } catch (error) {
    console.error("Community bootstrap failed:", error);
    showPageError("Sayfa yüklenirken bir hata oluştu. Lütfen yenileyin.");
  }
}

function scrollToFeedTarget() {
  const params = new URLSearchParams(window.location.search);
  const postId = params.get("post");
  const commentId = params.get("comment");
  if (!postId && !commentId) return;

  let target = null;
  if (commentId) target = document.getElementById(`comment-${commentId}`);
  if (!target && postId) target = document.getElementById(`post-${postId}`);
  if (!target) return;

  document.querySelectorAll(".feed-item-highlight").forEach((el) => {
    el.classList.remove("feed-item-highlight");
  });
  target.classList.add("feed-item-highlight");

  window.requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("post");
  cleanUrl.searchParams.delete("comment");
  const query = cleanUrl.searchParams.toString();
  window.history.replaceState({}, "", query ? `${cleanUrl.pathname}?${query}` : cleanUrl.pathname);
}

// --- 6. VERİTABANI İŞLEMLERİ (Sorular ve Cevaplar) ---
function renderAnswers(container, answers, postId) {
  if (!container) return;
  container.replaceChildren();
  if (!answers?.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Henüz yanıt yok.";
    container.appendChild(empty);
    return;
  }

  answers.forEach((answer) => {
    const answerEl = document.createElement("div");
    answerEl.className = "answer";
    answerEl.id = `comment-${answer.id}`;

    const header = document.createElement("div");
    header.className = "answer-header";
    const author = document.createElement("strong");
    author.textContent = answer.author;
    header.append(author);
    if (answer.authorIsMentor) {
      header.appendChild(createMentorBadge());
    }
    header.append(document.createTextNode(` · ${formatDate(answer.createdAt)}`));

    const content = document.createElement("div");
    content.className = "rich-content";
    window.RekabetliQuill?.renderRichContent(content, answer.content);

    answerEl.append(header, content);

    window.RekabetliCommentRatings?.renderRatingBlock(answerEl, answer, {
      currentUserId,
      isLoggedIn: isUserLoggedIn,
      onRequireLogin: () => {
        window.location.href = "/login";
      },
    });

    const isCommentOwner = Boolean(currentUserId && answer.userId && answer.userId === currentUserId);
    if (isCommentOwner) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "secondary danger answer-delete-btn";
      deleteBtn.textContent = "Sil";
      deleteBtn.addEventListener("click", async () => {
        if (
          !(await rekabetliConfirm({
            title: "Yanıtı sil",
            message: "Bu yanıtı kalıcı olarak silmek istediğine emin misin?",
            confirmLabel: "Sil",
            cancelLabel: "Vazgeç",
            danger: true,
          }))
        )
          return;
        try {
          await deleteComment(answer.id);
          const target = questions.find((q) => q.id === postId);
          if (target) {
            target.answers = target.answers.filter((a) => a.id !== answer.id);
            renderQuestions();
          }
          window.rekabetliNotifications?.refresh();
        } catch (error) {
          console.error("Comment delete error:", error.message);
          await rekabetliAlert({ title: "Silinemedi", message: "Yanıt silinemedi." });
        }
      });
      answerEl.appendChild(deleteBtn);
    }

    container.appendChild(answerEl);
  });
}

function mapPostRow(postRow) {
  return {
    id: postRow.id,
    userId: postRow.user_id ?? null,
    author: postRow.author,
    title: postRow.title,
    content: postRow.content,
    createdAt: postRow.created_at,
    authorIsMentor: false,
    likeCount: 0,
    likedByMe: false,
    savedByMe: false,
    answers: [],
  };
}

function buildLikeStats(likeRows, userId) {
  const countByPostId = new Map();
  const likedByMe = new Set();

  (likeRows ?? []).forEach((row) => {
    countByPostId.set(row.post_id, (countByPostId.get(row.post_id) ?? 0) + 1);
    if (userId && row.user_id === userId) likedByMe.add(row.post_id);
  });

  return { countByPostId, likedByMe };
}

function buildSavedSet(saveRows, userId) {
  const savedByMe = new Set();
  if (!userId) return savedByMe;
  (saveRows ?? []).forEach((row) => {
    if (row.user_id === userId) savedByMe.add(row.post_id);
  });
  return savedByMe;
}

function mapCommentRow(commentRow) {
  return {
    id: commentRow.id,
    postId: commentRow.post_id,
    userId: commentRow.user_id ?? null,
    author: commentRow.author,
    content: commentRow.content,
    createdAt: commentRow.created_at,
    authorIsMentor: false,
  };
}

async function loadPosts() {
  if (!canViewFeed || !communityId) {
    if (questionList) questionList.replaceChildren();
    return;
  }

  try {
    const { data: postRows, error: postsError } = await getSb()
      .from("posts")
      .select("id, user_id, author, title, content, created_at")
      .eq("community_id", communityId)
      .order("created_at", { ascending: false });

    if (postsError) {
      console.error("Posts load error:", postsError.message);
      if (questionList) {
        showEmptyListMessage(
          questionList,
          "Veriler yüklenemedi. Supabase'de user_id sütunu ve tablolar için supabase-post-actions.sql dosyasını çalıştırın."
        );
      }
      return;
    }

    const mappedPosts = (postRows ?? []).map(mapPostRow);
    const postIds = mappedPosts.map((post) => post.id);

    let commentRows = [];
    let likeRows = [];
    let saveRows = [];

    if (postIds.length > 0) {
      const [commentsResult, likesResult, savesResult] = await Promise.all([
        getSb()
          .from("comments")
          .select("id, post_id, user_id, author, content, created_at")
          .in("post_id", postIds)
          .order("created_at", { ascending: false }),
        getSb().from("post_likes").select("post_id, user_id").in("post_id", postIds),
        getSb().from("post_saves").select("post_id, user_id").in("post_id", postIds),
      ]);

      if (commentsResult.error) {
        console.error("Comments load error:", commentsResult.error.message);
      } else {
        commentRows = commentsResult.data ?? [];
      }

      if (likesResult.error) {
        console.error("Likes load error:", likesResult.error.message);
      } else {
        likeRows = likesResult.data ?? [];
      }

      if (savesResult.error) {
        console.error("Saves load error:", savesResult.error.message);
      } else {
        saveRows = savesResult.data ?? [];
      }
    }

    const { countByPostId, likedByMe } = buildLikeStats(likeRows, currentUserId);
    const savedByMe = buildSavedSet(saveRows, currentUserId);
    const allComments = commentRows.map(mapCommentRow);

    const authorIds = [
      ...new Set(
        [...mappedPosts.map((post) => post.userId), ...allComments.map((comment) => comment.userId)].filter(
          Boolean
        )
      ),
    ];
    const profilesByUserId = new Map();

    if (authorIds.length > 0) {
      const { data: profileRows, error: profilesError } = await getSb()
        .from("profiles")
        .select("id, display_name, avatar_url, is_mentor")
        .in("id", authorIds);

      if (profilesError) {
        console.error("Profiles load error:", profilesError.message);
      } else {
        (profileRows ?? []).forEach((row) => profilesByUserId.set(row.id, row));
      }
    }

    const commentIds = allComments.map((c) => c.id);
    const ratingStats = await window.RekabetliCommentRatings?.loadStatsForCommentIds(commentIds, currentUserId);
    if (ratingStats) {
      window.RekabetliCommentRatings.enrichComments(allComments, ratingStats);
    }

    const commentsByPostId = new Map();
    allComments.forEach((comment) => {
      const list = commentsByPostId.get(comment.postId) ?? [];
      list.push(comment);
      commentsByPostId.set(comment.postId, list);
    });

    questions = mappedPosts.map((post) => {
      const profile = post.userId ? profilesByUserId.get(post.userId) : null;
      return {
        ...post,
        authorAvatarUrl: profile?.avatar_url?.trim() || null,
        authorIsMentor: Boolean(profile?.is_mentor),
        likeCount: countByPostId.get(post.id) ?? 0,
        likedByMe: likedByMe.has(post.id),
        savedByMe: savedByMe.has(post.id),
        answers: (commentsByPostId.get(post.id) ?? []).map((answer) => {
          const answerProfile = answer.userId ? profilesByUserId.get(answer.userId) : null;
          return {
            ...answer,
            authorIsMentor: Boolean(answerProfile?.is_mentor),
          };
        }),
      };
    });

    renderQuestions();
    scrollToFeedTarget();
  } catch (error) {
    console.error("Community posts load failed:", error);
    if (questionList) {
      showEmptyListMessage(questionList, "Paylaşımlar yüklenirken bir hata oluştu. Sayfayı yenileyin.");
    }
  }
}

async function savePost({ author, title, content, userId }) {
  const row = { author, title, content, community_id: communityId };
  if (userId) row.user_id = userId;

  const { data, error } = await getSb()
    .from("posts")
    .insert([row])
    .select("id, user_id, author, title, content, created_at")
    .single();

  if (error) throw error;
  return mapPostRow(data);
}

async function deletePost(postId) {
  const { error } = await getSb().from("posts").delete().eq("id", postId);
  if (error) throw error;
}

async function deleteComment(commentId) {
  if (!currentUserId) {
    window.location.href = "/login";
    return;
  }

  const { error } = await getSb()
    .from("comments")
    .delete()
    .eq("id", commentId)
    .eq("user_id", currentUserId);
  if (error) throw error;
}

async function setPostLiked(postId, shouldLike) {
  if (!currentUserId) {
    window.location.href = "/login";
    return;
  }

  if (shouldLike) {
    const { error } = await getSb()
      .from("post_likes")
      .insert([{ post_id: postId, user_id: currentUserId }]);
    if (error) throw error;
    return;
  }

  const { error } = await getSb()
    .from("post_likes")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", currentUserId);
  if (error) throw error;
}

async function setPostSaved(postId, shouldSave) {
  if (!currentUserId) {
    window.location.href = "/login";
    return;
  }

  if (shouldSave) {
    const { error } = await getSb()
      .from("post_saves")
      .insert([{ post_id: postId, user_id: currentUserId }]);
    if (error) throw error;
    return;
  }

  const { error } = await getSb()
    .from("post_saves")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", currentUserId);
  if (error) throw error;
}

function requireLoginForAction() {
  if (isUserLoggedIn) return true;
  window.location.href = "/login";
  return false;
}

async function saveComment({ postId, author, content, userId }) {
  const row = { post_id: postId, author, content };
  if (userId) row.user_id = userId;

  const { data, error } = await getSb()
    .from("comments")
    .insert([row])
    .select("id, post_id, user_id, author, content, created_at")
    .single();

  if (error) throw error;
  const mapped = mapCommentRow(data);
  mapped.ratingAvg = null;
  mapped.ratingCount = 0;
  mapped.myRating = null;
  return mapped;
}

function renderQuestions() {
  if (!questionList || !template?.content) return;
  
  questionList.replaceChildren();
  if (!questions.length) {
    showEmptyListMessage(questionList, "Henüz paylaşım yok. İlk paylaşımı sen yapabilirsin.");
    return;
  }

  const ordered = [...questions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  ordered.forEach((question) => {
    const fragment = template.content.cloneNode(true);

    const cardEl = fragment.querySelector(".question-card");
    const titleEl = fragment.querySelector(".question-title");
    const metaEl = fragment.querySelector(".question-meta");
    const questionContentEl = fragment.querySelector(".question-content");
    const likeBtn = fragment.querySelector(".like-btn");
    const likeCountEl = fragment.querySelector(".like-count");
    const saveBtn = fragment.querySelector(".save-btn");
    const deleteBtn = fragment.querySelector(".delete-btn");
    const answersContainer = fragment.querySelector(".answers");
    const answerToggleBtn = fragment.querySelector(".answer-toggle-btn");
    const answerForm = fragment.querySelector(".answer-form");

    if (
      !cardEl ||
      !titleEl ||
      !metaEl ||
      !likeBtn ||
      !likeCountEl ||
      !saveBtn ||
      !deleteBtn ||
      !answersContainer ||
      !answerToggleBtn ||
      !answerForm
    ) {
      return;
    }

    cardEl.id = `post-${question.id}`;
    applyQuestionAvatar(cardEl, question.authorAvatarUrl, question.author);

    titleEl.textContent = question.title;
    metaEl.replaceChildren();
    const authorText = document.createElement("span");
    authorText.textContent = question.author;
    metaEl.append(authorText);
    if (question.authorIsMentor) {
      metaEl.appendChild(createMentorBadge());
    }
    metaEl.append(document.createTextNode(` · ${formatDate(question.createdAt)}`));
    window.RekabetliQuill?.renderRichContent(questionContentEl, question.content);

    likeCountEl.textContent = String(question.likeCount ?? 0);
    likeBtn.setAttribute("aria-pressed", question.likedByMe ? "true" : "false");
    likeBtn.setAttribute("aria-label", question.likedByMe ? "Beğeniyi kaldır" : "Beğen");

    saveBtn.setAttribute("aria-pressed", question.savedByMe ? "true" : "false");
    saveBtn.textContent = question.savedByMe ? "Kaldır" : "Kaydet";

    const isOwner = Boolean(currentUserId && question.userId && question.userId === currentUserId);
    if (!isOwner) {
      deleteBtn.remove();
    }

    likeBtn.addEventListener("click", async () => {
      if (!requireLoginForAction()) return;

      const target = questions.find((q) => q.id === question.id);
      if (!target) return;

      const nextLiked = !target.likedByMe;
      try {
        await setPostLiked(question.id, nextLiked);
        target.likedByMe = nextLiked;
        target.likeCount = Math.max(0, (target.likeCount ?? 0) + (nextLiked ? 1 : -1));
        renderQuestions();
        if (nextLiked) window.rekabetliNotifications?.refresh();
      } catch (error) {
        console.error("Like toggle error:", error.message);
        await rekabetliAlert({ title: "Hata", message: "Beğeni kaydedilemedi." });
      }
    });

    saveBtn.addEventListener("click", async () => {
      if (!requireLoginForAction()) return;

      const target = questions.find((q) => q.id === question.id);
      if (!target) return;

      const nextSaved = !target.savedByMe;
      try {
        await setPostSaved(question.id, nextSaved);
        target.savedByMe = nextSaved;
        renderQuestions();
      } catch (error) {
        console.error("Save toggle error:", error.message);
        await rekabetliAlert({ title: "Hata", message: "Kayıt işlemi başarısız." });
      }
    });

    if (isOwner) {
      deleteBtn.addEventListener("click", async () => {
        if (
          !(await rekabetliConfirm({
            title: "Soruyu sil",
            message: "Bu soruyu ve altındaki yanıtları kalıcı olarak silmek istediğine emin misin?",
            confirmLabel: "Sil",
            cancelLabel: "Vazgeç",
            danger: true,
          }))
        )
          return;

        try {
          await deletePost(question.id);
          questions = questions.filter((q) => q.id !== question.id);
          renderQuestions();
          window.rekabetliNotifications?.refresh();
        } catch (error) {
          console.error("Post delete error:", error.message);
          await rekabetliAlert({
            title: "Silinemedi",
            message: "Soru silinemedi. Yalnızca kendi gönderilerini silebilirsin.",
          });
        }
      });
    }

    renderAnswers(answersContainer, question.answers, question.id);

    answerToggleBtn.addEventListener("click", () => {
      if (!requireLoginForAction()) return;
      if (!canPostInCommunity) {
        void rekabetliAlert({
          title: "Üye olmalısın",
          message: "Yanıt yazmak için topluluğa üye olman gerekir.",
          showCancel: false,
          confirmLabel: "Tamam",
        });
        return;
      }

      const shouldShowForm = answerForm.hidden;
      answerForm.hidden = !shouldShowForm;
      answerToggleBtn.textContent = shouldShowForm ? "Vazgeç" : "Cevapla";

      if (shouldShowForm) {
        const editor = window.RekabetliQuill?.ensureAnswerEditor(answerForm);
        if (!editor) {
          answerForm.hidden = true;
          answerToggleBtn.textContent = "Cevapla";
          void editorUnavailableAlert();
        }
      } else if (answerForm._rekabetliQuill) {
        window.RekabetliQuill?.clear(answerForm._rekabetliQuill);
      }
    });

    answerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLoginForAction()) return;
      if (!canPostInCommunity) return;

      const answerQuill = window.RekabetliQuill?.ensureAnswerEditor(answerForm);
      if (!answerQuill) {
        await editorUnavailableAlert();
        return;
      }

      const answerContent = window.RekabetliQuill?.getHtml(answerQuill) || "";
      if (!answerContent) {
        await rekabetliAlert({
          title: "Boş yanıt",
          message: "Yanıt yazmadan gönderemezsin.",
        });
        return;
      }

      try {
        const newComment = await saveComment({
          postId: question.id,
          author: getCurrentAuthorName(),
          content: answerContent,
          userId: currentUserId,
        });

        const target = questions.find((q) => q.id === question.id);
        if (target) {
          newComment.authorIsMentor = currentUserIsMentor;
          target.answers.unshift(newComment);
          renderQuestions();
        }
        if (answerForm._rekabetliQuill) window.RekabetliQuill?.clear(answerForm._rekabetliQuill);
        answerForm.hidden = true;
        answerToggleBtn.textContent = "Cevapla";
        window.rekabetliNotifications?.refresh();
      } catch (error) {
        console.error("Comment insert error:", error.message);
        await rekabetliAlert({
          title: "Hata",
          message: "Yanıt kaydedilemedi. Bağlantı veya izinleri kontrol et.",
        });
      }
    });

    questionList.appendChild(fragment);
  });
}

// --- 7. EVENT LISTENERS (Tıklama Olayları) ---
document.addEventListener("DOMContentLoaded", () => {
  
  // Başlangıç durumu
  closeQuestionModal();
  initQuestionContentEditor();

  // Yeni Soru Ekleme Formu
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLoginForAction()) return;
      if (!canPostInCommunity) return;

      const data = new FormData(form);

      const title = String(data.get("title")).trim();
      if (!questionContentQuill) initQuestionContentEditor();

      const content = window.RekabetliQuill?.getHtml(questionContentQuill) || "";

      if (!title) return;

      if (!content) {
        await rekabetliAlert({
          title: "Boş detay",
          message: "Soru detayı yazmadan yayınlayamazsın.",
        });
        return;
      }

      if (!questionContentQuill) {
        await editorUnavailableAlert();
        return;
      }

      try {
        const newPost = await savePost({
          author: getCurrentAuthorName(),
          title,
          content,
          userId: currentUserId,
        });
        questions.unshift({
          ...newPost,
          authorAvatarUrl: currentUserAvatarUrl,
          authorIsMentor: currentUserIsMentor,
          likeCount: 0,
          likedByMe: false,
          savedByMe: false,
          answers: [],
        });
        form.reset();
        if (questionContentQuill) window.RekabetliQuill?.clear(questionContentQuill);
        closeQuestionModal();
        renderQuestions();
      } catch (error) {
        console.error("Post insert error:", error.message);
        await rekabetliAlert({
          title: "Hata",
          message: "Soru kaydedilemedi. Bağlantı veya izinleri kontrol et.",
        });
      }
    });
  }

  openQuestionModalButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!isUserLoggedIn) {
        window.location.href = "/login";
        return;
      }
      if (!canPostInCommunity) {
        void rekabetliAlert({
          title: "Üye olmalısın",
          message: "Bu toplulukta paylaşım yapmak için üye olman gerekir.",
          showCancel: false,
          confirmLabel: "Tamam",
        });
        return;
      }

      const mobileMenu = document.getElementById("mobile-menu");
      if (mobileMenu) mobileMenu.hidden = true;
      if (!questionContentQuill) initQuestionContentEditor();
      openQuestionModal();
    });
  });

  // Modal Kapatma Butonu
  closeQuestionModalBtn?.addEventListener("click", closeQuestionModal);
  
  // Modal Dışına Tıklayınca Kapanma Mantığı
  questionModal?.addEventListener("click", (event) => {
    if (event.target === questionModal) closeQuestionModal();
  });

  communityJoinBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    if (communityJoinBtn.disabled) return;

    if (communityJoinBtn.classList.contains("js-community-close")) {
      void closeCommunity();
      return;
    }
    if (communityJoinBtn.classList.contains("js-community-leave")) {
      void leaveCommunity();
      return;
    }
    if (communityJoinBtn.classList.contains("js-community-join-request")) {
      void sendJoinRequestPrivate();
      return;
    }
    void joinPublicCommunity();
  });

  panelMembers?.addEventListener("click", (event) => {
    const btn = event.target.closest(".js-remove-community-member");
    if (!btn || !isCommunityAdmin) return;
    event.preventDefault();
    const userId = btn.dataset.userId;
    if (userId) void removeCommunityMember(userId);
  });

  panelJoinRequests?.addEventListener("click", (event) => {
    const approveBtn = event.target.closest(".js-approve-join-request");
    if (approveBtn) {
      event.preventDefault();
      const requestId = approveBtn.dataset.requestId;
      if (requestId) void approveJoinRequest(requestId);
      return;
    }

    const rejectBtn = event.target.closest(".js-reject-join-request");
    if (!rejectBtn) return;
    event.preventDefault();
    const requestId = rejectBtn.dataset.requestId;
    if (requestId) void rejectJoinRequest(requestId);
  });

  // ESC Tuşuna Basınca Kapanma
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (questionModal && !questionModal.hidden) closeQuestionModal();
      const mobileMenu = document.getElementById("mobile-menu");
      if (mobileMenu && !mobileMenu.hidden) mobileMenu.hidden = true;
    }
  });

  void bootstrapCommunityFeedPage();
});