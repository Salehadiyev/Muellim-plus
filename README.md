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

## Qeydlər
- Model `ANTHROPIC_MODEL` dəyişəni ilə dəyişdirilə bilər (standart: `claude-opus-5-5`; daha ucuz variant: `claude-sonnet-5-5`).
- AI istifadəsi hər sorğuya görə ödənişlidir; Anthropic Console-da xərc limiti qoymaq tövsiyə olunur.
- Şagirdlər test linkini açanda cavablar onlara görünmür, bal serverdə hesablanır.
