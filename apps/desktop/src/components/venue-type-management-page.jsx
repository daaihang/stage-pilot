import { useEffect, useState } from "react";
import { ListMusic, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/sonner";
import { ResourcePage } from "@/components/resource-page";
import { createVenueType, deleteVenueType, listVenueTypes, updateVenueType } from "@/lib/resource-api";

export function VenueTypeManagementPage({ workspace }) {
  const [items,setItems]=useState([]); const [search,setSearch]=useState(""); const [open,setOpen]=useState(false); const [name,setName]=useState(""); const [color,setColor]=useState("#64748b"); const [busy,setBusy]=useState(false);
  const load=()=>listVenueTypes(workspace.id,{q:search}).then((r)=>setItems(r.items)).catch((e)=>notify.error("无法加载场地类型",{description:e.message}));
  useEffect(()=>{load()},[workspace.id,search]);
  const submit=async(e)=>{e.preventDefault();setBusy(true);const t=notify.loading("正在创建场地类型…");try{await createVenueType(workspace.id,{name,color});notify.success("场地类型已创建",{id:t});setOpen(false);setName("");await load()}catch(err){notify.error("创建场地类型失败",{id:t,description:err.message})}finally{setBusy(false)}};
  const toggle=async(item)=>{const t=notify.loading("正在更新…");try{await updateVenueType(workspace.id,item.id,{is_active:!item.is_active});notify.success("已更新",{id:t});await load()}catch(e){notify.error("更新失败",{id:t,description:e.message})}};
  const remove=async(item)=>{const t=notify.loading("正在删除…");try{await deleteVenueType(workspace.id,item.id);notify.success("已删除",{id:t});await load()}catch(e){notify.error("删除失败",{id:t,description:e.message})}};
  return <><ResourcePage title="场地类型" description="管理工作空间中的场地分类。系统默认类型可停用但不能删除。" count={items.length} search={{value:search,onChange:setSearch}} onCreate={workspace.role !== "member" ? ()=>setOpen(true):undefined} loading={false} empty={items.length?null:{icon:ListMusic,title:"暂无场地类型",action:workspace.role !== "member"?<Button onClick={()=>setOpen(true)}><Plus/>新建类型</Button>:null}}><Card><CardHeader><CardTitle>场地类型</CardTitle></CardHeader><CardContent className="space-y-1">{items.map(item=><div key={item.id} className="flex items-center gap-3 border-b py-3"><span className="size-3 rounded-full" style={{backgroundColor:item.color}}/><span className="flex-1">{item.name}</span>{item.is_system_default&&<Badge variant="outline">系统默认</Badge>}<Badge variant={item.is_active?"default":"secondary"}>{item.is_active?"启用":"停用"}</Badge>{workspace.role !== "member"&&<><Button size="sm" variant="outline" onClick={()=>toggle(item)}>{item.is_active?"停用":"启用"}</Button>{!item.is_system_default&&<Button size="icon" variant="ghost" onClick={()=>remove(item)}><Trash2/></Button>}</>}</div>)}</CardContent></Card></ResourcePage><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>新建场地类型</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={submit}><Input placeholder="类型名称" value={name} onChange={e=>setName(e.target.value)}/><Input type="color" value={color} onChange={e=>setColor(e.target.value)}/><Button disabled={busy||!name.trim()} type="submit">{busy?"创建中…":"创建"}</Button></form></DialogContent></Dialog></>;
}
