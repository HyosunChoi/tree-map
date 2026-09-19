import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Missing env vars (not configured yet, or a local checkout without a .env.local)
// must not crash the app — storage.js falls back to localStorage-only mode when this is null.
export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null

let sessionPromise = null

// Anonymous auth: one background session per browser, no sign-up/login UI.
// Cached as a promise so concurrent callers (initial load + a fast save) share one request.
export function ensureSession() {
  if (!supabase) return Promise.resolve(null)

  if (!sessionPromise) {
    sessionPromise = supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (error) throw error
        if (data.session) return data.session

        const { data: signInData, error: signInError } = await supabase.auth.signInAnonymously()
        if (signInError) throw signInError
        return signInData.session
      })
      .catch((error) => {
        sessionPromise = null // allow a retry on the next call instead of caching a rejection forever
        throw error
      })
  }

  return sessionPromise
}
