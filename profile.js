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
  const mentorPageAction = document.getElementById("mentor-page-action");
  const accordionSections = document.querySelectorAll(".activity-accordion-section");

  let currentUser = null;
  let savedAvatarUrl = null;
  let pendingAvatarFile = null;
  let removeAvatarOnSave = false;

  function formatDate(isoDate) {
    return new Date(isoDate).toLocaleString("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function setMessage(text, isError = false) {
    profileMessage.textContent = text;
    profileMessage.classList.toggle("profile-message-error", isError);
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
    const isBlobPreview = String(url ?? "").trim().startsWith("blob:");
    window.RekabetliAvatars?.applyUserAvatar({
      imgEl: avatarPreview,
      fallbackEl: avatarFallback,
      avatarUrl: url,
      displayName: displayName || "?",
      seed: currentUser?.id || displayName,
      setImgOptions: isBlobPreview ? { allowBlob: true } : undefined,
    });

    removeAvatarBtn.hidden = !url;
  }

  function applyProfileToForm(profile, metadata) {
    const firstName = metadata?.first_name ?? "";
    const lastName = metadata?.last_name ?? "";
    const defaultName = `${firstName} ${lastName}`.trim();

    displayNameInput.value = profile?.display_name?.trim() || defaultName || "";
    bioInput.value = profile?.bio?.trim() || "";
    userTypeSelect.value = profile?.user_type?.trim() || metadata?.user_type?.trim() || "";
    schoolInput.value = profile?.school?.trim() || metadata?.school?.trim() || "";
    cityInput.value = profile?.city?.trim() || "";
    phoneInput.value = profile?.phone?.trim() || metadata?.phone?.trim() || "";

    savedAvatarUrl = profile?.avatar_url?.trim() || null;
    pendingAvatarFile = null;
    removeAvatarOnSave = false;
    updateAvatarPreview(savedAvatarUrl, displayNameInput.value);

    const ratingDisplay = window.RekabetliCommentRatings?.getProfileRatingDisplay(profile);
    if (profileAnswerRating) {
      if (ratingDisplay) {
        const avgText = window.RekabetliCommentRatings.formatAvg(ratingDisplay.avg);
        profileAnswerRating.textContent = `Yanıtlarınızın ortalama faydalılık puanı: ${avgText} / 5 (${ratingDisplay.count} değerlendirme)`;
        profileAnswerRating.hidden = false;
      } else {
        profileAnswerRating.textContent = "";
        profileAnswerRating.hidden = true;
      }
    }
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
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      window.location.href = "/login";
      return;
    }

    currentUser = session.user;
    profileEmail.replaceChildren();
    profileEmail.append(document.createTextNode(`Hesap: ${currentUser.email}`));

    setupAccordions();

    const { data, error } = await supabase
      .from("profiles")
      .select(
        "display_name, bio, avatar_url, city, school, user_type, phone, is_mentor, answer_rating_sum, answer_rating_count"
      )
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) {
      console.error("Profile load error:", error.message);
      setMessage("Profil yüklenemedi. supabase-profile-fields.sql dosyasını çalıştırın.", true);
    }

    applyProfileToForm(data, currentUser.user_metadata ?? {});
    if (data?.is_mentor) {
      profileEmail.append(document.createTextNode(" "));
      profileEmail.appendChild(createMentorBadge());
      if (mentorPageAction) mentorPageAction.hidden = false;
    } else if (mentorPageAction) {
      mentorPageAction.hidden = true;
    }
    await loadAllActivity();
  }

  avatarInput.addEventListener("change", async () => {
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
    updateAvatarPreview(URL.createObjectURL(selectedFile), displayNameInput.value);
    removeAvatarBtn.hidden = false;
    if (selectedFile === file) setMessage("");
  });

  removeAvatarBtn.addEventListener("click", () => {
    pendingAvatarFile = null;
    removeAvatarOnSave = true;
    avatarInput.value = "";
    updateAvatarPreview(null, displayNameInput.value);
    setMessage("Fotoğraf kaydedildiğinde kaldırılacak.");
  });

  displayNameInput.addEventListener("input", () => {
    if (!avatarPreview.hidden) return;
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

  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");

    if (!currentUser) return;

    const displayName = displayNameInput.value.trim();
    if (!displayName) {
      setMessage("Görünen isim boş olamaz.", true);
      return;
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

      const { error } = await supabase.from("profiles").upsert(
        {
          id: currentUser.id,
          email: currentUser.email,
          display_name: displayName,
          bio: bioInput.value.trim() || null,
          avatar_url: avatarUrl,
          city: cityInput.value.trim() || null,
          school: schoolInput.value.trim() || null,
          user_type: userTypeSelect.value.trim() || null,
          phone: phoneInput.value.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (error) throw error;

      savedAvatarUrl = avatarUrl;
      pendingAvatarFile = null;
      removeAvatarOnSave = false;
      avatarInput.value = "";
      updateAvatarPreview(savedAvatarUrl, displayName);
      setMessage("Profil başarıyla kaydedildi.");
    } catch (error) {
      console.error("Profile save error:", error.message);
      setMessage(`Profil kaydedilemedi: ${error.message}`, true);
    } finally {
      submitBtn.disabled = false;
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
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
