import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { navigationRepository } from "@/lib/navigation-repository";

const NavigationContext = createContext(null);

export function NavigationProvider({ children, repository = navigationRepository }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [productionsByWorkspace, setProductionsByWorkspace] = useState({});
  // 前端优先的 Draft：仅存在于当前 React 会话，绝不写入 API 或本机持久化存储。
  // 后端实现 createDraftProduction 后，可用 Repository 返回的数据替换这层临时适配。
  const [localDraftsByWorkspace, setLocalDraftsByWorkspace] = useState({});
  const [productionAliases, setProductionAliases] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkspaces(await repository.listWorkspaces());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError : new Error(String(nextError)));
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

  const loadProductions = useCallback(async (workspaceId, { force = false } = {}) => {
    if (!force && Object.prototype.hasOwnProperty.call(productionsByWorkspace, workspaceId)) {
      return productionsByWorkspace[workspaceId];
    }
    const productions = await repository.listProductions(workspaceId);
    setProductionsByWorkspace((current) => ({ ...current, [workspaceId]: productions }));
    return productions;
  }, [productionsByWorkspace, repository]);

  /** 深链恢复的 production 详情合并进列表缓存，保持单一事实源。 */
  const setProductionsByWorkspaceEntry = useCallback((workspaceId, production) => {
    setProductionsByWorkspace((current) => {
      const existing = current[workspaceId];
      if (!existing) return current;
      if (existing.some((item) => item.id === production.id)) {
        return { ...current, [workspaceId]: existing.map((item) => (item.id === production.id ? production : item)) };
      }
      return { ...current, [workspaceId]: [production, ...existing] };
    });
  }, []);

  const createLocalDraft = useCallback((workspaceId) => {
    const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const draft = {
      id: `local-draft-${suffix}`,
      workspaceId,
      name: `活动-${Date.now()}`,
      status: "draft",
      startsAt: "",
      endsAt: "",
      timezone: "Asia/Shanghai",
      venue: "",
      description: "",
      isLocalDraft: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setLocalDraftsByWorkspace((current) => ({
      ...current,
      [workspaceId]: [draft, ...(current[workspaceId] ?? [])],
    }));
    return draft;
  }, []);

  const updateLocalDraft = useCallback((workspaceId, draftId, patch) => {
    setLocalDraftsByWorkspace((current) => {
      const drafts = current[workspaceId] ?? [];
      return {
        ...current,
        [workspaceId]: drafts.map((draft) => draft.id === draftId
          ? { ...draft, ...patch, updatedAt: new Date().toISOString() }
          : draft),
      };
    });
  }, []);

  const discardLocalDraft = useCallback((workspaceId, draftId) => {
    setLocalDraftsByWorkspace((current) => ({
      ...current,
      [workspaceId]: (current[workspaceId] ?? []).filter((draft) => draft.id !== draftId),
    }));
  }, []);

  const promoteLocalDraft = useCallback((workspaceId, draftId, production) => {
    setProductionAliases((current) => ({ ...current, [draftId]: production.id }));
    setLocalDraftsByWorkspace((current) => ({
      ...current,
      [workspaceId]: (current[workspaceId] ?? []).filter((draft) => draft.id !== draftId),
    }));
    setProductionsByWorkspace((current) => ({
      ...current,
      [workspaceId]: [production, ...(current[workspaceId] ?? []).filter((item) => item.id !== production.id)],
    }));
  }, []);

  const value = useMemo(() => ({
    repository,
    workspaces,
    productionsByWorkspace,
    localDraftsByWorkspace,
    productionAliases,
    loading,
    error,
    retry: loadWorkspaces,
    loadProductions,
    setProductionsByWorkspaceEntry,
    createLocalDraft,
    updateLocalDraft,
    discardLocalDraft,
    promoteLocalDraft,
  }), [repository, workspaces, productionsByWorkspace, localDraftsByWorkspace, productionAliases, loading, error, loadWorkspaces, loadProductions, setProductionsByWorkspaceEntry, createLocalDraft, updateLocalDraft, discardLocalDraft, promoteLocalDraft]);

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigationData() {
  const value = useContext(NavigationContext);
  if (!value) throw new Error("useNavigationData must be used within NavigationProvider");
  return value;
}
