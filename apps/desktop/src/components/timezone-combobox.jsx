import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxGroupLabel, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox"
import { getTimeZoneOptions } from "@/lib/timezone"

export function TimezoneCombobox({ value, onValueChange, disabled = false, className, autoFocus = false }) {
  const [inputValue, setInputValue] = useState("")
  const options = useMemo(() => getTimeZoneOptions(), [])
  const filtered = useMemo(() => {
    const query = inputValue.trim().toLowerCase()
    return query ? options.filter((option) => `${option.value} ${option.city} ${option.offset}`.toLowerCase().includes(query)) : options
  }, [inputValue, options])
  const groups = filtered.reduce((result, option) => {
    ;(result[option.group] ||= []).push(option)
    return result
  }, {})
  const selected = options.find((option) => option.value === value) || null
  return <Combobox items={filtered} value={selected} onValueChange={(option) => onValueChange?.(option?.value || option || "")} inputValue={inputValue} onInputValueChange={setInputValue} itemToStringValue={(item) => item?.value || item || ""} itemToStringLabel={(item) => item?.label || item || ""}>
    <ComboboxInput className={className} disabled={disabled} autoFocus={autoFocus} aria-label="时区" placeholder="搜索城市或时区" />
    <ComboboxContent><ComboboxList><ComboboxEmpty>没有匹配的时区</ComboboxEmpty>{Object.entries(groups).map(([group, items]) => <ComboboxGroup key={group}><ComboboxGroupLabel>{group}</ComboboxGroupLabel>{items.map((option) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>)}</ComboboxGroup>)}</ComboboxList></ComboboxContent>
  </Combobox>
}
