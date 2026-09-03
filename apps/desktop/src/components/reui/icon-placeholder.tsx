// Title: Icon Placeholder
// Description: Multi-icon-library router. StagePilot standardizes on remixicon,
// so this implementation resolves the remixicon prop by name from
// @remixicon/react; the other library props are accepted for drop-in
// compatibility with reui blocks. Unknown names render nothing instead of an
// invalid custom element.

import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpSLine,
  RiCalendarLine,
  RiCheckLine,
  RiCloseLine,
  RiDraggable,
  RiRepeatLine,
  RiSettings3Line,
  RiSubtractLine,
  RiTimeLine,
} from "@remixicon/react"
import type { ComponentType } from "react"

type IconPlaceholderProps = ComponentProps<"svg"> & {
  lucide?: string
  tabler?: string
  hugeicons?: string
  phosphor?: string
  remixicon?: string
}

const remixIcons: Record<string, ComponentType<ComponentProps<"svg">>> = {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpSLine,
  RiCalendarLine,
  RiCheckLine,
  RiCloseLine,
  RiDraggable,
  RiRepeatLine,
  RiSettings3Line,
  RiSubtractLine,
  RiTimeLine,
}

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
