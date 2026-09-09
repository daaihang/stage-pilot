import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityTimeText as TimeText } from "@/components/time-text";
import { formatDuration, getItemEffectiveDurationSeconds, getItemEffectiveTitle, getSheetItems, programSheetItemKindLabels } from "@/lib/program-sheet-utils";

export function ProgramSheetPreview({ sheet, programById, segmentById, timingForItem }) {
  const [mode, setMode] = useState("execution");
  const items = useMemo(() => {
    const source = getSheetItems(sheet);
    return mode === "audience" ? source.filter((item) => item.audienceVisible !== false) : source;
  }, [mode, sheet]);

  return <Card variant="flush">
    <CardHeader className="gap-3 border-b">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>节目单预览</CardTitle>
          <CardDescription className="mt-1">{mode === "execution" ? "执行预览显示全部条目，并标记内部提示。" : "观众预览只显示面向观众的条目。"}</CardDescription>
        </div>
        <Tabs value={mode} onValueChange={setMode}>
          <TabsList variant="line" className="w-full justify-start sm:w-auto">
            <TabsTrigger value="execution">执行预览</TabsTrigger>
            <TabsTrigger value="audience">观众预览</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </CardHeader>
    <CardContent className="p-0">
      {items.length ? <div className="divide-y">
        {items.map((item, index) => {
          const program = programById.get(item.productionProgramId) || item.programSnapshot;
          const segmentType = segmentById.get(item.segmentTypeId) || item.segmentTypeSnapshot;
          const timing = timingForItem(item);
          const kindLabel = programSheetItemKindLabels[item.kind] || "条目";
          const internal = item.audienceVisible === false;
          return <div key={item.id} className="grid gap-2 px-4 py-4 sm:grid-cols-[2rem_minmax(0,1fr)_6rem_minmax(10rem,auto)] sm:items-center sm:gap-4">
            <span className="text-sm tabular-nums text-muted-foreground">{index + 1}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{kindLabel}</Badge>
                {item.kind === "segment" && segmentType ? <Badge variant="outline" className="max-w-full truncate" style={{ borderColor: segmentType.color, color: segmentType.color }}>{segmentType.name}</Badge> : null}
                {item.kind === "program" && program?.programTypeName ? <Badge variant="outline" className="max-w-full truncate">{program.programTypeName}</Badge> : null}
                {mode === "execution" && internal ? <Badge variant="outline">内部</Badge> : null}
                {mode === "execution" && item.requiresExecution ? <Badge variant="outline">需执行</Badge> : null}
              </div>
              <p className="mt-1 truncate text-sm font-medium" title={getItemEffectiveTitle(item)}>{getItemEffectiveTitle(item)}</p>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground sm:text-right">{formatDuration(getItemEffectiveDurationSeconds(item))}</span>
            <div className="text-xs text-muted-foreground sm:text-right">{timing ? <><TimeText instant={timing.start} timezone={timing.timezone} /><span className="mx-1">—</span><TimeText instant={timing.end} timezone={timing.timezone} /></> : "未关联场次"}</div>
          </div>;
        })}
      </div> : <div className="p-10 text-center text-sm text-muted-foreground">{mode === "audience" ? "没有可供观众查看的条目。" : "暂无可预览的节目单条目。"}</div>}
    </CardContent>
  </Card>;
}
