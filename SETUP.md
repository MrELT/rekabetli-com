# NotAl — Yerel Kurulum

Multi-agent NotAl (`mainNotalGraph`) için yerel geliştirme rehberi.

## 1. Ön koşullar

- Node.js 20+
- npm
- Supabase projesi (ücretsiz plan yeterli)
- OpenAI API anahtarı

## 2. Ortam değişkenleri (`.env`)

Proje kökünde `.env` dosyası oluşturun (`.env.example` dosyasını kopyalayabilirsiniz):

```env
# Zorunlu — LangGraph / NotAl üretimi
OPENAI_API_KEY=sk-...

# İsteğe bağlı — varsayılan model
OPENAI_MODEL=gpt-4o-mini
AGENT_CHAT_MODEL=gpt-4o-mini
AGENT_CLASSIFIER_MODEL=gpt-4o-mini

# Zorunlu — Supabase
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# İsteğe bağlı — sayfa render kalitesi (Poppler, Windows önerilir)
YKS_PAGE_RENDER_DPI=150
# Poppler kuruluysa pdftoppm yolu (ör. C:\poppler\Library\bin)
# PDFTOPPM_PATH=C:\poppler\Library\bin\pdftoppm.exe
```

| Değişken | Açıklama |
|----------|----------|
| `OPENAI_API_KEY` | `runMainNotalGraph` LLM çağrıları |
| `SUPABASE_URL` | Supabase proje URL'si |
| `SUPABASE_ANON_KEY` | İstemci oturumu (login) |
| `SUPABASE_SERVICE_ROLE_KEY` | Sunucu API route'ları (not kaydı, kredi) — **gizli tutun** |

`npm run dev` çalıştırıldığında `scripts/inject-env.mjs` otomatik olarak `env-config.local.js` ve `.env.local` içindeki `NEXT_PUBLIC_*` değerlerini üretir.

## 3. Supabase tabloları

Projede notlar **`notal_saved_notes`** tablosunda tutulur (kullanıcı mesajındaki `notes` ile aynı işlev).

SQL dosyalarını **Supabase SQL Editor**'da sırayla çalıştırın:

1. `supabase-notal-demo-credits.sql` → `notal_user_credits` (not hakları)
2. `supabase-notal-saved-notes.sql` → `notal_saved_notes` (üretilen notlar)

İsteğe bağlı (Faz A + B — metin + figür RAG):

3. `supabase-notal-yks-chunks.sql` → `yks_chunks` (metin parçaları)
4. `supabase-notal-yks-figures.sql` → `yks_figures` + `yks_chunk_figures` + Storage bucket

Eski görsel pipeline (legacy, artık önerilmez):

5. `supabase-notal-notes-images.sql` + `supabase-notal-academic-ingestion.sql`

### `profiles` tablosu

NotAl demo **ayrı bir `profiles` tablosu gerektirmez**. Kimlik doğrulama Supabase `auth.users` üzerinden yapılır; notlar `notal_saved_notes.user_id` ile kullanıcıya bağlanır.

Ana Rekabetli sitesinde profil özellikleri varsa, o tablolar bağımsızdır.

## 4. Test kullanıcısı ve not hakkı

1. Ana siteden veya `/login` üzerinden kayıt olun / giriş yapın.
2. Demo sayfası oturum gerektirir (`NotalAuthGate`).
3. Yeni kullanıcıların varsayılan not hakkı **0**'dır. Yerel test için SQL Editor'da hak tanımlayın:

```sql
-- Kullanıcı UUID'nizi: Supabase → Authentication → Users
INSERT INTO public.notal_user_credits (user_id, notes_remaining, pdf_grant_count)
VALUES ('YOUR-USER-UUID', 10, 0)
ON CONFLICT (user_id) DO UPDATE
SET notes_remaining = 10;
```

## 5. Uygulamayı çalıştırma

```bash
npm install
npm run dev
```

Tarayıcıda açın:

- **NotAl arayüzü:** http://localhost:3000/notal
- **Kitap arşivi (admin):** http://localhost:3000/notal-admin/upload — Faz A+B birleşik ingest
- `/notal-demo` → `/notal` yönlendirmesi

## 6. Demo arayüzü özellikleri

| Alan | İşlev |
|------|--------|
| Sol sidebar | `/api/notal/notes` — kullanıcının kayıtlı notları |
| Orta chat | Konu yaz → `POST /api/notal` → `runMainNotalGraph` |
| Not detayı | Sidebar'dan not seçince Markdown + LaTeX render |
| Agent logları | Her yanıtta `steps` dizisi (supervisor, classify, …) |

API yanıt örneği:

```json
{
  "noteId": "uuid",
  "finalNote": "# Kepler Yasaları\n\n...",
  "steps": ["supervisor", "classify", "retrieve", "write", "illustrator", "polish"],
  "educationLevel": "high_school",
  "hasVisuals": false
}
```

## 7. Sorun giderme

| Sorun | Çözüm |
|-------|--------|
| `Sunucu yapılandırması eksik` | `.env` içinde `OPENAI_API_KEY` kontrol edin |
| `Supabase yapılandırması eksik` | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| `Not oluşturma hakkınız kalmadı` | Yukarıdaki SQL ile `notal_user_credits` güncelleyin |
| Oturum / login döngüsü | `/login?redirect=%2Fnotal` ile tekrar giriş |
| Boş not listesi | Önce chat'ten bir not üretin veya hak kontrolü yapın |
| Figür kaydı 0 | Poppler kurun (`PDFTOPPM_PATH`); `yks_figures` SQL + bucket çalıştırın |
| `TT: undefined function` | pdf.js font uyarısı — zararsız, yok sayılabilir |

## 9. Poppler (Windows) — Faz B sayfa render

MEB PDF'lerinde en iyi sayfa görüntüsü için [Poppler for Windows](https://github.com/oschwartz10612/poppler-windows/releases) indirin.

1. ZIP'i açın (ör. `C:\poppler`)
2. `.env` dosyasına ekleyin: `PDFTOPPM_PATH=C:\poppler\Library\bin\pdftoppm.exe`
3. Terminalde test: `pdftoppm -v`

Poppler yoksa sistem pdf.js canvas yedek motorunu kullanır (bazı PDF'lerde hata verebilir).

## 8. API mimarisi (güncel)

`POST /api/notal` artık doğrudan şunu çağırır:

```
lib/agents/supervisor/run.ts → runMainNotalGraph()
```

Akış: **supervisor** → (lise) **classify → retrieve (`yks_chunks`) → write → illustrator (`yks_figures`) → polish** → Supabase kaydı.
