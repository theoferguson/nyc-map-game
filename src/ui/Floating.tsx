import type React from 'react'

/**
 * Every panel floats over the imagery rather than docking to a screen edge, so
 * the map stays the whole surface and nothing reads as chrome. Insets clear the
 * iOS notch and home indicator.
 */
export function Floating({
  className,
  children,
}: {
  className: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-3 z-30 mx-auto max-w-md ${className}`}
      style={{
        marginBottom: 'env(safe-area-inset-bottom)',
        marginTop: 'env(safe-area-inset-top)',
      }}
    >
      <div className="pointer-events-auto">{children}</div>
    </div>
  )
}
