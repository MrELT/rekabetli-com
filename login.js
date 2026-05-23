const supabaseClient = window.getSupabase?.() || window.sb;
if (!supabaseClient) {
  console.error("Supabase bağlantısı kurulamadı.");
}

const loginForm = document.getElementById("login-form");
const authMessage = document.getElementById("auth-message");

function setMessage(text) {
  if (authMessage) authMessage.textContent = text;
}

function getSafeRedirectAfterLogin() {
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get("redirect");
  if (!redirect) return "index.html";
  if (redirect.includes("://") || redirect.startsWith("//")) return "index.html";
  const allowedPaths = ["index.html", "kimler-icin.html", "hakkimizda.html", "profile.html", "mentors.html"];
  const pathOnly = redirect.split("?")[0].split("#")[0];
  if (!allowedPaths.includes(pathOnly)) return "index.html";
  return redirect;
}

// Eğer zaten giriş yapmış biriyse yönlendir
async function ensureLoggedOutRedirect() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    window.location.href = getSafeRedirectAfterLogin();
  }
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

    window.location.href = getSafeRedirectAfterLogin();
  });
}

if (supabaseClient) {
  ensureLoggedOutRedirect();
}