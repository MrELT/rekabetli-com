// Yerel geliştirme: .env.example → .env kopyalayın, sonra:
//   npm run env:build
// Bu komut env-config.local.js üretir (git'e eklenmez).
//
// Canlı (Vercel): Project Settings → Environment Variables:
//   SUPABASE_URL, SUPABASE_ANON_KEY
// Build Command'a env:build ekleyin veya deploy öncesi script çalıştırın.
//
// Alternatif: Vercel'de window._env_ / window.env ile enjekte ederseniz
// env-config.js bunları da okur (env-config.js repoda sabittir).
