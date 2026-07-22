import { supabase } from './supabaseClient'

// Uploads go straight from the browser to Supabase Storage using the same
// anon-key client already used directly for Auth/Realtime -- a new
// category of direct-Supabase-from-frontend usage, since apiClient.ts only
// ever sends JSON and has no multipart path. Gated by Storage RLS on the
// receipt-images bucket (see migration 0015): the upload_path must be the
// exact one the backend issued when creating the session, since the RLS
// policy checks the household_id encoded in that path.
export async function uploadReceiptImage(bucket: string, path: string, file: File): Promise<void> {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
  })
  if (error) throw error
}
