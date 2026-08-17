(function initCommunityNotal() {
  const COMMUNITY_ID = new URLSearchParams(window.location.search).get("id");
  const ERROR_MESSAGES = {
    auth_required: "Özeti görmek için giriş yapmalısın.",
    forbidden: "Bu özeti görmek için topluluk üyesi olmalısın.",
    openai_not_configured: "NotAl şu an kullanılamıyor. Biraz sonra tekrar dene.",
    community_not_found: "Topluluk bulunamadı.",
    load_failed: "Paylaşımlar yüklenemedi. Sayfayı yenileyip tekrar dene.",
    generation_failed: "Özet oluşturulamadı. Biraz sonra tekrar dene.",
    invalid_payload: "İstek geçersiz.",
  };

  const statusEl = document.getElementById("community-notal-status");
  const summaryEl = document.getElementById("community-notal-summary");
  const highlightsEl = document.getElementById("community-notal-highlights");
  const faqBtn = document.getElementById("community-notal-faq-btn");
  const faqsEl = document.getElementById("community-notal-faqs");

  let summaryPromise = null;
  let faqPromise = null;
  let summaryLoaded = false;
  let faqsLoaded = false;

  function getAccessToken() {
    return window.RekabetliAuth?.getState?.()?.session?.access_token || null;
  }

  async function getAccessTokenReady() {
    const existing = getAccessToken();
    if (existing) return existing;
    await window.RekabetliAuth?.whenReady?.();
    return getAccessToken();
  }

  function setStatus(text, isError = false) {
    if (!statusEl) return;
    if (!text) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      statusEl.classList.remove("is-error");
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.classList.toggle("is-error", isError);
  }

  function mapError(code) {
    return ERROR_MESSAGES[code] || "Bir hata oluştu. Tekrar dene.";
  }

  async function requestNotal(mode) {
    const token = await getAccessTokenReady();
    if (!token) {
      const error = new Error("auth_required");
      error.code = "auth_required";
      throw error;
    }
    if (!COMMUNITY_ID) {
      const error = new Error("invalid_payload");
      error.code = "invalid_payload";
      throw error;
    }

    const response = await fetch("/api/community/notal-summary", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ communityId: COMMUNITY_ID, mode }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error || "generation_failed");
      error.code = payload?.error || "generation_failed";
      throw error;
    }
    return payload;
  }

  function renderSummary(payload) {
    if (summaryEl) {
      summaryEl.hidden = false;
      summaryEl.textContent = payload.summary || "";
    }
    if (highlightsEl) {
      highlightsEl.replaceChildren();
      const highlights = Array.isArray(payload.highlights) ? payload.highlights : [];
      if (!highlights.length) {
        highlightsEl.hidden = true;
      } else {
        highlights.forEach((item) => {
          const li = document.createElement("li");
          li.textContent = item;
          highlightsEl.appendChild(li);
        });
        highlightsEl.hidden = false;
      }
    }
    summaryLoaded = true;
    setStatus("");
  }

  function renderFaqs(payload) {
    if (!faqsEl) return;
    faqsEl.replaceChildren();
    const faqs = Array.isArray(payload.faqs) ? payload.faqs : [];
    if (!faqs.length) {
      const empty = document.createElement("p");
      empty.className = "community-notal-empty";
      empty.textContent = "Henüz sıkça sorulan soru çıkaracak kadar paylaşım yok.";
      faqsEl.appendChild(empty);
      faqsEl.hidden = false;
      faqsLoaded = true;
      return;
    }

    faqs.forEach((item) => {
      const article = document.createElement("article");
      article.className = "community-notal-faq";
      const question = document.createElement("h3");
      question.className = "community-notal-faq-q";
      question.textContent = item.question;
      const answer = document.createElement("p");
      answer.className = "community-notal-faq-a";
      answer.textContent = item.answer;
      article.append(question, answer);
      faqsEl.appendChild(article);
    });
    faqsEl.hidden = false;
    faqsLoaded = true;
  }

  async function loadSummary() {
    if (summaryLoaded || summaryPromise) return summaryPromise;
    setStatus("NotAl paylaşımları ve açıklamayı inceliyor…");
    summaryPromise = requestNotal("summary")
      .then((payload) => {
        renderSummary(payload);
      })
      .catch((error) => {
        summaryPromise = null;
        setStatus(mapError(error?.code), true);
      });
    return summaryPromise;
  }

  async function loadFaqs() {
    if (faqsLoaded || faqPromise) return faqPromise;
    if (faqBtn) {
      faqBtn.disabled = true;
      faqBtn.textContent = "Sorular inceleniyor…";
    }
    setStatus("NotAl sıkça sorulan soruları çıkarıyor…");
    faqPromise = requestNotal("faq")
      .then((payload) => {
        renderFaqs(payload);
        setStatus("");
        if (faqBtn) {
          faqBtn.hidden = true;
        }
      })
      .catch((error) => {
        faqPromise = null;
        setStatus(mapError(error?.code), true);
        if (faqBtn) {
          faqBtn.disabled = false;
          faqBtn.textContent = "Sıkça sorulan soruları incele";
        }
      });
    return faqPromise;
  }

  faqBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    void loadFaqs();
  });

  window.RekabetliCommunityNotal = {
    onAccordionOpened() {
      void loadSummary();
    },
  };
})();
