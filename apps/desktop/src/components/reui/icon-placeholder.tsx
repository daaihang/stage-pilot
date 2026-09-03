// Title: Icon Placeholder
// Description: Multi-icon-library router. StagePilot standardizes on remixicon,
// so this implementation simply resolves the remixicon prop; the other
// library props are accepted for drop-in compatibility with reui blocks.

import type { ComponentProps } from "react"

type IconPlaceholderProps = ComponentProps<"svg"> & {
  lucide?: string
  tabler?: string
  hugeicons?: string
  phosphor?: string
  remixicon?: string
}

export function IconPlaceholder({
  lucide: _lucide,
  tabler: _tabler,
  hugeicons: _hugeicons,
  phosphor: _phosphor,
  remixicon,
  ...props
}: IconPlaceholderProps) {
  const Icon = remixicon
  if (!Icon) return null
  return <Icon {...props} />
}
