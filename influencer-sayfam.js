(function initInfluencerPanel() {
  const statusEl = document.getElementById("influencer-sayfam-status");
  const PAYOUT_FEE_NOTE = "Ödeme taleplerinde 35 ₺ havale ücreti düşülür.";
  let lastWalletSummary = null;
  let payoutAccount = null;

  function formatTryMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0 ₺";
    return `${n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺`;
  }

  function formatWalletDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isFinite(d.getTime())
      ? d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })
      : "—";
  }

  function setStatus(text, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.hidden = !text;
    statusEl.classList.toggle("mentor-showcase-status-error", Boolean(isError && text));
  }

  function appendWalletStatChip(parent, label, value) {
    const chip = document.createElement("div");
    chip.className = "mentor-wallet-stat";
    const labelSpan = document.createElement("span");
    labelSpan.className = "mentor-wallet-stat-label";
    labelSpan.textContent = label;
    const valueStrong = document.createElement("strong");
    valueStrong.className = "mentor-wallet-stat-value";
    valueStrong.textContent = value;
    chip.append(labelSpan, valueStrong);
    parent.appendChild(chip);
  }

  function appendWalletTransactionItem(listEl, row) {
    const item = document.createElement("li");
    item.className = "mentor-wallet-transaction";
    const title = row.entry_type === "referral_commission_refund"
      ? `İade düşümü · ${row.package_title || "Paket"}`
      : row.entry_type === "payout"
        ? "Ödeme talebi"
        : `Komisyon · ${row.package_title || "Paket"}`;

    const head = document.createElement("div");
    head.className = "mentor-wallet-transaction-head";
    const titleEl = document.createElement("p");
    titleEl.className = "mentor-wallet-transaction-title";
    titleEl.textContent = title;
    const netEl = document.createElement("p");
    netEl.className = "mentor-wallet-transaction-net";
    netEl.textContent = formatTryMoney(row.net_amount);
    head.append(titleEl, netEl);

    const metaEl = document.createElement("p");
    metaEl.className = "mentor-wallet-transaction-meta";
    const metaParts = [
      row.buyer_display_name || "",
      formatWalletDate(row.created_at),
    ].filter(Boolean);
    if (row.is_withdrawable === false && row.entry_type === "referral_commission") {
      metaParts.push("Beklemede");
    }
    metaEl.textContent = metaParts.join(" · ");

    item.append(head, metaEl);
    listEl.appendChild(item);
  }

  function appendPayoutRequestItem(listEl, row) {
    const item = document.createElement("li");
    item.className = "mentor-wallet-payout-item";
    const amountSpan = document.createElement("span");
    amountSpan.textContent = `${formatTryMoney(row.amount_requested)} · ${row.status || "—"}`;
    const dateSpan = document.createElement("span");
    dateSpan.textContent = formatWalletDate(row.created_at);
    item.append(amountSpan, dateSpan);
    listEl.appendChild(item);
  }

  function setPanelMessage(el, text, isError = false) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("empty", !text);
    el.classList.toggle("profile-message-error", Boolean(isError && text));
  }

  function showPanel(panelId) {
    document.querySelectorAll("[data-influencer-panel-view]").forEach((view) => {
      const active = view.dataset.influencerPanelView === panelId;
      view.hidden = !active;
      view.classList.toggle("is-active", active);
    });
    document.querySelectorAll("[data-influencer-panel]").forEach((btn) => {
      const active = btn.dataset.influencerPanel === panelId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-current", active ? "page" : "false");
    });
    if (panelId) {
      history.replaceState(null, "", `#${panelId}`);
    }
    if (panelId === "cuzdanim") {
      void loadInfluencerWallet();
      void loadPayoutAccount();
    }
    if (panelId === "programim") {
      void loadReferralProgram();
    }
  }

  document.querySelectorAll("[data-influencer-panel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panelId = btn.dataset.influencerPanel;
      if (panelId) showPanel(panelId);
    });
  });

  window.addEventListener("hashchange", () => {
    const panelId = location.hash.replace(/^#/, "") || "programim";
    if (["programim", "cuzdanim"].includes(panelId)) showPanel(panelId);
  });

  async function ensureApprovedInfluencer() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      location.href = "/login?redirect=%2Finfluencer-sayfam";
      return null;
    }

    const { data, error } = await supabase.rpc("get_my_influencer_application");
    if (error || data?.status !== "approved") {
      location.href = "/influencer-program";
      return null;
    }

    setStatus("");
    return user;
  }

  async function loadReferralProgram() {
    const { data, error } = await supabase.rpc("get_influencer_referral_program");
    if (error) {
      console.error("get_influencer_referral_program:", error.message);
      return;
    }

    const linkInput = document.getElementById("influencer-referral-link");
    const codeEl = document.getElementById("influencer-referral-code");
    const statsEl = document.getElementById("influencer-program-stats");
    const fullLink = `${location.origin}${data.link_path || ""}`;

    if (linkInput) linkInput.value = fullLink;
    if (codeEl) {
      codeEl.textContent = `Kod: ${data.code || "—"} · Komisyon %${Math.round((Number(data.commission_rate) || 0.05) * 100)} · ${data.commission_years || 1} yıl`;
    }

    if (statsEl) {
      statsEl.replaceChildren();
      [
        { label: "Tıklama", value: String(data.click_count || 0) },
        { label: "Kayıt", value: String(data.signup_count || 0) },
        { label: "Satış", value: String(data.order_count || 0) },
        { label: "Toplam komisyon", value: formatTryMoney(data.commission_total) },
      ].forEach((item) => {
        appendWalletStatChip(statsEl, item.label, item.value);
      });
    }
  }

  document.getElementById("influencer-copy-link-btn")?.addEventListener("click", async () => {
    const input = document.getElementById("influencer-referral-link");
    const text = input?.value?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Link kopyalandı.");
      setTimeout(() => setStatus(""), 2000);
    } catch {
      input?.select();
      document.execCommand("copy");
    }
  });

  async function loadPayoutAccount() {
    const { data, error } = await supabase.from("influencer_payout_accounts").select("*").maybeSingle();
    if (error) {
      console.warn("influencer_payout_accounts:", error.message);
      return;
    }
    payoutAccount = data;
    if (data) {
      document.getElementById("influencer-payout-holder").value = data.account_holder || "";
      document.getElementById("influencer-payout-iban").value = data.iban || "";
      document.getElementById("influencer-payout-bank").value = data.bank_name || "";
    }
    updatePayoutUi();
  }

  function hasPayoutReady() {
    return window.RekabetliMentorVitrin?.hasPayoutBankDetails?.({
      payoutReady: Boolean(payoutAccount),
      accountHolder: payoutAccount?.account_holder,
      bankName: payoutAccount?.bank_name,
      iban: payoutAccount?.iban,
    });
  }

  function updatePayoutUi() {
    const summary = lastWalletSummary;
    const available = Number(summary?.available_balance) || 0;
    const minAmount = Number(summary?.payout_min_amount) || 500;
    const payoutBtn = document.getElementById("influencer-wallet-payout-btn");
    const payoutHint = document.getElementById("influencer-wallet-payout-hint");
    const amountInput = document.getElementById("influencer-wallet-payout-amount");
    const requestAmount = Number(amountInput?.value) || 0;
    const ready = hasPayoutReady();

    if (payoutBtn) {
      payoutBtn.disabled = !ready || available < minAmount || requestAmount < minAmount || requestAmount > available;
    }
    if (payoutHint) {
      if (!ready) payoutHint.textContent = "Ödeme talebi için önce IBAN bilgilerinizi kaydedin.";
      else if (available < minAmount) payoutHint.textContent = `Minimum çekim tutarı ${formatTryMoney(minAmount)}. ${PAYOUT_FEE_NOTE}`;
      else payoutHint.textContent = PAYOUT_FEE_NOTE;
    }
  }

  function renderInfluencerWallet(summary) {
    lastWalletSummary = summary;
    const balanceEl = document.getElementById("influencer-wallet-balance");
    const noteEl = document.getElementById("influencer-wallet-note");
    const statsEl = document.getElementById("influencer-wallet-stats");
    const listEl = document.getElementById("influencer-wallet-transactions");
    const emptyEl = document.getElementById("influencer-wallet-empty");
    const payoutListEl = document.getElementById("influencer-wallet-payout-requests");
    const payoutEmptyEl = document.getElementById("influencer-wallet-payout-empty");

    if (balanceEl) balanceEl.textContent = formatTryMoney(summary?.available_balance);
    if (noteEl) {
      noteEl.textContent = `Komisyonlar davet ettiğiniz kullanıcıların paket satın alımlarından oluşur. İlk görüşme + ${summary?.payout_hold_days || 14} gün sonra çekilebilir. ${PAYOUT_FEE_NOTE}`;
    }

    if (statsEl) {
      statsEl.hidden = false;
      statsEl.replaceChildren();
      [
        { label: "Toplam komisyon", value: formatTryMoney(summary?.total_commission) },
        { label: "Bekleyen", value: formatTryMoney(summary?.held_balance) },
        { label: "Satış", value: String(summary?.order_count || 0) },
      ].forEach((item) => {
        appendWalletStatChip(statsEl, item.label, item.value);
      });
    }

    const transactions = Array.isArray(summary?.transactions) ? summary.transactions : [];
    if (listEl && emptyEl) {
      listEl.replaceChildren();
      if (!transactions.length) {
        emptyEl.hidden = false;
        listEl.hidden = true;
      } else {
        emptyEl.hidden = true;
        listEl.hidden = false;
        transactions.forEach((row) => {
          appendWalletTransactionItem(listEl, row);
        });
      }
    }

    const payoutRequests = Array.isArray(summary?.payout_requests) ? summary.payout_requests : [];
    if (payoutListEl && payoutEmptyEl) {
      payoutListEl.replaceChildren();
      if (!payoutRequests.length) {
        payoutEmptyEl.hidden = false;
        payoutListEl.hidden = true;
      } else {
        payoutEmptyEl.hidden = true;
        payoutListEl.hidden = false;
        payoutRequests.forEach((row) => {
          appendPayoutRequestItem(payoutListEl, row);
        });
      }
    }

    updatePayoutUi();
  }

  async function loadInfluencerWallet() {
    const { data, error } = await supabase.rpc("get_influencer_wallet_summary");
    if (error) {
      console.error("get_influencer_wallet_summary:", error.message);
      return;
    }
    renderInfluencerWallet(data);
  }

  document.getElementById("influencer-wallet-payout-max-btn")?.addEventListener("click", () => {
    const input = document.getElementById("influencer-wallet-payout-amount");
    if (input && lastWalletSummary) {
      input.value = String(Math.floor(Number(lastWalletSummary.available_balance) || 0));
      updatePayoutUi();
    }
  });

  document.getElementById("influencer-wallet-payout-amount")?.addEventListener("input", updatePayoutUi);

  document.getElementById("influencer-wallet-payout-btn")?.addEventListener("click", async () => {
    const msgEl = document.getElementById("influencer-wallet-payout-message");
    const amount = Number(document.getElementById("influencer-wallet-payout-amount")?.value);
    const minAmount = Number(lastWalletSummary?.payout_min_amount) || 500;
    if (!Number.isFinite(amount) || amount < minAmount) {
      setPanelMessage(msgEl, `Minimum tutar ${formatTryMoney(minAmount)}.`, true);
      return;
    }

    const confirmed = await window.rekabetliConfirm?.({
      title: "Ödeme talebi",
      message: `${formatTryMoney(amount)} tutarında ödeme talebi oluşturulsun mu?`,
      confirmLabel: "Talep et",
    });
    if (!confirmed) return;

    setPanelMessage(msgEl, "Ödeme talebi oluşturuluyor…");
    const { data, error } = await supabase.functions.invoke("create-influencer-payout", {
      body: { amount },
    });

    if (error || data?.error) {
      setPanelMessage(msgEl, data?.message || error?.message || "Ödeme talebi oluşturulamadı.", true);
      return;
    }

    const net = formatTryMoney(data?.amount_net);
    setPanelMessage(
      msgEl,
      data?.request_id
        ? `Ödeme talebiniz alındı. Onay sonrası ${net} hesabınıza aktarılacak.`
        : "Ödeme talebiniz alındı.",
    );
    await loadInfluencerWallet();
  });

  document.getElementById("influencer-payout-iban")?.addEventListener("input", (event) => {
    const iban = window.RekabetliMentorVitrin?.sanitizeTurkishIban?.(event.target.value) || event.target.value;
    event.target.value = iban;
    const bank = window.RekabetliTurkishBanks?.resolveTurkishBankName?.(iban);
    const bankInput = document.getElementById("influencer-payout-bank");
    if (bankInput && bank) bankInput.value = bank;
  });

  document.getElementById("influencer-payout-account-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const msgEl = document.getElementById("influencer-payout-account-message");
    const holder = document.getElementById("influencer-payout-holder")?.value?.trim();
    const iban = window.RekabetliMentorVitrin?.sanitizeTurkishIban?.(
      document.getElementById("influencer-payout-iban")?.value || "",
    );
    const bankName = document.getElementById("influencer-payout-bank")?.value?.trim();

    if (!holder || !iban || !bankName) {
      setPanelMessage(msgEl, "Tüm alanları doldurun.", true);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("influencer_payout_accounts").upsert({
      user_id: user.id,
      account_holder: holder,
      bank_name: bankName,
      iban,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      setPanelMessage(msgEl, error.message, true);
      return;
    }

    setPanelMessage(msgEl, "Ödeme hesabı kaydedildi.");
    await loadPayoutAccount();
  });

  (async function boot() {
    const user = await ensureApprovedInfluencer();
    if (!user) return;

    const initialPanel = ["programim", "cuzdanim"].includes(location.hash.replace(/^#/, ""))
      ? location.hash.replace(/^#/, "")
      : "programim";
    showPanel(initialPanel);
  })();
})();
