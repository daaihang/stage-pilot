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
const { detailOpen, registerDetail, setDetailOpen } = useWindowDetail();

useEffect(() => registerDetail({
  key: "developer-tools",
  getDetail: () => <LayoutInspector />,
  triggerRef: detailTriggerRef,
  storageKey: "detailPane:window:v1",
}), [registerDetail]);

<Button
  ref={detailTriggerRef}
  aria-pressed={detailOpen}
  onClick={() => setDetailOpen(!detailOpen)}
>
  {detailOpen ? "关闭详情" : "打开详情"}
</Button>
```

页面不得再自行维护以下状态：`open`、详情宽度、嵌入/覆盖/独占模式。页面只读取 `detailOpen` 或 `detailPresentation` 来更新入口文案、详情说明等页面特有文本。

## 何时使用 workspace 模式

普通页面继续使用 `document`：外层滚动、内边距和 `standard / wide / full` 最大宽度保持原有行为。

需要列表与详情并列、两侧独立滚动的页面使用 `workspace`。接入新路由时，要在 `RoutedMainShell` 的 `contentLayout` 路由判断中加入该页面；不要在页面内部再包一层全屏滚动壳。

全局页面宽度偏好由 `AppContentLayout` 统一应用。详情独占时，详情画布也遵循相同偏好；嵌入式详情会填满它被分配的栏位，不再叠加页面最大宽度。

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
 ├─ 打开 + 宽度 ≥ 960px → 嵌入式分栏
 └─ 打开 + 宽度 < 960px  → 详情页覆盖主工作区

嵌入式分栏 ─标题栏独占/拖分割线越过阈值→ 详情独占
嵌入式分栏 ─关闭、最小宽度右移、标题栏关闭→ 关闭
详情独占   ─标题栏退出独占→ 嵌入式分栏
详情独占   ─分割线向右拖过阈值/右方向键→ 关闭
任意宽屏状态 ─容器缩小到 < 960px→ 详情页覆盖主工作区（独占会先退出）
```

窗口宽度由 `ResizeObserver` 读取实际内容容器，而不是直接读取浏览器窗口宽度。这样左侧应用导航收起、系统标题栏变化和嵌入式预览都能得到正确判断。

窄屏覆盖不是模态抽屉：详情在 `WindowDetailHost` 内绝对定位，覆盖中间/右侧主工作区，保留不透明的页面背景，不渲染遮罩或背景模糊；应用标题栏和左侧 `AppSidebar` 始终位于覆盖层之外。关闭可通过标题栏详情按钮、页面触发器或 Escape 完成，并使用进入/退出位移动画。

## 新页面接入检查清单

- [ ] 路由切换到 `workspace` 内容模式。
- [ ] 页面使用 `useWindowDetail`，没有重复的页面级详情状态。
- [ ] `registerDetail` 有稳定的 `key`、`storageKey` 和 `triggerRef`。
- [ ] 详情内容没有自己的 Sheet、固定定位和标题栏。
- [ ] 主区、详情区在宽屏可独立滚动；窄屏覆盖不遮挡应用标题栏。
- [ ] 分割线鼠标、触摸、键盘操作仍可用，且有 `role="separator"` 数值语义。
- [ ] 打开/关闭/独占/拖拽后没有重复 toast。
- [ ] 验证标准、宽、全宽偏好，以及宽屏/窄屏切换。
- [ ] 运行 `pnpm --filter @stagepilot/desktop build`。
