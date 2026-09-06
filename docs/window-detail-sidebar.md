# 窗口级详情侧栏接入指南

StagePilot 的详情侧栏是应用窗口壳层的一部分，不是某个页面私有的抽屉。窗口壳层负责布局、状态、标题栏动作、响应式切换和宽度持久化；页面只提供当前页面的详情内容和打开入口。

## 架构边界

```text
PageChromeProvider
└─ WindowDetailProvider        ← 窗口级状态
   └─ SidebarProvider
      ├─ AppSidebar             ← 始终独立显示
      └─ SidebarInset
         └─ WindowDetailHost    ← 统一承载详情
            └─ AppContentLayout ← document / workspace
```

相关实现：

- `apps/desktop/src/components/window-detail-context.jsx`：窗口级注册和状态。
- `apps/desktop/src/components/detail-split-pane.jsx`：嵌入、覆盖、独占、拖拽和动画。
- `apps/desktop/src/components/page-chrome.jsx`：标题栏中的独占/关闭动作。
- `apps/desktop/src/components/app-content-layout.jsx`：页面内容模式和全局宽度偏好。
- `apps/desktop/src/App.jsx`：窗口壳层挂载点和路由布局选择。

页面离开时，当前注册会被清理，详情默认关闭；这是一项有意的生命周期规则。它不会把侧栏实现退回页面私有，只表示详情内容必须和当前页面上下文一致。

## 页面需要适配的内容

只有以下内容需要页面参与：

1. 为需要详情的路由选择 `workspace` 内容模式，让主区和详情区拥有独立纵向滚动。
2. 使用 `useWindowDetail()` 注册详情内容、触发按钮 ref 和唯一的宽度存储键。
3. 详情内容本身保持普通 React 内容，不创建新的 `Sheet`、固定定位容器或独立标题栏关闭按钮。

开发工具页是参考实现：

```jsx
const detailTriggerRef = useRef(null);
const navigate = useNavigate();
const { detailOpen, registerDetail, setDetailOpen } = useWindowDetail();

useEffect(() => registerDetail({
  key: "developer-tools",
  detailLabel: "布局检查器",
  getDetail: () => <LayoutInspector />,
  triggerRef: detailTriggerRef,
  storageKey: "detailPane:window:v1",
  // 可选：标题栏、Escape 或覆盖模式关闭时同步页面 URL。
  onClose: () => navigate("/current-page"),
}), [registerDetail]);

<Button
  ref={detailTriggerRef}
  aria-pressed={detailOpen}
  onClick={() => setDetailOpen(!detailOpen)}
>
  {detailOpen ? "关闭详情" : "打开详情"}
</Button>
```

`registerDetail` 的 `onClose` 是可选回调。需要由路由驱动详情状态的页面应在这里移除详情相关的路径段或查询参数；普通详情页可以省略它。关闭回调只负责同步页面状态，不应重复触发打开/关闭 Toast。

页面不得再自行维护以下状态：`open`、详情宽度、嵌入/覆盖/独占模式。页面只读取 `detailOpen` 或 `detailPresentation` 来更新入口文案、详情说明等页面特有文本。

宽屏详情的默认打开方式由账户偏好 `detail_open_mode` 控制，取值为 `inline`（分栏侧栏，默认）或 `exclusive`（带边距的大模态详情窗口）。该偏好只决定下一次打开详情时的初始呈现；详情已经打开时修改偏好不会让当前 surface 跳变。容器宽度不足时无论偏好为何都强制使用运行时的 `overlay`，标题栏和左侧 `AppSidebar` 不受影响。历史偏好值 `overlay` 读取时按 `exclusive` 兼容处理。

`overlay` 是窄屏期间的临时呈现，不会覆盖本次详情会话的宽屏意图。宽屏 `inline` 缩窄后恢复为 `inline`，宽屏 `exclusive` 缩窄后恢复为 `exclusive`；窄屏首次打开详情时没有会话记忆，则使用打开瞬间捕获的账户偏好。详情关闭、路由卸载或注册清理后清除会话记忆，再次打开重新读取账户偏好。布局断点使用迟滞：首次测量以 `960px` 为中心判断，宽屏进入阈值为 `992px`，窄屏进入阈值为 `928px`；`929–991px` 保持上一次宽窄屏状态，避免窗口调整时反复播放模式动画。

## 工作空间资源库适配

节目、人员、机构、场地和设备资源库使用同一套列表 + 详情适配器：

- 列表页始终保留在主工作区，详情通过现有 `resourceId` 路由段驱动。
- 资源详情路径分别为 `/w/:workspaceId/library/{resourceType}/:resourceId`；无资源 ID 时详情关闭。
- `WorkspaceResourcePage` 使用 `useWindowDetail().registerDetail()` 注册 `ResourceDetailPanel`，并使用稳定的资源触发器 ref 恢复关闭后的焦点。
- 资源库路由必须选择 `AppContentLayout` 的 `workspace` 模式；主列表和右侧详情各自滚动，不能回退到页面级 `Sheet` 或完整详情页替换列表。
- 打开详情使用 `setDetailOpen(true, { announce: false })`，避免刷新、前进后退和深链产生重复提示。
- 关闭、删除或返回资源库时只移除 `resourceId`，不得清空列表的搜索、筛选和视图状态。
- 场地空间、机构联系人属于详情面板内的子资源，继续通过父资源 API 操作并显示共享 Toast。

新增或修改资源库页面时，优先复用 `ResourceDetailPanel` 和现有资源配置；不要重新引入 `ResourceDetailPage`、页面私有抽屉或第二套详情布局。

资源库类型管理也使用同一个窗口详情 surface：五个资源库的“管理类型”操作导航到当前资源列表的 `?panel=types`，并注册 `ResourceTypeManagementPanel`。类型管理与资源详情互斥，关闭类型面板只移除 `panel` 参数并保留列表的搜索、筛选和视图状态。类型管理统一调用 `/v1/workspaces/{workspaceId}/resource-types/{resourceType}`，其中 `resourceType` 只能为 `programs`、`venues`、`people`、`organizations` 或 `equipment`；文件类型继续独立管理。默认排序通过完整列表拖动持久化，系统默认类型同样可排序，`other` 永远固定在末尾；管理员可调用同一路径下的 `/restore` 恢复系统模板并将自定义资源迁移到 `other`。

成员页同样使用窗口详情 surface：Workspace `/w/:workspaceId/members?panel=invitations` 显示“成员邀请”，Production `/w/:workspaceId/p/:productionId/members?panel=invitations` 或 `/p/:productionId/members?panel=invitations` 显示“活动邀请”。列表、搜索和成员 tabs 保持挂载，关闭面板只移除 `panel`，并通过稳定的“成员邀请”按钮 ref 恢复焦点。邀请面板不得创建页面级 Sheet/Drawer；创建、撤销和接受操作使用共享 Toast。

`DetailSplitPane` 只保留一个 `[data-detail-surface]` 详情节点。嵌入、独占和覆盖是同一节点的三种几何状态；页面详情内容不得为了不同宽度再渲染第二份。

## 何时使用 workspace 模式

普通页面继续使用 `document`：外层滚动、内边距和 `standard / wide / full` 最大宽度保持原有行为。

需要列表与详情并列、两侧独立滚动的页面使用 `workspace`。接入新路由时，要在 `RoutedMainShell` 的 `contentLayout` 路由判断中加入该页面；页面不得再包一层全屏滚动壳。

`AppContentLayout` 在 `workspace` 和 `document` 模式都统一应用页面宽度偏好、居中画布和页面内边距；`workspace` 模式额外提供主区唯一的全高滚动边界。详情宿主在 inline、overlay 和 exclusive 三种模式中统一提供唯一的 `p-4 md:p-6` 滚动内容边界；详情页不得补偿性地再包一层页面内边距。overlay 和 exclusive 的内部内容画布遵循 `contentWidth` 并居中，inline 则始终填满被分配的栏位，不叠加最大宽度。

## 详情内容约束

- 不要使用 `position: fixed`、`z-index` 抽屉或页面级 `Sheet`。
- 不要依赖详情自己的关闭按钮；窗口标题栏提供关闭和独占切换，详情页模式还支持 Escape 关闭。
- 根节点应允许 `min-h-full`，长内容通过宿主的纵向滚动区域滚动。
- 详情内部可以有 sticky 页头，但不要覆盖应用标题栏。
- 详情操作仍须遵守共享 `notify` 规则；打开/关闭/独占切换由窗口宿主统一反馈，页面不要重复提示。
- `key` 和 `storageKey` 必须稳定且唯一；宽度会保存到 `appStore`，打开状态不会保存。

## 交互状态

```text
关闭
 ├─ 打开 + 宽屏 → 捕获账户偏好或上一次会话模式
 └─ 打开 + 窄屏 → 详情页覆盖主工作区

嵌入式分栏 ─标题栏独占→ 详情独占
嵌入式分栏 ─标题栏关闭→ 关闭
详情独占   ─标题栏退出独占→ 嵌入式分栏
详情独占   ─标题栏关闭→ 关闭
宽屏 inline ─进入窄屏→ overlay ─恢复宽屏→ inline
宽屏 exclusive ─进入窄屏→ overlay ─恢复宽屏→ exclusive
929–991px → 保持上一次宽窄屏状态
```

窗口宽度由 `ResizeObserver` 读取实际内容容器，而不是直接读取浏览器窗口宽度。这样左侧应用导航收起、系统标题栏变化和嵌入式预览都能得到正确判断。

嵌入式分割线只调整详情宽度，不负责进入独占或关闭详情。它使用与 `SidebarRail` 相同的全高命中轨道和悬停高亮线，并保留 `role="separator"` 的鼠标、触摸和键盘宽度调整；独占与关闭只由窗口标题栏控制。

独占详情不是普通的满幅侧栏：它在中间/右侧工作区内以带外边距的大窗口呈现。窗口表面沿用项目当前 shadcn/ui 的弹层语义（`bg-popover`、`text-popover-foreground`、`rounded-none`、`ring-1 ring-foreground/10`），只保留阴影作为独占层级的额外提示；主工作区留在下方但不可交互，使用轻量遮罩区分层级，不使用背景模糊。应用标题栏和左侧 `AppSidebar` 始终位于这个窗口之外。

独占表面是真正的 modal dialog：使用 `role="dialog"`、`aria-modal="true"`，进入时聚焦详情容器，Tab/Shift+Tab 只在详情控件和标题栏的详情独占/关闭按钮之间循环，背景主区与左侧导航设置为 `inert`。点击独占阴影或按 Escape 只退出独占并回到嵌入式详情，不关闭详情；标题栏关闭才会关闭详情。退出独占恢复进入独占前的焦点，关闭详情恢复页面触发按钮。

打开/关闭动画采用统一的 `cubic-bezier(0.22, 1, 0.36, 1)`：工作区尺寸使用 300ms 的 `t-resize`，独占窗口使用 250ms 打开、150ms 关闭，并从 `scale(0.96)` 过渡到 `scale(1)`；`prefers-reduced-motion` 下全部关闭过渡。

窄屏覆盖不是模态抽屉：详情在 `WindowDetailHost` 内绝对定位，覆盖中间/右侧主工作区，使用不透明页面背景，不渲染遮罩或背景模糊；应用标题栏和左侧 `AppSidebar` 始终位于覆盖层之外。关闭可通过标题栏详情按钮或 Escape 完成，并使用进入/退出位移动画。

窄屏覆盖保持页面语义（`role="region"`，不设置 `aria-modal` 或焦点陷阱），但主工作区内容在覆盖期间设置为 `inert`，详情标题/容器获得初始焦点。窗口从 `<960px` 切换到宽屏时，同一 Surface 从全工作区平滑收缩为右侧栏；反向切换执行相同的几何过渡。关闭阶段由 `transitionend`/`transitioncancel` 管理卸载，只有 reduced-motion 或无有效 transition 时才在下一帧兜底，不使用固定时长作为主要依据。

## 新页面接入检查清单

- [ ] 路由切换到 `workspace` 内容模式。
- [ ] 页面使用 `useWindowDetail`，没有重复的页面级详情状态。
- [ ] `registerDetail` 有稳定的 `key`、`storageKey` 和 `triggerRef`。
- [ ] 详情内容没有自己的 Sheet、固定定位和标题栏。
- [ ] 主区、详情区在宽屏可独立滚动；窄屏覆盖不遮挡应用标题栏。
- [ ] 分割线只调整宽度，不会因拖拽阈值进入独占或关闭；鼠标、触摸、键盘操作仍可用，且有 `role="separator"` 数值语义。
- [ ] 打开/关闭/独占/拖拽后没有重复 toast。
- [ ] 验证标准、宽、全宽偏好，以及宽屏/窄屏切换。
- [ ] 运行 `pnpm --filter @stagepilot/desktop build`。
