import { useEffect, useMemo, useState } from "react"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxGroupLabel, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@/components/ui/combobox"
import { getTimeZoneOptions } from "@/lib/timezone"

export function TimezoneCombobox({ value, onValueChange, disabled = false, className, autoFocus = false, open, onOpenChange, trigger }) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const options = useMemo(() => getTimeZoneOptions(), [])
  const isControlled = open !== undefined
  const isOpen = isControlled ? Boolean(open) : internalOpen
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
    const normalizedOpen = Boolean(nextOpen)
    if (!isControlled) setInternalOpen(normalizedOpen)
    setSearchValue("")
    onOpenChange?.(normalizedOpen, eventDetails)
  }

  const handleInputValueChange = (nextValue) => {
    if (!isOpen) return
    setSearchValue(nextValue)
  }

  // With a trigger, the input is mounted inside the popup. Keeping the
  // selected label in that input while the popup is closing races Base UI's
  // own input cleanup and can reopen the controlled combobox. The trigger's
  // surrounding field already renders the selected label, so the popup input
  // should be empty whenever it is closed.
  const inputValue = isOpen ? searchValue : (trigger ? "" : selectedLabel)

  return <Combobox items={filtered} value={selected} open={isControlled ? isOpen : undefined} openOnInputClick={!trigger} onOpenChange={handleOpenChange} onValueChange={(option) => onValueChange?.(option?.value || option || "")} inputValue={inputValue} onInputValueChange={handleInputValueChange} itemToStringValue={(item) => item?.value || item || ""} itemToStringLabel={(item) => item?.label || item || ""}>
    {trigger ? <ComboboxTrigger render={trigger} disabled={disabled} /> : <ComboboxInput className={className} disabled={disabled} autoFocus={autoFocus} aria-label="时区" placeholder="搜索城市或时区" />}
    <ComboboxContent className={trigger ? "w-80 p-2" : undefined}>
      {trigger && <ComboboxInput hideTrigger className="mb-2 w-full" disabled={disabled} autoFocus aria-label="时区" placeholder="搜索城市或时区" />}
      <ComboboxList><ComboboxEmpty>没有匹配的时区</ComboboxEmpty>{Object.entries(groups).map(([group, items]) => <ComboboxGroup key={group}><ComboboxGroupLabel>{group}</ComboboxGroupLabel>{items.map((option) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>)}</ComboboxGroup>)}</ComboboxList>
    </ComboboxContent>
  </Combobox>
}
