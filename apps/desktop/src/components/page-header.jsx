import { cn } from "@/lib/utils";

/**
 * Shared page-level heading. Navigation belongs above the page title, while
 * page actions remain separate from window-level detail controls.
 */
export function PageHeader({
  back,
  title,
  titleContent,
  titleAccessory,
  description,
  actions,
  headingLevel = "h1",
  children,
  className,
}) {
  const Heading = headingLevel;
  const resolvedTitle = titleContent || (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Heading className="min-w-0 break-words text-2xl font-semibold tracking-tight">{title}</Heading>
      {titleAccessory}
    </div>
  );

  return (
    <header className={cn("@container/page-header min-w-0 space-y-2", className)}>
      {back}
      <div className="flex min-w-0 flex-col gap-4 @min-[40rem]/page-header:flex-row @min-[40rem]/page-header:items-start @min-[40rem]/page-header:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          {resolvedTitle}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          {children}
        </div>
        {actions}
      </div>
    </header>
  );
}

/**
 * The contract is direct page-action children. They stack at narrow content
 * widths and return to an intrinsic, wrapping row when space is available.
 */
export function PageHeaderActions({ children, className }) {
  return (
    <div className={cn(
      "flex min-w-0 w-full flex-col gap-2 [&_[data-slot=button]]:w-full @min-[40rem]/page-header:w-auto @min-[40rem]/page-header:flex-row @min-[40rem]/page-header:flex-wrap @min-[40rem]/page-header:justify-end @min-[40rem]/page-header:[&_[data-slot=button]]:w-auto",
      className,
    )}>
      {children}
    </div>
  );
}
