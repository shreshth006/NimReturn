import type { ReactNode } from 'react'

// Technical evidence stays one tap away but collapsed, so consumer screens read as a story.
export function ProofDisclosure({ children, label = 'View proof' }: { children: ReactNode; label?: string }) {
  return (
    <details className="proof-disclosure">
      <summary>{label}</summary>
      <div className="proof-disclosure__body">{children}</div>
    </details>
  )
}
