(function initFeedDrafts() {
  const PREFIX = "rekabetli-draft:";
  const SAVE_DELAY_MS = 250;
  const boundQuills = new Set();

  function buildKey({ page, communityId, kind, id }) {
    const parts = [page];
    if (communityId) parts.push(communityId);
    parts.push(kind);
    if (id) parts.push(id);
    return PREFIX + parts.join(":");
  }

  function read(key) {
    if (!key) return null;
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function write(key, data) {
    if (!key) return;
    try {
      const hasTitle = Boolean(data?.title?.trim());
      const hasHtml = Boolean(data?.html?.trim());
      if (!hasTitle && !hasHtml) {
        sessionStorage.removeItem(key);
        return;
      }
      sessionStorage.setItem(key, JSON.stringify(data));
    } catch {
      /* depolama dolu veya gizli mod */
    }
  }

  function clear(key) {
    if (!key) return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* yoksay */
    }
  }

  function flushQuill(quill) {
    const key = quill?._rekabetliDraftKey;
    if (!key) return;
    const html = window.RekabetliQuill?.getHtml(quill) || "";
    const existing = read(key) || {};
    if (html) {
      write(key, { ...existing, html });
    } else if (existing.title?.trim()) {
      write(key, { title: existing.title });
    } else {
      clear(key);
    }
  }

  function restoreQuill(quill, key) {
    const data = read(key);
    if (!data?.html || !quill) return;
    window.RekabetliQuill?.setHtml?.(quill, data.html);
  }

  function bindQuill(quill, key) {
    if (!quill || !key || quill._rekabetliDraftKey) return;
    quill._rekabetliDraftKey = key;
    boundQuills.add(quill);
    restoreQuill(quill, key);
    quill.on("text-change", () => {
      clearTimeout(quill._rekabetliDraftTimer);
      quill._rekabetliDraftTimer = setTimeout(() => flushQuill(quill), SAVE_DELAY_MS);
    });
  }

  function bindField(input, key, field = "title") {
    if (!input || !key || input._rekabetliDraftKey) return;
    input._rekabetliDraftKey = key;
    const data = read(key);
    if (data?.[field]) input.value = data[field];

    input.addEventListener("input", () => {
      const existing = read(key) || {};
      const value = input.value;
      const next = { ...existing, [field]: value };
      if (!value.trim() && !existing.html?.trim()) {
        clear(key);
      } else {
        write(key, next);
      }
    });
  }

  function bindAnswerForm(form, key) {
    if (!form || !key) return;
    form.dataset.draftKey = key;
    const quill = form._rekabetliQuill;
    if (quill) bindQuill(quill, key);
  }

  function captureVisibleForms() {
    boundQuills.forEach((quill) => {
      if (quill?.root?.isConnected) flushQuill(quill);
    });

    document.querySelectorAll(".answer-form, .answer-reply-form").forEach((form) => {
      if (form._rekabetliQuill) flushQuill(form._rekabetliQuill);
    });

    const titleInput = document.querySelector("#question-form [name='title']");
    if (titleInput?._rekabetliDraftKey) {
      const key = titleInput._rekabetliDraftKey;
      const existing = read(key) || {};
      const title = titleInput.value;
      if (title.trim() || existing.html?.trim()) {
        write(key, { ...existing, title });
      }
    }
  }

  window.RekabetliFeedDrafts = {
    buildKey,
    bindQuill,
    bindField,
    bindAnswerForm,
    clear,
    captureVisibleForms,
    flushQuill,
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    captureVisibleForms();
  });
})();
