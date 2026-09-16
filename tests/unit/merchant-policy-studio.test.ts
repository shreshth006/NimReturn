import { describe, expect, it, vi } from 'vitest'

import { revealVersionEditor } from '../../src/features/merchant/version-editor.js'

describe('merchant policy version editor', () => {
  it('moves focus and the viewport to newly revealed v2 terms', () => {
    const focus = vi.fn()
    const scrollIntoView = vi.fn()

    revealVersionEditor({ focus, scrollIntoView })

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })

  it('does nothing when the editor is not mounted', () => {
    expect(() => revealVersionEditor(null)).not.toThrow()
  })
})
