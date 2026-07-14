# Topluluklar sayfası – kurulum kontrol listesi

Bu liste, topluluk sayfasının (profil butonu + Topluluk Ekle popup) çalışması için gereken adımları içerir.

## 1. Siteyi doğru şekilde açın (çok önemli)

HTML dosyasına çift tıklayıp `file://` ile açmayın. Oturum (giriş) paylaşılmaz ve JavaScript dosyaları bazen yüklenmez.

**Yapmanız gereken:**

1. VS Code / Cursor içinde proje klasörünü açın.
2. **Live Server** eklentisini kurun (yoksa).
3. `index.html` veya `communities.html` üzerinde sağ tık → **Open with Live Server**.
4. Adres çubuğunda şuna benzer bir adres görün: `http://127.0.0.1:5500/communities.html`
5. Giriş, ana sayfa ve topluluklar **aynı adresle** (aynı port) açılmalı.

## 2. Supabase SQL sırası

Supabase Dashboard → **SQL Editor** → New query. Aşağıdaki dosyaları **bu sırayla** çalıştırın (daha önce çalıştırdıysanız tekrar çalıştırmak genelde zararsızdır; `IF NOT EXISTS` / `DROP POLICY IF EXISTS` kullanılır):

| Sıra | Dosya | Ne işe yarar |
|------|--------|----------------|
| 1 | `supabase-profile-fields.sql` | Profiller + avatar bucket |
| 2 | `supabase-communities.sql` | `communities` tablosu |
| 3 | `supabase-community-join-requests.sql` | Katılma istekleri, üyelik, bildirim |
| 4 | `supabase-community-posts.sql` | Topluluk akışı (`posts.community_id`) |
| 5 | `supabase-community-rls-fix.sql` | **500 / infinite recursion** hatası aldıysanız (bir kez) |
| 6 | `supabase-community-join-public.sql` | Açık topluluğa **Topluluğa Katıl** ile üyelik |
| 7 | `supabase-community-members-list.sql` | Tüm üyeleri listeleme + admin üye kaldırma |
| 8 | `supabase-community-bento-stats.sql` | Ana sayfa bento topluluk / üye sayıları |
| 9 | `supabase-community-join-reject.sql` | Katılma isteği reddi + bildirim |
| 10 | `supabase-community-member-leave.sql` | Üyenin topluluktan ayrılması |
| 11 | `supabase-community-comment-membership.sql` | Açık topluluk gönderileri ana akışta + gerçek üye sayısı RPC + yanıt için üyelik |

**500 hatası:** Console’da `infinite recursion detected in policy for relation "communities"` görüyorsanız yalnızca **`supabase-community-rls-fix.sql`** dosyasını SQL Editor’da çalıştırmanız yeterli; sayfayı yenileyin.

**Zorunlu değil (topluluk listesi için):** `supabase-post-actions.sql`, `supabase-notifications.sql` (bildirimler için 3. dosya zaten bildirim kolonlarını günceller).

### SQL sonrası kontrol

Table Editor’da şunlar görünmeli:

- `communities`
- `community_join_requests`
- `community_members`

## 3. Supabase Auth ayarları

- **Authentication → Providers → Email** açık olmalı.
- Site URL / Redirect URLs (varsa): `http://127.0.0.1:5500` ve canlı domaininiz ekli olmalı.

## 4. Storage (profil fotoğrafı için)

- Bucket: **`avatars`** (public)
- `supabase-profile-fields.sql` bunu oluşturur.
- Topluluk logosu da `avatars` bucket’ına yüklenir (`{kullanıcıId}/community-....jpg`).

## 5. Sayfayı test etme

1. Live Server ile `http://127.0.0.1:5500/login.html` açın → giriş yapın.
2. `http://127.0.0.1:5500/communities.html` açın.
3. Sağ üstte **Profil** yazmalı (Giriş Yap değil).
4. **Topluluk Ekle** → popup açılmalı.

### Hâlâ çalışmıyorsa (F12)

1. **Network** sekmesi → kırmızı satır var mı? Özellikle:
   - `supabase-client.js`
   - `nav-profile.js`
   - `communities-form.js`
2. Hepsi **200** olmalı (404 olmamalı).
3. **Console** → filtre: All levels (sadece Errors değil).

## 6. Kodda yapılan son düzeltme

- `communities.html` yarışmalar sayfasıyla aynı yapıda (Supabase script’leri `<head>` içinde).
- Geçersiz `<motion>` etiketleri kaldırıldı (tarayıcı HTML’i bozuyordu, script’ler çalışmıyordu).
- `communities-form.js` sadeleştirildi (`DOMContentLoaded` ile başlatma).

## 7. Sizin ekstra yapmanız gereken bir şey var mı?

| Konu | Gerekli mi? |
|------|-------------|
| SQL dosyalarını sırayla çalıştırmak | Evet (bir kez) |
| Live Server / benzeri yerel sunucu | Evet |
| Supabase’te manuel veri girişi | Hayır |
| Edge Function / ek API | Hayır (şimdilik) |
| Admin onay ekranı | Hayır (ileride; SQL’de `approve_community_join_request` hazır) |

Onay akışı ileride panelden bağlanacak; şimdilik istekler `community_join_requests` tablosuna yazılır ve (bildirim SQL’i çalıştıysanız) topluluk sahibine bildirim gider.
