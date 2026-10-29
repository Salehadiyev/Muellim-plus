# Müəllim+

TR-YÖS (Temel Matematik + Sayısal Yetenek) hazırlığı üçün müəllim platforması: tələbələr və qruplar, sual bankı, AI ilə sual, kitabdan/PDF-dən sual, testlər və denemelər, səhv dəftəri, materiallar, dərs və ödəniş dəftəri. Tələbələr qeydiyyatsız, öz şəxsi linki ilə girir.

Sayt: **https://muellim-plus.vercel.app**

## Hər şey harada saxlanılır

| Yer | Nə var | Nə vaxt lazımdır |
|---|---|---|
| **GitHub** — `Salehadiyev/Muellim-plus` | Bütün kod, dəyişikliklərin tarixçəsi, SQL faylları (`supabase/`), sınaqlar | Yeni dəyişiklik, köhnə versiyaya qayıtmaq |
| **Vercel** — `muellim-plus` layihəsi | Saytın özü, API açarları (Settings → Environment Variables) | GitHub-a kod gələndə sayt **özü yenilənir**; açarı dəyişmək lazım olanda |
| **Supabase** | Baza: tələbələr, suallar, testlər, nəticələr, ödənişlər, fayllar | Yeni SQL işə salmaq (SQL Editor), ehtiyat nüsxə |
| **AI hesabları** (Anthropic, OpenAI, Google AI Studio) | AI açarları və balans | Balans bitəndə |

Sayt bu hesablarda işləyir — hər hansı söhbət bağlansa da dayanmır.

## Yeni dəyişiklik lazım olanda
1. claude.ai-də yeni söhbət aç və GitHub repozitoriyasını (`Salehadiyev/Muellim-plus`) qoş.
2. Nə istədiyini yaz. Claude əvvəlcə `CLAUDE.md` faylını oxuyur — layihənin quruluşu və iş qaydaları oradadır.
   Başqa AI köməkçisi (GPT, Codex və s.) ilə işləyəndə ona de: **"Əvvəlcə repozitoriyadakı AGENTS.md faylını oxu və ona əməl et."**
3. Claude dəyişikliyi edir, sınaqları işlədir və GitHub-a göndərir; Vercel saytı özü yeniləyir.
4. Bazada dəyişiklik lazım olsa, Claude SQL-i söhbətə yazır: **Supabase → SQL Editor → New query → yapışdır → Run**.

## Ehtiyat nüsxə
- Saytda **Ayarlar → Məlumatlarımı yüklə** — bütün məlumat bir faylda. Ayda bir dəfə yüklə və saxla.
- Pulsuz Supabase planı avtomatik nüsxə saxlamır; tələbə çoxalanda Pro plana keçmək məsləhətdir.

## Bazanın yenilənmələri (SQL faylları)
`supabase/` qovluğunda: `schema.sql` (əsas) və `002`…`016` yeniləmələri. Hamısı bir faylda: `supabase/full_schema.sql` — **yeni boş Supabase layihəsi** üçün bunu bir dəfə işə salmaq kifayətdir. Hər fayl təkrar işə salına bilər (zərərsizdir).

## Bölmələr (qısa)
- **Ana səhifə** — bu günün xülasəsi, zəif nəticələr, açıq testlər.
- **Tələbələr** — yarat, qrupa qoy, köçür, sil; şəxsi link; tələbə səhifəsi (nəticələr, gizli qeyd, fərdi tapşırıq, valideyn hesabatı).
- **Qruplar** — tələbələr, testlər, səhv dəftəri, materiallar, analiz, imtahan tarixi.
- **Suallar** — bank (real çətinlik, toplu silmə), kitabdan/PDF, AI ilə (nümunədən, mövzudan, məktəb, yaz və çevir).
- **Testlər** — yeni test, ⚡ avtomatik test (kitabdan / AI / bankdan, asan-orta-çətin bölgüsü), açıq/bağlı, nəticələr və tələbənin qələmlə həlli.
- **Materiallar** — PDF, şəkil, mətn, video link — qrup-qrup.
- **Dərslər** — aylıq ödəniş (ayın neçəsi), gəldi/gəlmədi, geri al, tarixçə.
- **Ayarlar** — AI xərci və limitlər, ehtiyat nüsxə.

## Texniki (proqramçı üçün)
- Front-end: `index.html`, `app.js`, `styles.css` (build yoxdur). Server: `api/ai.js`, `api/_tryos.js`, `api/config.js` (Vercel funksiyaları).
- Sınaqlar: `tests/run.mjs` (Playwright + server), `tests/sql/run.sh` (Postgres: miqrasiyalar + təhlükəsizlik yoxlamaları). GitHub Actions hər push-da işlədir.
- Ətraflı: `CLAUDE.md`.
