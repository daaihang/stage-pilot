import { useEffect, useMemo, useState } from "react"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxGroupLabel, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@/components/ui/combobox"
import { getTimeZoneOptions } from "@/lib/timezone"

export function TimezoneCombobox({ value, onValueChange, disabled = false, className, autoFocus = false, open, onOpenChange, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const options = useMemo(() => getTimeZoneOptions(), [])
  const isOpen = open !== undefined ? Boolean(open) : internalOpen
  const filtered = useMemo(() => {
    const query = searchValue.trim().toLowerCase()
    return query ? options.filter((option) => `${option.value} ${option.city} ${option.offset}`.toLowerCase().includes(query)) : options
  }, [options, searchValue])
  const groups = filtered.reduce((result, option) => {
    ;(result[option.group] ||= []).push(option)
    return result
  }, {})
  const selected = options.find((option) => option.value === value) || null
  const selectedLabel = selected?.label || ""

  useEffect(() => {
    // Search text is only a transient state for an open picker. The selected
    // value remains the source of truth while the trigger is closed, so an
    // async preference response cannot leave the field blank or stale.
    if (!isOpen) {
      setSearchValue("")
    }
  }, [isOpen])

  const handleOpenChange = (nextOpen, eventDetails) => {
    setInternalOpen(nextOpen)
    setSearchValue("")
    onOpenChange?.(nextOpen, eventDetails)
  }

  const handleInputValueChange = (nextValue) => {
    if (!isOpen) return
    setSearchValue(nextValue)
  }

  return <Combobox items={filtered} value={selected} open={open} onOpenChange={handleOpenChange} onValueChange={(option) => onValueChange?.(option?.value || option || "")} inputValue={isOpen ? searchValue : selectedLabel} onInputValueChange={handleInputValueChange} itemToStringValue={(item) => item?.value || item || ""} itemToStringLabel={(item) => item?.label || item || ""}>
    {trigger ? <ComboboxTrigger render={trigger} disabled={disabled} /> : <ComboboxInput className={className} disabled={disabled} autoFocus={autoFocus} aria-label="时区" placeholder="搜索城市或时区" />}
    <ComboboxContent className={trigger ? "w-80 p-2" : undefined}>
      {trigger && <ComboboxInput hideTrigger className="mb-2 w-full" disabled={disabled} autoFocus aria-label="时区" placeholder="搜索城市或时区" />}
      <ComboboxList><ComboboxEmpty>没有匹配的时区</ComboboxEmpty>{Object.entries(groups).map(([group, items]) => <ComboboxGroup key={group}><ComboboxGroupLabel>{group}</ComboboxGroupLabel>{items.map((option) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>)}</ComboboxGroup>)}</ComboboxList>
    </ComboboxContent>
  </Combobox>
}
