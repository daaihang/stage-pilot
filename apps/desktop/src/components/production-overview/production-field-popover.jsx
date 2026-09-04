import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { notify } from "@/components/ui/sonner";

export function ProductionFieldPopover({
  label,
  value,
  trigger,
  description,
  renderEditor,
  onSave,
  validate,
  disabled = false,
  contentClassName = "w-72",
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fieldId = useId();

  useEffect(() => {
    if (open) {
      setDraft(value ?? "");
      setError("");
    }
  }, [open, value]);

  const handleOpenChange = (nextOpen) => {
    if (saving) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setDraft(value ?? "");
      setError("");
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;

    const validationError = validate?.(draft);
    if (validationError) {
      setError(validationError);
      notify.error(`无法保存${label}`, { description: validationError });
      return;
    }

    setSaving(true);
    try {
      const result = await onSave?.(draft);
      if (result !== false) setOpen(false);
    } catch (saveError) {
      notify.error(`无法保存${label}`, {
        description: saveError?.message || String(saveError),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger disabled={disabled || saving} render={trigger} />
      <PopoverContent align="start" className={contentClassName}>
        <div
          className="space-y-3"
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.target instanceof HTMLTextAreaElement) return;
            if (event.target instanceof HTMLInputElement) save(event);
          }}
        >
          <PopoverHeader>
            <PopoverTitle>{label}</PopoverTitle>
            {description && <PopoverDescription>{description}</PopoverDescription>}
          </PopoverHeader>
          <Field data-disabled={saving || undefined} data-invalid={Boolean(error) || undefined}>
            <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
            <div>
              {renderEditor?.({
                draft,
                setDraft,
                disabled: saving,
                error,
                open,
                id: fieldId,
              })}
            </div>
            {error && <FieldError>{error}</FieldError>}
            {description && <FieldDescription>{description}</FieldDescription>}
          </Field>
          <div className="flex justify-end gap-2 border-t pt-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => handleOpenChange(false)}
            >
              取消
            </Button>
            <Button type="button" size="sm" disabled={saving} onClick={save}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
