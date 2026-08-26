(function initProfile() {
  const supabase = window.getSupabase?.() || window.sb;
  if (!supabase) {
    console.error("[rekabetli] Supabase yüklenemedi. Sayfayı yerel sunucu ile açın.");
    return;
  }

  const AVATAR_BUCKET = "avatars";
  const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
  const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

  const profileEmail = document.getElementById("profile-email");
  const profileAnswerRating = document.getElementById("profile-answer-rating");
  const profileForm = document.getElementById("profile-form");
  const displayNameInput = document.getElementById("displayName");
  const bioInput = document.getElementById("bio");
  const userTypeSelect = document.getElementById("userType");
  const schoolInput = document.getElementById("school");
  const cityInput = document.getElementById("city");
  const phoneInput = document.getElementById("phone");
  const profileMessage = document.getElementById("profile-message");
  const profileUserCodeEl = document.getElementById("profile-user-code");
  const profileUserCodeCopyBtn = document.getElementById("profile-user-code-copy");
  const logoutBtn = document.getElementById("logout-btn");
  const deleteProfileBtn = document.getElementById("profile-delete-btn");
  const avatarInput = document.getElementById("avatar-input");
  const avatarPreview = document.getElementById("avatar-preview");
  const avatarFallback = document.getElementById("avatar-fallback");
  const removeAvatarBtn = document.getElementById("remove-avatar-btn");
  const panelQuestions = document.getElementById("panel-questions");
  const panelAnswers = document.getElementById("panel-answers");
  const panelSaved = document.getElementById("panel-saved");
  const countQuestions = document.getElementById("count-questions");
  const countAnswers = document.getElementById("count-answers");
  const countSaved = document.getElementById("count-saved");
  const influencerPageAction = document.getElementById("influencer-page-action");
  const accordionSections = document.querySelectorAll(".activity-accordion-section");
  const isStandaloneProfilePage = /\/profile\/?$/i.test(window.location.pathname);

  let currentUser = null;
  let savedAvatarUrl = null;
  let pendingAvatarFile = null;
  let removeAvatarOnSave = false;
  let profileIsMentor = false;
  let profileUserType = "";
  let leaveMentorConfirmed = false;

  function isMentorUserType(value) {
    return String(value || "").trim().toLowerCase() === "mentor";
  }

  function hasMentorAccess() {
    return profileIsMentor || isMentorUserType(profileUserType);
  }

  async function confirmLeaveMentorRole() {
    return rekabetliConfirm({
      title: "Mentör tipini değiştir",
      message:
        "Kullanıcı tipini Mentör dışına alırsan vitrin sayfan yayın listesinden kaldırılır ve mentör panelin (vitrin verilerin) kalıcı olarak silinir. Bu işlem geri alınamaz. Devam etmek istiyor musun?",
      confirmLabel: "Evet, değiştir",
      cancelLabel: "Vazgeç",
      danger: true,
    });
  }

  function formatDate(isoDate) {
    return new Date(isoDate).toLocaleString("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function setMessage(text, isError = false) {
    if (!profileMessage) return;
    profileMessage.textContent = text;
    profileMessage.classList.toggle("profile-message-error", isError);
  }

  function applyUserCodeDisplay(userCode) {
    const code = String(userCode || "").trim().toUpperCase();
    if (!profileUserCodeEl) return;
    profileUserCodeEl.textContent = code || "—";
    if (profileUserCodeCopyBtn) profileUserCodeCopyBtn.hidden = !code;
  }

  async function copyUserCodeToClipboard() {
    const code = profileUserCodeEl?.textContent?.trim();
    if (!code || code === "—") return;
    try {
      await navigator.clipboard.writeText(code);
      setMessage("Kullanıcı kodu kopyalandı.");
    } catch {
      setMessage("Kod kopyalanamadı. Kodu elle seçip kopyalayın.", true);
    }
  }

  function createMentorBadge() {
    const badge = document.createElement("span");
    badge.className = "mentor-badge";
    badge.textContent = "Mentör";
    return badge;
  }

  function getInitials(name) {
    const parts = String(name || "?")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0]?.[0] ?? "?").toUpperCase();
  }

  function updateAvatarPreview(url, displayName) {
    if (!avatarPreview && !avatarFallback) return;
    const isBlobPreview = String(url ?? "").trim().startsWith("blob:");
    window.RekabetliAvatars?.applyUserAvatar({
      imgEl: avatarPreview,
      fallbackEl: avatarFallback,
      avatarUrl: url,
      displayName: displayName || "?",
      seed: currentUser?.id || displayName,
      setImgOptions: isBlobPreview ? { allowBlob: true } : undefined,
    });

    if (removeAvatarBtn) removeAvatarBtn.hidden = !url;
  }

  function applyProfileToForm(profile, metadata) {
    const firstName = metadata?.first_name ?? "";
    const lastName = metadata?.last_name ?? "";
    const defaultName = `${firstName} ${lastName}`.trim();

    if (displayNameInput) {
      displayNameInput.value = profile?.display_name?.trim() || defaultName || "";
    }
    if (userTypeSelect) {
      userTypeSelect.value = profile?.user_type?.trim() || metadata?.user_type?.trim() || "";
    }

    savedAvatarUrl = profile?.avatar_url?.trim() || null;
    pendingAvatarFile = null;
    removeAvatarOnSave = false;
    updateAvatarPreview(savedAvatarUrl, displayNameInput?.value);
  }

  async function enrichAnswersWithRatings(answers) {
    if (!answers?.length || !window.RekabetliCommentRatings) return;
    const stats = await window.RekabetliCommentRatings.loadStatsForCommentIds(
      answers.map((a) => a.id),
      currentUser?.id ?? null
    );
    const asComments = answers.map((a) => ({
      id: a.id,
      userId: a.user_id ?? currentUser?.id ?? null,
    }));
    window.RekabetliCommentRatings.enrichComments(asComments, stats);
    answers.forEach((a, i) => {
      a.ratingCount = asComments[i].ratingCount;
      a.ratingAvg = asComments[i].ratingAvg;
      a.myRating = asComments[i].myRating;
    });
  }

  function setPanelEmpty(container, text) {
    if (!container) return;
    container.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = text;
    container.appendChild(empty);
  }

  function setAccordionOpen(sectionName, isOpen) {
    const section = document.querySelector(`.activity-accordion-section[data-section="${sectionName}"]`);
    if (!section) return;

    section.classList.toggle("is-open", isOpen);
    const trigger = section.querySelector(".activity-accordion-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }

  function highlightActivityTarget(postId, commentId) {
    document.querySelectorAll(".activity-item-highlight").forEach((el) => {
      el.classList.remove("activity-item-highlight");
    });

    let target = null;
    if (commentId) target = document.getElementById(`comment-${commentId}`);
    if (!target && postId) target = document.getElementById(`post-${postId}`);
    if (!target) return;

    target.classList.add("activity-item-highlight");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function applyDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    const postId = params.get("post");
    const commentId = params.get("comment");

    if (tab === "profile" || tab === "questions" || tab === "answers" || tab === "saved") {
      setAccordionOpen(tab, true);
    }

    if (postId || commentId) {
      setAccordionOpen("questions", true);
    }

    if (!postId && !commentId) return;

    window.setTimeout(() => {
      document.getElementById("profile-activity")?.scrollIntoView({ behavior: "smooth", block: "start" });
      highlightActivityTarget(postId, commentId);
    }, 400);
  }

  function setupAccordions() {
    accordionSections.forEach((section) => {
      const trigger = section.querySelector(".activity-accordion-trigger");
      if (!trigger) return;

      trigger.addEventListener("click", () => {
        const willOpen = !section.classList.contains("is-open");
        section.classList.toggle("is-open", willOpen);
        trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
      });
    });
  }

  function createMeta(text) {
    const p = document.createElement("p");
    p.className = "activity-meta";
    p.textContent = text;
    return p;
  }

  function createActions(buttons) {
    const wrap = document.createElement("div");
    wrap.className = "activity-actions";
    buttons.forEach((btn) => wrap.appendChild(btn));
    return wrap;
  }

  function createSecondaryButton(label, extraClass = "") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `secondary${extraClass ? ` ${extraClass}` : ""}`;
    btn.textContent = label;
    return btn;
  }

  function createSecondaryLink(label, href) {
    const link = document.createElement("a");
    link.className = "secondary activity-action-link";
    link.href = href;
    link.textContent = label;
    return link;
  }

  function feedPostHref(postId, commentId) {
    const params = new URLSearchParams();
    params.set("post", postId);
    if (commentId) params.set("comment", commentId);
    return `/?${params.toString()}`;
  }

  function goToRelatedQuestion(postId, commentId) {
    setAccordionOpen("questions", true);
    window.setTimeout(() => highlightActivityTarget(postId, commentId), 200);
  }

  async function deleteOwnPost(postId) {
    const { error } = await supabase.from("posts").delete().eq("id", postId).eq("user_id", currentUser.id);
    if (error) throw error;
  }

  async function deleteOwnComment(commentId) {
    const { error } = await supabase
      .from("comments")
      .delete()
      .eq("id", commentId)
      .eq("user_id", currentUser.id);
    if (error) throw error;
  }

  async function unsavePost(postId) {
    const { error } = await supabase
      .from("post_saves")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", currentUser.id);
    if (error) throw error;
  }

  async function loadMyQuestions() {
    if (!panelQuestions) return;
    setPanelEmpty(panelQuestions, "Yükleniyor...");

    const { data: posts, error } = await supabase
      .from("posts")
      .select("id, title, content, created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });

    if (error) {
      setPanelEmpty(panelQuestions, "Sorular yüklenemedi.");
      console.error(error.message);
      if (countQuestions) countQuestions.textContent = "0";
      return;
    }

    if (countQuestions) countQuestions.textContent = String(posts?.length ?? 0);

    if (!posts?.length) {
      setPanelEmpty(panelQuestions, "Henüz soru sormadınız.");
      return;
    }

    const postIds = posts.map((p) => p.id);
    const { data: comments } = await supabase
      .from("comments")
      .select("id, post_id, user_id, author, content, created_at")
      .in("post_id", postIds)
      .order("created_at", { ascending: false });

    const allComments = comments ?? [];
    await enrichAnswersWithRatings(allComments);

    const commentsByPost = new Map();
    allComments.forEach((c) => {
      const list = commentsByPost.get(c.post_id) ?? [];
      list.push(c);
      commentsByPost.set(c.post_id, list);
    });

    panelQuestions.replaceChildren();
    posts.forEach((post) => {
      const article = document.createElement("article");
      article.className = "activity-item";
      article.id = `post-${post.id}`;

      const title = document.createElement("h4");
      title.className = "activity-title";
      title.textContent = post.title;

      const content = document.createElement("div");
      content.className = "activity-content rich-content";
      if (window.RekabetliQuill) {
        RekabetliQuill.renderRichContent(content, post.content);
      } else {
        content.textContent = post.content;
      }

      article.append(title, createMeta(formatDate(post.created_at)), content);

      const answers = commentsByPost.get(post.id) ?? [];
      const threadLabel = document.createElement("p");
      threadLabel.className = "activity-thread-label";
      threadLabel.textContent = `Yanıtlar (${answers.length})`;
      article.appendChild(threadLabel);

      if (answers.length) {
        const thread = document.createElement("div");
        thread.className = "activity-thread";
        answers.forEach((answer) => {
          const commentEl = document.createElement("div");
          commentEl.className = "activity-comment";
          commentEl.id = `comment-${answer.id}`;

          const authorLine = document.createElement("strong");
          authorLine.textContent = `${answer.author} · ${formatDate(answer.created_at)}`;

          const answerText = document.createElement("div");
          answerText.className = "rich-content";
          if (window.RekabetliQuill) {
            RekabetliQuill.renderRichContent(answerText, answer.content);
          } else {
            answerText.textContent = answer.content;
          }

          commentEl.append(authorLine, answerText);

          window.RekabetliCommentRatings?.renderRatingBlock(
            commentEl,
            {
              id: answer.id,
              userId: answer.user_id,
              author: answer.author,
              ratingAvg: answer.ratingAvg,
              ratingCount: answer.ratingCount,
              myRating: answer.myRating,
            },
            { currentUserId: currentUser.id, isLoggedIn: true }
          );

          if (answer.user_id === currentUser.id) {
            const deleteCommentBtn = createSecondaryButton("Sil", "danger");
            deleteCommentBtn.addEventListener("click", async () => {
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
                await deleteOwnComment(answer.id);
                await loadAllActivity();
                window.rekabetliNotifications?.refresh();
              } catch (err) {
                await rekabetliAlert({ title: "Silinemedi", message: "Yanıt silinemedi." });
                console.error(err.message);
              }
            });
            commentEl.appendChild(deleteCommentBtn);
          }

          thread.appendChild(commentEl);
        });
        article.appendChild(thread);
      } else {
        const emptyThread = document.createElement("p");
        emptyThread.className = "activity-thread-empty";
        emptyThread.textContent = "Henüz yanıt yok.";
        article.appendChild(emptyThread);
      }

      const deleteBtn = createSecondaryButton("Sil", "danger");
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
          await deleteOwnPost(post.id);
          await loadAllActivity();
          window.rekabetliNotifications?.refresh();
        } catch (err) {
          await rekabetliAlert({ title: "Silinemedi", message: "Soru silinemedi." });
          console.error(err.message);
        }
      });

      article.appendChild(
        createActions([createSecondaryLink("Akışta görüntüle", feedPostHref(post.id)), deleteBtn])
      );
      panelQuestions.appendChild(article);
    });
  }

  async function loadMyAnswers() {
    if (!panelAnswers) return;
    setPanelEmpty(panelAnswers, "Yükleniyor...");

    const { data: comments, error } = await supabase
      .from("comments")
      .select("id, post_id, author, content, created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });

    if (error) {
      setPanelEmpty(panelAnswers, "Yanıtlar yüklenemedi.");
      console.error(error.message);
      if (countAnswers) countAnswers.textContent = "0";
      return;
    }

    if (countAnswers) countAnswers.textContent = String(comments?.length ?? 0);

    if (!comments?.length) {
      setPanelEmpty(panelAnswers, "Henüz yanıt vermediniz.");
      return;
    }

    await enrichAnswersWithRatings(comments);

    const postIds = [...new Set(comments.map((c) => c.post_id))];
    const { data: posts } = await supabase.from("posts").select("id, title").in("id", postIds);
    const titleById = new Map((posts ?? []).map((p) => [p.id, p.title]));

    panelAnswers.replaceChildren();
    comments.forEach((comment) => {
      const article = document.createElement("article");
      article.className = "activity-item";
      article.id = `comment-${comment.id}`;
      const postTitle = titleById.get(comment.post_id) || "Soru";

      const title = document.createElement("h4");
      title.className = "activity-title";
      title.textContent = postTitle;

      const content = document.createElement("div");
      content.className = "activity-content rich-content";
      if (window.RekabetliQuill) {
        RekabetliQuill.renderRichContent(content, comment.content);
      } else {
        content.textContent = comment.content;
      }

      const ratingWrap = document.createElement("div");
      ratingWrap.className = "activity-comment";
      window.RekabetliCommentRatings?.renderRatingBlock(
        ratingWrap,
        {
          id: comment.id,
          userId: currentUser.id,
          author: comment.author,
          ratingAvg: comment.ratingAvg,
          ratingCount: comment.ratingCount,
          myRating: comment.myRating,
        },
        { currentUserId: currentUser.id, isLoggedIn: true }
      );

      const relatedBtn = createSecondaryButton("İlgili soruya git");
      relatedBtn.addEventListener("click", () => {
        goToRelatedQuestion(comment.post_id, comment.id);
      });

      const deleteCommentBtn = createSecondaryButton("Sil", "danger");
      deleteCommentBtn.addEventListener("click", async () => {
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
          await deleteOwnComment(comment.id);
          await loadAllActivity();
          window.rekabetliNotifications?.refresh();
        } catch (err) {
          await rekabetliAlert({ title: "Silinemedi", message: "Yanıt silinemedi." });
          console.error(err.message);
        }
      });

      article.append(
        createMeta(`Yanıt · ${formatDate(comment.created_at)}`),
        title,
        content,
        ratingWrap,
        createActions([
          relatedBtn,
          createSecondaryLink("Akışta görüntüle", feedPostHref(comment.post_id, comment.id)),
          deleteCommentBtn,
        ])
      );
      panelAnswers.appendChild(article);
    });
  }

  async function loadSavedPosts() {
    if (!panelSaved) return;
    setPanelEmpty(panelSaved, "Yükleniyor...");

    const { data: saves, error: savesError } = await supabase
      .from("post_saves")
      .select("post_id, created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });

    if (savesError) {
      setPanelEmpty(panelSaved, "Kayıtlar yüklenemedi.");
      console.error(savesError.message);
      if (countSaved) countSaved.textContent = "0";
      return;
    }

    if (countSaved) countSaved.textContent = String(saves?.length ?? 0);

    if (!saves?.length) {
      setPanelEmpty(panelSaved, "Henüz kaydettiğiniz gönderi yok.");
      return;
    }

    const postIds = saves.map((s) => s.post_id);
    const { data: posts, error: postsError } = await supabase
      .from("posts")
      .select("id, title, content, author, created_at")
      .in("id", postIds);

    if (postsError) {
      setPanelEmpty(panelSaved, "Gönderiler yüklenemedi.");
      return;
    }

    const postById = new Map((posts ?? []).map((p) => [p.id, p]));
    panelSaved.replaceChildren();

    saves.forEach((save) => {
      const post = postById.get(save.post_id);
      if (!post) return;

      const article = document.createElement("article");
      article.className = "activity-item";
      article.id = `saved-post-${post.id}`;

      const title = document.createElement("h4");
      title.className = "activity-title";
      title.textContent = post.title;

      const content = document.createElement("div");
      content.className = "activity-content rich-content";
      if (window.RekabetliQuill) {
        RekabetliQuill.renderRichContent(content, post.content);
      } else {
        content.textContent = post.content;
      }

      const unsaveBtn = createSecondaryButton("Kaldır", "danger");
      unsaveBtn.addEventListener("click", async () => {
        try {
          await unsavePost(post.id);
          await loadAllActivity();
        } catch (err) {
          await rekabetliAlert({ title: "Hata", message: "Kayıt kaldırılamadı." });
          console.error(err.message);
        }
      });

      article.append(
        createMeta(`Kaydedildi · ${formatDate(save.created_at)}`),
        title,
        createMeta(`${post.author} · ${formatDate(post.created_at)}`),
        content,
        createActions([createSecondaryLink("Akışta görüntüle", feedPostHref(post.id)), unsaveBtn])
      );
      panelSaved.appendChild(article);
    });

    if (!panelSaved.children.length) {
      setPanelEmpty(panelSaved, "Kaydedilen gönderiler artık mevcut değil.");
    }
  }

  async function loadAllActivity() {
    await Promise.all([loadMyQuestions(), loadMyAnswers(), loadSavedPosts()]);
    applyDeepLink();
  }

  async function loadProfile() {
    if (!profileForm) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      window.location.href = "/login";
      return;
    }

    currentUser = session.user;
    if (profileEmail) {
      profileEmail.replaceChildren();
      profileEmail.append(document.createTextNode(`Hesap: ${currentUser.email}`));
    }

    setupAccordions();

    const { data, error } = await supabase
      .from("profiles")
      .select("display_name, avatar_url, user_type, is_mentor")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) {
      console.error("Profile load error:", error.message);
      setMessage("Profil yüklenemedi. supabase-profile-fields.sql dosyasını çalıştırın.", true);
    }

    applyProfileToForm(data, currentUser.user_metadata ?? {});
    profileIsMentor = Boolean(data?.is_mentor);
    profileUserType = String(data?.user_type || "").trim();

    const panelHome = window.RekabetliPanelHome?.pathFromProfile?.(data) ||
      (hasMentorAccess()
        ? window.RekabetliPanelHome?.MENTOR_HOME || "/mentor-sayfam"
        : window.RekabetliPanelHome?.STUDENT_HOME || "/ogrenci-sayfam");

    window.RekabetliPanelHome?.setPath?.(currentUser.id, panelHome);

    if (isStandaloneProfilePage) {
      const profileTab =
        window.RekabetliPanelHome?.withProfileTab?.(panelHome) ||
        (String(panelHome).includes("#") ? panelHome : `${panelHome}#profil`);
      window.location.replace(profileTab);
      return;
    }

    if (profileEmail && profileIsMentor) {
      profileEmail.append(document.createTextNode(" "));
      profileEmail.appendChild(createMentorBadge());
    }

    const { data: influencerApp } = await supabase.rpc("get_my_influencer_application");
    if (influencerPageAction) {
      influencerPageAction.hidden = influencerApp?.status !== "approved";
    }
    await loadAllActivity();
  }

  profileUserCodeCopyBtn?.addEventListener("click", () => {
    void copyUserCodeToClipboard();
  });

  avatarInput?.addEventListener("change", async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setMessage("Yalnızca JPG, PNG veya WebP yükleyebilirsin.", true);
      avatarInput.value = "";
      return;
    }

    let selectedFile = file;
    if (selectedFile.size > MAX_AVATAR_BYTES && window.RekabetliImageCompression?.compressImageFile) {
      try {
        selectedFile = await window.RekabetliImageCompression.compressImageFile(selectedFile, {
          maxBytes: MAX_AVATAR_BYTES,
          outputName: "avatar-optimized.webp",
        });
        if (selectedFile.size <= MAX_AVATAR_BYTES) {
          setMessage("Gorsel otomatik optimize edildi ve yuklemeye hazir.");
        }
      } catch (compressionError) {
        console.warn("[rekabetli][avatar-compress-failed]", compressionError);
      }
    }

    if (selectedFile.size > MAX_AVATAR_BYTES) {
      setMessage("Profil fotoğrafı en fazla 5 MB olabilir. Lütfen görseli sıkıştırıp (tercihen WebP) tekrar yükleyin.", true);
      avatarInput.value = "";
      return;
    }

    pendingAvatarFile = selectedFile;
    removeAvatarOnSave = false;
    updateAvatarPreview(URL.createObjectURL(selectedFile), displayNameInput?.value);
    if (removeAvatarBtn) removeAvatarBtn.hidden = false;
    if (selectedFile === file) setMessage("");
  });

  removeAvatarBtn?.addEventListener("click", () => {
    pendingAvatarFile = null;
    removeAvatarOnSave = true;
    if (avatarInput) avatarInput.value = "";
    updateAvatarPreview(null, displayNameInput?.value);
    setMessage("Fotoğraf kaydedildiğinde kaldırılacak.");
  });

  displayNameInput?.addEventListener("input", () => {
    if (!avatarFallback || (avatarPreview && !avatarPreview.hidden)) return;
    avatarFallback.textContent = getInitials(displayNameInput.value);
  });

  async function uploadAvatar(file) {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${currentUser.id}/avatar.${ext}`;

    if (window.RekabetliImageUploadLimit?.consumeUploadSlot) {
      await window.RekabetliImageUploadLimit.consumeUploadSlot(supabase, {
        bucket: AVATAR_BUCKET,
        path,
      });
    }

    const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: "3600",
    });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  }

  userTypeSelect?.addEventListener("change", async () => {
    if (!hasMentorAccess()) {
      leaveMentorConfirmed = false;
      return;
    }
    if (isMentorUserType(userTypeSelect.value)) {
      leaveMentorConfirmed = false;
      return;
    }

    const confirmed = await confirmLeaveMentorRole();
    if (!confirmed) {
      userTypeSelect.value = profileUserType || "Mentor";
      leaveMentorConfirmed = false;
      return;
    }
    leaveMentorConfirmed = true;
  });

  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");

    if (!currentUser) return;

    const displayNameRaw = displayNameInput.value.trim();
    const displayName = window.RekabetliSecurity?.sanitizePersonName
      ? window.RekabetliSecurity.sanitizePersonName(displayNameRaw, 120)
      : displayNameRaw;
    if (!displayName) {
      setMessage("Görünen isim boş olamaz.", true);
      return;
    }

    const selectedType = userTypeSelect.value.trim();
    const leavingMentor = hasMentorAccess() && !isMentorUserType(selectedType);

    if (leavingMentor && !leaveMentorConfirmed) {
      const confirmed = await confirmLeaveMentorRole();
      if (!confirmed) {
        userTypeSelect.value = profileUserType || "Mentor";
        return;
      }
      leaveMentorConfirmed = true;
    }

    const submitBtn = profileForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      let avatarUrl = savedAvatarUrl;

      if (removeAvatarOnSave) {
        avatarUrl = null;
      } else if (pendingAvatarFile) {
        try {
          avatarUrl = await uploadAvatar(pendingAvatarFile);
        } catch (uploadErr) {
          if (window.RekabetliImageUploadLimit?.isLimitError(uploadErr)) {
            setMessage(window.RekabetliImageUploadLimit.getLimitMessage(uploadErr), true);
            return;
          }
          throw uploadErr;
        }
      }

      if (leavingMentor) {
        const { error: leaveError } = await supabase.rpc("leave_mentor_role", {
          p_new_user_type: selectedType || null,
        });
        if (leaveError) throw leaveError;

        profileIsMentor = false;
        profileUserType = selectedType;
        leaveMentorConfirmed = false;
        if (profileEmail) {
          profileEmail.querySelector(".mentor-badge")?.remove();
        }
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: displayName,
          avatar_url: avatarUrl,
          user_type: selectedType || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", currentUser.id);

      if (error) throw error;

      savedAvatarUrl = avatarUrl;
      pendingAvatarFile = null;
      removeAvatarOnSave = false;
      if (avatarInput) avatarInput.value = "";
      updateAvatarPreview(savedAvatarUrl, displayName);
      profileUserType = selectedType;

      const panelHome = window.RekabetliPanelHome?.pathFromProfile?.({
        is_mentor: profileIsMentor,
        user_type: selectedType,
      }) ||
        (hasMentorAccess() ? "/mentor-sayfam" : "/ogrenci-sayfam");
      window.RekabetliPanelHome?.setPath?.(currentUser.id, panelHome);
      void window.syncProfileNavState?.(currentUser);

      if (leavingMentor) {
        setMessage(
          "Profil kaydedildi. Mentör ünvanın kaldırıldı, vitrinin silindi. Mentör paneline erişimin kapandı.",
        );
        if (window.location.pathname.replace(/\/$/, "").endsWith("mentor-sayfam")) {
          window.location.replace(panelHome);
          return;
        }
      } else if (isMentorUserType(selectedType) && !profileIsMentor) {
        setMessage("Profil kaydedildi. Mentör panelin açık; vitrinini oluşturup onaya gönderebilirsin.");
      } else {
        setMessage("Profil başarıyla kaydedildi.");
      }
    } catch (error) {
      console.error("Profile save error:", error.message);
      const code = error?.message || "";
      if (code.includes("leave_mentor_role") || code.includes("not_a_mentor")) {
        setMessage(
          "Mentörlükten çıkış tamamlanamadı. supabase-leave-mentor-role.sql dosyasını çalıştırın veya tekrar deneyin.",
          true,
        );
      } else {
        setMessage(`Profil kaydedilemedi: ${error.message}`, true);
      }
    } finally {
      submitBtn.disabled = false;
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.RekabetliPanelHome?.clear?.();
      window.location.href = "/login";
    } catch (error) {
      console.error("Çıkış hatası:", error.message);
      setMessage("Çıkış yapılamadı.", true);
    }
  });

  deleteProfileBtn?.addEventListener("click", async () => {
    if (!currentUser) return;

    const confirmed = await rekabetliConfirm({
      title: "Profili sil",
      message:
        "Bu islem geri alinamaz. Profilin, paylasimlarin ve hesabina bagli tum veriler kalici olarak silinecek. Devam etmek istiyor musun?",
      confirmLabel: "Evet, sil",
      cancelLabel: "Vazgec",
      danger: true,
    });

    if (!confirmed) return;

    deleteProfileBtn.disabled = true;
    try {
      const { data, error } = await supabase.rpc("delete_my_account");
      if (error) throw error;
      if (!data) throw new Error("Hesap silme islemi tamamlanamadi.");

      await supabase.auth.signOut();
      window.location.href = "/?accountDeleted=1";
    } catch (error) {
      console.error("Account delete error:", error.message || error);
      await rekabetliAlert({
        title: "Silme basarisiz",
        message:
          "Hesap silinemedi. SQL fonksiyonunu calistirdigindan emin ol ve tekrar dene.",
      });
    } finally {
      deleteProfileBtn.disabled = false;
    }
  });

  loadProfile();
})();
