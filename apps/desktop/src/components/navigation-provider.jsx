import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { navigationRepository } from "@/lib/navigation-repository";

const NavigationContext = createContext(null);

export function NavigationProvider({ children, repository = navigationRepository, authStatus = "authenticated" }) {
  const [productionsByWorkspace, setProductionsByWorkspace] = useState({});
  const productionsByWorkspaceRef = useRef({});
  const productionRequestsRef = useRef(new Map());
  const cacheGenerationRef = useRef(0);
  const [productionLoadStates, setProductionLoadStates] = useState({});
  // 创建会话只存在于当前 React 会话，不属于 Production 集合，也不写入 API 或本机存储。
  const [creationSession, setCreationSession] = useState(null);
  const creationSessionRef = useRef(null);
  productionsByWorkspaceRef.current = productionsByWorkspace;

  const resetNavigationCache = useCallback(() => {
    cacheGenerationRef.current += 1;
    productionRequestsRef.current.clear();
    setProductionsByWorkspace({});
    setProductionLoadStates({});
  }, []);

  // WorkspaceProvider is the single owner of workspace loading. This provider
  // only owns the production cache, so navigation never issues a second
  // workspace request or toggles the shell's global loading state.
  useEffect(() => {
    if (authStatus !== "authenticated") resetNavigationCache();
  }, [authStatus, resetNavigationCache]);

  const loadProductions = useCallback(async (workspaceId, { force = false } = {}) => {
    const cached = productionsByWorkspaceRef.current[workspaceId];
    if (!force && cached) return cached;
    const pending = productionRequestsRef.current.get(workspaceId);
    if (pending) return pending;

    const generation = cacheGenerationRef.current;
    setProductionLoadStates((current) => ({ ...current, [workspaceId]: { status: "loading", error: null } }));
    const request = repository.listProductions(workspaceId).then((productions) => {
      if (generation !== cacheGenerationRef.current) return productions;
      const existingById = new Map((productionsByWorkspaceRef.current[workspaceId] ?? []).map((item) => [item.id, item]));
      const merged = productions.map((item) => ({ ...item, venue: existingById.get(item.id)?.venue ?? item.venue ?? "" }));
      setProductionsByWorkspace((current) => ({ ...current, [workspaceId]: merged }));
      setProductionLoadStates((current) => ({ ...current, [workspaceId]: { status: "ready", error: null } }));
      return merged;
    }).catch((nextError) => {
      const error = nextError instanceof Error ? nextError : new Error(String(nextError));
      if (generation === cacheGenerationRef.current) setProductionLoadStates((current) => ({ ...current, [workspaceId]: { status: "error", error } }));
      throw error;
    }).finally(() => {
      productionRequestsRef.current.delete(workspaceId);
    });
    productionRequestsRef.current.set(workspaceId, request);
    return request;
  }, [repository]);

  /** 深链恢复的 production 详情合并进列表缓存，保持单一事实源。 */
  const setProductionsByWorkspaceEntry = useCallback((workspaceId, production) => {
    setProductionsByWorkspace((current) => {
      const existing = current[workspaceId] ?? [];
      const previous = existing.find((item) => item.id === production.id);
      const nextProduction = { ...production, venue: production.venue ?? previous?.venue ?? "" };
      if (existing.some((item) => item.id === production.id)) {
        return { ...current, [workspaceId]: existing.map((item) => (item.id === production.id ? nextProduction : item)) };
      }
      return { ...current, [workspaceId]: [nextProduction, ...existing] };
    });
    setProductionLoadStates((current) => ({ ...current, [workspaceId]: { status: "ready", error: null } }));
  }, []);

  const createCreationSession = useCallback((workspaceId) => {
    if (creationSessionRef.current) return creationSessionRef.current;
    const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const defaultName = `活动-${Date.now()}`;
    const session = {
      id: `creation-session-${suffix}`,
      workspaceId,
      name: defaultName,
      defaultName,
      plannedStartAt: "",
      plannedEndAt: "",
      timezone: "Asia/Shanghai",
      venue: "",
      description: "",
      isCreationSession: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    creationSessionRef.current = session;
    setCreationSession(session);
    return session;
  }, []);

  const updateCreationSession = useCallback((sessionId, patch) => {
    const current = creationSessionRef.current;
    if (!current || current.id !== sessionId) return null;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    creationSessionRef.current = next;
    setCreationSession(next);
    return next;
  }, []);

  const discardCreationSession = useCallback((sessionId) => {
    if (sessionId && creationSessionRef.current?.id !== sessionId) return;
    creationSessionRef.current = null;
    setCreationSession(null);
  }, []);

  const getCreationSession = useCallback(() => creationSessionRef.current, []);

  const value = useMemo(() => ({
    repository,
    productionsByWorkspace,
    productionLoadStates,
    creationSession,
    loading: false,
    error: null,
    retry: resetNavigationCache,
    loadProductions,
    setProductionsByWorkspaceEntry,
    createCreationSession,
    updateCreationSession,
    discardCreationSession,
    getCreationSession,
  }), [repository, productionsByWorkspace, productionLoadStates, creationSession, loadProductions, setProductionsByWorkspaceEntry, createCreationSession, updateCreationSession, discardCreationSession, getCreationSession, resetNavigationCache]);

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigationData() {
  const value = useContext(NavigationContext);
  if (!value) throw new Error("useNavigationData must be used within NavigationProvider");
  return value;
}
