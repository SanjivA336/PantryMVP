/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_API_BASE_URL: string
  readonly VITE_DEVELOPER_USER_IDS: string
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SUPPORT_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
