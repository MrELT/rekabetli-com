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
const resetBtn = document.getElementById("reset-btn");
const heroJoinBtn = document.getElementById("hero-join-btn");

let questions = [];
let isUserLoggedIn = false;
let currentUserId = null;
let currentUserDisplayName = null;
let currentUserAvatarUrl = null;
let currentUserIsMentor = false;
let questionContentQuill = null;
const GUEST_FEED_PREVIEW_LIMIT = 3;
const POST_CONTENT_MAX_LENGTH = 1800;
let guestFeedHasMore = false;

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

function animateCount(element, target, options = {}) {
  if (!element) return;

  const { prefix = "", suffix = "", duration = 1100, delay = 0 } = options;
  const safeTarget = Math.max(0, Math.round(Number(target) || 0));
  const startAt = performance.now() + delay;

  function tick(now) {
    if (now < startAt) {
      requestAnimationFrame(tick);
      return;
    }
    const progress = Math.min(1, (now - startAt) / duration);
    const eased = 1 - (1 - progress) ** 3;
    const value = Math.round(safeTarget * eased);
    element.textContent = `${prefix}${value}${suffix}`;
    if (progress < 1) requestAnimationFrame(tick);
    else element.textContent = `${prefix}${safeTarget}${suffix}`;
  }

  element.textContent = `${prefix}0${suffix}`;
  requestAnimationFrame(tick);
}

function getCommunityInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function appendTrendingAvatar(parent, row, href) {
  const avatarLink = document.createElement("a");
  avatarLink.className = "trending-avatar";
  avatarLink.href = href;
  avatarLink.setAttribute("aria-hidden", "true");
  avatarLink.tabIndex = -1;

  const img = document.createElement("img");
  img.className = "trending-avatar-img";
  const fallback = document.createElement("span");
  fallback.className = "trending-avatar-fallback";
  avatarLink.append(img, fallback);

  window.RekabetliAvatars?.applyUserAvatar({
    imgEl: img,
    fallbackEl: fallback,
    avatarUrl: row.avatar_url?.trim(),
    displayName: row.name,
    seed: row.id || row.name,
  });

  parent.appendChild(avatarLink);
}

function renderBentoFeaturedCommunities(listEl, rows, options = {}) {
  const { animateCounts = true } = options;
  if (!listEl) return;

  listEl.replaceChildren();
  listEl.classList.remove("is-loading");
  listEl.setAttribute("aria-busy", "false");

  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "trending-item trending-item-empty";
    li.innerHTML = `
      <div class="trending-media">
        <span class="trending-rank" aria-hidden="true">—</span>
        <span class="trending-avatar trending-avatar-fallback" aria-hidden="true">?</span>
      </div>
      <div class="trending-body">
        <span class="trending-name">Henüz topluluk yok</span>
        <span class="trending-meta">İlk sen kur</span>
      </div>
      <a class="trending-go" href="/communities" aria-label="Topluluk oluştur">→</a>
    `;
    listEl.appendChild(li);
    return;
  }

  rows.slice(0, 3).forEach((row, index) => {
    const li = document.createElement("li");
    li.className = "trending-item";
    li.style.animationDelay = `${index * 90}ms`;

    const rank = document.createElement("span");
    rank.className = "trending-rank";
    rank.setAttribute("aria-hidden", "true");
    rank.textContent = String(index + 1);

    const communityHref = `/communities?community=${encodeURIComponent(row.id)}`;

    const media = document.createElement("div");
    media.className = "trending-media";
    media.append(rank);
    appendTrendingAvatar(media, row, communityHref);

    const body = document.createElement("div");
    body.className = "trending-body";

    const link = document.createElement("a");
    link.className = "trending-name bento-community-link";
    link.href = communityHref;
    link.textContent = row.name;
    body.appendChild(link);

    if (row.visibility === "private") {
      const hint = document.createElement("span");
      hint.className = "bento-visibility-hint";
      hint.title = "Gizli topluluk";
      hint.textContent = " 🔒";
      link.appendChild(hint);
    }

    const meta = document.createElement("span");
    meta.className = "trending-meta";
    const memberCountEl = document.createElement("span");
    memberCountEl.className = "bento-member-count";
    const memberCount = Math.max(0, Math.round(Number(row.member_count) || 0));
    if (animateCounts) {
      memberCountEl.textContent = "0";
      animateCount(memberCountEl, memberCount, {
        duration: 1000,
        delay: 180 + index * 120,
      });
    } else {
      memberCountEl.textContent = String(memberCount);
    }
    meta.append(memberCountEl, document.createTextNode(" üye"));
    body.appendChild(meta);

    const go = document.createElement("a");
    go.className = "trending-go";
    go.href = communityHref;
    go.setAttribute("aria-label", `${row.name} topluluğuna git`);
    go.textContent = "→";

    li.append(media, body, go);
    listEl.appendChild(li);
  });
}

const HOME_BENTO_LS_KEY = "rekabetli.homeBento.v1";
const HOME_BENTO_LS_TTL_MS = 5 * 60 * 1000;
const HOME_BENTO_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSafeHttpsAvatarUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return false;
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeClientBentoRow(row) {
  if (!row || typeof row !== "object") return null;

  const id = String(row.id ?? "").trim();
  if (!HOME_BENTO_UUID_RE.test(id)) return null;

  let name = String(row.name ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return null;
  if (name.length > 120) name = name.slice(0, 120);

  const visibility = row.visibility === "private" ? "private" : "public";
  const member_count = Math.max(
    0,
    Math.min(1_000_000, Math.round(Number(row.member_count) || 0)),
  );
  const rawAvatar = String(row.avatar_url ?? "").trim();

  return {
    id,
    name,
    visibility,
    member_count,
    avatar_url: rawAvatar && isSafeHttpsAvatarUrl(rawAvatar) ? rawAvatar : null,
  };
}

function normalizeHomeBentoPayload(raw) {
  if (!raw || typeof raw !== "object") return null;

  const count = Math.max(
    0,
    Math.min(1_000_000, Math.round(Number(raw.count) || 0)),
  );
  const trending = Array.isArray(raw.trending)
    ? raw.trending
        .map(sanitizeClientBentoRow)
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const fetchedAt = Number(raw.fetchedAt);

  return {
    count,
    trending,
    fetchedAt: Number.isFinite(fetchedAt) && fetchedAt > 0 ? fetchedAt : Date.now(),
  };
}

function homeBentoPayloadsEqual(a, b) {
  if (!a || !b) return false;
  if (a.count !== b.count || a.trending.length !== b.trending.length) return false;

  return a.trending.every((row, index) => {
    const other = b.trending[index];
    return (
      row.id === other.id &&
      row.name === other.name &&
      row.member_count === other.member_count &&
      row.visibility === other.visibility
    );
  });
}

function readLocalHomeBento() {
  try {
    const raw = localStorage.getItem(HOME_BENTO_LS_KEY);
    if (!raw) return null;
    const parsed = normalizeHomeBentoPayload(JSON.parse(raw));
    if (!parsed) return null;
    if (Date.now() - parsed.fetchedAt > HOME_BENTO_LS_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLocalHomeBento(payload) {
  try {
    const normalized = normalizeHomeBentoPayload(payload);
    if (!normalized) return;
    localStorage.setItem(HOME_BENTO_LS_KEY, JSON.stringify(normalized));
  } catch {
    // localStorage dolu veya devre dışı
  }
}

function setBentoLoadingState(isLoading) {
  const countEl = document.getElementById("bento-community-count");
  const listEl = document.getElementById("bento-featured-communities");

  if (countEl) {
    countEl.classList.toggle("is-skeleton", isLoading);
    if (isLoading) {
      countEl.textContent = "";
      countEl.setAttribute("aria-hidden", "true");
    }
  }

  if (listEl) {
    listEl.classList.toggle("is-loading", isLoading);
    listEl.setAttribute("aria-busy", isLoading ? "true" : "false");
  }
}

function applyHomeBentoPayload(payload, options = {}) {
  const { animateCounts = false } = options;
  const data = normalizeHomeBentoPayload(payload);
  if (!data) return false;

  const countEl = document.getElementById("bento-community-count");
  const listEl = document.getElementById("bento-featured-communities");

  setBentoLoadingState(false);

  if (countEl) {
    countEl.classList.remove("is-skeleton");
    countEl.removeAttribute("aria-hidden");
    const prefix = countEl.dataset.prefix || "";
    if (animateCounts) {
      animateCount(countEl, data.count, { prefix, duration: 900 });
    } else {
      countEl.textContent = `${prefix}${data.count}`;
    }
  }

  renderBentoFeaturedCommunities(listEl, data.trending, { animateCounts });
  window.__REKABETLI_BENTO_APPLIED__ = data;
  saveLocalHomeBento(data);
  return true;
}

function tryInitialHomeBentoHydrate() {
  if (window.__HOME_BENTO__) {
    if (applyHomeBentoPayload(window.__HOME_BENTO__, { animateCounts: false })) {
      return true;
    }
  }

  const cached = readLocalHomeBento();
  if (cached) {
    return applyHomeBentoPayload(cached, { animateCounts: false });
  }

  return false;
}

function enrichBentoRows(rows, communities) {
  const avatarById = new Map(
    (communities ?? []).map((row) => [row.id, row.avatar_url?.trim() || null]),
  );

  return (rows ?? []).map((row) => ({
    ...row,
    avatar_url: row.avatar_url?.trim() || avatarById.get(row.id) || null,
  }));
}

function renderBentoLoadError(listEl) {
  if (!listEl) return;
  listEl.replaceChildren();
  listEl.classList.remove("is-loading");
  listEl.setAttribute("aria-busy", "false");

  const li = document.createElement("li");
  li.className = "trending-item trending-item-empty";
  li.innerHTML = `
    <div class="trending-media">
      <span class="trending-rank" aria-hidden="true">!</span>
      <span class="trending-avatar trending-avatar-fallback" aria-hidden="true">!</span>
    </div>
    <div class="trending-body">
      <span class="trending-name">Topluluklar yüklenemedi</span>
      <span class="trending-meta">Lütfen sayfayı yenileyin</span>
    </div>
  `;
  listEl.appendChild(li);
}

async function loadBentoCommunityStats(options = {}) {
  const { background = false } = options;
  const countEl = document.getElementById("bento-community-count");
  const listEl = document.getElementById("bento-featured-communities");

  if (!countEl && !listEl) return;

  if (!background && !window.__REKABETLI_BENTO_APPLIED__) {
    if (!tryInitialHomeBentoHydrate()) {
      setBentoLoadingState(true);
    }
  }

  if (!getSb()) return;

  try {
    const { data: communities, error } = await getSb()
      .from("communities")
      .select("id, name, visibility, created_at, avatar_url");

    if (error) {
      console.error("Bento communities load error:", error.message);
      if (!window.__REKABETLI_BENTO_APPLIED__) {
        renderBentoLoadError(listEl);
      }
      return;
    }

    const rows = communities ?? [];
    const total = rows.length;

    const { data: stats, error: statsError } = await getSb().rpc(
      "get_communities_bento_stats",
    );

    let trendingRows = [];

    if (!statsError && stats?.length) {
      trendingRows = enrichBentoRows(stats, rows);
    } else {
      if (statsError) {
        console.warn("Bento stats RPC unavailable:", statsError.message);
      }
      trendingRows = [...rows]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map((row) => ({
          id: row.id,
          name: row.name,
          visibility: row.visibility,
          avatar_url: row.avatar_url?.trim() || null,
          member_count: 1,
        }));
    }

    const payload = normalizeHomeBentoPayload({
      count: total,
      trending: trendingRows
        .map(sanitizeClientBentoRow)
        .filter(Boolean)
        .slice(0, 3),
      fetchedAt: Date.now(),
    });

    if (!payload) {
      if (!window.__REKABETLI_BENTO_APPLIED__) {
        renderBentoLoadError(listEl);
      }
      return;
    }

    if (background && homeBentoPayloadsEqual(window.__REKABETLI_BENTO_APPLIED__, payload)) {
      return;
    }

    applyHomeBentoPayload(payload, { animateCounts: !background });
  } catch (error) {
    console.error("Bento communities load failed:", error);
    if (!window.__REKABETLI_BENTO_APPLIED__) {
      renderBentoLoadError(listEl);
    }
  }
}

function openQuestionModal() {
  if (questionModal) questionModal.hidden = false;
  document.body.classList.add("question-modal-open");
}

function closeQuestionModal() {
  if (questionModal) questionModal.hidden = true;
  document.body.classList.remove("question-modal-open");
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
    return;
  }

  const draftKey = window.RekabetliFeedDrafts?.buildKey({ page: "home", kind: "question" });
  if (draftKey) {
    window.RekabetliFeedDrafts.bindQuill(questionContentQuill, draftKey);
    const titleInput = form?.querySelector('[name="title"]');
    window.RekabetliFeedDrafts.bindField(titleInput, draftKey, "title");
  }
}

async function editorUnavailableAlert() {
  await rekabetliAlert({
    title: "Düzenleyici yüklenemedi",
    message: "Metin düzenleyici açılamadı. Sayfayı yenileyip tekrar deneyin.",
  });
}

function applyQuestionAvatar(container, avatarUrl, authorName, userId) {
  const imgEl = container.querySelector(".question-avatar-img");
  const fallbackEl = container.querySelector(".question-avatar-fallback");
  window.RekabetliAvatars?.applyUserAvatar({
    imgEl,
    fallbackEl,
    avatarUrl,
    displayName: authorName,
    seed: userId || authorName,
  });
}

// --- 5. OTURUM KONTROLÜ (Merkezi Auth Store) ---
async function syncAppUserContext(user) {
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

  if (heroJoinBtn) {
    heroJoinBtn.hidden = isUserLoggedIn;
    const heroActions = heroJoinBtn.closest(".hero-actions");
    if (heroActions) heroActions.hidden = isUserLoggedIn;
  }
}

function scrollToFeedTarget() {
  window.RekabetliFeedAccordion?.scrollToTarget?.(questions);
}

// --- 6. VERİTABANI İŞLEMLERİ (Sorular ve Cevaplar) ---
function buildAnswerRenderContext() {
  return {
    formatDate,
    createMentorBadge,
    currentUserId,
    isLoggedIn: isUserLoggedIn,
    draftScope: { page: "home" },
    onRequireLogin: () => {
      window.location.href = "/login";
    },
    requireLogin: requireLoginForAction,
    alertDialog: rekabetliAlert,
    onEditAnswer: async (answer, postId, content) => {
      const row = await window.RekabetliFeedEdit.updateComment(
        getSb(),
        answer.id,
        currentUserId,
        content,
      );
      const target = questions.find((q) => q.id === postId);
      if (!target) return;

      const mapped = mapCommentRow(row);
      mapped.authorIsMentor = answer.authorIsMentor;
      mapped.ratingAvg = answer.ratingAvg;
      mapped.ratingCount = answer.ratingCount;
      mapped.myRating = answer.myRating;
      mapped.replies = answer.replies;
      window.RekabetliFeedEdit.patchCommentInTree(target.answers, answer.id, mapped);
      renderQuestions();
    },
    onEditReply: async (reply, answer, postId, content) => {
      const row = await window.RekabetliFeedEdit.updateComment(
        getSb(),
        reply.id,
        currentUserId,
        content,
      );
      const target = questions.find((q) => q.id === postId);
      if (!target) return;

      const mapped = mapCommentRow(row);
      mapped.authorIsMentor = reply.authorIsMentor;
      window.RekabetliFeedEdit.patchCommentInTree(target.answers, reply.id, mapped);
      renderQuestions();
    },
    onDeleteAnswer: async (answer, postId) => {
      if (
        !(await rekabetliConfirm({
          title: "Yanıtı sil",
          message: "Bu yanıtı kalıcı olarak silmek istediğine emin misin?",
          confirmLabel: "Sil",
          cancelLabel: "Vazgeç",
          danger: true,
        }))
      ) {
        return;
      }
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
    },
    onDeleteReply: async (reply, answer, postId) => {
      if (
        !(await rekabetliConfirm({
          title: "Yorumu sil",
          message: "Bu yorumu kalıcı olarak silmek istediğine emin misin?",
          confirmLabel: "Sil",
          cancelLabel: "Vazgeç",
          danger: true,
        }))
      ) {
        return;
      }
      try {
        await deleteComment(reply.id);
        const target = questions.find((q) => q.id === postId);
        const parent = target?.answers.find((a) => a.id === answer.id);
        if (parent) {
          parent.replies = (parent.replies ?? []).filter((r) => r.id !== reply.id);
          renderQuestions();
        }
        window.rekabetliNotifications?.refresh();
      } catch (error) {
        console.error("Reply delete error:", error.message);
        await rekabetliAlert({ title: "Silinemedi", message: "Yorum silinemedi." });
      }
    },
    onSubmitReply: async ({ postId, parentCommentId, content }) => {
      const newReply = await saveComment({
        postId,
        parentCommentId,
        author: getCurrentAuthorName(),
        content,
        userId: currentUserId,
      });
      newReply.authorIsMentor = currentUserIsMentor;
      const target = questions.find((q) => q.id === postId);
      const parent = target?.answers.find((a) => a.id === parentCommentId);
      if (parent) {
        parent.replies = parent.replies ?? [];
        parent.replies.push(newReply);
        renderQuestions();
      }
      window.rekabetliNotifications?.refresh();
    },
  };
}

function renderAnswers(container, answers, postId) {
  window.RekabetliCommentReplies?.renderAnswers(
    container,
    answers,
    postId,
    buildAnswerRenderContext(),
  );
}

function mapPostRow(postRow) {
  return {
    id: postRow.id,
    userId: postRow.user_id ?? null,
    author: postRow.author,
    title: postRow.title,
    content: postRow.content,
    createdAt: postRow.created_at,
    updatedAt: postRow.updated_at ?? null,
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
    parentCommentId: commentRow.parent_comment_id ?? null,
    userId: commentRow.user_id ?? null,
    author: commentRow.author,
    content: commentRow.content,
    createdAt: commentRow.created_at,
    updatedAt: commentRow.updated_at ?? null,
    authorIsMentor: false,
    replies: [],
  };
}

async function loadPosts() {
  guestFeedHasMore = false;

  try {
    let postsQuery = getSb()
      .from("posts")
      .select("id, user_id, author, title, content, created_at, updated_at")
      .is("community_id", null)
      .order("created_at", { ascending: false });

    if (!isUserLoggedIn) {
      postsQuery = postsQuery.limit(GUEST_FEED_PREVIEW_LIMIT + 1);
    }

    const { data: postRows, error: postsError } = await postsQuery;

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

    let rowsForFeed = postRows ?? [];
    if (!isUserLoggedIn && rowsForFeed.length > GUEST_FEED_PREVIEW_LIMIT) {
      guestFeedHasMore = true;
      rowsForFeed = rowsForFeed.slice(0, GUEST_FEED_PREVIEW_LIMIT);
    }

    const mappedPosts = rowsForFeed.map(mapPostRow);
    const postIds = mappedPosts.map((post) => post.id);

    let commentRows = [];
    let likeRows = [];
    let saveRows = [];

    if (postIds.length > 0) {
      const [commentsResult, likesResult, savesResult] = await Promise.all([
        getSb()
          .from("comments")
          .select("id, post_id, parent_comment_id, user_id, author, content, created_at, updated_at")
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

    const commentIds = allComments.filter((c) => !c.parentCommentId).map((c) => c.id);
    const ratingStats = await window.RekabetliCommentRatings?.loadStatsForCommentIds(
      commentIds,
      currentUserId,
    );
    if (ratingStats) {
      window.RekabetliCommentRatings.enrichComments(
        allComments.filter((c) => !c.parentCommentId),
        ratingStats,
      );
    }

    allComments.forEach((comment) => {
      const profile = comment.userId ? profilesByUserId.get(comment.userId) : null;
      comment.authorIsMentor = Boolean(profile?.is_mentor);
    });

    const commentsByPostId = new Map();
    allComments.forEach((comment) => {
      const list = commentsByPostId.get(comment.postId) ?? [];
      list.push(comment);
      commentsByPostId.set(comment.postId, list);
    });

    questions = mappedPosts.map((post) => {
      const profile = post.userId ? profilesByUserId.get(post.userId) : null;
      const displayName = profile?.display_name?.trim() || post.author;
      return {
        ...post,
        author: displayName,
        authorAvatarUrl: profile?.avatar_url?.trim() || null,
        authorIsMentor: Boolean(profile?.is_mentor),
        likeCount: countByPostId.get(post.id) ?? 0,
        likedByMe: likedByMe.has(post.id),
        savedByMe: savedByMe.has(post.id),
        answers: window.RekabetliCommentReplies?.partitionComments(
          commentsByPostId.get(post.id) ?? [],
        ) ?? [],
      };
    });

    renderQuestions();
    scrollToFeedTarget();
  } catch (error) {
    console.error("Posts load failed:", error);
    if (questionList) {
      showEmptyListMessage(questionList, "Veriler yüklenirken bir hata oluştu. Sayfayı yenileyin.");
    }
  }
}

async function savePost({ author, title, content, userId }) {
  const row = { author, title, content };
  if (userId) row.user_id = userId;

  const { data, error } = await getSb()
    .from("posts")
    .insert([row])
    .select("id, user_id, author, title, content, created_at, updated_at")
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

async function saveComment({ postId, author, content, userId, parentCommentId = null }) {
  const row = { post_id: postId, author, content };
  if (userId) row.user_id = userId;
  if (parentCommentId) row.parent_comment_id = parentCommentId;

  const { data, error } = await getSb()
    .from("comments")
    .insert([row])
    .select("id, post_id, parent_comment_id, user_id, author, content, created_at, updated_at")
    .single();

  if (error) throw error;
  const mapped = mapCommentRow(data);
  if (!parentCommentId) {
    mapped.ratingAvg = null;
    mapped.ratingCount = 0;
    mapped.myRating = null;
  }
  return mapped;
}

function renderGuestFeedCta() {
  const cta = document.createElement("div");
  cta.className = "feed-guest-cta";

  const text = document.createElement("p");
  text.className = "feed-guest-cta-text";
  text.textContent =
    "Akışın tamamını görmek, soru sormak ve topluluklara katılmak için giriş yap.";

  const actions = document.createElement("div");
  actions.className = "feed-guest-cta-actions";

  const loginLink = document.createElement("a");
  loginLink.href = "/login";
  loginLink.className = "nav-btn nav-btn-primary";
  loginLink.textContent = "Giriş Yap";

  const registerLink = document.createElement("a");
  registerLink.href = "/register";
  registerLink.className = "nav-btn";
  registerLink.textContent = "Hesap Oluştur";

  actions.append(loginLink, registerLink);
  cta.append(text, actions);
  return cta;
}

function renderQuestions() {
  if (!questionList || !template?.content) return;

  window.RekabetliFeedDrafts?.captureVisibleForms();

  questionList.replaceChildren();
  if (!questions.length) {
    showEmptyListMessage(questionList, "Henüz soru yok. İlk soruyu sen ekleyebilirsin.");
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
    const ownerActions = fragment.querySelector(".question-owner-actions");
    const editBtn = fragment.querySelector(".edit-btn");
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
      !ownerActions ||
      !editBtn ||
      !deleteBtn ||
      !answersContainer ||
      !answerToggleBtn ||
      !answerForm
    ) {
      return;
    }

    cardEl.id = `post-${question.id}`;
    applyQuestionAvatar(cardEl, question.authorAvatarUrl, question.author, question.userId);

    titleEl.textContent = question.title;
    metaEl.replaceChildren();
    const authorText = document.createElement("span");
    authorText.textContent = question.author;
    metaEl.append(authorText);
    if (question.authorIsMentor) {
      metaEl.appendChild(createMentorBadge());
    }
    window.RekabetliFeedEdit?.appendTimestampMeta(metaEl, {
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
      formatDate,
    });
    window.RekabetliQuill?.renderRichContent(questionContentEl, question.content);

    likeCountEl.textContent = String(question.likeCount ?? 0);
    likeBtn.setAttribute("aria-pressed", question.likedByMe ? "true" : "false");
    likeBtn.setAttribute("aria-label", question.likedByMe ? "Beğeniyi kaldır" : "Beğen");

    saveBtn.setAttribute("aria-pressed", question.savedByMe ? "true" : "false");
    saveBtn.textContent = question.savedByMe ? "Kaldır" : "Kaydet";

    const isOwner = Boolean(currentUserId && question.userId && question.userId === currentUserId);
    if (!isOwner) {
      ownerActions.remove();
    } else {
      ownerActions.hidden = false;
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
      editBtn.addEventListener("click", () => {
        window.RekabetliFeedEdit?.startPostEdit({
          question,
          cardEl,
          titleMaxLength: 120,
          contentMaxLength: POST_CONTENT_MAX_LENGTH,
          alertDialog: rekabetliAlert,
          onSave: async ({ title, content }) => {
            const row = await window.RekabetliFeedEdit.updatePost(
              getSb(),
              question.id,
              currentUserId,
              { title, content },
            );
            const target = questions.find((q) => q.id === question.id);
            if (!target) return;

            target.title = row.title;
            target.content = row.content;
            target.updatedAt = row.updated_at ?? null;
            renderQuestions();
          },
        });
      });

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
    window.RekabetliFeedAccordion?.bind(cardEl, question);

    answerToggleBtn.addEventListener("click", () => {
      if (!requireLoginForAction()) return;

      const shouldShowForm = answerForm.hidden;
      if (shouldShowForm) {
        question._setAccordionExpanded?.(true);
      }
      answerForm.hidden = !shouldShowForm;
      answerToggleBtn.textContent = shouldShowForm ? "Vazgeç" : "Cevapla";

      if (shouldShowForm) {
        answerForm.dataset.draftKey =
          window.RekabetliFeedDrafts?.buildKey({
            page: "home",
            kind: "answer",
            id: question.id,
          }) || "";
        const editor = window.RekabetliQuill?.ensureAnswerEditor(answerForm);
        if (!editor) {
          answerForm.hidden = true;
          answerToggleBtn.textContent = "Cevapla";
          void editorUnavailableAlert();
        }
      }
    });

    answerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!requireLoginForAction()) return;

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
          target.expanded = true;
          renderQuestions();
        }
        if (answerForm._rekabetliQuill) window.RekabetliQuill?.clear(answerForm._rekabetliQuill);
        if (answerForm.dataset.draftKey) window.RekabetliFeedDrafts?.clear(answerForm.dataset.draftKey);
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

  if (!isUserLoggedIn && guestFeedHasMore) {
    questionList.appendChild(renderGuestFeedCta());
  }
}

// --- 7. EVENT LISTENERS (Tıklama Olayları) ---
document.addEventListener("DOMContentLoaded", () => {
  let homeAuthBound = false;
  let skipInitialHomeAuthHydrate = true;
  let lastKnownHomeUserId = null;

  function bindHomeAuthListener() {
    if (homeAuthBound || !window.RekabetliAuth) return;
    homeAuthBound = true;

    window.RekabetliAuth.subscribe((state) => {
      if (!state.ready) return;
      const nextUserId = state.user?.id ?? null;
      if (skipInitialHomeAuthHydrate) {
        skipInitialHomeAuthHydrate = false;
        lastKnownHomeUserId = nextUserId;
        return;
      }
      if (nextUserId === lastKnownHomeUserId) return;
      lastKnownHomeUserId = nextUserId;
      syncAppUserContext(state.user).then(loadPosts).catch((error) => {
        console.error("Auth refresh failed:", error);
      });
    });
  }

  async function bootstrapHomePage() {
    const hadBento = Boolean(window.__REKABETLI_BENTO_APPLIED__);
    const auth = window.RekabetliAuth;
    const state = auth ? await auth.whenReady() : { user: null };

    lastKnownHomeUserId = state.user?.id ?? null;
    await syncAppUserContext(state.user);
    void loadBentoCommunityStats({ background: hadBento });
    await loadPosts();
    bindHomeAuthListener();
  }

  
  // Başlangıç durumu
  closeQuestionModal();
  initQuestionContentEditor();

  // Yeni Soru Ekleme Formu
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
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
        const questionDraftKey = window.RekabetliFeedDrafts?.buildKey({ page: "home", kind: "question" });
        if (questionDraftKey) window.RekabetliFeedDrafts.clear(questionDraftKey);
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

  // Soru Sor Butonları - GİRİŞ KONTROLÜ BURADA YAPIYORUZ
  openQuestionModalButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!isUserLoggedIn) {
        // Kullanıcı giriş yapmamışsa login sayfasına yönlendir
        window.location.href = "/login";
        return;
      }
      
      // Kullanıcı giriş yapmışsa Soru Sor modülünü aç
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

  // ESC Tuşuna Basınca Kapanma
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (questionModal && !questionModal.hidden) closeQuestionModal();
      const mobileMenu = document.getElementById("mobile-menu");
      if (mobileMenu && !mobileMenu.hidden) mobileMenu.hidden = true;
    }
  });

  resetBtn?.addEventListener("click", () => {
    void loadPosts();
  });

  // İlk Yüklemeler — bento bootstrap mümkün olduğunca erken
  tryInitialHomeBentoHydrate();

  bootstrapHomePage().catch((error) => {
    console.error("Initial load failed:", error);
    if (questionList) {
      showEmptyListMessage(questionList, "Sayfa yüklenirken bir hata oluştu. Lütfen yenileyin.");
    }
  });
});