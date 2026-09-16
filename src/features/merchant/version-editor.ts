interface VersionEditorTarget {
  focus(options?: FocusOptions): void
  scrollIntoView(options?: ScrollIntoViewOptions): void
}

export function revealVersionEditor(target: VersionEditorTarget | null): void {
  if (!target) return
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: 'start' })
}
