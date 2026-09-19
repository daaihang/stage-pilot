import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { localDateTimeToUtc, utcToLocalDateTime } from "@/lib/campaign-form-runtime";

function optionValue(option) {
  return typeof option === "string" ? option : option?.value || option?.label || "";
}

function optionLabel(option) {
  return typeof option === "string" ? option : option?.label || option?.value || "";
}

function describedBy(descriptionId, errorId, hasDescription, hasErrors) {
  return [hasDescription ? descriptionId : null, hasErrors ? errorId : null].filter(Boolean).join(" ") || undefined;
}

function MultiSelectField({ field, value, onValueChange, disabled, triggerId, descriptionId, errorId, invalid }) {
  const selected = Array.isArray(value) ? value : [];
  const options = Array.isArray(field.options) ? field.options : [];
  const selectedLabels = options.filter((option) => selected.includes(optionValue(option))).map(optionLabel);
  const toggle = (nextValue, checked) => {
    const next = checked ? [...new Set([...selected, nextValue])] : selected.filter((item) => item !== nextValue);
    onValueChange(next);
  };

  return <Popover>
    <PopoverTrigger render={<Button id={triggerId} type="button" variant="outline" className="w-full justify-between font-normal" disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={describedBy(descriptionId, errorId, Boolean(field.helpText), invalid)}><span className={selectedLabels.length ? "truncate" : "text-muted-foreground"}>{selectedLabels.length ? selectedLabels.join("、") : "请选择"}</span><span className="text-muted-foreground">已选 {selected.length}</span></Button>} />
    <PopoverContent align="start" className="w-(--anchor-width) min-w-56">
      <div role="group" aria-label={field.label || "多选字段"} className="space-y-2">
        {options.map((option, index) => {
          const optionId = `${triggerId}-option-${index}`;
          const valueKey = optionValue(option);
          return <Field key={valueKey || index} orientation="horizontal" className="gap-2">
            <Checkbox id={optionId} checked={selected.includes(valueKey)} disabled={disabled} onCheckedChange={(checked) => toggle(valueKey, Boolean(checked))} />
            <FieldLabel htmlFor={optionId} className="text-sm font-normal">{optionLabel(option)}</FieldLabel>
          </Field>;
        })}
      </div>
    </PopoverContent>
  </Popover>;
}

function FieldControl({ field, value, onValueChange, readOnly, mode, timezone, controlId, descriptionId, errorId, invalid }) {
  const description = describedBy(descriptionId, errorId, Boolean(field.helpText), invalid);
  const options = Array.isArray(field.options) ? field.options : [];
  if (field.type === "select") return <Select value={value || null} onValueChange={(next) => onValueChange(next || "")} disabled={readOnly}><SelectTrigger id={controlId} className="w-full" aria-invalid={invalid || undefined} aria-describedby={description}><SelectValue placeholder="请选择" /></SelectTrigger><SelectContent>{options.map((option, index) => <SelectItem key={optionValue(option) || index} value={optionValue(option)}>{optionLabel(option)}</SelectItem>)}</SelectContent></Select>;
  if (field.type === "multiselect") return <MultiSelectField field={field} value={value} onValueChange={onValueChange} disabled={readOnly} triggerId={controlId} descriptionId={descriptionId} errorId={errorId} invalid={invalid} />;
  if (field.type === "radio") return <RadioGroup value={value || null} onValueChange={(next) => onValueChange(next || "")} aria-labelledby={`${controlId}-label`} aria-describedby={description} aria-invalid={invalid || undefined} className="gap-2">{options.map((option, index) => {
    const optionId = `${controlId}-option-${index}`;
    return <Field key={optionValue(option) || index} orientation="horizontal" className="gap-2"><RadioGroupItem id={optionId} value={optionValue(option)} disabled={readOnly} /><FieldLabel htmlFor={optionId} className="text-sm font-normal">{optionLabel(option)}</FieldLabel></Field>;
  })}</RadioGroup>;
  if (field.type === "checkbox") return <Field orientation="horizontal" className="gap-2"><Checkbox id={controlId} checked={Boolean(value)} disabled={readOnly} aria-invalid={invalid || undefined} aria-describedby={description} onCheckedChange={(checked) => onValueChange(Boolean(checked))} /><FieldLabel htmlFor={controlId} className="text-sm font-normal">确认</FieldLabel></Field>;
  if (field.type === "textarea") return <Textarea id={controlId} readOnly={readOnly} value={value || ""} aria-invalid={invalid || undefined} aria-describedby={description} onChange={(event) => onValueChange(event.target.value)} rows={3} />;
  if (field.type === "file") return mode === "public" ? <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">公开表单暂不支持文件上传。</p> : <Input id={controlId} disabled={readOnly} type="file" aria-invalid={invalid || undefined} aria-describedby={description} onChange={(event) => onValueChange(event.target.files?.[0]?.name || "")} />;
  const inputValue = field.type === "datetime" ? utcToLocalDateTime(value, timezone) : (value ?? "");
  const onChange = (event) => {
    if (field.type === "number") {
      const number = event.target.value === "" ? undefined : event.target.valueAsNumber;
      onValueChange(Number.isFinite(number) ? number : undefined);
      return;
    }
    if (field.type === "datetime") {
      onValueChange(localDateTimeToUtc(event.target.value, timezone));
      return;
    }
    onValueChange(event.target.value);
  };
  return <Input id={controlId} readOnly={readOnly} type={field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text"} value={inputValue} placeholder={field.placeholder || ""} aria-invalid={invalid || undefined} aria-describedby={description} onChange={onChange} />;
}

export function CampaignFormField({ field, value, onValueChange, required, readOnly, mode, timezone, errors = [] }) {
  const instanceId = useId().replace(/:/g, "");
  const controlId = `campaign-field-${field.id}-${instanceId}`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const invalid = errors.length > 0;
  const isChoiceGroup = field.type === "radio" || field.type === "checkbox";
  return <Field data-invalid={invalid || undefined}>
    {isChoiceGroup ? <FieldTitle id={`${controlId}-label`} className="text-sm font-medium">{field.label || "未命名字段"}{required ? <span className="ml-1 text-destructive">*</span> : null}</FieldTitle> : <FieldLabel htmlFor={controlId} className="text-sm font-medium">{field.label || "未命名字段"}{required ? <span className="ml-1 text-destructive">*</span> : null}</FieldLabel>}
    {field.helpText ? <FieldDescription id={descriptionId}>{field.helpText}</FieldDescription> : null}
    <FieldControl field={field} value={value} onValueChange={onValueChange} readOnly={readOnly} mode={mode} timezone={timezone} controlId={controlId} descriptionId={descriptionId} errorId={errorId} invalid={invalid} />
    <FieldError id={errorId} errors={errors} />
  </Field>;
}

export function CampaignConsentField({ block, value, onValueChange, readOnly, errors = [] }) {
  const instanceId = useId().replace(/:/g, "");
  const controlId = `campaign-consent-${block.id}-${instanceId}`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const invalid = errors.length > 0;
  return <Field data-invalid={invalid || undefined}>
    <FieldTitle className="text-sm font-medium">{block.title || "同意确认"}{block.required ? <span className="ml-1 text-destructive">*</span> : null}</FieldTitle>
    {block.body ? <FieldDescription id={descriptionId}>{block.body}</FieldDescription> : null}
    <Field orientation="horizontal" className="gap-2"><Checkbox id={controlId} checked={value === true} disabled={readOnly} aria-invalid={invalid || undefined} aria-describedby={describedBy(descriptionId, errorId, Boolean(block.body), invalid)} onCheckedChange={(checked) => onValueChange(Boolean(checked))} /><FieldLabel htmlFor={controlId} className="text-sm font-normal">我已阅读并同意</FieldLabel></Field>
    <FieldError id={errorId} errors={errors} />
  </Field>;
}
