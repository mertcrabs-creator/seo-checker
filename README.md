# CR SEO Panel

React + Node.js (Express) + PostgreSQL ile SEO yönetim paneli.

## Kurulum

```bash
# 1) PostgreSQL (Docker ile ya da mevcut bir sunucu)
docker compose up -d db

# 2) API
cd server
npm install
cp .env.example .env
npm run gen:secrets        # çıkan JWT_ACCESS_SECRET ve ENCRYPTION_KEY'i .env'e yapıştırın
npm run dev                # migration'lar açılışta otomatik çalışır → http://localhost:4000

# 3) Panel
cd ../client
npm install
npm run dev                # http://localhost:5173  (/api istekleri 4000'e proxy'lenir)
```

İlk kayıt olan kullanıcı **admin** olur; sonrasında kayıt `ALLOW_REGISTRATION=false` ile kapalıdır.

### Google Search Console

1. Google Cloud Console → *APIs & Services* → **Google Search Console API**'yi etkinleştirin.
2. *Credentials* → **OAuth client ID** (Web application) oluşturun.
   Yetkili yönlendirme URI'si: `http://localhost:5173/api/integrations/google/callback`
3. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` değerlerini `server/.env`'e yazın.
4. Panelde **Ayarlar → Google ile bağlan**.

PageSpeed için `PAGESPEED_API_KEY` opsiyoneldir (yoksa düşük kotalı anonim istek atılır).

## Mimari

```
client/src/api/client.js      tek axios instance (token, refresh, interceptor)
client/src/api/endpoints.js   TÜM API uç noktaları — bileşenler sadece buradan çağırır
server/src/routes/            auth, domains, keywords, integrations
server/src/services/          GSC senkron, PageSpeed, site tarayıcı (audit/), analiz sorguları
server/src/db/migrations/     SQL şema
```

| Veri | Kaynak |
|---|---|
| Tıklama, gösterim, CTR, pozisyon, anahtar kelime, sayfa, ülke, cihaz | Google Search Console API (OAuth, salt-okunur) |
| Core Web Vitals, Lighthouse puanları, hız fırsatları | PageSpeed Insights API |
| Site sağlığı (52 kural, çözüm önerileriyle) | Kendi tarayıcımız (robots.txt'ye uyar) |

## Güvenlik

- Şifreler bcrypt (cost 12); güçlü şifre politikası; kullanıcı tespitine karşı sabit süreli giriş.
- Brute-force: IP+e-posta rate limit ve 5 hatalı denemede 15 dk hesap kilidi.
- Access token (15 dk) sadece bellekte; refresh token `httpOnly + SameSite=Strict` cookie'de, DB'de SHA-256 hash'i saklanır, her kullanımda rotasyon ve **yeniden kullanım tespiti** (çalınan token tüm oturum ailesini iptal eder).
- Şifre değişikliği tüm oturumları ve mevcut access token'ları anında geçersiz kılar.
- Cookie kullanan uçlarda CSRF koruması (Origin kontrolü + özel başlık), sıkı CORS.
- Tüm girdiler zod ile doğrulanır; tüm SQL parametreli; sıralama kolonları beyaz listeli.
- Kaynak sahipliği her sorguda `user_id` ile kontrol edilir (IDOR yok; başkasının kaydı 404).
- **SSRF koruması**: tarayıcı bağlantı anında DNS'i doğrular (rebinding'e karşı), özel/ayrılmış IP'ler, 80/443 dışı portlar ve http(s) dışı şemalar engellenir, her yönlendirme yeniden doğrulanır, boyut/süre sınırı vardır.
- Google tokenları AES-256-GCM ile şifreli saklanır; OAuth akışı PKCE + tek kullanımlık state ile.
- Helmet (API için `default-src 'none'`), gövde limiti 100 KB, `qs` kapalı, production'da hata detayı gizli.

## Production notları

- `NODE_ENV=production`, `COOKIE_SECURE=true`, HTTPS arkasında `TRUST_PROXY=1`.
- `client` build'ini (`npm run build`) ve `/api`'yi aynı origin altında sunun (ör. Nginx).
- İş kuyruğu süreç içidir; birden fazla API instance'ında BullMQ / pg-boss'a taşınmalıdır.
