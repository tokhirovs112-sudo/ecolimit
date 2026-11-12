# EcoLimit — CO₂ limit platformasi

Havo ifloslanishini oldindan tahlil qilib, uning oldini olishga yordam beradigan platforma. Har bir korxonaga **mahsulotiga bo'lgan talab** va **limitdan haqiqiy foydalanishi**ni hisobga olib, individual CO₂ limiti ajratiladi.

**Stack:** Cloudflare Pages (statik frontend) + Pages Functions (API) + D1 (SQLite baza). Build qadami yo'q, tashqi npm paketlar ham yo'q.

## Imkoniyatlar

**Korxona kabineti**
- Oylik limit, shu paytgacha ishlatilgan miqdor, qoldiq va oy oxirigacha prognoz
- Oxirgi 6 oylik CO₂ hisoboti (grafik) va progress
- Qo'shimcha limit narxlari (bosqichli) va qo'shimcha limit so'rovi
- Ajratilgan ish vaqti
- Limit qanday hisoblanganining izohi
- **Muammolar** bo'limi: murojaat yuborish, regulyator javobini ko'rish, Telegram orqali bog'lanish
- Parolni o'zgartirish

**Regulyator (admin) paneli**
- Hudud bo'yicha limit taqsimoti va oy limitlarini tasdiqlash
- Korxona qo'shish, tahrirlash va o'chirish, login va parol berish
- Oylik CO₂ hisobotlarini kiritish
- Qo'shimcha limit so'rovlarini tasdiqlash yoki rad etish
- Murojaatlarga javob berish
- Umumiy limit, tariflar va Telegram username sozlamalari

## Limit algoritmi

```
Ball_i  = Talab_i × Foydalanish_i
Limit_i = UmumiyLimit × Ball_i / Σ Ball
```

`Foydalanish_i` — oxirgi 3 oyda tasdiqlangan limitning haqiqatda ishlatilgan ulushi. U 0.3 bilan 1.0 orasida bo'ladi, yangi korxona uchun esa 1.0 olinadi. Kichik korxona limitini tugata olmasa, koeffitsienti kamayadi va ortiqcha limit talabi katta korxonalarga o'tadi.

Qo'shimcha limit bosqichli narxda beriladi (standart holatda: 0–5% → 18 $/t, 5–10% → 27 $/t, 10–20% → 45 $/t). Oxirgi bosqichdan yuqori qo'shimcha limitga ruxsat berilmaydi.

## Cloudflare'ga joylash

### 1. D1 bazasini yarating
Cloudflare Dashboard → **Storage & Databases → D1** → **Create database**. Nomini `ecolimit-db` qiling, keyin **Database ID** ni nusxalab oling.

### 2. Jadvallarni yarating
D1 → `ecolimit-db` → **Console** bo'limiga [`migrations/0001_init.sql`](migrations/0001_init.sql) faylining butun matnini qo'ying va **Execute** tugmasini bosing.

### 3. Pages loyihasini GitHub'ga ulang
**Workers & Pages → Create → Pages → Connect to Git** → `ecolimit` reposini tanlang.
- Framework preset: **None**
- Build command: *(bo'sh qoldiring)*
- Build output directory: `public`

### 4. Bazani ulang
Pages loyihasi → **Settings → Bindings → Add → D1 database**:
- Variable name: `DB`
- Database: `ecolimit-db`

Keyin **Deployments** bo'limida oxirgi deploy'ni **Retry deployment** bilan qayta ishga tushiring.

### 5. Birinchi kirish
Saytni ochganingizda **«Birinchi sozlash»** sahifasi chiqadi. U yerda admin akkauntini yarating. Shundan keyin korxonalarni qo'shib, ularga login va parol berasiz.

> Keyinchalik `main` branch'ga qilingan har bir push saytni avtomatik yangilaydi.

### Wrangler CLI bilan (ixtiyoriy)
Repoda `wrangler.toml` yo'q. Agar u bo'lsa, Cloudflare dashboard'dagi Bindings sozlamalari bloklanib qoladi. CLI'dan foydalanmoqchi bo'lsangiz, `wrangler.toml.example` faylidan nusxa oling:
```bash
cp wrangler.toml.example wrangler.toml
npx wrangler d1 create ecolimit-db           # chiqqan database_id ni wrangler.toml ga yozing
npx wrangler d1 migrations apply ecolimit-db --remote
npx wrangler pages deploy public
```

## Lokal ishga tushirish
```bash
cp wrangler.toml.example wrangler.toml
npx wrangler d1 migrations apply ecolimit-db --local
npx wrangler pages dev
# http://localhost:8788
```

## Xavfsizlik
- Parollar PBKDF2-SHA256 bilan (100 000 iteratsiya, alohida salt) saqlanadi
- Sessiya HttpOnly, Secure, SameSite=Lax cookie'da saqlanadi, bazada esa faqat token hash'i turadi
- 5 marta noto'g'ri parol kiritilsa, login 15 daqiqaga bloklanadi
- Har bir korxona faqat o'z ma'lumotlarini ko'radi; admin endpointlari rol bo'yicha himoyalangan

## Aloqa
Savol va muammolar bo'yicha Telegram: [@saidalokhonn](https://t.me/saidalokhonn)
