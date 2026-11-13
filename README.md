# EcoLimit — CO₂ limit platformasi

Havo ifloslanishini oldindan tahlil qilib, uning oldini olishga yordam beradigan platforma. Har bir korxonaga **mahsulotiga bo'lgan talab** va **limitdan haqiqiy foydalanishi**ni hisobga olib, individual CO₂ limiti ajratiladi.

**Stack:** Cloudflare Workers (static assets + API) va D1 (SQLite baza). Build qadami ham, tashqi npm paketlar ham yo'q.

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

Loyiha Cloudflare **Workers** sifatida ishlaydi. Barcha sozlamalar [`wrangler.jsonc`](wrangler.jsonc) faylida turadi, jumladan D1 bazasi ham (`DB` → `ecolimit-db`).

1. **D1 bazasini yarating.** Nomi `ecolimit-db` bo'lsin. Keyin `migrations/0001_init.sql` faylini bazaning **Console** bo'limida bajaring.
2. **ID ni yozing.** `wrangler.jsonc` faylidagi `database_id` qiymatini o'z bazangizning ID si bilan almashtiring.
3. **Reponi ulang.** **Workers & Pages → Create application → Continue with GitHub** orqali shu reponi tanlang. Deploy buyrug'i: `npx wrangler deploy`.
4. **Admin yarating.** Saytni birinchi marta ochganingizda **«Birinchi sozlash»** sahifasida admin akkauntini yarating.

`main` branch'ga qilingan har bir push saytni avtomatik yangilaydi.

## Lokal ishga tushirish
```bash
npx wrangler d1 migrations apply ecolimit-db --local
npx wrangler dev
# http://localhost:8787
```

## Xavfsizlik
- Parollar PBKDF2-SHA256 bilan (100 000 iteratsiya, alohida salt) saqlanadi
- Sessiya HttpOnly, Secure, SameSite=Lax cookie'da saqlanadi, bazada esa faqat token hash'i turadi
- 5 marta noto'g'ri parol kiritilsa, login 15 daqiqaga bloklanadi
- Har bir korxona faqat o'z ma'lumotlarini ko'radi; admin endpointlari rol bo'yicha himoyalangan

## Aloqa
Savol va muammolar bo'yicha Telegram: [@saidalokhonn](https://t.me/saidalokhonn)
