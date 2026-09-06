import { CalendarClock } from "@/components/ui/icons";
import { DateTimePickerPanel } from "@/components/reui/date-time-picker";
import { ProductionOverviewField } from "@/components/production-overview/production-overview-field";
import { ActivityTimeText } from "@/components/time-text";

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
      displayValue={value ? <ActivityTimeText instant={value} timezone={timezone} /> : ""}
      placeholder="未设置"
      icon={CalendarClock}
      disabled={disabled}
      description={description}
      contentClassName="w-auto"
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
