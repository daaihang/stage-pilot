// Title: Icon Placeholder
// Description: Multi-icon-library router. StagePilot standardizes on remixicon,
// so this implementation resolves the remixicon prop by name from
// Remix icon names are resolved through the shared application icon boundary;
// the other library props remain accepted for drop-in ReUI compatibility.
// Unknown names render nothing instead of an invalid custom element.

import type { ComponentProps, ComponentType } from "react"
import { remixIconMap } from "@/components/ui/icons"

type IconPlaceholderProps = ComponentProps<"svg"> & {
  lucide?: string
  tabler?: string
  hugeicons?: string
  phosphor?: string
  remixicon?: string
}

const remixIcons: Record<string, ComponentType<ComponentProps<"svg">>> = remixIconMap

export function IconPlaceholder({
  lucide: _lucide,
  tabler: _tabler,
  hugeicons: _hugeicons,
  phosphor: _phosphor,
  remixicon,
  ...props
}: IconPlaceholderProps) {
  const Icon = remixicon ? remixIcons[remixicon] : undefined
  if (!Icon) return null
  return <Icon {...props} />
}
