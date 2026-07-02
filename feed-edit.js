(function initFeedEdit() {
  const ANSWER_CONTENT_MAX_LENGTH = 1200;

  const RICH_ALLOWED_TAGS = [
    "p",
    "br",
    "strong",
    "em",
    "u",
    "s",
    "a",
    "img",
    "ol",
    "ul",
    "li",
    "h1",
    "h2",
    "h3",
    "blockquote",
    "code",
    "pre",
    "span",
  ];

  const RICH_ALLOWED_ATTR = [
    "href",
    "target",
    "rel",
    "class",
    "src",
    "alt",
    "loading",
    "width",
    "height",
    "style",
  ];

  function wasEdited(createdAt, updatedAt) {
    if (!createdAt || !updatedAt) return false;
    const created = new Date(createdAt).getTime();
    const updated = new Date(updatedAt).getTime();
    if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;
    return updated - created > 1000;
  }

  function appendTimestampMeta(parent, { createdAt, updatedAt, formatDate }) {
    if (!parent || typeof formatDate !== "function") return;
    parent.append(document.createTextNode(` · ${formatDate(createdAt)}`));
    if (!wasEdited(createdAt, updatedAt)) return;

    const edited = document.createElement("span");
    edited.className = "edited-meta";
    edited.textContent = ` · ${formatDate(updatedAt)} tarihinde düzenlendi`;
    parent.append(edited);
  }

  function sanitizeTitle(value, maxLength = 180) {
    const security = window.RekabetliSecurity;
    if (security?.sanitizePlainText) {
      return security.sanitizePlainText(value, maxLength);
    }
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function sanitizeEditHtml(html) {
    const raw = String(html ?? "").trim();
    if (!raw) return "";

    if (window.DOMPurify) {
      return window.DOMPurify.sanitize(raw, {
        ALLOWED_TAGS: RICH_ALLOWED_TAGS,
        ALLOWED_ATTR: RICH_ALLOWED_ATTR,
      }).trim();
    }

    return raw;
  }

  function normalizeEditHtml(html) {
    return sanitizeEditHtml(html).replace(/\s+/g, " ").trim();
  }

  function captureQuillHtml(quill) {
    return window.RekabetliQuill?.getHtml(quill) || "";
  }

  function buildEditFooter({ onCancel, onSave, alertDialog }) {
    const footer = document.createElement("div");
    footer.className = "feed-edit-footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary";
    cancelBtn.textContent = "Vazgeç";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "nav-btn nav-btn-primary";
    saveBtn.textContent = "Kaydet";
    saveBtn.disabled = true;

    footer.append(cancelBtn, saveBtn);

    cancelBtn.addEventListener("click", () => {
      onCancel?.();
    });

    saveBtn.addEventListener("click", async () => {
      if (saveBtn.disabled) return;

      saveBtn.disabled = true;
      cancelBtn.disabled = true;

      try {
        await onSave();
      } catch (error) {
        console.error("Feed edit save error:", error);
        await alertDialog?.({
          title: "Kaydedilemedi",
          message: "Değişiklikler kaydedilemedi. Bağlantı veya izinleri kontrol et.",
        });
      } finally {
        cancelBtn.disabled = false;
        if (!saveBtn.isConnected) return;
        syncSaveState?.();
      }
    });

    let syncSaveState = () => {
      saveBtn.disabled = true;
    };

    return {
      footer,
      saveBtn,
      cancelBtn,
      setSyncHandler(handler) {
        syncSaveState = handler;
      },
      syncSaveState() {
        syncSaveState();
      },
    };
  }

  async function updatePost(supabase, postId, userId, { title, content }) {
    if (!userId) throw new Error("auth_required");

    const safeTitle = sanitizeTitle(title);
    const safeContent = sanitizeEditHtml(content);
    if (!safeTitle) throw new Error("empty_title");
    if (!safeContent) throw new Error("empty_content");

    const { data, error } = await supabase
      .from("posts")
      .update({ title: safeTitle, content: safeContent })
      .eq("id", postId)
      .eq("user_id", userId)
      .select("id, user_id, author, title, content, created_at, updated_at")
      .single();

    if (error) throw error;
    return data;
  }

  async function updateComment(supabase, commentId, userId, content) {
    if (!userId) throw new Error("auth_required");

    const safeContent = sanitizeEditHtml(content);
    if (!safeContent) throw new Error("empty_content");

    const { data, error } = await supabase
      .from("comments")
      .update({ content: safeContent })
      .eq("id", commentId)
      .eq("user_id", userId)
      .select("id, post_id, parent_comment_id, user_id, author, content, created_at, updated_at")
      .single();

    if (error) throw error;
    return data;
  }

  function startPostEdit({
    question,
    cardEl,
    titleMaxLength = 180,
    contentMaxLength = 1800,
    onSave,
    onCancel,
    alertDialog,
  }) {
    if (!cardEl || cardEl.dataset.editing === "true") return false;

    const titleEl = cardEl.querySelector(".question-title");
    const contentEl = cardEl.querySelector(".question-content");
    const questionBody = cardEl.querySelector(".question-body");
    const ownerActions = cardEl.querySelector(".question-owner-actions");
    if (!titleEl || !contentEl || !questionBody) return false;

    cardEl.dataset.editing = "true";
    question._setAccordionExpanded?.(true);

    titleEl.hidden = true;
    contentEl.hidden = true;
    if (ownerActions) ownerActions.hidden = true;

    const form = document.createElement("div");
    form.className = "feed-edit-form post-edit-form";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "feed-edit-title post-edit-title";
    titleInput.value = question.title;
    titleInput.maxLength = titleMaxLength;
    titleInput.setAttribute("aria-label", "Başlık");

    const editorPanel = document.createElement("div");
    editorPanel.className = "feed-edit-editor-panel";

    const editorHost = document.createElement("div");
    editorHost.className = "feed-edit-editor-host";
    editorHost.setAttribute("aria-label", "İçerik");
    editorPanel.appendChild(editorHost);

    const initialTitle = String(question.title ?? "").trim();
    let initialContent = normalizeEditHtml(question.content);

    const footerUi = buildEditFooter({
      alertDialog,
      onCancel: () => {
        cleanup();
        onCancel?.();
      },
      onSave: async () => {
        const title = titleInput.value.trim();
        const content = captureQuillHtml(quill);

        if (!title) {
          await alertDialog?.({
            title: "Boş başlık",
            message: "Başlık yazmadan kaydedemezsin.",
          });
          return;
        }

        if (!content || window.RekabetliQuill?.isEmpty(quill)) {
          await alertDialog?.({
            title: "Boş içerik",
            message: "İçerik yazmadan kaydedemezsin.",
          });
          return;
        }

        if (
          title === initialTitle &&
          normalizeEditHtml(content) === initialContent
        ) {
          return;
        }

        await onSave({ title, content });
        cleanup();
      },
    });

    form.append(titleInput, editorPanel, footerUi.footer);
    questionBody.appendChild(form);

    let quill = null;
    quill = window.RekabetliQuill?.create(editorHost, {
      placeholder: "İçeriği düzenle...",
      maxLength: contentMaxLength,
    });

    if (!quill) {
      cleanup();
      return false;
    }

    window.RekabetliQuill.setHtml(quill, question.content);

    const syncSaveState = () => {
      const title = titleInput.value.trim();
      const content = captureQuillHtml(quill);
      const hasChanges =
        title !== initialTitle || normalizeEditHtml(content) !== initialContent;
      const isValid =
        Boolean(title) && Boolean(content) && !window.RekabetliQuill?.isEmpty(quill);
      footerUi.saveBtn.disabled = !(hasChanges && isValid);
    };

    footerUi.setSyncHandler(syncSaveState);
    titleInput.addEventListener("input", syncSaveState);
    quill.on("text-change", syncSaveState);

    requestAnimationFrame(() => {
      initialContent = normalizeEditHtml(captureQuillHtml(quill) || question.content);
      syncSaveState();
      titleInput.focus();
    });

    function cleanup() {
      delete cardEl.dataset.editing;
      form.remove();
      titleEl.hidden = false;
      contentEl.hidden = false;
      if (ownerActions) ownerActions.hidden = false;
    }

    return true;
  }

  function startCommentEdit({
    containerEl,
    contentEl,
    initialContent,
    onSave,
    onCancel,
    alertDialog,
  }) {
    if (!containerEl || !contentEl || containerEl.dataset.editing === "true") return false;

    containerEl.dataset.editing = "true";
    contentEl.hidden = true;

    const form = document.createElement("div");
    form.className = "feed-edit-form comment-edit-form";

    const editorPanel = document.createElement("div");
    editorPanel.className = "feed-edit-editor-panel";

    const editorHost = document.createElement("div");
    editorHost.className = "feed-edit-editor-host";
    editorHost.setAttribute("aria-label", "Düzenleme metni");
    editorPanel.appendChild(editorHost);

    let baselineContent = normalizeEditHtml(initialContent);

    const footerUi = buildEditFooter({
      alertDialog,
      onCancel: () => {
        cleanup();
        onCancel?.();
      },
      onSave: async () => {
        const content = captureQuillHtml(quill);

        if (!content || window.RekabetliQuill?.isEmpty(quill)) {
          await alertDialog?.({
            title: "Boş metin",
            message: "Metin yazmadan kaydedemezsin.",
          });
          return;
        }

        if (normalizeEditHtml(content) === baselineContent) {
          return;
        }

        await onSave(content);
        cleanup();
      },
    });

    form.append(editorPanel, footerUi.footer);
    contentEl.insertAdjacentElement("afterend", form);

    let quill = null;
    quill = window.RekabetliQuill?.create(editorHost, {
      placeholder: "Metni düzenle...",
      maxLength: ANSWER_CONTENT_MAX_LENGTH,
      toolbar: [
        ["bold", "italic", "underline"],
        ["image"],
        [{ list: "bullet" }],
        ["clean"],
      ],
    });

    if (!quill) {
      cleanup();
      return false;
    }

    window.RekabetliQuill.setHtml(quill, initialContent);

    const syncSaveState = () => {
      const content = captureQuillHtml(quill);
      const hasChanges = normalizeEditHtml(content) !== baselineContent;
      const isValid = Boolean(content) && !window.RekabetliQuill?.isEmpty(quill);
      footerUi.saveBtn.disabled = !(hasChanges && isValid);
    };

    footerUi.setSyncHandler(syncSaveState);
    quill.on("text-change", syncSaveState);

    requestAnimationFrame(() => {
      baselineContent = normalizeEditHtml(captureQuillHtml(quill) || initialContent);
      syncSaveState();
      quill.focus?.();
    });

    function cleanup() {
      delete containerEl.dataset.editing;
      form.remove();
      contentEl.hidden = false;
    }

    return true;
  }

  function patchCommentInTree(answers, commentId, patch) {
    for (const answer of answers ?? []) {
      if (answer.id === commentId) {
        Object.assign(answer, patch);
        return true;
      }
      for (const reply of answer.replies ?? []) {
        if (reply.id === commentId) {
          Object.assign(reply, patch);
          return true;
        }
      }
    }
    return false;
  }

  window.RekabetliFeedEdit = {
    wasEdited,
    appendTimestampMeta,
    updatePost,
    updateComment,
    patchCommentInTree,
    startPostEdit,
    startCommentEdit,
  };
})();
