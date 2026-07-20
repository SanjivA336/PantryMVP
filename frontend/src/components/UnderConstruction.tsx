export function UnderConstruction({ feature }: { feature: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 p-12 text-center">
      <h2 className="text-xl font-semibold" style={{ color: 'var(--color-primary)' }}>
        {feature}
      </h2>
      <p className="text-sm text-gray-500">This feature is under construction — check back soon.</p>
    </div>
  )
}
