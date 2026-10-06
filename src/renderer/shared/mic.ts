/** "Default - Mikrofon (Yeti Classic) (046d:0ab7)" -> "Mikrofon (Yeti Classic)" */
export function micName(label: string): string {
  return label
    .replace(/^(Default|Communications) - /, '')
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '')
}
