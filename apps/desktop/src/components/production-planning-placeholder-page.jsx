import { CalendarRange, ClipboardList, ListTree } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageBreadcrumbs } from "@/components/stagepilot-pages";
import { ProductionPageHeader } from "@/components/production-page-shell";

const planningPageContent = {
  schedule: {
    icon: CalendarRange,
    title: "暂无排程安排",
    description: "后续可以在这里管理装台、彩排、演出和撤台等时间。",
  },
  occurrences: {
    icon: ListTree,
    title: "暂无场次安排",
    description: "场次数据接入后，正式演出、预演和加演场会显示在这里。",
  },
  rehearsals: {
    icon: ClipboardList,
    title: "暂无彩排安排",
    description: "彩排、技术彩排和带妆彩排接入后，会显示在这里。",
  },
};

export function ProductionPlanningPlaceholderPage({ route, workspace, production }) {
  const content = planningPageContent[route.page] || planningPageContent.schedule;
  const Icon = content.icon;
  return <div className="space-y-6">
    <PageBreadcrumbs route={route} workspace={workspace} production={production} />
    <ProductionPageHeader workspace={workspace} production={production} title={route.meta.title} subtitle={route.meta.description} />
    <Card className="border-dashed">
      <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 text-center">
        <Icon className="size-8 text-muted-foreground" />
        <div>
          <p className="font-medium">{content.title}</p>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">{content.description}</p>
        </div>
        <Badge variant="outline">等待后端接入</Badge>
      </CardContent>
    </Card>
  </div>;
}
