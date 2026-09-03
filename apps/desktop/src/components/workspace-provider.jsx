import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { navigationRepository } from "@/lib/navigation-repository";
import { getLastWorkspace, listWorkspaceMembers, setLastWorkspace } from "@/lib/workspace-api";

/**
 * Workspace Context：登录后的 Current Workspace Context 生命周期。
 *
 * 登录 → 获取 User → 获取可访问 Workspace 列表 → 恢复上次 Workspace 或选择
 * → 进入 Workspace Context。currentWorkspace 不绑定在 User 上，切换时通过
 * switchWorkspace 重新校验 membership 并同步服务端 last_workspace_id。
 *
 * status:
 * - "loading"      正在加载工作空间列表
 * - "none"         用户没有任何工作空间（进入 onboarding）
 * - "selecting"    有多个工作空间且没有可恢复的最近记录（进入 selector）
 * - "ready"        已进入某个工作空间上下文
 * - "error"        加载失败（可 retry）
 */

const WorkspaceContext = createContext(null);

const LAST_WORKSPACE_CACHE_KEY = "stagepilot:lastWorkspaceId";

function readCachedLastWorkspace() {
  try {
    return window.localStorage.getItem(LAST_WORKSPACE_CACHE_KEY) || "";
  } catch {
    return "";
  }
}

function cacheLastWorkspace(workspaceId) {
  try {
    if (workspaceId) window.localStorage.setItem(LAST_WORKSPACE_CACHE_KEY, workspaceId);
    else window.localStorage.removeItem(LAST_WORKSPACE_CACHE_KEY);
  } catch {
    // localStorage 不可用时仅失去缓存能力，服务端仍是事实来源。
  }
}

export function WorkspaceProvider({ children, repository = navigationRepository }) {
  const [status, setStatus] = useState("loading");
  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspace, setCurrentWorkspace] = useState(null);
  const [membershipRole, setMembershipRole] = useState("");
  const [error, setError] = useState(null);

  const loadWorkspaces = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const list = await repository.listWorkspaces();
      setWorkspaces(list);
      if (!list.length) {
        setCurrentWorkspace(null);
        setMembershipRole("");
        cacheLastWorkspace("");
        setStatus("none");
        return;
      }
      // 恢复顺序：服务端 last_workspace_id → 本地缓存（仍需在服务端列表内）
      // → 唯一工作空间 → 进入 selector。
      let restored = null;
      try {
        const { workspace_id: lastId } = await getLastWorkspace();
        restored = list.find((item) => item.id === lastId) || null;
      } catch {
        restored = null;
      }
      if (!restored) {
        const cached = readCachedLastWorkspace();
        restored = cached ? list.find((item) => item.id === cached) || null : null;
      }
      if (!restored && list.length === 1) restored = list[0];
      if (restored) {
        setCurrentWorkspace(restored);
        setMembershipRole(restored.plan || "");
        cacheLastWorkspace(restored.id);
        setStatus("ready");
        return;
      }
      setStatus("selecting");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError : new Error(String(nextError)));
      setStatus("error");
    }
  }, [repository]);

  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

  const switchWorkspace = useCallback(async (workspaceId) => {
    // 仅允许切换到列表内的工作空间；列表本身已按 membership 过滤。
    const target = workspaces.find((item) => item.id === workspaceId);
    if (!target || target.id === currentWorkspace?.id) return;
    // 切换失败时保持原上下文，不清空当前状态。
    try {
      await setLastWorkspace(workspaceId);
    } catch {
      // 服务端记录失败不阻塞本地切换；下次恢复会重新走列表校验。
    }
    setCurrentWorkspace(target);
    setMembershipRole(target.plan || "");
    cacheLastWorkspace(workspaceId);
    setStatus("ready");
  }, [workspaces, currentWorkspace]);

  const clearWorkspaceCache = useCallback(() => {
    cacheLastWorkspace("");
  }, []);

  /** 创建工作空间后刷新列表并直接进入；创建者已在服务端成为 OWNER。 */
  const loadWorkspacesNow = useCallback(async () => {
    const list = await repository.listWorkspaces();
    setWorkspaces(list);
    return list;
  }, [repository]);

  const adoptCreatedWorkspace = useCallback(async (created) => {
    const summary = created.plan
      ? created
      : { id: created.id, name: created.name, slug: created.slug, plan: "OWNER", logo: ([...created.name][0]) || "W" };
    const list = await loadWorkspacesNow();
    const known = list.find((item) => item.id === summary.id);
    const adopted = known || summary;
    setCurrentWorkspace(adopted);
    setMembershipRole(adopted.plan || "OWNER");
    cacheLastWorkspace(adopted.id);
    setStatus("ready");
  }, [loadWorkspacesNow]);

  const value = useMemo(() => ({
    repository,
    status,
    workspaces,
    currentWorkspace,
    membershipRole,
    error,
    retry: loadWorkspaces,
    switchWorkspace,
    adoptCreatedWorkspace,
    clearWorkspaceCache,
    refreshWorkspaces: loadWorkspaces,
    listMembers: listWorkspaceMembers,
  }), [repository, status, workspaces, currentWorkspace, membershipRole, error, loadWorkspaces, switchWorkspace, adoptCreatedWorkspace, clearWorkspaceCache]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceContext() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspaceContext must be used within WorkspaceProvider");
  return value;
}
