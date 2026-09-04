import { WorkspaceResourcePage } from "@/components/workspace-resource-pages";

// 保留节目库专用导出名，页面内部使用真实共享资源库实现。
export function ProgramLibraryPage({ workspace, selectedResourceId, panel }) {
  return <WorkspaceResourcePage workspace={workspace} resourceType="programs" selectedResourceId={selectedResourceId} panel={panel} />;
}
