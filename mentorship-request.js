(function initMentorshipRequest() {
  const supabase = window.getSupabase?.() || window.sb;
  const sec = window.RekabetliSecurity;
  if (!supabase) return;

  const requestBtn = document.getElementById("mentorship-request-btn");
  const modal = document.getElementById("mentorship-request-modal");
  const closeBtn = document.getElementById("close-mentorship-request-modal");
  const form = document.getElementById("mentorship-request-form");
  const branchesContainer = document.getElementById("mentorship-branches-container");
  const addBranchBtn = document.getElementById("mentorship-add-branch-btn");
  const formMessage = document.getElementById("mentorship-request-message");
  const submitBtn = document.getElementById("mentorship-request-submit");

  if (!requestBtn || !modal || !form || !branchesContainer) return;

  const BRANCH_PLACEHOLDERS = [
    "Örn: Olimpiyat hazırlığı",
    "Örn: Matematik özel ders",
    "Örn: Fizik proje danışmanlığı",
    "Örn: YKS koçluğu",
    "Örn: TEKNOFEST mentörlüğü",
  ];
  const MIN_BRANCH_FIELDS = 2;
  const MAX_BRANCH_FIELDS = 8;
  const RETURN_URL = "mentors.html?openMentorshipRequest=1";

  let branchFieldCount = MIN_BRANCH_FIELDS;

  function setFormMessage(text, isError = false) {
    if (!formMessage) return;
    if (!text) {
      formMessage.hidden = true;
      formMessage.textContent = "";
      formMessage.classList.remove("is-error");
      return;
    }
    formMessage.hidden = false;
    formMessage.textContent = text;
    formMessage.classList.toggle("is-error", isError);
  }

  function splitDisplayName(displayName) {
    const parts = String(displayName || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return { firstName: "", lastName: "" };
    if (parts.length === 1) return { firstName: parts[0], lastName: "" };
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  }

  function createBranchField(index) {
    const wrap = document.createElement("div");
    wrap.className = "mentor-branch-field";

    const label = document.createElement("label");
    label.textContent = `Talep edilen branş ${index + 1}`;
    label.setAttribute("for", `mentorship-branch-${index}`);

    const input = document.createElement("input");
    input.type = "text";
    input.id = `mentorship-branch-${index}`;
    input.name = "requested_branch";
    input.maxLength = 120;
    input.required = index < MIN_BRANCH_FIELDS;
    input.placeholder = BRANCH_PLACEHOLDERS[index % BRANCH_PLACEHOLDERS.length];
    input.autocomplete = "off";

    wrap.append(label, input);
    return wrap;
  }

  function renderBranchFields(values = []) {
    branchesContainer.replaceChildren();
    for (let i = 0; i < branchFieldCount; i += 1) {
      const field = createBranchField(i);
      const input = field.querySelector("input");
      if (input && values[i]) {
        input.value = sec?.sanitizeBranchText ? sec.sanitizeBranchText(values[i], 120) : values[i];
      }
      branchesContainer.appendChild(field);
    }
    if (addBranchBtn) {
      addBranchBtn.hidden = branchFieldCount >= MAX_BRANCH_FIELDS;
    }
  }

  function collectBranches() {
    const raw = [...branchesContainer.querySelectorAll('input[name="requested_branch"]')].map((input) =>
      String(input.value ?? "")
    );
    return sec?.sanitizeBranchList ? sec.sanitizeBranchList(raw, MAX_BRANCH_FIELDS, 120) : raw.map((v) => v.trim()).filter(Boolean);
  }

  function hasUnsafeInput(values) {
    if (!sec?.containsMarkupAttempt) return false;
    return values.some((value) => sec.containsMarkupAttempt(value));
  }

  function readSanitizedFormFields() {
    const rawFirst = document.getElementById("mentorship-first-name")?.value ?? "";
    const rawLast = document.getElementById("mentorship-last-name")?.value ?? "";
    const rawEmail = document.getElementById("mentorship-email")?.value ?? "";
    const rawPhone = document.getElementById("mentorship-phone")?.value ?? "";
    const branchInputs = [...branchesContainer.querySelectorAll('input[name="requested_branch"]')].map(
      (input) => input.value ?? ""
    );

    if (hasUnsafeInput([rawFirst, rawLast, rawEmail, rawPhone, ...branchInputs])) {
      return { error: "HTML, script veya geçersiz bağlantı içeriği kullanılamaz." };
    }

    const firstName = sec?.sanitizePersonName ? sec.sanitizePersonName(rawFirst, 80) : String(rawFirst).trim();
    const lastName = sec?.sanitizePersonName ? sec.sanitizePersonName(rawLast, 80) : String(rawLast).trim();
    const email = sec?.sanitizeEmail ? sec.sanitizeEmail(rawEmail, 120) : String(rawEmail).trim().toLowerCase();
    const phone = sec?.sanitizePhone ? sec.sanitizePhone(rawPhone, 20) : String(rawPhone).trim();
    const branches = collectBranches();
    const monthlySessions = Number.parseInt(
      String(document.getElementById("mentorship-monthly-sessions")?.value ?? ""),
      10
    );

    return { firstName, lastName, email, phone, branches, monthlySessions };
  }

  async function loadRequesterDefaults() {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) return null;

    const meta = user.user_metadata ?? {};
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, phone, email")
      .eq("id", user.id)
      .maybeSingle();

    const fromMeta = {
      firstName: String(meta.first_name ?? "").trim(),
      lastName: String(meta.last_name ?? "").trim(),
    };
    const fromDisplay = splitDisplayName(profile?.display_name);

    return {
      userId: user.id,
      firstName: fromMeta.firstName || fromDisplay.firstName,
      lastName: fromMeta.lastName || fromDisplay.lastName,
      email: profile?.email?.trim() || user.email || "",
      phone: profile?.phone?.trim() || String(meta.phone ?? "").trim(),
    };
  }

  async function fillFormFromProfile() {
    const defaults = await loadRequesterDefaults();
    if (!defaults) return;

    document.getElementById("mentorship-first-name").value = sec?.sanitizePersonName
      ? sec.sanitizePersonName(defaults.firstName, 80)
      : defaults.firstName;
    document.getElementById("mentorship-last-name").value = sec?.sanitizePersonName
      ? sec.sanitizePersonName(defaults.lastName, 80)
      : defaults.lastName;
    document.getElementById("mentorship-email").value = sec?.sanitizeEmail
      ? sec.sanitizeEmail(defaults.email, 120)
      : defaults.email;
    document.getElementById("mentorship-phone").value = sec?.sanitizePhone
      ? sec.sanitizePhone(defaults.phone, 20)
      : defaults.phone;

    const { data: existing } = await supabase
      .from("mentorship_requests")
      .select("requested_branches, monthly_sessions")
      .eq("user_id", defaults.userId)
      .maybeSingle();

    const safeBranches = sec?.sanitizeBranchList
      ? sec.sanitizeBranchList(existing?.requested_branches ?? [], MAX_BRANCH_FIELDS, 120)
      : (existing?.requested_branches ?? []).filter(Boolean);

    if (safeBranches.length) {
      branchFieldCount = Math.max(MIN_BRANCH_FIELDS, safeBranches.length);
      renderBranchFields(safeBranches);
    } else {
      branchFieldCount = MIN_BRANCH_FIELDS;
      renderBranchFields();
    }

    const monthlyInput = document.getElementById("mentorship-monthly-sessions");
    if (monthlyInput && existing?.monthly_sessions) {
      monthlyInput.value = String(existing.monthly_sessions);
    }
  }

  function openModal() {
    modal.hidden = false;
    document.body.classList.add("question-modal-open");
    setFormMessage("");
    fillFormFromProfile();
    document.getElementById("mentorship-first-name")?.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("question-modal-open");
    setFormMessage("");
  }

  async function handleRequestClick() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      window.location.href = `login.html?redirect=${encodeURIComponent(RETURN_URL)}`;
      return;
    }

    openModal();
  }

  requestBtn.addEventListener("click", handleRequestClick);
  closeBtn?.addEventListener("click", closeModal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeModal();
  });

  addBranchBtn?.addEventListener("click", () => {
    if (branchFieldCount >= MAX_BRANCH_FIELDS) return;
    const values = collectBranches();
    branchFieldCount += 1;
    renderBranchFields(values);
    const lastInput = branchesContainer.querySelector(".mentor-branch-field:last-child input");
    lastInput?.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      window.location.href = `login.html?redirect=${encodeURIComponent(RETURN_URL)}`;
      return;
    }

    const parsed = readSanitizedFormFields();
    if (parsed.error) {
      setFormMessage(parsed.error, true);
      return;
    }

    const { firstName, lastName, email, phone, branches, monthlySessions } = parsed;

    if (!firstName || !lastName) {
      setFormMessage("Ad ve soyad zorunludur.", true);
      return;
    }
    if (!email || !(sec?.isValidEmail ? sec.isValidEmail(email) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      setFormMessage("Geçerli bir e-posta adresi girin.", true);
      return;
    }
    if (branches.length < MIN_BRANCH_FIELDS) {
      setFormMessage(`En az ${MIN_BRANCH_FIELDS} branş girmelisiniz.`, true);
      return;
    }
    if (!Number.isFinite(monthlySessions) || monthlySessions < 1 || monthlySessions > 60) {
      setFormMessage("Aylık görüşme sayısı 1 ile 60 arasında olmalıdır (1 görüşme = 1 saat).", true);
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    const row = {
      user_id: session.user.id,
      first_name: firstName,
      last_name: lastName,
      email,
      phone: phone || null,
      requested_branches: branches,
      monthly_sessions: monthlySessions,
      status: "pending",
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("mentorship_requests").upsert(row, { onConflict: "user_id" });

    if (submitBtn) submitBtn.disabled = false;

    if (error) {
      console.error("Mentorship request save error:", error.message);
      setFormMessage(
        "Ön talep kaydedilemedi. mentorship_requests tablosu ve SQL dosyasının çalıştırıldığından emin olun.",
        true
      );
      return;
    }

    await rekabetliAlert({
      title: "Ön talep alındı",
      message:
        "Mentörlük ön talebiniz kaydedildi. Doğrulanmış mentörler yayına alındığında ve eşleştirme süreci başladığında sizinle iletişime geçeceğiz.",
      confirmLabel: "Tamam",
    });

    closeModal();
  });

  renderBranchFields();

  const params = new URLSearchParams(window.location.search);
  if (params.get("openMentorshipRequest") === "1") {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        openModal();
        params.delete("openMentorshipRequest");
        const query = params.toString();
        window.history.replaceState(
          {},
          "",
          query ? `${window.location.pathname}?${query}` : window.location.pathname
        );
      }
    });
  }
})();
