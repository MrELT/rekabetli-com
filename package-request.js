(function initPackageRequest() {

  const supabase = window.getSupabase?.() || window.sb;

  const sec = window.RekabetliSecurity;

  const vitrin = window.RekabetliMentorVitrin;

  if (!supabase) return;



  const PENDING_KEY = "rekabetli_pending_package_request";

  const MAX_NOTE = 500;



  let modal = null;

  let form = null;

  let formMessage = null;

  let submitBtn = null;

  let activeContext = null;



  function ensureModal() {

    if (modal) return;



    modal = document.createElement("div");

    modal.id = "package-request-modal";

    modal.className = "modal-overlay";

    modal.hidden = true;

    modal.innerHTML = `

      <section class="modal-card mentor-application-card" role="dialog" aria-modal="true" aria-labelledby="package-request-title">

        <div class="modal-header">

          <h2 id="package-request-title">Paket ön talebi</h2>

          <button id="close-package-request-modal" type="button" class="icon-btn" aria-label="Pencereyi kapat">✕</button>

        </div>

        <form id="package-request-form" class="modal-form mentor-application-form">

          <p class="profile-hint">Seçtiğiniz paket için ilginizi mentöre ileteceğiz. Bilgileriniz profilinizden doldurulur.</p>



          <label for="package-request-mentor">Mentör</label>

          <input id="package-request-mentor" type="text" readonly />



          <label for="package-request-package">Paket</label>

          <input id="package-request-package" type="text" readonly />



          <label for="package-request-price">Liste fiyatı</label>

          <input id="package-request-price" type="text" readonly />



          <label for="package-request-first-name">Ad</label>

          <input id="package-request-first-name" name="first_name" type="text" maxlength="80" required autocomplete="given-name" />



          <label for="package-request-last-name">Soyad</label>

          <input id="package-request-last-name" name="last_name" type="text" maxlength="80" required autocomplete="family-name" />



          <label for="package-request-email">E-posta</label>

          <input id="package-request-email" name="email" type="email" maxlength="120" required autocomplete="email" />



          <label for="package-request-phone">Telefon</label>

          <input id="package-request-phone" name="phone" type="tel" maxlength="20" autocomplete="tel" placeholder="05xx xxx xx xx" />



          <label for="package-request-note">Not (isteğe bağlı)</label>

          <textarea id="package-request-note" name="note" rows="3" maxlength="${MAX_NOTE}" placeholder="Paketle ilgili sorularınız veya beklentiniz…"></textarea>



          <p id="package-request-message" class="form-message" role="status" hidden></p>

          <button type="submit" id="package-request-submit">Ön talep gönder</button>

        </form>

      </section>

    `;

    document.body.appendChild(modal);



    form = document.getElementById("package-request-form");

    formMessage = document.getElementById("package-request-message");

    submitBtn = document.getElementById("package-request-submit");



    document.getElementById("close-package-request-modal")?.addEventListener("click", closeModal);

    modal.addEventListener("click", (event) => {

      if (event.target === modal) closeModal();

    });

    document.addEventListener("keydown", (event) => {

      if (event.key === "Escape" && modal && !modal.hidden) closeModal();

    });

    form?.addEventListener("submit", handleSubmit);

  }



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



  function buildReturnUrl(context) {

    const params = new URLSearchParams();

    const mentorId = sanitizeContextIds(context)?.mentorId;

    const packageId = sanitizeContextIds(context)?.packageId;

    if (!mentorId || !packageId) return "/mentors";

    params.set("id", mentorId);

    params.set("openPackageRequest", "1");

    params.set("packageId", packageId);

    return `/mentor?${params.toString()}`;

  }



  function formatPriceLabel(price) {

    if (vitrin?.formatPriceTry) {

      return vitrin.formatPriceTry(price) || "Belirtilmedi";

    }

    return price != null ? String(price) : "Belirtilmedi";

  }



  function sanitizeContextIds(context) {

    if (!context) return null;

    const mentorId = vitrin?.isValidMentorId?.(context.mentorId) ? String(context.mentorId).trim() : "";

    const packageId = sec?.sanitizePackageId?.(context.packageId) || "";

    if (!mentorId || !packageId) return null;

    return { mentorId, packageId };

  }



  function sanitizeContextLabels(context) {

    return {

      mentorName: sec?.sanitizePersonName?.(context?.mentorName, 120) || "Mentör",

      title: sec?.sanitizeBranchText?.(context?.title, 120) || "Paket",

      price:

        context?.price != null && Number.isFinite(Number(context.price)) && Number(context.price) >= 0

          ? Number(context.price)

          : null,

    };

  }



  function normalizeStoredContext(raw) {

    if (!raw || typeof raw !== "object") return null;

    const ids = sanitizeContextIds(raw);

    if (!ids) return null;

    const labels = sanitizeContextLabels(raw);

    return { ...ids, ...labels };

  }



  async function verifyPackageOnServer(ids) {

    const [{ data: profile }, { data: pageRow }] = await Promise.all([

      supabase

        .from("profiles")

        .select("display_name, is_mentor")

        .eq("id", ids.mentorId)

        .eq("is_mentor", true)

        .maybeSingle(),

      supabase.from("mentor_pages").select("packages").eq("user_id", ids.mentorId).maybeSingle(),

    ]);



    if (!profile || !pageRow) {

      return { error: "Mentör veya paket bulunamadı." };

    }



    const packages = Array.isArray(pageRow.packages) ? pageRow.packages : [];

    const pkg = packages.find((item) => sec?.sanitizePackageId?.(item?.id) === ids.packageId);

    if (!pkg) {

      return { error: "Paket bulunamadı." };

    }



    const title = sec?.sanitizeBranchText?.(pkg.title, 120) || "Paket";

    const price =

      pkg.price != null && Number.isFinite(Number(pkg.price)) && Number(pkg.price) >= 0

        ? Number(pkg.price)

        : null;

    const capacity = vitrin?.sanitizeCapacity?.(pkg.capacity) ?? null;



    let remaining = null;

    if (capacity != null && vitrin?.getRemainingCapacity) {

      const fillCounts = vitrin.fetchPackageFillCounts

        ? await vitrin.fetchPackageFillCounts(supabase, ids.mentorId)

        : new Map();

      remaining = vitrin.getRemainingCapacity(capacity, fillCounts.get(ids.packageId) || 0);

      if (remaining !== null && remaining <= 0) {

        return { error: "Bu paketin kapasitesi dolmuş." };

      }

    }



    return {

      ok: true,

      context: {

        mentorId: ids.mentorId,

        packageId: ids.packageId,

        mentorName: sec?.sanitizePersonName?.(profile.display_name, 120) || "Mentör",

        title,

        price,

      },

    };

  }



  async function loadRequesterDefaults() {

    const {

      data: { user },

      error: userError,

    } = await supabase.auth.getUser();

    if (userError || !user) return null;



    const meta = user.user_metadata ?? {};

    const { data: profile } = await supabase.rpc("get_my_contact_info");



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



  async function fillForm(context) {

    document.getElementById("package-request-mentor").value = context.mentorName || "Mentör";

    document.getElementById("package-request-package").value = context.title || "Paket";

    document.getElementById("package-request-price").value = formatPriceLabel(context.price);



    const defaults = await loadRequesterDefaults();

    if (!defaults) return;



    document.getElementById("package-request-first-name").value = sec?.sanitizePersonName

      ? sec.sanitizePersonName(defaults.firstName, 80)

      : defaults.firstName;

    document.getElementById("package-request-last-name").value = sec?.sanitizePersonName

      ? sec.sanitizePersonName(defaults.lastName, 80)

      : defaults.lastName;

    document.getElementById("package-request-email").value = sec?.sanitizeEmail

      ? sec.sanitizeEmail(defaults.email, 120)

      : defaults.email;

    document.getElementById("package-request-phone").value = sec?.sanitizePhone

      ? sec.sanitizePhone(defaults.phone, 20)

      : defaults.phone;

    document.getElementById("package-request-note").value = "";

  }



  async function openModal(context) {

    ensureModal();

    const verified = await verifyPackageOnServer(context);

    if (verified.error) {

      await window.rekabetliAlert?.({

        title: "Ön talep",

        message: verified.error,

        confirmLabel: "Tamam",

      });

      return;

    }



    activeContext = verified.context;

    modal.hidden = false;

    document.body.classList.add("question-modal-open");

    setFormMessage("");

    void fillForm(activeContext);

    document.getElementById("package-request-first-name")?.focus();

  }



  function closeModal() {

    if (!modal) return;

    modal.hidden = true;

    document.body.classList.remove("question-modal-open");

    setFormMessage("");

    activeContext = null;

  }



  function readSanitizedFields() {

    const rawFirst = document.getElementById("package-request-first-name")?.value ?? "";

    const rawLast = document.getElementById("package-request-last-name")?.value ?? "";

    const rawEmail = document.getElementById("package-request-email")?.value ?? "";

    const rawPhone = document.getElementById("package-request-phone")?.value ?? "";

    const rawNote = document.getElementById("package-request-note")?.value ?? "";



    if (sec?.containsMarkupAttempt?.([rawFirst, rawLast, rawEmail, rawPhone, rawNote].join(" "))) {

      return { error: "HTML, script veya geçersiz bağlantı içeriği kullanılamaz." };

    }



    return {

      firstName: sec?.sanitizePersonName ? sec.sanitizePersonName(rawFirst, 80) : String(rawFirst).trim(),

      lastName: sec?.sanitizePersonName ? sec.sanitizePersonName(rawLast, 80) : String(rawLast).trim(),

      email: sec?.sanitizeEmail ? sec.sanitizeEmail(rawEmail, 120) : String(rawEmail).trim().toLowerCase(),

      phone: sec?.sanitizePhone ? sec.sanitizePhone(rawPhone, 20) : String(rawPhone).trim(),

      note: sec?.sanitizePlainText ? sec.sanitizePlainText(rawNote, MAX_NOTE) : String(rawNote).trim(),

    };

  }



  async function handleSubmit(event) {

    event.preventDefault();

    setFormMessage("");



    const {

      data: { session },

    } = await supabase.auth.getSession();

    if (!session) {

      window.location.href = `/login?redirect=${encodeURIComponent(buildReturnUrl(activeContext))}`;

      return;

    }



    if (!activeContext?.mentorId || !activeContext?.packageId) {

      setFormMessage("Paket bilgisi eksik.", true);

      return;

    }



    if (session.user.id === activeContext.mentorId) {

      setFormMessage("Kendi paketinize ön talep oluşturamazsınız.", true);

      return;

    }



    const verified = await verifyPackageOnServer(activeContext);

    if (verified.error) {

      setFormMessage(verified.error, true);

      return;

    }

    activeContext = verified.context;



    const parsed = readSanitizedFields();

    if (parsed.error) {

      setFormMessage(parsed.error, true);

      return;

    }



    const { firstName, lastName, email, phone, note } = parsed;

    if (!firstName || !lastName) {

      setFormMessage("Ad ve soyad zorunludur.", true);

      return;

    }

    if (!email || !(sec?.isValidEmail ? sec.isValidEmail(email) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {

      setFormMessage("Geçerli bir e-posta adresi girin.", true);

      return;

    }



    if (submitBtn) submitBtn.disabled = true;



    const row = {

      user_id: session.user.id,

      mentor_id: activeContext.mentorId,

      package_id: activeContext.packageId,

      package_title: activeContext.title || "Paket",

      package_price: activeContext.price,

      first_name: firstName,

      last_name: lastName,

      email,

      phone: phone || null,

      note: note || null,

      status: "pending",

      updated_at: new Date().toISOString(),

    };



    const { error } = await supabase.from("package_requests").upsert(row, {

      onConflict: "user_id,mentor_id,package_id",

    });



    if (submitBtn) submitBtn.disabled = false;



    if (error) {

      console.error("package request save:", error.message);

      const unavailable = String(error.message || "").includes("package_request_mentor_unavailable");
      setFormMessage(
        unavailable
          ? "Bu mentör şu anda yeni öğrenci kabul etmiyor."
          : "Ön talep kaydedilemedi. package_requests tablosunun oluşturulduğundan emin olun.",
        true,
      );

      return;

    }



    sessionStorage.removeItem(PENDING_KEY);
    window.rekabetliNotifications?.refresh?.();

    await window.rekabetliAlert?.({

      title: "Ön talep alındı",

      message: "Paket ön talebiniz kaydedildi. Mentör ve ekibimiz uygun olduğunda sizinle iletişime geçecek.",

      confirmLabel: "Tamam",

    });

    closeModal();

  }



  async function isMentorAcceptingRequests(mentorId) {
    if (!vitrin?.isValidMentorId?.(mentorId)) return false;
    const { data, error } = await supabase
      .from("mentor_pages")
      .select("vitrin_active")
      .eq("user_id", mentorId)
      .maybeSingle();
    if (error) {
      console.error("package request availability:", error.message);
      return false;
    }
    return data?.vitrin_active !== false;
  }

  async function open(context) {

    const normalized = normalizeStoredContext(context);

    if (!normalized) return;

    const accepting = await isMentorAcceptingRequests(normalized.mentorId);
    if (!accepting) {
      if (typeof window.rekabetliAlert === "function") {
        await window.rekabetliAlert({
          title: "Mentör meşgul",
          message:
            "Bu mentör şu anda yeni öğrenci kabul etmiyor. Daha sonra tekrar deneyebilir veya başka bir mentör seçebilirsiniz.",
          confirmLabel: "Tamam",
          showCancel: false,
        });
      }
      return;
    }



    const {

      data: { session },

    } = await supabase.auth.getSession();

    if (!session) {

      sessionStorage.setItem(PENDING_KEY, JSON.stringify(normalized));

      window.location.href = `/login?redirect=${encodeURIComponent(buildReturnUrl(normalized))}`;

      return;

    }



    await openModal(normalized);

  }



  function restorePendingFromStorage() {

    try {

      const raw = sessionStorage.getItem(PENDING_KEY);

      if (!raw) return null;

      return normalizeStoredContext(JSON.parse(raw));

    } catch {

      sessionStorage.removeItem(PENDING_KEY);

      return null;

    }

  }



  async function bootFromUrl() {

    const params = new URLSearchParams(window.location.search);

    if (params.get("openPackageRequest") !== "1") return;



    const {

      data: { session },

    } = await supabase.auth.getSession();

    if (!session) return;



    const mentorId = params.get("id");

    const packageId = params.get("packageId");

    let context = restorePendingFromStorage();



    if (!context && vitrin?.isValidMentorId?.(mentorId) && sec?.sanitizePackageId?.(packageId)) {

      context = normalizeStoredContext({ mentorId, packageId, title: "Paket" });

    }



    if (context) {

      await openModal(context);

      params.delete("openPackageRequest");

      params.delete("packageId");

      const query = params.toString();

      window.history.replaceState({}, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);

    }

  }



  window.RekabetliPackageRequest = { open };



  void bootFromUrl();

})();

