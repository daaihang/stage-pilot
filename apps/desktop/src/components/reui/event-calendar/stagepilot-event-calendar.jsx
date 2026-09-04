import { EventCalendar } from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import { EventCalendarNav, EventCalendarToolbar } from "@/components/reui/event-calendar/event-calendar-nav";
import { Card, CardContent } from "@/components/ui/card";
import { zhCN } from "date-fns/locale";

const zhI18n = {
  labels: {
    today: "今天", previous: "上一个", next: "下一个", allDay: "全天",
    more: (count) => `+${count} 项`, noEvents: "暂无安排", loading: "正在加载安排",
    selectView: "选择视图", resources: "资源", goToDate: "前往日期",
    viewShortcuts: { month: "月", week: "周", day: "日", days: "多日", agenda: "列表", resource: "资源" },
  },
  viewNames: { month: "月", week: "周", day: "日", days: (count) => `${count}日`, agenda: "议程", resource: "资源" },
};

export function StagePilotEventCalendar({
  className = "",
  defaultView = "month",
  views,
  resources = [],
  events,
  defaultEvents = [],
  interactions,
  ...calendarProps
}) {
  return <Card className={`w-full py-0 ${className}`}>
    <CardContent className="p-0">
      <EventCalendar events={events} defaultEvents={defaultEvents} defaultView={defaultView} views={views} resources={resources} locale={zhCN} i18n={zhI18n} interactions={{ drag: false, resize: false, selectSlot: false, ...interactions }} className="h-[560px] w-full" {...calendarProps}>
        <div className="flex flex-wrap items-center gap-2 border-b pe-2">
          <EventCalendarNav className="min-w-0 flex-1" />
          <EventCalendarToolbar />
        </div>
        <EventCalendarContent />
      </EventCalendar>
    </CardContent>
  </Card>;
}
