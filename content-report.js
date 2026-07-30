/**
 * Gönderi / yorum raporlama modalı + buton yardımcıları.
 * Bağımlılık: supabase-client, confirm-dialog (rekabetliAlert)
 */
(function initContentReport(global) {
  const FLAG_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 3.75a.75.75 0 0 1 .75-.75h9.5a.75.75 0 0 1 .53 1.28L14.06 7.5l2.72 3.22A.75.75 0 0 1 16.25 12H7.5v8.25a.75.75 0 0 1-1.5 0V3.75Z"/></svg>';

  let modalEl = null;
  let reasonInput = null;
  let submitBtn = null;
  let cancelBtn = null;
  let closeBtn = null;
  let messageEl = null;
  let titleEl = null;
  let pendingTarget = null;
  let submitting = false;

  function getSb() {
    return global.getSupabase?.() || global.sb || null;
  }

  function ensureModal() {
    if (modalEl) return modalEl;

    modalEl = document.createElement("div");
    modalEl.id = "content-report-modal";
    modalEl.className = "modal-overlay content-report-modal";
    modalEl.hidden = true;
    modalEl.innerHTML = `
      <section class="modal-card content-report-card" role="dialog" aria-modal="true" aria-labelledby="content-report-title">
        <div class="modal-header">
          <h2 id="content-report-title">İçeriği rapor et</h2>
          <button type="button" class="icon-btn content-report-close" aria-label="Pencereyi kapat">✕</button>
        </div>
        <form class="content-report-form" id="content-report-form">
          <p class="content-report-lead">
            İstersen şikayetini kısaca yazabilirsin. Raporlar incelenir; gerekirse içerik kaldırılır.
          </p>
          <label class="content-report-label" for="content-report-reason">
            Rapor detayı <span class="content-report-optional">(opsiyonel)</span>
          </label>
          <textarea
            id="content-report-reason"
            class="content-report-reason"
            rows="5"
            maxlength="2000"
            placeholder="Örn. Hakaret / spam / yanıltıcı içerik…"
          ></textarea>
          <p id="content-report-message" class="content-report-message" hidden></p>
          <div class="content-report-actions">
            <button type="button" class="secondary content-report-cancel">Vazgeç</button>
            <button type="submit" class="secondary content-report-submit">Rapor et</button>
          </div>
        </form>
      </section>
    `;
    document.body.appendChild(modalEl);

    reasonInput = modalEl.querySelector("#content-report-reason");
    submitBtn = modalEl.querySelector(".content-report-submit");
    cancelBtn = modalEl.querySelector(".content-report-cancel");
    closeBtn = modalEl.querySelector(".content-report-close");
    messageEl = modalEl.querySelector("#content-report-message");
    titleEl = modalEl.querySelector("#content-report-title");
    const form = modalEl.querySelector("#content-report-form");

    closeBtn?.addEventListener("click", closeModal);
    cancelBtn?.addEventListener("click", closeModal);
    modalEl.addEventListener("click", (event) => {
      if (event.target === modalEl) closeModal();
    });
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitReport();
    });

    return modalEl;
  }

  function setMessage(text, isError = false) {
    if (!messageEl) return;
    if (!text) {
      messageEl.hidden = true;
      messageEl.textContent = "";
      messageEl.classList.remove("is-error");
      return;
    }
    messageEl.hidden = false;
    messageEl.textContent = text;
    messageEl.classList.toggle("is-error", Boolean(isError));
  }

  function closeModal() {
    if (!modalEl || submitting) return;
    modalEl.hidden = true;
    pendingTarget = null;
    if (reasonInput) reasonInput.value = "";
    setMessage("");
  }

  function openReportModal(target) {
    ensureModal();
    pendingTarget = target;
    if (titleEl) {
      titleEl.textContent =
        target?.targetType === "comment" ? "Yorumu rapor et" : "Gönderiyi rapor et";
    }
    if (reasonInput) reasonInput.value = "";
    setMessage("");
    modalEl.hidden = false;
    reasonInput?.focus();
  }

  function mapSubmitError(error) {
    const raw = String(error?.message || error?.code || "");
    if (/auth_required/i.test(raw)) return "Rapor göndermek için giriş yapmalısın.";
    if (/content_report_own_content/i.test(raw)) return "Kendi içeriğini raporlayamazsın.";
    if (/content_report_already_pending/i.test(raw)) {
      return "Bu içerik için zaten bekleyen bir raporun var.";
    }
    if (/content_report_reason_too_long/i.test(raw)) {
      return "Açıklama çok uzun. Lütfen kısalt.";
    }
    if (/content_report_rate_limited/i.test(raw)) {
      return "Çok fazla rapor gönderdin. Biraz sonra tekrar dene.";
    }
    if (/content_report_not_found/i.test(raw)) {
      return "İçerik bulunamadı; silinmiş olabilir.";
    }
    return "Rapor gönderilemedi. Lütfen tekrar dene.";
  }

  async function submitReport() {
    if (!pendingTarget || submitting) return;
    const sb = getSb();
    if (!sb) {
      setMessage("Bağlantı hazır değil. Sayfayı yenile.", true);
      return;
    }

    const reason = String(reasonInput?.value || "").trim();
    if (reason.length > 2000) {
      setMessage("Açıklama çok uzun. Lütfen kısalt.", true);
      return;
    }

    submitting = true;
    if (submitBtn) submitBtn.disabled = true;
    setMessage("");

    try {
      const { error } = await sb.rpc("submit_content_report", {
        p_target_type: pendingTarget.targetType,
        p_post_id: pendingTarget.postId || null,
        p_comment_id: pendingTarget.commentId || null,
        p_reason: reason,
      });
      if (error) throw error;

      submitting = false;
      closeModal();
      if (typeof global.rekabetliAlert === "function") {
        await global.rekabetliAlert({
          title: "Rapor alındı",
          message: "Şikayetin incelenecek. Teşekkürler.",
          showCancel: false,
          confirmLabel: "Tamam",
        });
      }
    } catch (error) {
      console.error("content report submit:", error);
      setMessage(mapSubmitError(error), true);
    } finally {
      submitting = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function createReportButton({ targetType, postId, commentId, authorId, currentUserId, onRequireLogin, variant }) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      variant === "secondary"
        ? "secondary content-report-btn content-report-btn--inline"
        : "action-btn content-report-btn content-report-btn--inline";
    btn.setAttribute(
      "aria-label",
      targetType === "comment" ? "Yorumu rapor et" : "Gönderiyi rapor et",
    );
    btn.innerHTML = `${FLAG_SVG}<span class="content-report-btn-label">Rapor et</span>`;

    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!currentUserId) {
        if (typeof onRequireLogin === "function") onRequireLogin();
        else if (typeof global.requireLoginForAction === "function") {
          global.requireLoginForAction();
        } else {
          global.location.href = "/login";
        }
        return;
      }

      if (authorId && currentUserId && String(authorId) === String(currentUserId)) {
        return;
      }

      openReportModal({
        targetType,
        postId: postId || null,
        commentId: commentId || null,
      });
    });

    return btn;
  }

  function attachPostReportButton(cardEl, question, options = {}) {
    if (!cardEl || !question?.id) return;

    cardEl.querySelectorAll(".content-report-btn").forEach((el) => el.remove());

    const currentUserId = options.currentUserId ?? null;
    if (currentUserId && question.userId && String(question.userId) === String(currentUserId)) {
      return;
    }

    const actions = cardEl.querySelector(".question-actions");
    if (!actions) return;

    const btn = createReportButton({
      targetType: "post",
      postId: question.id,
      commentId: null,
      authorId: question.userId,
      currentUserId,
      onRequireLogin: options.onRequireLogin,
      variant: "action",
    });
    btn.classList.add("content-report-btn--post");

    const saveBtn = actions.querySelector(".save-btn");
    const ownerActions = actions.querySelector(".question-owner-actions");
    if (saveBtn) {
      saveBtn.insertAdjacentElement("afterend", btn);
    } else if (ownerActions) {
      actions.insertBefore(btn, ownerActions);
    } else {
      actions.appendChild(btn);
    }
  }

  global.RekabetliContentReport = {
    openReportModal,
    createReportButton,
    attachPostReportButton,
  };
})(window);
