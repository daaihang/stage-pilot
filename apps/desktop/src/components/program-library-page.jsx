import { useEffect, useMemo, useState } from "react";
import { Clock3, FileMusic, MoreHorizontal, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResourcePage } from "@/components/resource-page";
import { ResourceFilters, getResourceFilterConditions } from "@/components/resource-filters";
import { appStore } from "@/lib/app-store";
import { notify } from "@/components/ui/sonner";
import { programFixtures, programStatuses, programStatusLabel, programTypes, programTypeLabel } from "@/lib/program-fixtures";
import { createFilterQuery } from "@/components/reui/filters/filters-query";

const VIEW_KEY = (workspaceId) => `resourceView:${workspaceId}:programs`;
const typeOptions = programTypes;
const statusOptions = programStatuses;
const tagOptions = [{ value: "开场", label: "开场" }, { value: "原创", label: "原创" }, { value: "群舞", label: "群舞" }, { value: "现场", label: "现场" }, { value: "亲子", label: "亲子" }];
const filterFields = [
  { id: "type", label: "节目类型", type: "select", defaultOperator: "is_any_of", options: typeOptions, searchable: false },
  { id: "status", label: "状态", type: "select", defaultOperator: "is_any_of", options: statusOptions, searchable: false },
  { id: "tags", label: "标签", type: "multiselect", defaultOperator: "has_any_of", options: tagOptions },
  { id: "durationMinutes", label: "时长（分钟）", type: "number", defaultOperator: "between", placeholder: "分钟" },
];

function matches(program, query, search) {
  const haystack = [program.name, program.performers, program.organization, ...program.tags].join(" ").toLowerCase();
  if (search && !haystack.includes(search.trim().toLowerCase())) return false;
  return getResourceFilterConditions(query).every(({ field, operator, values }) => {
    if (field === "type" || field === "status") return operator === "is_any_of" ? values.includes(program[field]) : !values.includes(program[field]);
    if (field === "tags") return operator === "has_any_of" ? values.some((value) => program.tags.includes(value)) : values.every((value) => !program.tags.includes(value));
    if (field === "durationMinutes") { const [from, to] = values.map(Number); return operator === "between" ? program.durationMinutes >= from && program.durationMinutes <= to : operator === "gte" ? program.durationMinutes >= from : program.durationMinutes <= from; }
    return true;
  });
}

function statusBadge(status) { return <Badge variant={status === "ready" ? "default" : status === "draft" ? "secondary" : "outline"}>{programStatusLabel[status]}</Badge>; }
function ProgramActions() { return <Button variant="ghost" size="icon-sm" aria-label="节目操作" onClick={(event) => { event.stopPropagation(); notify.message("节目数据服务尚未接入", { description: "编辑和删除功能将在资源 API 接入后开放。" }); }}><MoreHorizontal /></Button>; }

function ProgramRow({ program }) { return <div className="flex items-center gap-3 border-b px-3 py-3 last:border-b-0"><div className="flex size-9 shrink-0 items-center justify-center bg-primary/10 text-primary"><FileMusic className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{program.name}</p><p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{programTypeLabel[program.type]}</span><span className="flex items-center gap-1"><UsersRound className="size-3" />{program.performers}</span><span className="flex items-center gap-1"><Clock3 className="size-3" />{program.durationMinutes} 分钟</span></p></div><div className="hidden items-center gap-2 md:flex">{program.tags.slice(0, 2).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}{statusBadge(program.status)}</div><ProgramActions /></div>; }
function ProgramCard({ program }) { return <Card className="h-full"><CardHeader><div className="flex items-start justify-between gap-3"><div className="flex size-10 items-center justify-center bg-primary/10 text-primary"><FileMusic className="size-5" /></div><ProgramActions /></div><CardTitle className="text-base">{program.name}</CardTitle><CardDescription>{programTypeLabel[program.type]} · {program.organization}</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex items-center justify-between text-xs text-muted-foreground"><span className="flex items-center gap-1"><Clock3 className="size-3" />{program.durationMinutes} 分钟</span>{statusBadge(program.status)}</div><div className="flex flex-wrap gap-1">{program.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div><p className="truncate text-xs text-muted-foreground">演出：{program.performers}</p></CardContent></Card>; }

export function ProgramLibraryPage({ workspace }) {
  const [view, setView] = useState("list");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(() => createFilterQuery());
  useEffect(() => { let active = true; appStore.get(VIEW_KEY(workspace.id)).then((saved) => { if (active && (saved === "list" || saved === "grid")) setView(saved); }).catch(() => {}); return () => { active = false; }; }, [workspace.id]);
  const changeView = (next) => { setView(next); appStore.set(VIEW_KEY(workspace.id), next).catch(() => {}); };
  const programs = useMemo(() => programFixtures.filter((program) => matches(program, query, search)), [query, search]);
  const empty = !programFixtures.length ? { icon: FileMusic, title: "还没有节目", description: "节目库将沉淀可在不同活动中复用的节目资产。", action: <Button onClick={() => notify.message("节目数据服务尚未接入")}>新建节目</Button> } : programs.length === 0 ? { icon: FileMusic, title: "没有符合条件的节目", description: "尝试调整搜索关键词或清除筛选。", action: <Button variant="outline" onClick={() => { setSearch(""); setQuery(createFilterQuery()); }}>清除筛选</Button> } : null;
  return <ResourcePage title="节目库" description="沉淀可在不同活动中复用的长期节目资产。" count={programs.length} search={{ value: search, onChange: setSearch }} filters={<ResourceFilters fields={filterFields} value={query} onChange={setQuery} onClear={() => setQuery(createFilterQuery())} />} view={view} onViewChange={changeView} onCreate={() => notify.message("节目数据服务尚未接入", { description: "新建节目将在资源 API 接入后开放。" })} empty={empty}>{view === "list" ? <Card><CardContent className="p-0">{programs.map((program) => <ProgramRow key={program.id} program={program} />)}</CardContent></Card> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{programs.map((program) => <ProgramCard key={program.id} program={program} />)}</div>}</ResourcePage>;
}
