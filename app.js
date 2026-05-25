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
const supabaseClient = window.getSupabase?.() || window.sb;

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

function renderBentoFeaturedCommunities(listEl, rows) {
  if (!listEl) return;

  listEl.replaceChildren();

  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "bento-communities-empty";
    const label = document.createElement("span");
    label.textContent = "Henüz topluluk yok";
    const countEl = document.createElement("strong");
    countEl.textContent = "0 üye";
    li.append(label, countEl);
    animateCount(countEl, 0, { suffix: " üye", duration: 800 });
    listEl.appendChild(li);
    return;
  }

  rows.slice(0, 3).forEach((row, index) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    const link = document.createElement("a");
    link.className = "bento-community-link";
    link.href = `/communities?community=${encodeURIComponent(row.id)}`;
    link.textContent = row.name;
    span.appendChild(link);

    if (row.visibility === "private") {
      const hint = document.createElement("span");
      hint.className = "bento-visibility-hint";
      hint.title = "Gizli topluluk";
      hint.textContent = " 🔒";
      span.appendChild(hint);
    }

    const strong = document.createElement("strong");
    const countEl = document.createElement("span");
    countEl.className = "bento-member-count";
    countEl.textContent = "0";
    strong.append(countEl, document.createTextNode(" üye"));
    li.append(span, strong);
    animateCount(countEl, row.member_count ?? 0, {
      duration: 1000,
      delay: 120 + index * 140,
    });

    listEl.appendChild(li);
  });
}

async function loadBentoCommunityStats() {
  const countEl = document.getElementById("bento-community-count");
  const listEl = document.getElementById("bento-featured-communities");

  if (!supabaseClient || (!countEl && !listEl)) return;

  try {
    const { data: communities, error } = await supabaseClient
      .from("communities")
      .select("id, name, visibility, created_at");

    if (error) {
      console.error("Bento communities load error:", error.message);
      if (listEl) {
        listEl.replaceChildren();
        const li = document.createElement("li");
        li.className = "bento-communities-empty";
        const label = document.createElement("span");
        label.textContent = "Topluluklar yüklenemedi";
        const strong = document.createElement("strong");
        strong.textContent = "—";
        li.append(label, strong);
        listEl.appendChild(li);
      }
      return;
    }

    const rows = communities ?? [];
    const total = rows.length;

    if (countEl) {
      const prefix = countEl.dataset.prefix || "";
      animateCount(countEl, total, { prefix, duration: 1200 });
    }

    const { data: stats, error: statsError } = await supabaseClient.rpc("get_communities_bento_stats");

    if (!statsError && stats?.length) {
      renderBentoFeaturedCommunities(listEl, stats);
      return;
    }

    if (statsError) {
      console.warn("Bento stats RPC unavailable:", statsError.message);
    }

    const fallback = [...rows]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((row) => ({
        id: row.id,
        name: row.name,
        visibility: row.visibility,
        member_count: 1,
      }));

    renderBentoFeaturedCommunities(listEl, fallback);
  } catch (error) {
    console.error("Bento communities load failed:", error);
    showEmptyListMessage(listEl, "Topluluklar yüklenemedi.");
  }
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

// --- 5. OTURUM KONTROLÜ (Giriş Yap -> Profil Değişimi) ---
async function syncProfileNavState() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error("Session check error:", error.message);
  }
  
  const session = data?.session;
  isUserLoggedIn = Boolean(session);
  currentUserId = session?.user?.id ?? null;
  currentUserDisplayName = null;
  currentUserAvatarUrl = null;

  if (currentUserId) {
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", currentUserId)
      .maybeSingle();
    const emailName = session.user.email?.split("@")[0] ?? "";
    currentUserDisplayName = profile?.display_name?.trim() || emailName || "Kullanıcı";
    currentUserAvatarUrl = profile?.avatar_url?.trim() || null;
  }

  // Butonun ne yazacağını ve nereye gideceğini belirle
  const label = isUserLoggedIn ? "Profil" : "Giriş Yap";
  const targetHref = isUserLoggedIn ? "/profile" : "/login";

  if (desktopProfileBtn) {
    desktopProfileBtn.textContent = label;
    desktopProfileBtn.setAttribute("href", targetHref);
  }
  if (mobileProfileBtn) {
    mobileProfileBtn.textContent = label;
    mobileProfileBtn.setAttribute("href", targetHref);
  }

  if (heroJoinBtn) {
    heroJoinBtn.hidden = isUserLoggedIn;
    const heroActions = heroJoinBtn.closest(".hero-actions");
    if (heroActions) heroActions.hidden = isUserLoggedIn;
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
    header.append(author, document.createTextNode(` · ${formatDate(answer.createdAt)}`));

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
  };
}

async function loadPosts() {
  guestFeedHasMore = false;

  try {
    let postsQuery = supabaseClient
      .from("posts")
      .select("id, user_id, author, title, content, created_at")
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
        supabaseClient
          .from("comments")
          .select("id, post_id, user_id, author, content, created_at")
          .in("post_id", postIds)
          .order("created_at", { ascending: false }),
        supabaseClient.from("post_likes").select("post_id, user_id").in("post_id", postIds),
        supabaseClient.from("post_saves").select("post_id, user_id").in("post_id", postIds),
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

    const authorIds = [...new Set(mappedPosts.map((post) => post.userId).filter(Boolean))];
    const profilesByUserId = new Map();

    if (authorIds.length > 0) {
      const { data: profileRows, error: profilesError } = await supabaseClient
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", authorIds);

      if (profilesError) {
        console.error("Profiles load error:", profilesError.message);
      } else {
        (profileRows ?? []).forEach((row) => profilesByUserId.set(row.id, row));
      }
    }

    const allComments = commentRows.map(mapCommentRow);
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
        likeCount: countByPostId.get(post.id) ?? 0,
        likedByMe: likedByMe.has(post.id),
        savedByMe: savedByMe.has(post.id),
        answers: commentsByPostId.get(post.id) ?? [],
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

  const { data, error } = await supabaseClient
    .from("posts")
    .insert([row])
    .select("id, user_id, author, title, content, created_at")
    .single();

  if (error) throw error;
  return mapPostRow(data);
}

async function deletePost(postId) {
  const { error } = await supabaseClient.from("posts").delete().eq("id", postId);
  if (error) throw error;
}

async function deleteComment(commentId) {
  if (!currentUserId) {
    window.location.href = "/login";
    return;
  }

  const { error } = await supabaseClient
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
    const { error } = await supabaseClient
      .from("post_likes")
      .insert([{ post_id: postId, user_id: currentUserId }]);
    if (error) throw error;
    return;
  }

  const { error } = await supabaseClient
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
    const { error } = await supabaseClient
      .from("post_saves")
      .insert([{ post_id: postId, user_id: currentUserId }]);
    if (error) throw error;
    return;
  }

  const { error } = await supabaseClient
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

  const { data, error } = await supabaseClient
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
    metaEl.textContent = `${question.author} · ${formatDate(question.createdAt)}`;
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

  if (!isUserLoggedIn && guestFeedHasMore) {
    questionList.appendChild(renderGuestFeedCta());
  }
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

  // İlk Yüklemeler
  supabaseClient.auth.onAuthStateChange(() => {
    syncProfileNavState().then(loadPosts).catch((error) => {
      console.error("Auth refresh failed:", error);
    });
  });

  void loadBentoCommunityStats();

  syncProfileNavState().then(loadPosts).catch((error) => {
    console.error("Initial load failed:", error);
    if (questionList) {
      showEmptyListMessage(questionList, "Sayfa yüklenirken bir hata oluştu. Lütfen yenileyin.");
    }
  });
});