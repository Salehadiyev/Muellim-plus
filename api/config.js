// Brauzerə yalnız açıq (public) Supabase məlumatlarını və hansı AI modellərinin qoşulduğunu verir.
// Gizli açarların özü heç vaxt göstərilmir.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const has = (k) => Boolean(process.env[k]);
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    models: [
      { key: 'opus', label: 'Claude Opus 5.5', note: '~10 sent/sual · ən güclü', ready: has('ANTHROPIC_API_KEY') },
      { key: 'sonnet', label: 'Claude Sonnet 5.5', note: '~5 sent/sual', ready: has('ANTHROPIC_API_KEY') },
      { key: 'gpt-sol', label: 'GPT-6.1 Sol', note: '~5 sent/sual', ready: has('OPENAI_API_KEY') },
      { key: 'gemini-flash', label: 'Gemini 3.8 Flash', note: '~2-3 sent/sual · 1 yanvardan 2x', ready: has('GEMINI_API_KEY') }
    ]
  });
}
