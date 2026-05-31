const supabaseClient = window.getSupabase?.() || window.sb;
if (!supabaseClient) {
  console.error("Supabase bağlantısı kurulamadı.");
}

const loginForm = document.getElementById("login-form");
const authMessage = document.getElementById("auth-message");

function setMessage(text) {
  if (authMessage) authMessage.textContent = text;
}

const ALLOWED_REDIRECT_PATHS = [
  "/",
  "/kimler-icin",
  "/hakkimizda",
  "/profile",
  "/mentors",
  "/communities",
  "/community",
  "/competitions",
  "/exams",
  "/register",
  "/login",
  "/sinav-bilgileri",
  "/yarisma-bilgileri",
  "/notal",
];

function normalizeRedirectPath(redirect) {
  let normalized = redirect.trim();
  normalized = normalized.replace(/^\/?index\.html(?=[$?#]|$)/i, "/");
  normalized = normalized.replace(/^([a-z0-9-]+)\.html(?=[$?#]|$)/i, "/$1");
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  return normalized;
}

function getSafeRedirectAfterLogin() {
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get("redirect");
  if (!redirect) return "/";
  if (redirect.includes("://") || redirect.startsWith("//")) return "/";

  const normalized = normalizeRedirectPath(redirect);
  const pathOnly = normalized.split("?")[0].split("#")[0];
  const allowed = ALLOWED_REDIRECT_PATHS.some(
    (p) => pathOnly === p || (p !== "/" && pathOnly.startsWith(`${p}/`))
  );

  if (!allowed) return "/";
  return normalized;
}

// Giriş yapmış kullanıcı — NotAl için otomatik yönlendirme YOK (login↔notal döngüsünü önler)
async function ensureLoggedOutRedirect() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) return;

  const target = getSafeRedirectAfterLogin();
  const here = `${window.location.pathname}${window.location.search}`;
  if (target === here || target === window.location.pathname) return;

  const pathOnly = target.split("?")[0].split("#")[0];
  if (pathOnly.startsWith("/notal")) {
    setMessage(
      "Zaten giriş yaptınız. NotAl sayfasına gitmek için tarayıcı adres çubuğuna /notal yazın veya ana menüden NotAl'a tıklayın.",
    );
    return;
  }

  window.location.replace(target);
}

if (loginForm && supabaseClient) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault(); // Sayfanın yenilenmesini ve linke veri eklenmesini kesin olarak durdurur
    setMessage("");

    const data = new FormData(loginForm);
    const email = String(data.get("email")).trim();
    const password = String(data.get("password")).trim();

    // supabase yerine supabaseClient kullanıyoruz
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(`Giriş başarısız: Lütfen bilgilerini kontrol et.`);
      return;
    }

    sessionStorage.removeItem("rekabetli_notal_login_redirect_ts");
    window.location.href = getSafeRedirectAfterLogin();
  });
}

if (supabaseClient) {
  ensureLoggedOutRedirect();
}