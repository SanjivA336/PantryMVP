interface Props {
  className?: string
}

// The app's version (from package.json, baked in at build time). Small and
// quiet on purpose: it's there so anyone reporting a problem can say which
// version they were on.
export function AppVersion({ className = '' }: Props) {
  return <p className={`text-xs text-muted ${className}`}>v{__APP_VERSION__}</p>
}
