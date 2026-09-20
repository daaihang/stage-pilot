# 页面页头规范

StagePilot 的登录后页面使用共享 `PageHeader`。页头负责页面层级、标题说明和页面级操作；窗口标题栏负责当前位置和窗口级详情控制；左侧导航负责上下文切换。三者不要互相替代。

## 组件边界

- `PageHeader`：通用页头，负责返回入口、标题、说明、标题附件和操作区域。
- `PageHeaderActions`：声明页面操作优先级，接收 `primary`、`secondary` 和 `overflow`。
- `WorkspacePageHeader`：工作空间路由适配器，负责工作空间角色和确定性返回目标。
- `ProductionPageHeader`：活动路由适配器，负责活动状态、活动角色和离开前异步守卫。
- `ResourcePage`：资源列表页；独立页面可以拥有页头，嵌入页面应使用 `h2` 或隐藏重复页头。

页头不承载详情关闭、详情独占切换、侧栏切换、上下文退出或窗口级操作。详情关闭统一由窗口标题栏和 `WindowDetailHost` 处理。

## 根页头与嵌入页头

每个页面只保留一个根级 `h1`：

```jsx
<PageHeader
  title="节目单"
  description="管理当前活动的节目单版本。"
  actions={(
    <PageHeaderActions
      primary={<Button onClick={openCreate}>新建节目单</Button>}
      secondary={[refreshButton]}
    />
  )}
/>
```

嵌入在活动、工作空间或另一个资源页中的列表使用 `h2`，避免重复渲染新的主标题：

```jsx
<ResourcePage
  headingLevel="h2"
  title="节目单版本"
  actions={{ primary: <Button onClick={openCreate}>新建版本</Button> }}
>
  {children}
</ResourcePage>
```

`PageHeader` 默认只让 `h1` 参与根页头可见性报告；`h2` 不会覆盖外层页头状态。使用 `titleContent` 时，调用方仍必须保留正确的 `h1` 语义。

## 操作槽位

`primary` 必须是一个主操作节点，通常是创建、添加、上传或提交。一个页头不能同时出现两个主按钮；如果有多个同类动作，应改为一个入口或放入 `overflow`。

`secondary` 最多放两个高频、可直接访问的辅助操作，例如刷新、管理或查看。低频和进阶操作放入 `overflow` 菜单；组件不会根据按钮源码顺序自动改变操作层级。

```jsx
<PageHeaderActions
  primary={<Button onClick={openCreate}>新建</Button>}
  secondary={[refreshButton, manageButton]}
  overflow={<Button variant="outline">更多</Button>}
/>
```

操作区使用命名容器查询：

- 40rem 以上：标题和操作同行，主操作靠右。
- 小于 40rem：标题与操作上下排列。
- 单一主操作：占满可用宽度。
- 主操作加一个次操作：优先两列。
- 主操作加两个次操作：主操作单独一行，两个次操作组成下一行。
- 每列最小宽度为 10.5rem；容器更窄时自然退化为纵向排列。
- 不截断按钮文案，保留按钮已有的禁用、加载和 Toast 行为。

返回入口位于标题上方，并使用确定性目标。根页面不渲染多余返回；页面返回、详情关闭和上下文退出是三个不同动作。

## 滚动状态

`AppContentLayout` 是页面内容的滚动边界，公开 `useAppContentLayout()`：

```jsx
const { contentWidth, scrollRef } = useAppContentLayout();
```

`scrollRef` 指向 `.app-content-scroll`，不是 `window`。普通页面、工作区页面和打开详情后的主工作区都应以它作为页面滚动观察的根容器；详情面板自身仍有独立滚动边界。

根级 `PageHeader` 会使用该滚动根通过 `IntersectionObserver` 报告 `pageHeaderVisible`。页头仍有任意可见区域时为 `true`，完全离开内容视口后为 `false`。状态由 `PageChromeContext` 暴露，标题栏和悬浮主操作都只消费根级 `h1` 的状态。

页面切换后，旧页头必须注销，新页面在注册前保持安全的可见默认值。普通页面、工作区页面和详情打开后的主工作区都使用 `.app-content-scroll`；详情面板自己的滚动不能改变主页面状态。

## 标题栏 Breadcrumb

标题栏只使用 `buildBreadcrumbItems()` 生成的一套完整路径。不要同时渲染两套路径 DOM，也不要通过透明度动画在不同路径结构之间切换。

标题栏偏好和页头状态的规则如下：

| 状态 | 默认内容 | Hover / Focus |
| --- | --- | --- |
| 页眉可见 + 页面/应用偏好 | 完整 Breadcrumb | 保持完整 Breadcrumb |
| 页眉可见 + 无偏好 | 空 | 展开完整 Breadcrumb |
| 页眉已滚出 + 页面偏好 | 页面名称 | 展开完整 Breadcrumb |
| 页眉已滚出 + 应用偏好 | `StagePilot` | 展开完整 Breadcrumb |
| 页眉已滚出 + 无偏好 | 空 | 展开完整 Breadcrumb |

“完整”表示路径数据不被业务逻辑裁剪。窄窗口可以使用 CSS 省略单个标签，并通过 `title` 保留完整文本；不能因为窗口变窄而创建另一套语义路径。

标题栏中部的空白区域必须归 `data-tauri-drag-region`。标题文本和 Breadcrumb 只允许实际链接区域接收指针，不能使用覆盖整个中部的透明交互层，否则会阻断窗口拖拽。

## 悬浮主操作

长表单和高频创建页可以显式传入 `floatingPrimary`，或者在没有直接 `PageHeader` 的编辑器内使用 `FloatingPrimaryAction`：

```jsx
<PageHeader
  title="全部表单"
  actions={<PageHeaderActions primary={<Button onClick={openCreate}>新建表单</Button>} />}
  floatingPrimary={<Button onClick={openCreate}>新建表单</Button>}
/>
```

悬浮主操作只在根级 `h1` 页眉完全滚出后出现；页眉可见时只显示页头中的原按钮。每个页面最多一个悬浮主操作，必须由页面显式启用，不能因为存在 `primary` 自动生成。

悬浮按钮通过 `AppContentLayout` 的内容宽度容器对齐。`/work` 中必须避开 48px 全局工具栏和 Toast 安全区域；详情打开时仍属于主内容区，不进入详情面板。悬浮按钮必须复用原有点击、禁用、加载和 `notify` 行为。

悬浮操作适合创建、发布等单一主动作，不适合详情关闭、页面返回、侧栏切换、保存草稿或低频菜单。长表单只能选择一个高频主动作，例如发布；保存、校验和预览继续保留在编辑器工具栏。

接入标题栏或悬浮操作时，必须遵守以下规则：

- 只消费根级 `h1` 页头状态，不能让嵌入式 `h2` 改写状态。
- 页面切换和页头卸载后清理注册，默认恢复为可见。
- 不监听 `window` 滚动，也不在详情面板滚动时改变主页面状态。
- 悬浮主操作应由页面明确选择，不能因为存在 `primary` 就自动出现。
- `/work` 的底部工具栏和 Toast 偏移必须纳入悬浮操作的安全区域计算。

## 接入检查清单

- [ ] 页面只有一个根级 `h1` 页头。
- [ ] 返回按钮位于页头标题上方，并指向确定的父路由。
- [ ] `primary` 只有一个主操作。
- [ ] `secondary` 不超过两个；低频操作放入 `overflow`。
- [ ] 详情关闭、侧栏切换和上下文退出没有混入页头操作。
- [ ] 嵌入式资源使用 `h2` 或显式隐藏重复页头。
- [ ] 页面没有额外创建全屏滚动壳；需要滚动观察时使用 `useAppContentLayout().scrollRef`。
- [ ] 操作保留共享 `notify` 的加载、成功和失败反馈。
- [ ] 验证标准、宽、全宽内容偏好以及详情打开后的实际容器宽度。
