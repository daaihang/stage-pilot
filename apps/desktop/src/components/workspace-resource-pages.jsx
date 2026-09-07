import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, FileMusic, ListMusic, MapPin, Package, Plus, Trash2, UsersRound } from "@/components/ui/icons";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { ListSurface, ResourcePage, resourceGridClassName } from "@/components/resource-page";
import { ResourceFilters, getResourceFilterConditions } from "@/components/resource-filters";
import { useWindowDetail, useWindowDetailRegistration } from "@/components/window-detail-context";
import { appStore } from "@/lib/app-store";
import { createFilterQuery } from "@/components/reui/filters/filters-query";
import { createOrganizationContact, createResource, createVenueSpace, deleteOrganizationContact, deleteResource, getResource, listOrganizationContacts, listResource, listResourceTypes, listVenueSpaces, updateResource, resourceDefinitions } from "@/lib/resource-api";
import { ResourceTypeDefinition, ResourceTypeManagementPanel } from "@/components/resource-type-management-panel";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { resourcePath, resourceTypePanelPath, workspacePath } from "@/lib/navigation";
import { DetailFormLayout } from "@/components/detail-form-layout";
import { FormActionBar } from "@/components/form-action-bar";

const configs = {
  programs: { icon: FileMusic, primary: "name", kind: "program_type_id", label: "节目类型", defaults: [], fields: ["name", "program_type_id", "default_duration_seconds", "tags", "description", "technical_notes", "status"] },
  people: { icon: UsersRound, primary: "display_name", kind: "person_type_id", label: "人员类型", defaults: [], fields: ["display_name", "person_type_id", "primary_email", "primary_phone", "skills", "tags", "bio", "status"] },
  organizations: { icon: Building2, primary: "name", kind: "organization_type_id", label: "机构类型", defaults: [], fields: ["name", "organization_type_id", "city", "address", "tags", "description", "status"] },
  venues: { icon: MapPin, primary: "name", kind: "venue_type_id", label: "场地类型", defaults: [], fields: ["name", "venue_type_id", "city", "address", "timezone", "tags", "description", "status"] },
  equipment: { icon: Package, primary: "name", kind: "equipment_type_id", label: "设备类型", defaults: [], fields: ["name", "equipment_type_id", "quantity_total", "unit", "ownership", "storage_location", "tags", "technical_notes", "status"] },
};
const labels = { owned: "自有", rented: "租赁", active: "可用", maintenance: "维护中", archived: "已归档" };
const fieldLabels = { name: "名称", display_name: "姓名", program_type_id: "节目类型", person_type_id: "人员类型", organization_type_id: "机构类型", venue_type_id: "场地类型", equipment_type_id: "设备类型", default_duration_seconds: "默认时长（秒）", primary_email: "邮箱", primary_phone: "电话", skills: "技能（逗号分隔）", tags: "标签（逗号分隔）", bio: "简介", city: "城市", address: "地址", timezone: "时区", quantity_total: "库存数量", unit: "单位", ownership: "归属", storage_location: "存放位置", description: "说明", technical_notes: "技术备注", status: "状态" };
const canManage = (workspace) => ["owner", "admin"].includes(workspace?.role);
const textValue = (item, key) => Array.isArray(item[key]) ? item[key].join(", ") : item[key] ?? "";
const typeFields = new Set(Object.values(configs).map((config) => config.kind));
const apiValue = (key, value) => typeFields.has(key) ? value : ["tags", "skills"].includes(key) ? value.split(",").map((x) => x.trim()).filter(Boolean) : ["default_duration_seconds", "quantity_total"].includes(key) ? Number(value || 0) : value;
const statusField = { id: "status", label: "状态", type: "select", defaultOperator: "is_any_of", options: [{ value: "active", label: "可用" }, { value: "maintenance", label: "维护中" }, { value: "archived", label: "已归档" }] };
const filterFields = (type, types) => [{ id: type === "programs" ? "type_id" : configs[type].kind, label: configs[type].label, type: "select", defaultOperator: "is_any_of", options: types.map((x) => ({ value: x.id, label: `${x.name}${x.is_active ? "" : "（已停用）"}` })) }, statusField];
function filtersToParams(query) { const result = {}; for (const condition of getResourceFilterConditions(query)) { if (condition.operator === "is_any_of" && condition.values?.length) result[condition.field] = condition.values; } return result; }

function selectOptions(type, types) { return types.filter((x) => x.is_active).map((x) => [x.id, x.name]); }
function defaultTypeID(types) { return types.find((item) => item.system_key === "other" && item.is_active)?.id || types.find((item) => item.is_active)?.id || ""; }
function resourceTypeFor(type, item, types) { return types.find((entry) => entry.id === item[configs[type].kind]) || null; }
function subtitle(type, item, types) { const resourceType = resourceTypeFor(type, item, types); const kind = resourceType?.name || "其他"; if (type === "equipment") return `${kind} · ${item.quantity_total} ${item.unit} · ${labels[item.ownership]}`; if (type === "people") return `${kind} · ${item.primary_email || item.primary_phone || "联系方式待补充"}`; return `${kind} · ${item.city || (item.default_duration_seconds ? `${Math.round(item.default_duration_seconds / 60)} 分钟` : "资料待补充")}`; }

function CreateResourceDialog({ workspace, type, open, onOpenChange, resourceTypes, onCreated }) {
  const cfg = configs[type];
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState("");
  const [busy, setBusy] = useState(false);
  const options = selectOptions(type, resourceTypes);

  useEffect(() => {
    if (!open) return;
    setName("");
    setTypeId(defaultTypeID(resourceTypes));
  }, [open, type]);

  useEffect(() => {
    if (open && (!typeId || !resourceTypes.some((item) => item.id === typeId && item.is_active))) setTypeId(defaultTypeID(resourceTypes));
  }, [open, resourceTypes, typeId]);

  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return notify.error(`请输入${resourceDefinitions[type].singular}名称`);
    if (!typeId) return notify.error(`请先启用至少一个${cfg.label}`);
    const body = type === "equipment"
      ? { name: name.trim(), equipment_type_id: typeId, quantity_total: 1, ownership: "owned" }
      : { [cfg.primary]: name.trim(), [cfg.kind]: typeId };
    setBusy(true);
    const toast = notify.loading(`正在创建${resourceDefinitions[type].singular}…`);
    try {
      const item = await createResource(workspace.id, type, body);
      notify.success(`已创建${resourceDefinitions[type].singular}`, { id: toast });
      onOpenChange(false);
      onCreated(item);
    } catch (error) {
      notify.error(`创建${resourceDefinitions[type].singular}失败`, { id: toast, description: error?.message || String(error) });
    } finally {
      setBusy(false);
    }
  };

  return <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}><DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-md flex-col"><DialogHeader><DialogTitle>新建{resourceDefinitions[type].singular}</DialogTitle><DialogDescription>创建后进入详情页，可继续完善资料。</DialogDescription></DialogHeader><DetailFormLayout className="min-h-0 flex-1" scrollBoundary="self" onSubmit={submit} busy={busy} contentClassName="space-y-4 pr-1" actions={<FormActionBar onCancel={() => onOpenChange(false)} busy={busy} disabled={busy || !typeId} submitLabel="创建" busyLabel="创建中…" />}><label className="block space-y-1"><span className="text-sm font-medium">名称</span><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label><div className="space-y-1"><span className="text-sm font-medium">{cfg.label}</span><Select items={options.map(([value, label]) => ({ value, label }))} value={typeId} onValueChange={setTypeId}><SelectTrigger className="h-9 w-full"><SelectValue placeholder={options.length ? `选择${cfg.label}` : `请先启用${cfg.label}`} /></SelectTrigger><SelectContent>{options.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>{options.length === 0 && <p className="text-xs text-destructive">没有启用的{cfg.label}，请先在类型管理中启用一个类型。</p>}</div></DetailFormLayout></DialogContent></Dialog>;
}

export function WorkspaceResourcePage({ workspace, resourceType, selectedResourceId, panel }) {
  const type = resourceType;
  const cfg = configs[type];
  const navigate = useNavigate();
  const [view, setView] = useState("list");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(() => createFilterQuery());
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState([]);
  const requestSequence = useRef(0);
  const triggerRefs = useRef(new Map());
  const typePanelTriggerRef = useRef(null);
  const reloadRef = useRef(null);
  const { setDetailOpen } = useWindowDetail();
  const typePanelOpen = panel === "types";
  const activeTriggerRef = useRef(null);

  useEffect(() => {
    const triggerRef = typePanelOpen ? typePanelTriggerRef : triggerRefs.current.get(selectedResourceId);
    activeTriggerRef.current = triggerRef?.current || null;
  }, [selectedResourceId, typePanelOpen]);
  const getDetail = useCallback(() => typePanelOpen
    ? <ResourceTypeManagementPanel workspace={workspace} resourceType={type} onChanged={() => reloadRef.current?.().catch(() => {})} />
    : selectedResourceId
      ? <ResourceDetailPanel workspace={workspace} resourceType={type} resourceId={selectedResourceId} onClose={() => navigate(workspacePath(workspace.id, type))} onUpdated={() => reloadRef.current?.().catch(() => {})} onDeleted={async () => { await reloadRef.current?.().catch(() => {}); navigate(workspacePath(workspace.id, type)); }} />
      : null, [navigate, selectedResourceId, type, typePanelOpen, workspace]);
  useWindowDetailRegistration({ key: `workspace-resource:${workspace.id}:${type}`, detailLabel: `${resourceDefinitions[type].singular}详情`, getDetail, triggerRef: activeTriggerRef, storageKey: "detailPane:workspace-resources:v1", onClose: () => navigate(workspacePath(workspace.id, type)) });
  useEffect(() => {
    if (selectedResourceId || typePanelOpen) setDetailOpen(true, { announce: false });
    else setDetailOpen(false, { announce: false });
  }, [selectedResourceId, setDetailOpen, typePanelOpen]);

  const reload = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    try {
      const result = await listResource(workspace.id, type, { q: search, ...filtersToParams(query) });
      if (requestId !== requestSequence.current) return result;
      setItems(result.items);
      setTotal(result.total);
      setError(null);
      return result;
    } catch (nextError) {
      if (requestId !== requestSequence.current) throw nextError;
      setError(nextError);
      throw nextError;
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [query, search, type, workspace.id]);
  reloadRef.current = reload;

  useEffect(() => {
    setSearch("");
    setQuery(createFilterQuery());
    setItems([]);
    setTotal(0);
    setTypes([]);
    setError(null);
    setLoading(true);
    requestSequence.current += 1;
    let active = true;
    appStore.get(`resourceView:${workspace.id}:${type}`).then((storedView) => {
      if (active && ["list", "grid"].includes(storedView)) setView(storedView);
    }).catch(() => {});
    return () => { active = false; };
  }, [type, workspace.id]);

  useEffect(() => {
    const timer = setTimeout(() => reload().catch(() => {}), 200);
    return () => {
      clearTimeout(timer);
      requestSequence.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    if (!ResourceTypeDefinition[type]) return undefined;
    let active = true;
    listResourceTypes(workspace.id, type).then((result) => {
      if (active) setTypes(result.items);
    }).catch((nextError) => {
      if (active) notify.error(`无法加载${configs[type].label}`, { description: nextError?.message || String(nextError) });
    });
    return () => { active = false; };
  }, [type, workspace.id]);

  const retry = async () => {
    const toast = notify.loading("正在刷新资源…");
    try {
      await reload();
      notify.success("资源已刷新", { id: toast });
    } catch (nextError) {
      notify.error("刷新资源失败", { id: toast, description: nextError?.message || String(nextError) });
    }
  };
  const empty = error
    ? { icon: cfg.icon, title: "无法加载资源", description: error.message, action: <Button variant="outline" onClick={retry}>重试</Button> }
    : total === 0
      ? { icon: cfg.icon, title: `还没有${resourceDefinitions[type].singular}`, description: "创建第一条资源，供后续活动持续复用。", action: canManage(workspace) ? <Button onClick={() => setOpen(true)}>新建{resourceDefinitions[type].singular}</Button> : null }
      : null;
  const openResource = (item) => navigate(resourcePath(workspace.id, type, item.id));
  const Item = ({ item }) => {
    const Icon = cfg.icon;
    const selected = selectedResourceId === item.id;
    const itemRef = (node) => {
      const ref = triggerRefs.current.get(item.id) || { current: null };
      ref.current = node;
      triggerRefs.current.set(item.id, ref);
    };
    return view === "grid"
      ? <button ref={itemRef} type="button" className={`text-left ${selected ? "ring-2 ring-primary" : ""}`} onClick={() => openResource(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openResource(item); } }} aria-current={selected ? "page" : undefined}><Card className="cursor-pointer hover:bg-muted/40"><CardHeader><div className="flex justify-between"><div className="flex size-10 items-center justify-center bg-primary/10 text-primary"><Icon className="size-5" /></div><Badge variant={item.status === "active" ? "default" : "secondary"}>{labels[item.status]}</Badge></div><CardTitle className="truncate text-base">{item[cfg.primary]}</CardTitle><CardDescription className="truncate">{resourceTypeFor(type, item, types) && <span className="mr-1 inline-flex size-2 rounded-full" style={{ backgroundColor: resourceTypeFor(type, item, types).color }} aria-label={`${cfg.label}颜色`} />}{subtitle(type, item, types)}</CardDescription></CardHeader><CardContent>{item.tags?.slice(0, 3).map((tag) => <Badge key={tag} variant="outline" className="mr-1">{tag}</Badge>)}</CardContent></Card></button>
      : <button ref={itemRef} type="button" className={`flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-b-0 hover:bg-muted/40 ${selected ? "bg-muted/60" : ""}`} onClick={() => openResource(item)} aria-current={selected ? "page" : undefined}><div className="flex size-9 items-center justify-center bg-primary/10 text-primary"><Icon className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item[cfg.primary]}</p><p className="mt-1 flex items-center truncate text-xs text-muted-foreground">{resourceTypeFor(type, item, types) && <span className="mr-1 inline-flex size-2 shrink-0 rounded-full" style={{ backgroundColor: resourceTypeFor(type, item, types).color }} aria-label={`${cfg.label}颜色`} />}{subtitle(type, item, types)}</p></div><Badge variant={item.status === "active" ? "default" : "secondary"}>{labels[item.status]}</Badge></button>;
  };
  const TypeIcon = ResourceTypeDefinition[type]?.icon;
  const headerActions = TypeIcon ? <Button ref={typePanelTriggerRef} variant="outline" onClick={() => navigate(resourceTypePanelPath(workspace.id, type))}><TypeIcon />管理{configs[type].label}</Button> : null;

  return <>
    <ResourcePage title={resourceDefinitions[type].title} description={resourceDefinitions[type].description} count={total} search={{ value: search, onChange: setSearch }} filters={<ResourceFilters fields={filterFields(type, types)} value={query} onChange={setQuery} onClear={() => setQuery(createFilterQuery())} />} view={view} onViewChange={(next) => { setView(next); appStore.set(`resourceView:${workspace.id}:${type}`, next).catch(() => {}); }} headerActions={headerActions} onCreate={canManage(workspace) ? () => setOpen(true) : undefined} loading={loading} empty={empty}>
      {view === "grid" ? <div className={resourceGridClassName}>{items.map((item) => <Item key={item.id} item={item} />)}</div> : <ListSurface>{items.map((item) => <Item key={item.id} item={item} />)}</ListSurface>}
    </ResourcePage>
    <CreateResourceDialog workspace={workspace} type={type} open={open} onOpenChange={setOpen} resourceTypes={types} onCreated={async (item) => { await reload().catch(() => {}); navigate(resourcePath(workspace.id, type, item.id)); }} />
  </>;
}

function ResourceRelations({ workspace, type, resourceId }) {
  const [items, setItems] = useState([]);
  const [people, setPeople] = useState([]);
  const [name, setName] = useState("");
  const [personID, setPersonID] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [removing, setRemoving] = useState(false);
  const editable = canManage(workspace);

  const load = async () => {
    try {
      setItems(type === "venues"
        ? await listVenueSpaces(workspace.id, resourceId)
        : await listOrganizationContacts(workspace.id, resourceId));
      if (type === "organizations") {
        setPeople((await listResource(workspace.id, "people", { limit: 100 })).items);
      }
    } catch (error) {
      notify.error("无法加载关联资料", { description: error?.message || String(error) });
    }
  };

  useEffect(() => { load(); }, [workspace.id, type, resourceId]);

  const create = async (event) => {
    event.preventDefault();
    const toast = notify.loading("正在添加…");
    try {
      if (type === "venues") {
        await createVenueSpace(workspace.id, resourceId, { name, capacity: null });
      } else {
        await createOrganizationContact(workspace.id, resourceId, { person_id: personID });
      }
      await load();
      setName("");
      setPersonID("");
      notify.success("已添加", { id: toast });
    } catch (error) {
      notify.error("添加失败", { id: toast, description: error?.message || String(error) });
    }
  };

  const remove = async () => {
    if (!pendingRemoval) return;
    const id = pendingRemoval.id;
    setRemoving(true);
    const toast = notify.loading("正在移除…");
    try {
      if (type === "venues") {
        await deleteVenueSpace(workspace.id, resourceId, id);
      } else {
        await deleteOrganizationContact(workspace.id, resourceId, id);
      }
      await load();
      notify.success("已移除", { id: toast });
      setPendingRemoval(null);
    } catch (error) {
      notify.error("移除失败", { id: toast, description: error?.message || String(error) });
    } finally {
      setRemoving(false);
    }
  };

  const title = type === "venues" ? "场地空间" : "机构联系人";
  const personOptions = people.map((person) => ({ value: person.id, label: person.display_name }));

  return <Card>
    <CardHeader>
      <CardTitle className="text-base">{title}</CardTitle>
      <CardDescription>{type === "venues" ? "容量和技术条件属于具体空间。" : "联系人是业务通讯录人员，不是登录账号。"}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {items.map((item) => <div key={item.id} className="flex items-center justify-between border-b py-2 text-sm">
        <span>{type === "venues"
          ? `${item.name}${item.capacity != null ? ` · ${item.capacity} 人` : ""}`
          : `${item.person_name}${item.title ? ` · ${item.title}` : ""}`}</span>
        {editable && <Button variant="ghost" size="sm" onClick={() => setPendingRemoval({
          id: item.id,
          name: type === "venues"
            ? item.name
            : `${item.person_name}${item.title ? ` · ${item.title}` : ""}`,
        })}>移除</Button>}
      </div>)}
      {editable && <form className="flex gap-2" onSubmit={create}>
        {type === "venues"
          ? <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="新增空间名称" />
          : <Combobox
            items={personOptions}
            value={personOptions.find((person) => person.value === personID) || null}
            onValueChange={(person) => setPersonID(person?.value || "")}
            itemToStringValue={(person) => person?.value || ""}
            itemToStringLabel={(person) => person?.label || ""}
          >
            <ComboboxInput className="min-w-0 flex-1" placeholder="选择人员" />
            <ComboboxContent>
              <ComboboxEmpty>没有匹配的人员</ComboboxEmpty>
              <ComboboxList>{personOptions.map((person) => <ComboboxItem key={person.value} value={person}>{person.label}</ComboboxItem>)}</ComboboxList>
            </ComboboxContent>
          </Combobox>}
        <Button type="submit" disabled={type === "venues" ? !name.trim() : !personID}><Plus />添加</Button>
      </form>}
    </CardContent>
    <ConfirmDeleteDialog
      open={Boolean(pendingRemoval)}
      onOpenChange={(nextOpen) => { if (!nextOpen && !removing) setPendingRemoval(null); }}
      resourceType={type === "venues" ? "场地空间" : "机构联系人"}
      resourceName={pendingRemoval?.name}
      resourceCollectionLabel={type === "venues" ? "场地空间列表" : "机构联系人列表"}
      busy={removing}
      onConfirm={remove}
    />
  </Card>;
}

const detailSelectOptions = (key, cfg, types) => typeFields.has(key)
  ? types.map((x) => [x.id, `${x.name}${x.is_active ? "" : "（已停用）"}`])
  : key === "status"
    ? [["active", "可用"], ["maintenance", "维护中"], ["archived", "已归档"]]
    : key === "ownership"
      ? [["owned", "自有"], ["rented", "租赁"]]
      : cfg.defaults;

export function ResourceDetailPanel({ workspace, resourceType, resourceId, onClose, onUpdated, onDeleted }) {
  const type = resourceType;
  const cfg = configs[type];
  const [item, setItem] = useState(null);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setItem(null);
    setError(null);
    getResource(workspace.id, type, resourceId)
      .then((result) => { if (active) setItem(result); })
      .catch((error) => {
        if (active) {
          setError(error);
          notify.error(`无法加载${resourceDefinitions[type].singular}`, { description: error?.message || String(error) });
        }
      })
      .finally(() => { if (active) setLoading(false); });
    if (!ResourceTypeDefinition[type]) return () => { active = false; };
    listResourceTypes(workspace.id, type)
      .then((result) => { if (active) setTypes(result.items); })
      .catch((error) => {
        if (active) notify.error(`无法加载${cfg.label}`, { description: error?.message || String(error) });
      });
    return () => { active = false; };
  }, [workspace.id, type, resourceId]);

  useEffect(() => load(), [load]);

  const save = async (key, value) => {
    const toast = notify.loading("正在保存…");
    try {
      setItem(await updateResource(workspace.id, type, resourceId, { [key]: apiValue(key, value) }));
      onUpdated?.();
      notify.success("已保存", { id: toast });
    } catch (error) {
      notify.error("保存失败", { id: toast, description: error?.message || String(error) });
    }
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    const toast = notify.loading(`正在删除${resourceDefinitions[type].singular}…`);
    try {
      await deleteResource(workspace.id, type, resourceId);
      notify.success("已删除", { id: toast });
      setDeleteOpen(false);
      onDeleted?.();
    } catch (error) {
      notify.error("删除失败", { id: toast, description: error?.message || String(error) });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="min-h-full text-sm text-muted-foreground">正在加载资源…</div>;
  if (error || !item) return <div className="space-y-3"><p className="text-sm text-destructive">无法加载{resourceDefinitions[type].singular}</p><div className="flex gap-2"><Button variant="outline" onClick={load}>重试</Button><Button variant="ghost" onClick={onClose}>返回资源库</Button></div></div>;

  return <>
    <div className="@container/resource-detail min-h-full min-w-0 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{resourceDefinitions[type].title}</p>
          <h1 className="mt-1 text-xl font-semibold">{item[cfg.primary]}</h1>
          <p className="text-sm text-muted-foreground">修改字段后在离开输入框时自动保存。</p>
        </div>
        {canManage(workspace) && <Button variant="destructive" size="sm" disabled={deleting} onClick={() => setDeleteOpen(true)}><Trash2 />删除</Button>}
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">基本资料</h2>
        <div className="grid gap-4 @min-[36rem]/resource-detail:grid-cols-2">
          {cfg.fields.map((key) => <label key={key} className={["description", "bio", "technical_notes"].includes(key) ? "space-y-1 @min-[36rem]/resource-detail:col-span-2" : "space-y-1"}>
            <span className="text-sm font-medium">{fieldLabels[key]}</span>
            {["ownership", "status", ...typeFields].includes(key)
              ? <Select
                items={detailSelectOptions(key, cfg, types).map(([value, label]) => ({ value, label }))}
                value={typeFields.has(key) ? (item[key] || defaultTypeID(types)) : (item[key] || "")}
                disabled={!canManage(workspace)}
                onValueChange={(value) => save(key, value)}
              >
                <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{detailSelectOptions(key, cfg, types).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
              : ["description", "bio", "technical_notes"].includes(key)
                ? <textarea className="min-h-24 w-full border bg-background p-2 text-sm" defaultValue={textValue(item, key)} disabled={!canManage(workspace)} onBlur={(event) => event.target.value !== textValue(item, key) && save(key, event.target.value)} />
                : <Input type={["default_duration_seconds", "quantity_total"].includes(key) ? "number" : "text"} defaultValue={textValue(item, key)} disabled={!canManage(workspace)} onBlur={(event) => event.target.value !== textValue(item, key) && save(key, event.target.value)} />}
          </label>)}
        </div>
      </section>
      {["venues", "organizations"].includes(type) && <ResourceRelations workspace={workspace} type={type} resourceId={resourceId} />}
    </div>
    <ConfirmDeleteDialog
      open={deleteOpen}
      onOpenChange={setDeleteOpen}
      resourceType={resourceDefinitions[type].singular}
      resourceName={item[cfg.primary]}
      resourceCollectionLabel="资源库"
      busy={deleting}
      onConfirm={remove}
    />
  </>;
}
