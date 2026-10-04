import { createClient } from '@supabase/supabase-js'

// trim(): a hosting dashboard can save a pasted value with a trailing newline.
// Ordinary HTTP requests shrug that off, but the realtime WebSocket puts the
// key in its URL, where the newline breaks authentication, so live updates
// silently stop working in production.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Check your .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
