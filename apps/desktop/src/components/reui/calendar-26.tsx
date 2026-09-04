// Title: Calendar with date picker and year view (c-calendar-26)
// Description: reui c-calendar-26 移植版。相对上游 pattern 的差异：
// - 受控组件：selected / onSelect / month 由调用方持有，可空；
// - 中文化：react-day-picker 的 zhCN locale + date-fns 中文月份缩写；
// - 图标经由 IconPlaceholder（remixicon），导入路径适配仓库别名。

import {
  Dispatch,
  HTMLAttributes,
  ReactNode,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  eachMonthOfInterval,
  eachYearOfInterval,
  endOfYear,
  format,
  isAfter,
  isBefore,
  startOfYear,
} from "date-fns"
import { zhCN as dateFnsZhCN } from "date-fns/locale"
import { zhCN } from "react-day-picker/locale"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent } from "@/components/ui/card"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { IconPlaceholder } from "@/components/reui/icon-placeholder"

function MonthGrid({
  className,
  children,
  isYearView,
  years,
  currentYear,
  currentMonth,
  onMonthSelect,
  selectedYear,
  setSelectedYear,
  startDate,
  endDate,
}: {
  className?: string
  children: ReactNode
  isYearView: boolean
  setIsYearView: Dispatch<SetStateAction<boolean>>
  startDate: Date
  endDate: Date
  years: Date[]
  currentYear: number
  currentMonth: number
  onMonthSelect: (date: Date) => void
  selectedYear: number | null
  setSelectedYear: Dispatch<SetStateAction<number | null>>
}) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isYearView && scrollAreaRef.current) {
      const activeElement = scrollAreaRef.current.querySelector(
        "[data-active='true']"
      ) as HTMLElement | null

      if (activeElement) {
        activeElement.scrollIntoView({ block: "center" })
      }
    }
  }, [isYearView, selectedYear])

  return (
    <div className="relative">
      <table className={className}>{children}</table>
      {isYearView && (
        <div className="bg-background absolute inset-0 z-20 -m-2">
          <div className="h-full" ref={scrollAreaRef}>
            <ScrollArea className="h-full">
              <div className="px-3 pt-1 pb-3">
                {selectedYear === null ? (
                  <div className="grid grid-cols-4 gap-2">
                    {years.map((year) => {
                      const y = year.getFullYear()
                      const isCurrent = y === currentYear
                      return (
                        <Button
                          key={y}
                          variant={isCurrent ? "default" : "outline"}
                          size="sm"
                          className="h-8"
                          data-active={isCurrent}
                          onClick={() => setSelectedYear(y)}
                        >
                          {y}
                        </Button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        onClick={() => setSelectedYear(null)}
                      >
                        <IconPlaceholder
                          lucide="ChevronDownIcon"
                          tabler="IconChevronDown"
                          hugeicons="ArrowDown01Icon"
                          phosphor="CaretDownIcon"
                          remixicon="RiArrowDownSLine"
                          className="mr-1 size-4 rotate-90"
                        />
                        {selectedYear}
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {eachMonthOfInterval({
                        start: startOfYear(new Date(selectedYear, 0)),
                        end: endOfYear(new Date(selectedYear, 0)),
                      }).map((month) => {
                        const isCurrent =
                          month.getMonth() === currentMonth &&
                          selectedYear === currentYear

                        const isDisabled =
                          isBefore(month, startOfYear(startDate)) ||
                          isAfter(month, endOfYear(endDate))

                        return (
                          <Button
                            key={month.getTime()}
                            variant={isCurrent ? "default" : "outline"}
                            size="sm"
                            className="h-8"
                            data-active={isCurrent}
                            disabled={isDisabled}
                            onClick={() => onMonthSelect(month)}
                          >
                            {format(month, "MMM", { locale: dateFnsZhCN })}
                          </Button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  )
}

function CaptionLabel({
  children,
  isYearView,
  setIsYearView,
}: {
  isYearView: boolean
  setIsYearView: Dispatch<SetStateAction<boolean>>
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <Button
      className="data-[state=open]:text-muted-foreground/80 -ms-2 flex items-center gap-2 text-sm font-medium hover:bg-transparent [&[data-state=open]>svg]:rotate-180"
      data-state={isYearView ? "open" : "closed"}
      onClick={() => setIsYearView((prev) => !prev)}
      size="sm"
      variant="ghost"
    >
      {children}
      <IconPlaceholder
        lucide="ChevronDownIcon"
        tabler="IconChevronDown"
        hugeicons="ArrowDown01Icon"
        phosphor="CaretDownIcon"
        remixicon="RiArrowDownSLine"
        aria-hidden="true"
        className="text-muted-foreground/80 shrink-0 transition-transform duration-200"
      />
    </Button>
  )
}

/** c-calendar-26 的日历面板（受控）。年份网格范围 ±10 年。 */
export function CalendarYearView({
  selected,
  onSelect,
  month,
  onMonthChange,
  disabled,
  startYear = new Date().getFullYear() - 10,
  endYear = new Date().getFullYear() + 10,
  footer,
}: {
  selected?: Date
  onSelect?: (date: Date | undefined) => void
  month?: Date
  onMonthChange?: (date: Date) => void
  disabled?: boolean | ((date: Date) => boolean)
  startYear?: number
  endYear?: number
  footer?: ReactNode
}) {
  const today = new Date()
  const [isYearView, setIsYearView] = useState(false)
  const [selectedYear, setSelectedYear] = useState<number | null>(null)

  const startDate = startOfYear(new Date(startYear, 0))
  const endDate = endOfYear(new Date(endYear, 11))

  const years = eachYearOfInterval({
    end: endOfYear(endDate),
    start: startOfYear(startDate),
  })

  return (
    <Card className="p-0">
      <CardContent className="p-0">
        <Calendar
          locale={zhCN}
          classNames={{
            month_caption: "justify-start",
            nav: "flex items-center w-full absolute inset-x-0 justify-end pointer-events-none [&>button]:pointer-events-auto",
          }}
          components={{
            CaptionLabel: (props: any) => (
              <CaptionLabel
                isYearView={isYearView}
                setIsYearView={(val) => {
                  setIsYearView(val)
                  if (!val) setSelectedYear(null)
                }}
                {...props}
              />
            ),
            MonthGrid: (props: any) => (
              <MonthGrid
                className={props.className}
                currentMonth={(month ?? today).getMonth()}
                currentYear={(month ?? today).getFullYear()}
                endDate={endDate}
                isYearView={isYearView}
                onMonthSelect={(selectedMonth: Date) => {
                  onMonthChange?.(selectedMonth)
                  setIsYearView(false)
                  setSelectedYear(null)
                }}
                setIsYearView={setIsYearView}
                startDate={startDate}
                years={years}
                selectedYear={selectedYear}
                setSelectedYear={setSelectedYear}
              >
                {props.children}
              </MonthGrid>
            ),
          }}
          disabled={disabled}
          endMonth={endDate}
          mode="single"
          month={month}
          onMonthChange={onMonthChange}
          onSelect={onSelect}
          selected={selected}
          startMonth={startDate}
          footer={footer}
        />
      </CardContent>
    </Card>
  )
}

/**
 * c-calendar-26 的原组合形态：触发按钮 + 年份视图日历弹层（受控）。
 * 仅作独立纯日期选择时使用；日期时间复合选择请用 date-time-picker。
 */
export function Calendar26({
  selected,
  onSelect,
  placeholder = "选择日期",
  disabled = false,
  align = "start",
  className,
  iconOnly = false,
  ariaLabel,
  clearable = false,
}: {
  selected?: Date | null
  onSelect?: (date: Date | undefined) => void
  placeholder?: string
  disabled?: boolean
  align?: "start" | "center" | "end"
  className?: string
  iconOnly?: boolean
  ariaLabel?: string
  clearable?: boolean
}) {
  const today = new Date()
  const [month, setMonth] = useState<Date>(selected ?? today)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (selected) {
      setMonth((current) => current?.getTime() === selected.getTime() ? current : selected)
    }
  }, [selected])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            className={cn(iconOnly ? "size-8" : "group/pick-date w-full justify-between", className)}
            variant="outline"
            size={iconOnly ? "icon" : "default"}
            disabled={disabled}
            aria-label={iconOnly ? (ariaLabel || placeholder) : undefined}
            title={iconOnly ? (ariaLabel || placeholder) : undefined}
          >
            {!iconOnly && <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected ? `${selected.getFullYear()}年${selected.getMonth() + 1}月${selected.getDate()}日` : placeholder}
            </span>}
            <IconPlaceholder
              lucide="CalendarIcon"
              tabler="IconCalendarEvent"
              hugeicons="Calendar04Icon"
              phosphor="CalendarBlankIcon"
              remixicon="RiCalendarLine"
              aria-hidden="true"
              className="text-muted-foreground/80 group-hover:text-foreground shrink-0 transition-colors"
            />
          </Button>
        }
      />
      <PopoverContent align={align} className="w-auto p-0">
        <CalendarYearView
          selected={selected ?? undefined}
          onSelect={(date) => {
            onSelect?.(date)
            if (date) setOpen(false)
          }}
          month={month}
          onMonthChange={setMonth}
        />
        {clearable && selected && (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => {
                onSelect?.(undefined)
                setOpen(false)
              }}
            >
              清除日期
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
