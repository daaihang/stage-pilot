import { useRef } from "react";
import { Pencil } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProductionFieldPopover } from "@/components/production-overview/production-field-popover";

export function ProductionOverviewField({
  label,
  value,
  displayValue,
  placeholder = "未设置",
  icon: Icon,
  canEdit = true,
  disabled = false,
  variant = "default",
  hideLabel = false,
  editLabel = `编辑${label}`,
  description,
  renderEditor,
  onSave,
  validate,
  contentClassName,
  className,
  valueClassName,
  hideFieldLabel = false,
}) {
  const shownValue = displayValue || placeholder;
  const titleVariant = variant === "title";
  const ValueElement = titleVariant ? "h1" : "div";
  const triggerRef = useRef(null);

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size={titleVariant ? "icon-sm" : "icon-xs"}
      ref={triggerRef}
      aria-label={editLabel}
      title={editLabel}
      disabled={disabled}
    >
      <Pencil />
    </Button>
  );

  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2",
        titleVariant && "items-center gap-1",
        className,
      )}
    >
      {Icon && <Icon className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", titleVariant && "mt-0")} />}
      <div className="min-w-0 flex-1">
        {!hideLabel && <p className="text-xs text-muted-foreground">{label}</p>}
        <ValueElement
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            titleVariant ? "text-2xl font-semibold tracking-tight" : "mt-1 text-lg",
            !value && "text-muted-foreground",
          )}
        >
          <span className={cn("min-w-0 whitespace-pre-wrap", titleVariant && "truncate", valueClassName)}>
            {shownValue}
          </span>
          {canEdit && renderEditor && onSave && (
            <ProductionFieldPopover
              label={label}
              value={value}
              description={description}
              renderEditor={renderEditor}
              onSave={onSave}
              hideFieldLabel={hideFieldLabel}
              validate={validate}
              disabled={disabled}
              contentClassName={contentClassName}
              trigger={trigger}
              triggerRef={triggerRef}
            />
          )}
        </ValueElement>
      </div>
    </div>
  );
}
