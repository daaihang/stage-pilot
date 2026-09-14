import test from "node:test";
import assert from "node:assert/strict";
import {
  directProductionPath,
  matchStagePilotRoute,
  productionPath,
  resolveContextExit,
  resolveDetailClose,
  resolvePageBack,
  workspacePath,
} from "./navigation.js";

const workspace = { id: "ws_1", name: "演出工作空间", workspaceNavigable: true };
const production = { id: "prod_1", name: "青年音乐节" };

test("workspace page back resolves to the workspace root", () => {
  const route = matchStagePilotRoute("/w/ws_1/members");
  assert.deepEqual(resolvePageBack({ route, workspace }), {
    kind: "route",
    to: workspacePath("ws_1", "home"),
    label: "演出工作空间",
  });
});

test("workspace root pages do not render a redundant back link", () => {
  assert.equal(resolvePageBack({ route: matchStagePilotRoute("/w/ws_1/home"), workspace }), null);
  assert.equal(resolvePageBack({ route: matchStagePilotRoute("/w/ws_1/productions"), workspace }), null);
});

test("production overview exits to the activity list", () => {
  const route = matchStagePilotRoute("/w/ws_1/p/prod_1/overview");
  assert.deepEqual(resolvePageBack({ route, workspace, production }), {
    kind: "route",
    to: workspacePath("ws_1", "productions"),
    label: "活动",
  });
});

test("production child pages return to the production overview", () => {
  const route = matchStagePilotRoute("/w/ws_1/p/prod_1/programs");
  assert.deepEqual(resolvePageBack({ route, workspace, production }), {
    kind: "route",
    to: productionPath("ws_1", "prod_1", "overview"),
    label: "活动概览",
  });
});

test("all production child routes share the same parent", () => {
  const childPages = ["activity-info", "form-templates", "forms", "collection-workflows", "program-sheets", "programs", "schedule", "occurrences", "rehearsals", "settings", "members", "roles", "files"];
  for (const page of childPages) {
    const route = matchStagePilotRoute(`/w/ws_1/p/prod_1/${page}`);
    assert.equal(resolvePageBack({ route, workspace, production })?.to, productionPath("ws_1", "prod_1", "overview"), page);
  }
});

test("production-only children return to direct production overview while overview exits to work", () => {
  const childRoute = matchStagePilotRoute("/p/prod_1/programs");
  const overviewRoute = matchStagePilotRoute("/p/prod_1/overview");
  const productionOnlyWorkspace = { ...workspace, workspaceNavigable: false };
  assert.deepEqual(resolvePageBack({ route: childRoute, workspace: productionOnlyWorkspace, production }), {
    kind: "route",
    to: directProductionPath("prod_1", "overview"),
    label: "活动概览",
  });
  assert.deepEqual(resolvePageBack({ route: overviewRoute, workspace: productionOnlyWorkspace, production }), {
    kind: "route",
    to: "/work?tab=participating",
    label: "我的活动",
  });
  assert.equal(resolveContextExit({ route: childRoute, workspace: productionOnlyWorkspace }), "/work?tab=participating");
});

test("campaign details return to the forms list", () => {
  const route = matchStagePilotRoute("/w/ws_1/p/prod_1/forms/camp_1/form");
  assert.deepEqual(resolvePageBack({ route, workspace, production }), {
    kind: "route",
    to: productionPath("ws_1", "prod_1", "forms"),
    label: "全部表单",
  });
});

test("resource and invitation detail close destinations preserve their canonical parent", () => {
  const resourceRoute = matchStagePilotRoute("/w/ws_1/library/programs/program_1");
  assert.equal(resolveDetailClose({ route: resourceRoute, workspace }), workspacePath("ws_1", "programs"));
  const invitationRoute = matchStagePilotRoute("/w/ws_1/p/prod_1/members", "?panel=invitations");
  assert.equal(resolveDetailClose({ route: invitationRoute, workspace, production }), productionPath("ws_1", "prod_1", "members"));
});

test("resource type panel routes are parsed without a resource id", () => {
  const route = matchStagePilotRoute("/w/ws_1/library/programs", "?panel=types");
  assert.equal(route.mode, "workspace");
  assert.equal(route.page, "programs");
  assert.equal(route.resourceId, undefined);
  assert.equal(route.panel, "types");
});

test("planning and resource detail ids are URL addressable", () => {
  const planningRoute = matchStagePilotRoute("/w/ws_1/p/prod_1/schedule", "?detail=occ_1");
  assert.equal(planningRoute.detailId, "occ_1");
  const directRoute = matchStagePilotRoute("/p/prod_1/programs", "?detail=program_1");
  assert.equal(directRoute.detailId, "program_1");
});
