(function initCommentReplies() {
  function partitionComments(comments) {
    const topLevel = [];
    const repliesByParent = new Map();

    (comments ?? []).forEach((comment) => {
      if (comment.parentCommentId) {
        const list = repliesByParent.get(comment.parentCommentId) ?? [];
        list.push(comment);
        repliesByParent.set(comment.parentCommentId, list);
        return;
      }
      topLevel.push({ ...comment, replies: [] });
    });

    topLevel.forEach((answer) => {
      const replies = repliesByParent.get(answer.id) ?? [];
      replies.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      answer.replies = replies;
    });

    topLevel.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return topLevel;
  }

  function renderAnswers(container, answers, postId, ctx) {
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
      if (answer.authorIsMentor && ctx.createMentorBadge) {
        header.appendChild(ctx.createMentorBadge());
      }
      window.RekabetliFeedEdit?.appendTimestampMeta(header, {
        createdAt: answer.createdAt,
        updatedAt: answer.updatedAt,
        formatDate: ctx.formatDate,
      });

      const content = document.createElement("div");
      content.className = "rich-content";
      window.RekabetliQuill?.renderRichContent(content, answer.content);

      answerEl.append(header, content);

      window.RekabetliCommentRatings?.renderRatingBlock(answerEl, answer, {
        currentUserId: ctx.currentUserId,
        isLoggedIn: ctx.isLoggedIn,
        onRequireLogin: ctx.onRequireLogin,
      });

      const isCommentOwner = Boolean(
        ctx.currentUserId && answer.userId && answer.userId === ctx.currentUserId,
      );
      if (isCommentOwner && (ctx.onEditAnswer || ctx.onDeleteAnswer)) {
        const ownerActions = document.createElement("div");
        ownerActions.className = "answer-owner-actions";

        if (ctx.onEditAnswer) {
          const editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.className = "secondary answer-edit-btn";
          editBtn.textContent = "Düzenle";
          editBtn.addEventListener("click", () => {
            window.RekabetliFeedEdit?.startCommentEdit({
              containerEl: answerEl,
              contentEl: content,
              initialContent: answer.content,
              onSave: async (newContent) => {
                await ctx.onEditAnswer(answer, postId, newContent);
              },
              alertDialog: ctx.alertDialog,
            });
          });
          ownerActions.appendChild(editBtn);
        }

        if (ctx.onDeleteAnswer) {
          const deleteBtn = document.createElement("button");
          deleteBtn.type = "button";
          deleteBtn.className = "secondary danger answer-delete-btn";
          deleteBtn.textContent = "Sil";
          deleteBtn.addEventListener("click", () => {
            void ctx.onDeleteAnswer(answer, postId);
          });
          ownerActions.appendChild(deleteBtn);
        }

        answerEl.appendChild(ownerActions);
      }

      mountReplySection(answerEl, answer, postId, ctx);
      container.appendChild(answerEl);
    });
  }

  function mountReplySection(answerEl, answer, postId, ctx) {
    const replies = answer.replies ?? [];
    const section = document.createElement("div");
    section.className = "answer-replies";

    if (replies.length) {
      const list = document.createElement("div");
      list.className = "answer-replies-list";
      replies.forEach((reply) => {
        list.appendChild(renderReplyItem(reply, answer, postId, ctx));
      });
      section.appendChild(list);
    }

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "secondary answer-reply-toggle-btn";
    toggleBtn.textContent = "Yorum yap";

    const form = document.createElement("form");
    form.className = "answer-reply-form";
    form.hidden = true;
    if (ctx.draftScope) {
      form.dataset.draftKey = window.RekabetliFeedDrafts?.buildKey({
        ...ctx.draftScope,
        kind: "reply",
        id: answer.id,
      });
    }

    const label = document.createElement("label");
    label.className = "answer-reply-editor-label";
    label.textContent = "Yorumun";

    const editorHost = document.createElement("div");
    editorHost.className = "answer-editor-host quill-editor-host";
    editorHost.setAttribute("aria-label", "Yorum metni");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Gönder";

    form.append(label, editorHost, submit);

    async function ensureCommunityAccess() {
      if (typeof ctx.requireCommunityAccess !== "function") return true;
      try {
        return Boolean(await ctx.requireCommunityAccess(postId));
      } catch (error) {
        console.error("Community access check error:", error);
        return false;
      }
    }

    toggleBtn.addEventListener("click", () => {
      void (async () => {
        if (!ctx.requireLogin?.()) return;
        if (!(await ensureCommunityAccess())) return;
        const willOpen = form.hidden;
        form.hidden = !willOpen;
        toggleBtn.textContent = willOpen ? "Vazgeç" : "Yorum yap";
        if (willOpen) {
          const quill = window.RekabetliQuill?.ensureAnswerEditor(form);
          quill?.focus?.();
        }
      })();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!ctx.requireLogin?.()) return;
      if (!(await ensureCommunityAccess())) return;

      const quill = window.RekabetliQuill?.ensureAnswerEditor(form);
      if (!quill) {
        await ctx.alertDialog?.({
          title: "Düzenleyici yüklenemedi",
          message: "Yorum alanı açılamadı. Sayfayı yenileyip tekrar deneyin.",
        });
        return;
      }

      const content = window.RekabetliQuill?.getHtml(quill) || "";
      if (!content) {
        await ctx.alertDialog?.({
          title: "Boş yorum",
          message: "Yorum yazmadan gönderemezsin.",
        });
        return;
      }

      submit.disabled = true;
      try {
        await ctx.onSubmitReply?.({
          postId,
          parentCommentId: answer.id,
          content,
        });
        if (form.dataset.draftKey) window.RekabetliFeedDrafts?.clear(form.dataset.draftKey);
        if (form._rekabetliQuill) window.RekabetliQuill?.clear(form._rekabetliQuill);
        form.hidden = true;
        toggleBtn.textContent = "Yorum yap";
      } catch (error) {
        console.error("Reply insert error:", error);
        await ctx.alertDialog?.({
          title: "Hata",
          message: "Yorum kaydedilemedi. Bağlantı veya izinleri kontrol et.",
        });
      } finally {
        submit.disabled = false;
      }
    });

    section.append(toggleBtn, form);
    answerEl.appendChild(section);
  }

  function renderReplyItem(reply, answer, postId, ctx) {
    const el = document.createElement("div");
    el.className = "answer-reply";
    el.id = `comment-${reply.id}`;

    const header = document.createElement("div");
    header.className = "answer-reply-header";
    const author = document.createElement("strong");
    author.textContent = reply.author;
    header.append(author);
    if (reply.authorIsMentor && ctx.createMentorBadge) {
      header.appendChild(ctx.createMentorBadge());
    }
    window.RekabetliFeedEdit?.appendTimestampMeta(header, {
      createdAt: reply.createdAt,
      updatedAt: reply.updatedAt,
      formatDate: ctx.formatDate,
    });

    const content = document.createElement("div");
    content.className = "rich-content answer-reply-content";
    window.RekabetliQuill?.renderRichContent(content, reply.content);

    el.append(header, content);

    const isOwner = Boolean(ctx.currentUserId && reply.userId && reply.userId === ctx.currentUserId);
    if (isOwner && (ctx.onEditReply || ctx.onDeleteReply)) {
      const ownerActions = document.createElement("div");
      ownerActions.className = "answer-owner-actions";

      if (ctx.onEditReply) {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "secondary answer-edit-btn";
        editBtn.textContent = "Düzenle";
        editBtn.addEventListener("click", () => {
          window.RekabetliFeedEdit?.startCommentEdit({
            containerEl: el,
            contentEl: content,
            initialContent: reply.content,
            onSave: async (newContent) => {
              await ctx.onEditReply(reply, answer, postId, newContent);
            },
            alertDialog: ctx.alertDialog,
          });
        });
        ownerActions.appendChild(editBtn);
      }

      if (ctx.onDeleteReply) {
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "secondary danger answer-reply-delete-btn";
        deleteBtn.textContent = "Sil";
        deleteBtn.addEventListener("click", () => {
          void ctx.onDeleteReply(reply, answer, postId);
        });
        ownerActions.appendChild(deleteBtn);
      }

      el.appendChild(ownerActions);
    }

    return el;
  }

  window.RekabetliCommentReplies = {
    partitionComments,
    renderAnswers,
  };
})();
