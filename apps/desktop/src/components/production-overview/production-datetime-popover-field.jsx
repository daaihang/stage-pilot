import { CalendarClock } from "@/components/ui/icons";
import { formatProductionInstant } from "@/lib/production-api";
import { DateTimePickerPanel } from "@/components/reui/date-time-picker";
import { ProductionOverviewField } from "@/components/production-overview/production-overview-field";

export function ProductionDateTimePopoverField({
  label,
  value,
  timezone,
  onSave,
  disabled = false,
  description,
}) {
  return (
    <ProductionOverviewField
      label={label}
      value={value}
      displayValue={value ? formatProductionInstant(value, timezone) : ""}
      placeholder="未设置"
      icon={CalendarClock}
      disabled={disabled}
      description={description}
      contentClassName="w-auto p-0"
      onSave={onSave}
      hideFieldLabel
      renderEditor={({ draft, setDraft, disabled: editorDisabled, open }) => (
        <DateTimePickerPanel
          value={draft}
          timezone={timezone}
          active={open}
          showApply={false}
          disabled={editorDisabled}
          onDraftChange={setDraft}
        />
      )}
    />
  );
}
