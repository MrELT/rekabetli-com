(function initRekabetliQuill() {
  const FORUM_ATTACHMENTS_BUCKET = "forum-attachments";
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const ANSWER_CONTENT_MAX_LENGTH = 1200;
  const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

  const QUESTION_TOOLBAR = [
    ["bold", "italic", "underline"],
    ["link", "image"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["blockquote"],
    ["clean"],
  ];

  const ANSWER_TOOLBAR = [
    ["bold", "italic", "underline"],
    ["image"],
    [{ list: "bullet" }],
    ["clean"],
  ];

  const IMAGE_RESIZE_MIN_PX = 48;

  function buildEditorModules(toolbarContainer) {
    return {
      toolbar: buildToolbarModules(toolbarContainer),
    };
  }

  function attachImageResize(quill) {
    if (!quill || quill._rekabetliImageResizeAttached) return;
    quill._rekabetliImageResizeAttached = true;

    const container = quill.root.parentElement;
    if (!container) return;

    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }

    let overlay = null;
    let selectedImg = null;
    let sizeLabel = null;

    const hide = () => {
      overlay?.remove();
      overlay = null;
      selectedImg = null;
      sizeLabel = null;
    };

    const updateLabel = () => {
      if (!sizeLabel || !selectedImg) return;
      const w = Math.round(selectedImg.getBoundingClientRect().width);
      const h = Math.round(selectedImg.getBoundingClientRect().height);
      sizeLabel.textContent = `${w} × ${h}`;
    };

    const reposition = () => {
      if (!overlay || !selectedImg) return;
      if (!quill.root.contains(selectedImg)) {
        hide();
        return;
      }

      const cr = container.getBoundingClientRect();
      const ir = selectedImg.getBoundingClientRect();
      Object.assign(overlay.style, {
        left: `${ir.left - cr.left + container.scrollLeft}px`,
        top: `${ir.top - cr.top + container.scrollTop}px`,
        width: `${ir.width}px`,
        height: `${ir.height}px`,
      });
      updateLabel();
    };

    const applyImageSize = (img, width, height) => {
      const w = Math.max(IMAGE_RESIZE_MIN_PX, Math.round(width));
      const h = Math.max(IMAGE_RESIZE_MIN_PX, Math.round(height));
      img.width = w;
      img.height = h;
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
      img.removeAttribute("data-width");
      img.removeAttribute("data-height");
    };

    const selectImage = (img) => {
      if (!img || !quill.root.contains(img)) return;

      hide();
      selectedImg = img;

      overlay = document.createElement("div");
      overlay.className = "rekabetli-image-resize-overlay";
      overlay.setAttribute("contenteditable", "false");

      sizeLabel = document.createElement("span");
      sizeLabel.className = "rekabetli-image-size-label";
      overlay.appendChild(sizeLabel);

      ["nw", "ne", "sw", "se"].forEach((corner) => {
        const handle = document.createElement("span");
        handle.className = `rekabetli-image-handle rekabetli-image-handle-${corner}`;
        handle.dataset.corner = corner;
        handle.addEventListener("mousedown", startDrag);
        overlay.appendChild(handle);
      });

      container.appendChild(overlay);
      reposition();
    };

    quill._rekabetliImageResizeSelect = selectImage;

    function startDrag(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!selectedImg) return;

      const corner = event.currentTarget.dataset.corner;
      const startX = event.clientX;
      const startY = event.clientY;
      const startW = selectedImg.width || selectedImg.getBoundingClientRect().width;
      const startH = selectedImg.height || selectedImg.getBoundingClientRect().height;
      const ratio =
        selectedImg.naturalWidth > 0
          ? selectedImg.naturalWidth / selectedImg.naturalHeight
          : startW / startH || 1;

      const onMove = (moveEvent) => {
        let dx = moveEvent.clientX - startX;
        let dy = moveEvent.clientY - startY;

        if (corner.includes("w")) dx = -dx;
        if (corner.includes("n")) dy = -dy;

        let newW = startW + dx;
        let newH = startH + dy;

        if (moveEvent.shiftKey) {
          newH = newW / ratio;
        } else {
          newH = newW / ratio;
        }

        applyImageSize(selectedImg, newW, newH);
        reposition();
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }

    quill.root.addEventListener("click", (event) => {
      const img = event.target.closest("img");
      if (img && quill.root.contains(img)) {
        event.preventDefault();
        selectImage(img);
        return;
      }

      if (!event.target.closest(".rekabetli-image-resize-overlay")) {
        hide();
      }
    });

    quill.on("text-change", reposition);

    [container, container.closest(".modal-overlay")].filter(Boolean).forEach((el) => {
      el.addEventListener("scroll", reposition, { passive: true });
    });

    window.addEventListener("resize", reposition, { passive: true });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hide();
    });
  }

  function getSb() {
    return window.sb || null;
  }

  function sanitizeFileName(name) {
    return String(name || "gorsel.jpg").replace(/[^\w.\-]+/g, "_");
  }

  async function showQuillAlert(title, message) {
    if (typeof window.rekabetliAlert === "function") {
      await window.rekabetliAlert({ title, message });
      return;
    }
    window.alert(`${title}\n\n${message}`);
  }

  async function uploadForumImage(file) {
    const sb = getSb();
    if (!sb) {
      throw new Error("Supabase bağlantısı bulunamadı.");
    }

    const {
      data: { session },
    } = await sb.auth.getSession();

    if (!session?.user?.id) {
      const err = new Error("Giriş gerekli");
      err.code = "NOT_LOGGED_IN";
      throw err;
    }

    const userId = session.user.id;
    const filePath = `${userId}/${Date.now()}-${sanitizeFileName(file.name)}`;

    if (window.RekabetliImageUploadLimit?.consumeUploadSlot) {
      await window.RekabetliImageUploadLimit.consumeUploadSlot(sb, {
        bucket: FORUM_ATTACHMENTS_BUCKET,
        path: filePath,
      });
    }

    const { error: uploadError } = await sb.storage.from(FORUM_ATTACHMENTS_BUCKET).upload(filePath, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });

    if (uploadError) throw uploadError;

    const { data } = sb.storage.from(FORUM_ATTACHMENTS_BUCKET).getPublicUrl(filePath);
    return data.publicUrl;
  }

  function insertImageAtSelection(quill, imageUrl) {
    const range = quill.getSelection(true);
    const index = range ? range.index : quill.getLength();
    quill.insertEmbed(index, "image", imageUrl, "user");
    quill.setSelection(index + 1, 0, "silent");
  }

  async function handleImageFile(quill, file) {
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      await showQuillAlert(
        "Geçersiz dosya",
        "Yalnızca JPEG, PNG, WebP veya GIF yükleyebilirsin."
      );
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      await showQuillAlert("Dosya çok büyük", "Görsel en fazla 5 MB olabilir.");
      return;
    }

    const toolbar = quill.getModule("toolbar");
    const imageBtn = toolbar?.container?.querySelector(".ql-image");
    imageBtn?.classList.add("ql-image-uploading");

    try {
      const publicUrl = await uploadForumImage(file);
      insertImageAtSelection(quill, publicUrl);
      const insertedImg = quill.root.querySelectorAll("img");
      const lastImg = insertedImg[insertedImg.length - 1];
      if (lastImg && quill._rekabetliImageResizeSelect) {
        requestAnimationFrame(() => quill._rekabetliImageResizeSelect(lastImg));
      }
    } catch (error) {
      console.error("Forum görseli yüklenemedi:", error);

      if (error.code === "NOT_LOGGED_IN") {
        window.location.href = "/login";
        return;
      }

      if (window.RekabetliImageUploadLimit?.isLimitError(error)) {
        await showQuillAlert("Günlük limit", window.RekabetliImageUploadLimit.getLimitMessage(error));
        return;
      }

      await showQuillAlert(
        "Yükleme başarısız",
        "Görsel yüklenemedi. Giriş yaptığınızdan ve supabase-forum-attachments.sql dosyasını çalıştırdığınızdan emin olun."
      );
    } finally {
      imageBtn?.classList.remove("ql-image-uploading");
    }
  }

  function imageHandler() {
    const quill = this.quill;
    if (!quill) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/gif";
    input.hidden = true;

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      void handleImageFile(quill, file);
    });

    document.body.appendChild(input);
    input.click();
  }

  function buildToolbarModules(container) {
    return {
      container,
      handlers: {
        image: imageHandler,
      },
    };
  }

  function preventBase64Images(quill) {
    quill.on("text-change", () => {
      quill.root.querySelectorAll('img[src^="data:"]').forEach((img) => {
        const blot = Quill.find(img);
        if (blot && typeof blot.remove === "function") {
          blot.remove();
        } else {
          img.remove();
        }
      });
    });
  }

  function isHtmlContent(value) {
    return /<[^>]+>/.test(String(value || ""));
  }

  function renderRichContent(element, content) {
    if (!element) return;

    const raw = String(content || "").trim();
    element.classList.add("rich-content");

    if (!raw) {
      element.replaceChildren();
      return;
    }

    if (isHtmlContent(raw) && !window.DOMPurify) {
      console.warn(
        "[rekabetli] DOMPurify yüklü değil; zengin içerik düz metin olarak gösteriliyor."
      );
      element.textContent = raw;
      return;
    }

    if (isHtmlContent(raw) && window.DOMPurify) {
      element.innerHTML = DOMPurify.sanitize(raw, {
        ALLOWED_TAGS: [
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
        ],
        ALLOWED_ATTR: ["href", "target", "rel", "class", "src", "alt", "loading", "width", "height", "style"],
      });

      element.querySelectorAll("a[href]").forEach((link) => {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      });

      element.querySelectorAll("img[src]").forEach((img) => {
        img.setAttribute("loading", "lazy");
        img.setAttribute("alt", img.getAttribute("alt") || "Eklenen görsel");
      });
      return;
    }

    element.textContent = raw;
  }

  function hasMeaningfulContent(quill) {
    if (!quill) return false;
    if (quill.getText().trim()) return true;
    return Boolean(quill.root.querySelector("img"));
  }

  function attachMaxLength(quill, maxLength) {
    if (!maxLength) return;

    quill.on("text-change", () => {
      const length = quill.getLength() - 1;
      if (length > maxLength) {
        quill.deleteText(maxLength, length - maxLength);
      }
    });
  }

  function create(host, options = {}) {
    if (!host || typeof Quill === "undefined") {
      console.error("Quill editor host veya Quill kütüphanesi bulunamadı.");
      return null;
    }

    try {
      host.classList.add("quill-editor-host");
      host.querySelectorAll(".quill-editor-wrap").forEach((node) => node.remove());

      const wrapper = document.createElement("div");
      wrapper.className = "quill-editor-wrap";
      host.appendChild(wrapper);

      const quill = new Quill(wrapper, {
        theme: "snow",
        placeholder: options.placeholder || "",
        modules: buildEditorModules(options.toolbar || QUESTION_TOOLBAR),
      });

      preventBase64Images(quill);
      attachImageResize(quill);
      attachMaxLength(quill, options.maxLength);
      try {
        localizeQuillChrome(quill);
      } catch (chromeError) {
        console.warn("Quill arayüz yerelleştirmesi atlandı:", chromeError);
      }
      return quill;
    } catch (error) {
      console.error("Quill oluşturulamadı:", error);
      return null;
    }
  }

  function localizeToolbar(quill) {
    const toolbar = quill.getModule("toolbar");
    if (!toolbar?.container) return;

    const titleByClass = {
      "ql-bold": "Kalın",
      "ql-italic": "İtalik",
      "ql-underline": "Altı çizili",
      "ql-link": "Bağlantı ekle",
      "ql-image": "Görsel ekle",
      "ql-list": "Liste",
      "ql-blockquote": "Alıntı",
      "ql-clean": "Biçimlendirmeyi temizle",
    };

    toolbar.container.querySelectorAll("button").forEach((button) => {
      for (const className of button.classList) {
        if (titleByClass[className]) {
          button.setAttribute("title", titleByClass[className]);
          break;
        }
      }
    });

    toolbar.container.querySelectorAll(".ql-picker-label").forEach((label) => {
      label.setAttribute("title", "Stil seç");
    });
  }

  function replaceTooltipTextNodes(root) {
    const replacements = [
      ["Enter link:", "Bağlantı ekle:"],
      ["Enter link", "Bağlantı ekle"],
      ["Visit URL:", "Bağlantı:"],
      ["Visit URL", "Bağlantı"],
      ["Edit", "Düzenle"],
      ["Save", "Kaydet"],
      ["Remove", "Kaldır"],
    ];

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const trimmed = node.textContent.trim();
      for (const [from, to] of replacements) {
        if (trimmed === from || node.textContent.includes(from)) {
          node.textContent = node.textContent.replace(from, to);
          break;
        }
      }
      node = walker.nextNode();
    }
  }

  function localizeTooltipRoot(tooltipRoot) {
    if (!tooltipRoot || tooltipRoot._rekabetliLocalizing) return;

    tooltipRoot._rekabetliLocalizing = true;
    try {
      const input = tooltipRoot.querySelector("input[type='text']");
      if (input) {
        input.setAttribute("placeholder", "https://ornek.com");
      }

      const preview = tooltipRoot.querySelector("a.ql-preview");
      if (preview) preview.setAttribute("title", "Bağlantıyı aç");

      replaceTooltipTextNodes(tooltipRoot);
      syncTooltipActionLabels(tooltipRoot);
    } finally {
      tooltipRoot._rekabetliLocalizing = false;
    }
  }

  function patchQuillTooltip(quill) {
    const tooltip = quill.theme?.tooltip;
    if (!tooltip?.root || tooltip._rekabetliPatched) return;

    tooltip._rekabetliPatched = true;
    tooltip.root.classList.add("rekabetli-quill-tooltip");
    localizeTooltipRoot(tooltip.root);

    if (typeof tooltip.show === "function" && !tooltip._rekabetliShowPatched) {
      tooltip._rekabetliShowPatched = true;
      const originalShow = tooltip.show.bind(tooltip);
      tooltip.show = function patchedShow(...args) {
        originalShow(...args);
        requestAnimationFrame(() => localizeTooltipRoot(tooltip.root));
      };
    }

    if (typeof tooltip.edit === "function" && !tooltip._rekabetliEditPatched) {
      tooltip._rekabetliEditPatched = true;
      const originalEdit = tooltip.edit.bind(tooltip);
      tooltip.edit = function patchedEdit(...args) {
        originalEdit(...args);
        requestAnimationFrame(() => localizeTooltipRoot(tooltip.root));
      };
    }
  }

  function syncTooltipActionLabels(root) {
    const action = root.querySelector("a.ql-action");
    const remove = root.querySelector("a.ql-remove");

    if (action) {
      const isEditing = root.classList.contains("ql-editing");
      const label = isEditing ? "Kaydet" : "Düzenle";
      if (action.textContent !== label) action.textContent = label;
    }

    if (remove && remove.textContent !== "Kaldır") {
      remove.textContent = "Kaldır";
    }
  }

  function localizeQuillChrome(quill) {
    localizeToolbar(quill);
    patchQuillTooltip(quill);
  }

  function getHtml(quill) {
    if (!quill) return "";
    const html = quill.root.innerHTML.trim();
    if (!hasMeaningfulContent(quill)) return "";
    if (html === "<p><br></p>") return "";
    return html;
  }

  function clear(quill) {
    if (!quill) return;
    quill.setText("");
  }

  function isEmpty(quill) {
    if (!quill) return true;
    return !hasMeaningfulContent(quill);
  }

  function ensureAnswerEditor(form) {
    if (!form) return null;
    if (form._rekabetliQuill) return form._rekabetliQuill;

    const host = form.querySelector(".answer-editor-host");
    if (!host) return null;

    const quill = create(host, {
      placeholder: "Yanıtını yaz...",
      maxLength: ANSWER_CONTENT_MAX_LENGTH,
      toolbar: ANSWER_TOOLBAR,
    });

    if (quill) form._rekabetliQuill = quill;
    return quill;
  }

  window.RekabetliQuill = {
    create,
    getHtml,
    clear,
    isEmpty,
    renderRichContent,
    ensureAnswerEditor,
    imageHandler,
  };
})();
