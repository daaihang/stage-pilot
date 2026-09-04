/**
 * Navigation Repository：侧栏与页面导航的数据契约。
 *
 * 登录态（Tauri 或带后端的浏览器预览）使用 API 实现：数据来自
 * Workspace / Tenant Foundation 的 REST 接口，Production 领域尚未实现，
 * listProductions 返回空数组并走既有空状态。
 *
 * 浏览器无后端预览（mockNavigationRepository）仅用于 UI 开发，
 * 不再作为登录态的数据源。
 */

/** @typedef {Object} WorkspaceSummary
 * @property {string} id
 * @property {string} name
 * @property {string} slug
 * @property {string} plan
 * @property {string} logo
 */

/**
 * @typedef {Object} ProductionSummary
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} name
 * @property {"active"|"completed"|"archived"} status
 * @property {string} startsAt
 * @property {string} endsAt
 * @property {string} venue
 */

/**
 * @typedef {Object} NavigationRepository
 * @property {() => Promise<WorkspaceSummary[]>} listWorkspaces
 * @property {(id: string) => Promise<WorkspaceSummary|null>} getWorkspace
 * @property {(workspaceId: string) => Promise<ProductionSummary[]>} listProductions
 * @property {(workspaceId: string, productionId: string) => Promise<ProductionSummary|null>} getProduction
 */

import { getWorkspace as fetchWorkspace, listWorkspaces as fetchWorkspaces, toWorkspaceSummary } from "@/lib/workspace-api";
import { getAccessibleProduction, listAccessibleProductions, toProductionSummary } from "@/lib/production-api";

/** @type {NavigationRepository} */
export const apiNavigationRepository = {
  async listWorkspaces() {
    const workspaces = await fetchWorkspaces();
    return workspaces.map(toWorkspaceSummary);
  },
  async getWorkspace(id) {
    try {
      return toWorkspaceSummary(await fetchWorkspace(id));
    } catch (error) {
      // 无 membership / 不存在都返回 null，由调用方渲染不可访问页面。
      if (error?.status === 403 || error?.status === 404) return null;
      throw error;
    }
  },
  async listProductions(workspaceId) {
    const productions = await listAccessibleProductions();
    return productions.filter((production) => production.workspace_id === workspaceId).map(toProductionSummary);
  },
  async getProduction(workspaceId, productionId) {
    try {
      const production = await getAccessibleProduction(productionId);
      if (production.workspace_id !== workspaceId) return null;
      return toProductionSummary(production);
    } catch (error) {
      // 不存在 / 越权 / 父子伪造统一按不可访问处理（后端统一 404，不泄露存在性）。
      if (error?.status === 403 || error?.status === 404) return null;
      throw error;
    }
  },
};

/** @type {WorkspaceSummary[]} */
const mockWorkspaces = [
  { id: "ws-nanning-media", name: "南宁高中传媒社团联盟", slug: "nanning-media", plan: "Pro 工作空间", logo: "南" },
  { id: "ws-stagepilot-demo", name: "StagePilot Demo", slug: "stagepilot-demo", plan: "免费版", logo: "SP" },
];

/** @type {ProductionSummary[]} */
const mockProductions = [
  { id: "prod-youth-festival-2026", workspaceId: "ws-nanning-media", name: "2026 青年音乐节", status: "active", startsAt: "2026-09-18T10:00:00+08:00", endsAt: "2026-09-20T22:00:00+08:00", venue: "东盟盛天地" },
  { id: "prod-seven-schools", workspaceId: "ws-nanning-media", name: "七高校联合歌会", status: "active", startsAt: "2026-11-07T14:00:00+08:00", endsAt: "2026-11-07T22:00:00+08:00", venue: "广西文化艺术中心" },
  { id: "prod-new-year-2027", workspaceId: "ws-nanning-media", name: "2027 跨年晚会", status: "completed", startsAt: "2026-12-31T18:00:00+08:00", endsAt: "2027-01-01T00:30:00+08:00", venue: "南宁剧场" },
];

const pause = () => Promise.resolve();

/** @type {NavigationRepository} */
export const mockNavigationRepository = {
  async listWorkspaces() {
    await pause();
    return mockWorkspaces.map((workspace) => ({ ...workspace }));
  },
  async getWorkspace(id) {
    await pause();
    const workspace = mockWorkspaces.find((item) => item.id === id);
    return workspace ? { ...workspace } : null;
  },
  async listProductions(workspaceId) {
    await pause();
    return mockProductions.filter((item) => item.workspaceId === workspaceId).map((production) => ({ ...production }));
  },
  async getProduction(workspaceId, productionId) {
    await pause();
    const production = mockProductions.find((item) => item.workspaceId === workspaceId && item.id === productionId);
    return production ? { ...production } : null;
  },
};

/**
 * 登录态统一使用 API repository；mock 仍可显式引入用于开发预览。
 */
export const navigationRepository = apiNavigationRepository;
