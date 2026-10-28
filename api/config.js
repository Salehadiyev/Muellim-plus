// Brauzerə yalnız açıq (public) Supabase məlumatlarını verir.
// Gizli açarlar (ANTHROPIC_API_KEY) burada heç vaxt göstərilmir.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
}
