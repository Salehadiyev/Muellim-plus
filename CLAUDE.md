# Müəllim+ — Claude üçün təlimat

Bu fayl yeni Claude söhbəti üçündür: layihəni və iş qaydalarını buradan öyrən.

## Kiminlə işləyirsən
- Sahibi TR-YÖS imtahanına (Türkiyə: Temel Matematik + Sayısal Yetenek) özəl dərs keçən **riyaziyyat müəllimidir**. Platforma yalnız onun və tələbələri üçündür (qeydiyyat bağlıdır).
- **Həmişə Azərbaycan dilində cavab ver.** Sadə dil, texniki termin az.
- O, yalnız **iPad / Safari**-dən işləyir (çox vaxt "Özəl" rejim). Terminal, git, fayl redaktoru yoxdur.
- Supabase-ə SQL lazım olanda **SQL-in tam mətnini söhbətə yapışdır** (raw GitHub linki işləmir) və "Supabase → SQL Editor → New query → yapışdır → Run" de.
- Sahibinin qoyduğu qaydalar (pozma):
  - API açarlarını və digər gizli məlumatları cavabda və loglarda göstərmə.
  - Görmədiyin nümunəni sınaqdan keçmiş kimi göstərmə (real AI / real cihazda yoxlanmayanı açıq de).
  - Digər işləyən funksiyaları və bankdakı sualları qoru (real tələbə məlumatı var).

## Quruluş
- **Front-end:** `index.html`, `app.js` (bütün tətbiq, vanilla JS, hash marşrutlar), `styles.css`. Build yoxdur. CSP `index.html`-dəki meta-dadır.
  - Kitabxanalar jsDelivr-dən: supabase-js, KaTeX, pdf.js 4.10.38 (`isEvalSupported:false`), html2canvas, jspdf.
  - Müəllim marşrutları: `#/` ana səhifə, `students`, `classes` (UI-da **Qruplar**), `class/:id`, `student/:id`, `analysis/:id`, `bank`, `pdf`, `ai`, `tests`, `newtest`, `auto`, `test/:id`, `materials`, `lessons`, `settings`, `teachers` (admin, menyuda yoxdur).
  - Tələbə: `#/s/KOD` (şəxsi portal), `#/s/KOD/testId`, `#/s/KOD/testId/review`, `#/s/KOD/defter` (səhv dəftəri). Qrupsuz ümumi link: `#/t/testId`.
  - UI-da "sinif" → **qrup**, "şagird" → **tələbə** (bazada cədvəl adları `classes`, `students` qalıb).
- **Server (Vercel):** `api/ai.js` (AI əməliyyatları: generate, extract, transform, tryos_plan, tryos_generate, verify, tryos_analyze, tryos_from_examples, clean_copy), `api/_tryos.js` (TR-YÖS prompt və qaydalar), `api/config.js`. AI açarları yalnız Vercel env-dədir: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (+ model adları). Köməkçi model zənciri, limit yoxlaması (`ai_gate`), xəta jurnalı (`app_errors`).
- **Baza (Supabase Postgres + RLS):** `supabase/schema.sql` + `supabase/0NN_*.sql` miqrasiyaları. `supabase/full_schema.sql` = hamısı bir yerdə (`supabase/build-full.sh` ilə yaradılır; CI `--check` edir — miqrasiya dəyişəndə yenidən qur).
  - Tələbə funksiyaları `security definer`-dir və şəxsi kodla işləyir (`student_portal`, `student_get_test`, `student_submit_test`, `student_review`, `student_mistakes`, `student_answer_mistake`, `student_notes`, `student_analysis`, `student_save_drawings`). Cavab açarı tələbəyə heç vaxt getməməlidir; "test bağlananda göstər" rejimində açıq testin cavabları sızmamalıdır (`review_allowed`, `practice_safe`).
  - Miqrasiyalar: 002 TR-YÖS · 003 xərc · 004 status · 005 şəxsi linklər · 006 cavablara baxış · 007 vaxt/son tarix · 008 icazə və limit · 009 möhkəmləndirmə · 010 səhv dəftəri · 011 dəftərdə sızma qoruması · 012 deneme, imtahan tarixi, analiz, dərs qeydləri (storage `notes`) · 013 dərs/ödəniş, gizli qeyd, real çətinlik · 014 material video link · 015 qələmlə həll şəkilləri · 016 aylıq ödəniş · 017 qrupun mövzu planı (`classes.plan`) · 018 dərs cədvəli (`classes.schedule`).
  - Hər yeni miqrasiya təkrar işlədilə bilən olmalıdır (`if not exists`, `create or replace`, `drop policy if exists`). Köhnə baza ilə də sayt sınmamalıdır (sütun/cədvəl yoxdursa yumşaq geri çəkil və "NNN_*.sql işə salın" de).

## Sınaqlar (dəyişiklikdən sonra MƏCBURİ)
- Brauzer + server: `PW=playwright NODE_PATH=$(npm root -g) node tests/run.mjs` (və ya bir hissə: `... tests/run.mjs groups`). `tests/e2e/*.cjs` Playwright + `tests/fixtures/mock-supabase.js` (Supabase təqlidi — yeni cədvəl/RPC əlavə edəndə onu da yenilə). Hər faylın gözlənilən çıxışı `tests/run.mjs`-dədir.
- Baza: `tests/sql/run.sh` (təmiz bazada bütün miqrasiyalar iki dəfə + `tests/sql/checks.sql` RLS/təhlükəsizlik yoxlamaları + full_schema). Lokal Postgres 16 ilə: `PGHOST=... PGPORT=... tests/sql/run.sh`.
- GitHub Actions (`.github/workflows/tests.yml`) hər push-da hamısını işlədir; uğursuz sınağın səbəbi annotation kimi görünür.
- `main`-ə push → Vercel avtomatik yayımlayır.

## Üslub
- Kod şərhləri və UI mətnləri Azərbaycan dilində. TR-YÖS sualları türkcədir.
- Dizayn: okean rəngi (`--accent: #0E7490`), tünd yan menyu, kartlar; iPad və telefon üçün böyük toxunma hədəfləri (≥40px).
- İstifadəçi mətni HTML-ə yalnız `esc()` ilə; AI-dan gələn SVG yalnız `safeSvg()` ilə.
