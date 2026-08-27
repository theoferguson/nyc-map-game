import type React from 'react'

export function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-neutral-900 p-8 text-center text-white">
      {children}
    </div>
  )
}
