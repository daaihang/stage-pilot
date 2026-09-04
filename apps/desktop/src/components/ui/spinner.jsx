import { cn } from "@/lib/utils"
import { RiLoaderLine } from "@/components/ui/icons"

function Spinner({
  className,
  ...props
}) {
  return (
    <RiLoaderLine data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
