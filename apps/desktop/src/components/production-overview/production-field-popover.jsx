import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
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
  triggerRef: restoreFocusRef,
  hideFieldLabel = false,
  flush = false,
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fieldId = useId();
  const contentRef = useRef(null);
  const editorRef = useRef(null);
  const fallbackTriggerRef = useRef(null);
  const triggerRef = restoreFocusRef || fallbackTriggerRef;

  const isDirty = draft !== (value ?? "");

  useEffect(() => {
    if (open) {
      setDraft(value ?? "");
      setError("");
      const frame = requestAnimationFrame(() => {
        const firstControl = editorRef.current || contentRef.current?.querySelector("input, textarea, [data-slot='select-trigger'], [data-slot='combobox-input'], [data-field-control]");
        firstControl?.focus?.();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [open, value]);

  const handleOpenChange = (nextOpen) => {
    if (saving) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setDraft(value ?? "");
      setError("");
      requestAnimationFrame(() => triggerRef.current?.focus?.());
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
      if (result === false || result?.ok === false) {
        const nextError = result?.error?.message || result?.message || (typeof result?.error === "string" ? result.error : "");
        if (nextError) setError(nextError);
        return;
      }
      handleOpenChange(false);
    } catch (saveError) {
      setError(saveError?.message || String(saveError));
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
      <PopoverContent align="start" flush={flush} className={contentClassName}>
        <div
          ref={contentRef}
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
            {!hideFieldLabel && <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>}
            <div>
              {renderEditor?.({
                draft,
                setDraft,
                disabled: saving,
                error,
                open,
                id: fieldId,
                focusRef: editorRef,
              })}
            </div>
            {error && <FieldError>{error}</FieldError>}
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
            <Button type="button" size="sm" disabled={saving || !isDirty} onClick={save}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
