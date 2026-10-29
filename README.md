# Müəllim+ · ilk versiya

Riyaziyyat müəllimləri üçün platforma: siniflər, şagirdlər, AI ilə sual yaratma, kitabdan sual kəsib orijinala çevirmə, sual bankı və şagirdlər üçün onlayn test.

## Nə var

| Hissə | Nə edir |
|---|---|
| Giriş | Müəllim e-poçt və şifrə ilə qeydiyyatdan keçir |
| Siniflər | Sinif yaradılır, şagird siyahısı yapışdırılır |
| AI ilə sual | Mövzu, sinif, çətinlik seçilir, suallar həlli ilə gəlir |
| Kitabdan sual | Səhifənin şəkli çəkilir, sual çərçivəyə alınır, AI onu yeni orijinal suala çevirir. Kitabın şəkli saxlanılmır |
| Sual bankı | Bütün suallar, axtarış və filtr |
| Testlər | Bankdan sual seçilir, link şagirdlərə göndərilir, şagird qeydiyyatsız açır, çoxseçimli suallar avtomatik yoxlanılır |

## Fayllar

- `index.html`, `app.js`, `styles.css` — sayt (heç bir quraşdırma tələb etmir)
- `api/ai.js` — Claude AI ilə əlaqə (gizli açar yalnız serverdə qalır)
- `api/config.js` — sayta açıq Supabase məlumatını verir
- `supabase/schema.sql` — verilənlər bazası və təhlükəsizlik qaydaları

## İşə salma (iPad-dən də olur)

### 1. Supabase (verilənlər bazası, pulsuz)
1. supabase.com → **Start your project** → GitHub ilə daxil ol
2. **New project**: ad `muellim-plus`, güclü şifrə, region **Frankfurt** (Azərbaycana ən yaxın)
3. Sol menyu → **SQL Editor** → **New query** → `supabase/schema.sql` faylının hamısını yapışdır → **Run**
4. **Project Settings → API**: `Project URL` və `anon public` açarını bir yerə qeyd et
5. Sınaq müddətində asanlıq üçün: **Authentication → Sign In / Providers → Email** → "Confirm email" söndür

### 2. Claude API açarı
1. console.anthropic.com → hesab aç
2. **Billing** → kart əlavə et, kiçik məbləğ yüklə
3. **API Keys** → **Create Key** → açarı kopyala (bir dəfə göstərilir)

### 3. Vercel (sayt, pulsuz)
1. vercel.com → GitHub ilə daxil ol
2. **Add New → Project** → `muellim-plus` reposunu seç → **Import**
3. **Environment Variables** bölməsinə üçünü əlavə et:
   - `SUPABASE_URL` = Supabase Project URL
   - `SUPABASE_ANON_KEY` = Supabase anon public açarı
   - `ANTHROPIC_API_KEY` = Claude API açarı
4. **Deploy** → bir dəqiqədən sonra saytın linki hazırdır

### 4. Son addım
Supabase → **Authentication → URL Configuration** → **Site URL** yerinə Vercel linkini yaz.

## Yeniləmələr (bazaya)
- **002_tryos.sql** — TR-YÖS, şəkillər və yoxlama üçün yeni sütunlar. Supabase → SQL Editor → faylın hamısını yapışdır → Run.
- **004_status.sql** — AI yoxlama statusları (keçib / yoxlama tələb edir / qaralama) və müəllim təsdiqi.
- **005_student_links.sql** — hər şagirdə şəxsi link (8 simvollu kod), şagird kabineti, bir şagird bir testi bir dəfə göndərir.
- **006_review.sql** — testdən sonra şagird öz səhvlərini görür (müəllim seçir: göstərmə / göndərən kimi / test bağlananda).
- **008_access.sql** — müəllim təsdiqi (yeni qeydiyyat admin təsdiqləyənə qədər işləmir), gündəlik/aylıq AI xərc limiti, admin üçün "Müəllimlər" səhifəsi. Mövcud hesablar təsdiqlənir, ən birinci hesab admin olur.
- **007_test_rules.sql** — vaxt limiti (başlama anı serverdə), son tarix, sual/variant qarışdırma, fərdi (bir şagirdə) test, gecikmiş iş qeydi.
- **003_usage.sql** — AI sayğacı (yaradılan / banka düşən / boşa gedən sual və xərc, model üzrə). Qiymətlər `api/ai.js` → `priceOf`.

## TR-YÖS rejimi
- AI ilə sual → **TR-YÖS**: türkcə, 5 variant, əvvəlcə tip planı, sonra 3-lük partiyalarla suallar (40-a qədər).
- Qrafik, Venn, cədvəl, sxem və şəkilli variantlar SVG kimi çəkilir.
- Hər sual ikinci AI tərəfindən cavab açarı görmədən həll edilir: uyğun gəlirsə "✓ yoxlanılıb", gəlmirsə "⚠ yoxla".
- Qaydalar: `api/_tryos.js`.

## Nümunədən yaratma (TR-YÖS)
- Hər nümunə əvvəlcə analiz olunur (`tryos_analyze`, Claude Sonnet, şəkil ilə): ailə, vizual quruluş, qayda, qorunmalı/dəyişən xüsusiyyətlər, qeyri-müəyyənlik, kəsiyin tamlığı. Natamam kəsik istifadə olunmur; qeyri-müəyyən nümunə müəllim təsdiqi ilə işlədilir.
- Rejimlər (`api/_tryos.js` → `TRYOS_MODES`): izomorf / bənzər / fərqli quruluş. Bənzər və izomorfda sual ailəsi və təqdimat qorunur.
- "Səhifədəki bütün suallar"da hər sual üçün orijinal səhifədən ayrıca kəsik götürülür və yaratmaya göndərilir.
- Hər nümunəyə 1–5 sual; sorğular 2-lik hissələrə bölünür, çatışmayan bir dəfə avtomatik tamamlanır, sonra "Çatışmayanları yarat".
- Yoxlama iki ayrı hissədir: (A) düzgünlük — cavab açarını görmədən, brauzerdə çəkilmiş yekun görüntü ilə; (B) nümunəyə uyğunluq — orijinal nümunə, analiz və rejimlə. Keçməyən sual bir dəfə yenidən yaradılır, yenə keçməsə qaralama olur. Müəllim təsdiqi ayrıca (Sual bankı → Təsdiqlə).

## Şagird kabineti
- Sinif səhifəsində hər şagirdin **Linki göndər** düyməsi var (iPad-də paylaşma pəncərəsi açılır, WhatsApp seçmək olar). **Yeni link** köhnəsini etibarsız edir.
- Şagird `#/s/KOD` linkini açır: sinfinin açıq testlərini yazır (ad seçmədən), öz nəticələrini və orta faizini görür. Eyni testi iki dəfə göndərə bilmir.
- Test nəticələrində **Hələ göndərməyənlər** siyahısı və xatırlatma mətni.
- Köhnə ümumi test linki (`#/t/...`, ad seçməklə) də işləyir.
- **Səhvlərimə bax** (`#/s/KOD/TEST/review`): şagirdin cavabı, düzgün cavab və həll; yalnız müəllim icazə verəndə (testin `review_mode`).
- Müəllim: test nəticəsində hər şagird üçün sual xanaları (✓ ✗ —), ada basanda işi açılır; sinifdə şagirdin adına basanda onun bütün testləri (`#/student/ID`).

## Müəllim alətləri
- **Analiz** (sinif → Analiz): testlər üzrə orta nəticə, mövzular (zəifdən güclüyə), ən çox səhv edilən suallar və ən çox seçilən səhv variant, şagirdlər (köməyə ehtiyacı olanlar yuxarıda).
- **Şagird səhifəsi**: mövzular, nəticələr, hər test üzrə xanalar; **Fərdi tapşırıq (AI)** — səhv/boş suallardan bənzər yeni suallar, yoxlama, təsdiq, yalnız həmin şagirdə test; **Valideyn hesabatı** (7/30 gün, WhatsApp-a göndər).
- **Yeni test → Vaxt, son tarix, qarışdırma**: vaxt bitəndə avtomatik göndərmə, cavab qaralaması brauzerdə saxlanılır, qarışdırma hər şagird üçün sabit.

## Testə PDF-dən sual
- Testlər → Yeni test → **Kitabdan / PDF-dən sual**: istənilən PDF və ya şəkil açılır, sual çərçivəyə alınır, aşağıda seçim çıxır:
  - **Orijinalı təmiz çıxart** (`clean_copy`, həmişə köməkçi model — Claude Sonnet, o işləməsə başqası): sual dəyişmədən, kitabın dilində yenidən yazılır, şəkillər SVG ilə çəkilir, cavab tapılır (4–5 variant).
  - **AI ilə yarat**: **Bənzər** və ya **Yeni quruluş**, 1–3 sual (`tryos_from_examples`).
- Hər ikisində əvvəl analiz (natamam kəsik dayandırılır), sonra yoxlama; keçməyən bir dəfə yenidən yaradılır, yenə keçməsə qaralama (avtomatik seçilmir).
- Seçilən suallar **Testi yarat** basılanda banka yazılır və testə əlavə olunur.

## PDF
- Sual bankı → sualları seç → **PDF**; və ya AI nəticələrindən, test səhifəsindən.
- A4, iki sütun, səhifədə 4 və ya 6 sual, sonda cavab açarı; ayrıca "Həllər" sənədi.

## AI modelləri
TR-YÖS səhifəsinin yuxarısında model seçilir. Açarı olmayan model boz görünür.

| Model | Vercel dəyişəni |
|---|---|
| Claude Opus 5.5 / Sonnet 5.5 | `ANTHROPIC_API_KEY` |
| GPT-6.1 Sol | `OPENAI_API_KEY` |
| Gemini 3.8 Flash | `GEMINI_API_KEY` |

Şəkil oxuma və ikinci yoxlama həmişə Claude Sonnet ilə edilir (`HELPER_MODEL`).
Model adları dəyişsə: `ANTHROPIC_MODEL`, `SONNET_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL`.
Yeni dəyişən əlavə edəndən sonra Vercel-də **Redeploy** lazımdır.

## Qeydlər
- Model `ANTHROPIC_MODEL` dəyişəni ilə dəyişdirilə bilər (standart: `claude-opus-5-5`; daha ucuz variant: `claude-sonnet-5-5`).
- AI istifadəsi hər sorğuya görə ödənişlidir; Anthropic Console-da xərc limiti qoymaq tövsiyə olunur.
- Şagirdlər test linkini açanda cavablar onlara görünmür, bal serverdə hesablanır.
