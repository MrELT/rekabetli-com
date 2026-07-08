(function initRegister() {
  const supabase = window.getSupabase?.() || window.sb;
  if (!supabase) {
    console.error("[rekabetli] Supabase yüklenemedi.");
    return;
  }

const registerForm = document.getElementById("register-form");
const registerMessage = document.getElementById("register-message");
const registerSubmitBtn = document.getElementById("register-submit-btn");
const goLoginBtn = document.getElementById("go-login-btn");

const REGISTER_COOLDOWN_MS = 60 * 1000;
const REGISTER_COOLDOWN_KEY = "rekabetli_register_cooldown_until";
let registerCooldownTimerId = null;
const userTypeSelect = document.getElementById("userType");
const parentFields = document.getElementById("parent-fields");
const teacherFields = document.getElementById("teacher-fields");
const studentFields = document.getElementById("student-fields");
const professionInput = document.getElementById("profession");
const branchInput = document.getElementById("branch");
const teacherSchoolInput = document.getElementById("teacherSchool");
const studentSchoolInput = document.getElementById("studentSchool");
const educationLevelSelect = document.getElementById("educationLevel");
const classLevelWrap = document.getElementById("class-level-wrap");
const classLevelSelect = document.getElementById("classLevel");

const CLASS_OPTIONS = {
  Ortaokul: ["5. Sinif", "6. Sinif", "7. Sinif", "8. Sinif"],
  Lise: ["9. Sinif", "10. Sinif", "11. Sinif", "12. Sinif"],
};

function setMessage(text, type = "") {
  registerMessage.textContent = text || "";
  registerMessage.classList.toggle("empty", !text);
  registerMessage.classList.toggle("register-message--success", type === "success");
  registerMessage.classList.toggle("register-message--error", type === "error");
}

function setVerificationSentMessage(email) {
  registerMessage.textContent = "";
  registerMessage.classList.remove("empty", "register-message--error");
  registerMessage.classList.add("register-message--success");

  const title = document.createElement("strong");
  title.className = "register-message-title";
  title.textContent = "Doğrulama e-postası gönderildi";

  const body = document.createElement("span");
  body.className = "register-message-body";
  const emailText = email ? ` (${email})` : "";
  body.textContent =
    `Kaydınızı tamamlamak için e-posta adresinize${emailText} bir doğrulama bağlantısı gönderdik. ` +
    "Lütfen gelen kutunuzu (ve Spam/Gereksiz klasörünü) kontrol edip bağlantıya tıklayın. " +
    "Doğrulamadan sonra giriş yapabilirsiniz.";

  registerMessage.append(title, body);
}

function getRegisterCooldownRemainingMs() {
  const until = Number(localStorage.getItem(REGISTER_COOLDOWN_KEY) || 0);
  return Math.max(0, until - Date.now());
}

function formatRegisterCooldownMessage() {
  const seconds = Math.ceil(getRegisterCooldownRemainingMs() / 1000);
  return `E-postanızı doğrulayınız. Yeniden denemek için ${seconds} saniye bekleyiniz.`;
}

function startRegisterCooldown() {
  localStorage.setItem(REGISTER_COOLDOWN_KEY, String(Date.now() + REGISTER_COOLDOWN_MS));
}

function clearRegisterCooldownTimer() {
  if (registerCooldownTimerId) {
    clearInterval(registerCooldownTimerId);
    registerCooldownTimerId = null;
  }
}

function updateRegisterSubmitButton(isSubmitting = false) {
  if (!registerSubmitBtn) return;

  const remainingMs = getRegisterCooldownRemainingMs();
  const onCooldown = remainingMs > 0;

  if (isSubmitting) {
    registerSubmitBtn.disabled = true;
    registerSubmitBtn.textContent = "Kaydediliyor...";
    registerForm?.setAttribute("aria-busy", "true");
    return;
  }

  if (onCooldown) {
    registerSubmitBtn.disabled = true;
    const seconds = Math.ceil(remainingMs / 1000);
    registerSubmitBtn.textContent = `${seconds} sn sonra tekrar deneyiniz`;
    registerForm?.setAttribute("aria-busy", "false");
    return;
  }

  registerSubmitBtn.disabled = false;
  registerSubmitBtn.textContent = "Kayıt Ol";
  registerForm?.removeAttribute("aria-busy");
}

function syncRegisterCooldownUi(showWaitMessage = false) {
  const remainingMs = getRegisterCooldownRemainingMs();

  if (remainingMs <= 0) {
    clearRegisterCooldownTimer();
    updateRegisterSubmitButton(false);
    return;
  }

  if (showWaitMessage) {
    setMessage(formatRegisterCooldownMessage());
  }

  updateRegisterSubmitButton(false);

  if (registerCooldownTimerId) return;

  registerCooldownTimerId = setInterval(() => {
    if (getRegisterCooldownRemainingMs() <= 0) {
      clearRegisterCooldownTimer();
      updateRegisterSubmitButton(false);
      return;
    }
    if (showWaitMessage) {
      setMessage(formatRegisterCooldownMessage());
    }
    updateRegisterSubmitButton(false);
  }, 1000);
}

function updateUserTypeVisibility() {
  const userType = userTypeSelect.value;

  parentFields.hidden = userType !== "Veli";
  teacherFields.hidden = userType !== "Ogretmen";
  studentFields.hidden = userType !== "Ogrenci";

  professionInput.required = userType === "Veli";
  branchInput.required = userType === "Ogretmen";
  teacherSchoolInput.required = userType === "Ogretmen";
  studentSchoolInput.required = userType === "Ogrenci";
  educationLevelSelect.required = userType === "Ogrenci";

  if (userType !== "Veli") {
    professionInput.value = "";
  }
  if (userType !== "Ogretmen") {
    branchInput.value = "";
    teacherSchoolInput.value = "";
  }
  if (userType !== "Ogrenci") {
    studentSchoolInput.value = "";
    educationLevelSelect.value = "";
    classLevelSelect.value = "";
  }

  updateClassLevelVisibility();
}

function updateClassLevelVisibility() {
  if (userTypeSelect.value !== "Ogrenci") {
    classLevelWrap.hidden = true;
    classLevelSelect.required = false;
    classLevelSelect.disabled = true;
    classLevelSelect.replaceChildren();
    const placeholderOnly = document.createElement("option");
    placeholderOnly.value = "";
    placeholderOnly.textContent = "Sinif seciniz";
    classLevelSelect.appendChild(placeholderOnly);
    return;
  }

  const educationLevel = educationLevelSelect.value;
  const options = CLASS_OPTIONS[educationLevel];

  classLevelSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Sinif seciniz";
  classLevelSelect.appendChild(placeholder);

  if (!options) {
    classLevelWrap.hidden = true;
    classLevelSelect.required = false;
    classLevelSelect.disabled = true;
    return;
  }

  options.forEach((optionText) => {
    const option = document.createElement("option");
    option.value = optionText;
    option.textContent = optionText;
    classLevelSelect.appendChild(option);
  });

  classLevelWrap.hidden = false;
  classLevelSelect.required = true;
  classLevelSelect.disabled = false;
}

async function ensureLoggedOutRedirect() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    window.location.href = "/profile";
  }
}

function areLegalConsentsAccepted() {
  const kvkk = document.getElementById("consent-kvkk");
  const acikRiza = document.getElementById("consent-acik-riza");
  const sozlesme = document.getElementById("consent-sozlesme");
  return Boolean(kvkk?.checked && acikRiza?.checked && sozlesme?.checked);
}

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (getRegisterCooldownRemainingMs() > 0) {
    syncRegisterCooldownUi(true);
    return;
  }

  if (!areLegalConsentsAccepted()) {
    setMessage(
      "Kayıt olabilmek için KVKK Aydınlatma Metni, Açık Rıza Metni ve Kullanıcı Sözleşmesi onay kutularını işaretlemeniz gerekir."
    );
    document.getElementById("legal-consents")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  setMessage("");
  updateRegisterSubmitButton(true);

  const formData = new FormData(registerForm);
  const firstName = String(formData.get("firstName")).trim();
  const lastName = String(formData.get("lastName")).trim();
  const email = String(formData.get("email")).trim();
  const phone = String(formData.get("phone")).trim();
  const userType = String(formData.get("userType")).trim();
  const profession = String(formData.get("profession") ?? "").trim();
  const branch = String(formData.get("branch") ?? "").trim();
  const teacherSchool = String(formData.get("teacherSchool") ?? "").trim();
  const studentSchool = String(formData.get("studentSchool") ?? "").trim();
  const educationLevel = String(formData.get("educationLevel")).trim();
  const classLevel = String(formData.get("classLevel") ?? "").trim();
  const password = String(formData.get("password")).trim();

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          phone,
          user_type: userType,
          profession: userType === "Veli" ? profession : "",
          branch: userType === "Ogretmen" ? branch : "",
          school: userType === "Ogretmen" ? teacherSchool : userType === "Ogrenci" ? studentSchool : "",
          education_level: userType === "Ogrenci" ? educationLevel : "",
          class_level: userType === "Ogrenci" ? classLevel : "",
          consent_kvkk: true,
          consent_acik_riza: true,
          consent_sozlesme: true,
          consent_at: new Date().toISOString(),
        },
      },
    });

    startRegisterCooldown();

    if (error) {
      setMessage(`Kayıt başarısız: ${error.message}`, "error");
      syncRegisterCooldownUi(true);
      return;
    }

    const needsEmailConfirmation = Boolean(data?.user && !data?.session);

    if (needsEmailConfirmation) {
      setVerificationSentMessage(email);
    } else {
      setMessage("Kayıt başarılı. Giriş yapabilirsin.", "success");
      void window.RekabetliReferral?.claimReferralAttribution?.();
    }

    registerForm.reset();
    updateUserTypeVisibility();
    updateClassLevelVisibility();
    syncRegisterCooldownUi(true);
  } catch (submitError) {
    console.error("Register submit error:", submitError);
    startRegisterCooldown();
    setMessage("Kayıt başarısız: Bağlantı hatası. Lütfen bir süre sonra tekrar dene.", "error");
    syncRegisterCooldownUi(true);
  }
});

goLoginBtn.addEventListener("click", () => {
  window.location.href = "/login";
});

userTypeSelect.addEventListener("change", updateUserTypeVisibility);
educationLevelSelect.addEventListener("change", updateClassLevelVisibility);
updateUserTypeVisibility();
updateClassLevelVisibility();
syncRegisterCooldownUi(false);
ensureLoggedOutRedirect();
})();