import { createClient, type Session } from "@supabase/supabase-js";

export const supabaseUrl =
  (process.env as Record<string, string | undefined>)["EXPO_PUBLIC_SUPABASE_URL"] ??
  "https://ijklazicwpvvrnjjbggt.supabase.co";
export const supabaseAnonKey =
  (process.env as Record<string, string | undefined>)["EXPO_PUBLIC_SUPABASE_ANON_KEY"] ??
  "";

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey || "missing", {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true
  }
});

export async function getAnonymousSession(): Promise<Session | null> {
  if (!hasSupabaseConfig) return null;

  const existing = await supabase.auth.getSession();
  if (existing.data.session) return existing.data.session;

  const created = await supabase.auth.signInAnonymously();
  return created.data.session ?? null;
}
