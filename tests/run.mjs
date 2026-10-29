// Müəllim+ avtomatik sınaqları: node tests/run.mjs  (və ya: npm test --prefix tests)
// Hər sınaq ayrıca prosesdə işləyir; keçmə şərti: çıxış kodu 0, "FAIL" yoxdur və gözlənilən sətirlər var.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OK = /NO ERRORS/;
const tests = {
  // brauzer (Playwright + saxta Supabase / AI)
  'e2e/access-e2e.cjs': [OK, /admin approves and sets limits/, /unapproved: waiting screen/, /without 008: works as before/],
  'e2e/rules-e2e.cjs': [OK, /shuffle stable per student/, /auto-submit when time runs out/, /overdue test blocked/, /tests list: personal tag/],
  'e2e/pr-e2e.cjs': [OK, /personal test: Fərdi tapşırıq · .* 3 after_submit/, /Hörmətli valideyn/, /Fonksiyonlar 17%/],
  'e2e/an-e2e.cjs': [OK, /topics: Fonksiyonlar 17%/, /3 testdə/],
  'e2e/review-e2e.cjs': [/qstat dialog: Sual 1/, OK, /after_close: hidden while open/, /mode never → student review blocked/, /student page stats: 2 \/ 2 \| 17%/],
  'e2e/portal-e2e.cjs': [/no page errors|NO ERRORS/, /portal: lower-case code ok/, /old code rejected; typed new code works/, /results: 1 submitted, 2 not yet/],
  'e2e/pdf-test.cjs': [OK, /test question_ids: 5 \| saved new: 4/, /incomplete crop → message shown/],
  'e2e/pdf-bank.cjs': [OK, /bank now: 5 \| sources: book,ai,ai,ai \| cards left: 0/],
  'e2e/tests-pick.cjs': [OK, /test created with 4 questions, class c1/],
  'e2e/flow3.cjs': [OK, /bank approve badge: true/, /tile badge: ✔ Təsdiqlənib/],
  'e2e/tryos-e2e.cjs': [OK, /student figs: 4 opt figs: 10/],
  'e2e/usage-ui.cjs': [OK, /Cəmi \| 16 \| 3 \| 13/],
  'e2e/account-e2e.cjs': [OK, /forgot password sends link/, /recovery link → new password → app/, /expired session → back to login/],
  'e2e/csp-e2e.cjs': [OK, /pdf rendered: true/, /csp violations: \[\]/],
  'e2e/data-e2e.cjs': [OK, /privacy page public/, /export all data \(paged\)/, /csp: \[\]/],
  'e2e/auto-e2e.cjs': [/total: 4/, /pdf info: book.pdf · 3 səhifə \| to: 3/, /book groups: Asan · 2 \| Orta · 1 \| Çətin · 1/, /book items: Orijinal sual \d \| Orijinal sual \d \| AI sual orta \d \| Orijinal sual \d/, /Kitabda çatmadı \(orta 1\)/, /want: extract:Fonksiyonlar/, /fill plan: tryos_plan:\{"asan":0,"orta":1,"cetin":0\}/, /newtest title: Fonksiyonlar \| checked: 4/, /ai plan: tryos_plan:\{"asan":1,"orta":1,"cetin":1\} \| groups: Asan · 1 \| Orta · 1 \| Çətin · 1/, /print ok: true/],
  'e2e/notebook-e2e.cjs': [/mistakes after test: q2:open$/m, /portal waiting: Dəftərdə 1 sual var/, /portal due: Təkrar et \(1\)/, /practice q: g\(3\)=\? \(bənzər\)/, /btn after answer: Bitir/, /wrong: 6 \| marked: wrong:5,right:6/, /after wrong: open attempts=1 seen=q3 later=true/, /second practice q: f\(2\)=\?/, /right: ✓ Düzdür/, /portal after: .*1 düzəldilib.*Dəftər boşdur/, /teacher stats: 1 \| 1 \| 1 \| gen btn: ✨ Bənzərləri AI ilə hazırla \(1\)/, /teacher rows: Nərgiz Quliyeva 1 dəftərdə \|\| Əli Həsənov ✓ 1/, /gen note: «1\+1=\?» — bənzəri yoxlamadan keçmədi, qaralama kimi saxlandı: kor həll başqa cavab tapdı/, /tile label: bənzəri təsdiq gözləyir \| draft notice: true/, /pair: 1\+1=\? \|\| AI bənzər: 2\+3=\?/, /after approve: ✓ bənzəri var/, /bank similar: .*\[↔\] \| .*\[↔\]/, /no 010 teacher: true/, /no 010 portal ok: true/],
  'e2e/bigbank-e2e.cjs': [OK, /head: 2300 sual/, /rendered: 50/, /after more: 100/, /search one: Sual nömrə 2299/, /Seçilənlərdən test \(2300\)/, /bank dlg: Sual 1 \/ 2300/, /bank next: Sual 2 \/ 2300/, /✓ new test with big bank/],
  'e2e/errors-e2e.cjs': [OK, /network error → clear internet message/, /only unexpected errors logged/, /admin sees and clears errors/],
  // server (api/ai.js, saxta provayderlər)
  'server/srv2.mjs': [/verify disagree -> false/, /no render -> false/, /izomorf omits dup rule: true/],
  'server/clean.mjs': [/4-option clean copy: 200 4 4/, /no image: 400/],
  'server/fallback.mjs': [/Sol chosen, Claude broke → 200 X \| tried: openai \|/, /only Claude, broke → 402/],
  'server/effort.mjs': [/effort sent: 200 low/, /effort rejected → retry: 200 low>none/],
  'server/order.mjs': [/Sol chosen, no Claude → 200 gpt-sol \| tried: openai$/m, /Sol 429 → 200 gemini-flash \| tried: openai>anthropic>google \| fast: true/],
  'server/gem.mjs': [/gemini rejects thinkingLevel → 200 \| configs: low>default/],
  'server/auto.mjs': [/extract want: 200 çətin\/true,orta\/false \| prompt clean: true/, /empty page with want: 200 0/, /empty page without want: 400/, /plan mix: 200 5 asan,asan,orta,çətin,çətin \| prompt: true/, /plan too many: 400/],
  'server/gate.mjs': [/not approved\s+403 \| AI called: 0/, /daily limit hit\s+429 \| AI called: 0/, /monthly limit hit\s+429/, /gate error 500\s+503/, /no 008 \(404\)\s+200/]
};

const only = process.argv.slice(2);
const run = (file) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(here, file)], { cwd: here, env: process.env });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => p.kill('SIGKILL'), 240000);
  p.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
});

let failed = 0;
const started = Date.now();
for (const [file, expect] of Object.entries(tests)) {
  if (only.length && !only.some((o) => file.includes(o))) continue;
  const t0 = Date.now();
  const { code, out } = await run(file);
  const missing = expect.filter((re) => !re.test(out));
  const ok = code === 0 && !/^FAIL\b/m.test(out) && !missing.length;
  console.log(`${ok ? '✓' : '✗'} ${file} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (!ok) {
    failed++;
    if (code !== 0) console.log(`   çıxış kodu: ${code}`);
    missing.forEach((re) => console.log(`   gözlənilən tapılmadı: ${re}`));
    console.log(out.split('\n').slice(-25).map((l) => '   | ' + l).join('\n'));
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=${file}::` + [code !== 0 ? 'kod ' + code : '', ...missing.map(String), ...out.split('\n').slice(-12)].filter(Boolean).join(' ¦ ').replace(/%/g, '%25').replace(/\r?\n/g, ' ').slice(0, 3500));
  }
}
console.log(`\n${failed ? '✗ ' + failed + ' sınaq keçmədi' : '✓ hamısı keçdi'} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
process.exit(failed ? 1 : 0);
