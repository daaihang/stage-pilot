# StagePilot 征集、招募与表单平台：领域与产品研究

日期：2026-09-06
范围：不修改代码；审查当前仓库和两段既有设计讨论，并核验截至本日的公开产品/标准实践。
读者：StagePilot 产品、设计与后续实现团队。

## 结论先行

不要把这个模块命名或建模成一个泛化的「表单」功能。**表单是收集界面；`Campaign`（征集活动）才是用户和业务看到的完整对象。**

建议在 Production 侧保留一个一级入口，中文名称定为 **「征集与招募」**，但在入口内把业务明确分为四个互不混淆的组：

```text
全部 Campaign        统一总览、待处理和统计
├── 征集              节目、作品、方案、素材等 SUBMISSION
├── 招募              摄影师、志愿者、岗位/班次等 RECRUITMENT
├── 报名              观众、嘉宾、队伍等 REGISTRATION
└── 通用收集          车辆、住宿、餐饮、尺码、资料等 COLLECTION
```

这样「征集」和「招募」是独立、清晰的业务分组；「审核」不是第五种类型，而是跨类型的处理视图；「表单」也不应成为与它们平级的活动清单。每个 Campaign 恰好使用一个版本化的表单，但同时还拥有开放规则、审核流、结果转化和公开呈现。

用户从工作空间模板创建 Campaign 后，公共填写者经历的是一张完整的「说明 + 字段」表单；提交首先只产生 `Entry` 暂存数据。只有明确决定通过或确认后，系统才按受控的结果映射生成活动级正式对象。不要让外部提交直接写进人员库、设备库存或 Workspace 长期资源库。

## 已确认的仓库现状

这份建议以当前实现为起点，而不是假设从空白项目开始。

| 领域 | 当前状态 | 对本模块的影响 |
| --- | --- | --- |
| Production | 已有活动容器、时区、场地选择、场次/彩排/日程；活动是 Workspace 下的强隔离子域。 | `Campaign` 应属于 Production 并保存 `workspace_id`，使用复合外键保持租户隔离。 |
| 人员、节目、场地、设备 | Workspace 已有 `Person`、`Program`、`Venue/VenueSpace`、`EquipmentItem`，均定位为可复用资产。 | 它们只能是「通过后可选择提升/引用」的目标，不能作为公开表单的直接写入表。 |
| 活动资源 | 设计文档已预留 `ProductionProgram`、`ProductionPerson`、设备分配等，但数据库/API 尚未实现。 | 结果转化必须在领域设计中先定义，实际落库排在这些正式活动资源模型之后或同时完成。 |
| 成员与邀请 | 已实现 Production Membership、生产活动邀请码及开始/到期窗口；现实人员和后台访问已经可以分开。 | 招募通过只创建 `ProductionPerson`；只有管理员显式授予后台访问时，才创建/发放 `ProductionMembership`。绝不能自动把应募者变成 Workspace Member。 |
| 文件 | Workspace 文件表与对象存储上传已存在，但上传/下载均要求 Workspace Member，且服务端仍接受客户端声明的 MIME 类型。 | 不能直接拿来作为公开附件入口；需要 Campaign/Entry 归属、匿名受限上传、恶意文件隔离与审核后可见的独立能力。 |
| UI 路由 | 侧栏已有 `recruitment` 占位页，显示名为「征集与审核」；模板页也是占位。 | 这是适合替换的预留入口，不需要另建一套与 Production 平行的产品结构。 |

关键代码/迁移证据：

- `backend/migrations/000005_resource_foundation.up.sql` 建立 Workspace 可复用资源；`000012_production_locations.up.sql` 已采用 `workspace_id` + Production 的复合外键。
- `backend/migrations/000009_production_access.up.sql`、`000017_production_membership_windows.up.sql` 已支持活动直接成员及访问窗口。
- `backend/migrations/000006_files.up.sql` 和 `backend/api/cmd/server/files.go` 显示当前文件 API 仅以 Workspace 成员权限访问，且没有公开上传隔离流程。
- `docs/domain/production-resource-assignments.md` 已正确把 `ProductionProgram`、`ProductionPerson`、设备分配放在「后续活动资源」而非 Workspace 资产表中。
- `apps/desktop/src/components/app-sidebar.jsx` 和 `apps/desktop/src/lib/navigation.js` 保留了活动侧 `recruitment` 路由；`docs/sidebar-backend-integration.md` 明确它仍是占位领域。

## 推荐的信息架构

### Production 内的界面

```text
筹备
└── 征集与招募                         /intake（可先复用现有 recruitment 路由）
    ├── 全部 Campaign
    ├── 待处理                          跨所有 Campaign 的工作队列
    ├── 征集                            SUBMISSION 视图
    ├── 招募                            RECRUITMENT 视图
    ├── 报名                            REGISTRATION 视图
    └── 通用收集                        COLLECTION 视图

Campaign 详情
├── 概览                               状态、开放期、名额、漏斗
├── 表单                               内容块、字段、条件逻辑、预览
├── 规则                               可见性、开放/截止、次数、草稿、候补
├── 审核                               流程、评分量表、分配与决定
├── 提交记录                           Entry 收件箱、筛选、批量操作
├── 结果                               已确认/候补/已转化与异常
└── 设置                               危险操作、归档、保存为模板
```

「待处理」可以预设为首页，因为它回答的是工作人员每天的工作；分类 tab 回答的是“我正在运营哪一类 Campaign”。不要再把「审核」塞进侧栏名称，否则它会掩盖创建、公开发布、报名和转化这些同样重要的能力。

### Workspace 内的界面

现有「模板」入口应增加一个明确分组：`征集与招募模板`。首版无需单独开放一个所有表单的全局库。

```text
Workspace 模板
├── 系统模板（只读、可复制、版本化）
│   ├── 节目征集
│   ├── 摄影师招募
│   ├── 志愿者岗位招募
│   ├── 活动报名
│   ├── 艺人资料收集
│   └── 通用收集
└── 工作空间模板（本组织维护）
    └── 由系统模板复制、从空白创建，或从表现良好的 Campaign 另存
```

模板并非只有字段；它必须包含表单结构、默认规则、默认审核配方、结果映射和展示主题。因此建议对外叫 **Campaign Template / 征集活动模板**，而不是只叫 Form Template。

## 领域树与单一数据流

```text
StagePilot
├── System Campaign Templates                    系统只读模板及其版本
└── Workspace
    ├── Workspace Campaign Templates             组织自己的版本化模板
    ├── Reusable assets                           Person / Program / Venue / Equipment / File
    └── Production
        └── Campaign                              一次有业务目的的对外或内部收集
            ├── kind                              REGISTRATION | SUBMISSION | RECRUITMENT | COLLECTION
            ├── source snapshot                   来源模板与创建时版本，仅用于追溯
            ├── CampaignRevision                  可发布的不可变配置快照
            │   ├── FormVersion                   blocks[]、字段、校验、逻辑和呈现
            │   ├── AvailabilityPolicy            可见性、开放期、上限、次数和关闭文案
            │   ├── ReviewWorkflow                可选的阶段、审核人、量表和决定规则
            │   └── MaterializationPlan           通过后能创建或链接什么正式对象
            ├── Position / Slot                   仅招募或需要名额的报名场景启用
            └── Entry                             一份暂存提交，永不直接等于正式资源
                ├── EntryRevision / answers       草稿、提交、补件后形成可审计版本
                ├── ReviewAssignment / Feedback   审核、冲突声明、评论和评分
                ├── Decision                      通过、候补、拒绝、撤回等决定
                └── Materialization               幂等的“转正”记录和生成对象链接
```

核心不变量：

1. 一份 `Entry` 固定关联提交时的 `CampaignRevision`；后续管理员编辑表单不会改变历史问题、校验或答案含义。
2. `Entry`、审核意见、决定和正式对象之间始终有可追溯链接；不要复制后失去来源。
3. 每一项活动域和资源引用都保存 `workspace_id`，使用复合外键或等效服务端校验。
4. 发布后编辑不是就地篡改：创建新 revision，经预览/校验后发布；未完成草稿是否迁移必须由管理员显式选择。
5. 结果转化必须是服务端事务和幂等操作。重试不能重复创建人员、节目或分配。

## 四种 Campaign 的边界

| 类型 | 填写者要完成的事 | 典型正式结果 | 默认审核方式 | 关键专属能力 |
| --- | --- | --- | --- | --- |
| `REGISTRATION` 报名 | “我/我们参加这场活动。” | `ProductionRegistration`，必要时再关联参与人和签到记录 | 自动确认、人工确认或候补 | 人数、票种/组别、签到、取消、候补转正 |
| `SUBMISSION` 征集 | “我提交一个节目、作品、方案或资料。” | `ProductionProgram` 或其他活动级提交成果；可选择提升为 `Program` | 多阶段评审、补件、评分很常见 | 附件、共同提交者、作品版本、技术需求 |
| `RECRUITMENT` 招募 | “我申请某岗位/班次。” | `ProductionPerson` + Crew Assignment；可选 `ProductionMembership` | 人工筛选、面试/试岗、候补 | Position、Slot/Shift、可用时间、岗位名额、资质/作品集 |
| `COLLECTION` 通用收集 | “我提供这次运营需要的信息。” | 默认是保留的 `FormResponse`；经专用配置可生成活动需求/记录 | 通常无需审核 | 车辆、住宿、餐饮、尺码、反馈、补充资料 |

`COLLECTION` 不该默认“升级为资源库”。例如摄影师填写的自带相机是该场活动的一项资源承诺，不是已经验收的 Workspace 库存；场地线索也不是已确认的 Venue。应先形成活动级 `ResourceCommitment` / `Requirement` 或 `Candidate`，经过验证后才允许人工提升。

## Form Builder：应做成可组合文档，而非字段数组

既有讨论中「内容块 + 输入字段」的判断正确，建议落实为线性 `blocks[]` 文档：

```text
Welcome / 封面
动态活动信息（绑定活动名称、日期、地点、主办方）
Heading / Rich text / Callout / Image / Divider / FAQ / Terms
Field（问题）
Section 或 Page break
Conditional rule
Ending（确认、下一步、公开追踪链接）
```

Typeform 将欢迎页、说明内容和结束页视为表单体验的一部分；其 Welcome Screen 是每个表单一个的开始设置，结束页支持默认、自定义和重定向。Jotform 与 Google Forms 也将 Thank You/Confirmation 放在设置或 Presentation，而不是普通问题列表中。因此 StagePilot 将 welcome/ending 提升为 FormVersion `presentation` 设置，内容 blocks 只保留可排序的说明、分组、同意和上传提示；仍无需额外引入 Campaign Public Page。参见 [Typeform Welcome Screen](https://help.typeform.com/hc/en-us/articles/360052366812-Welcome-Screen)、[Typeform End Screens](https://help.typeform.com/hc/en-us/articles/360051791392-End-Screens-and-redirects)、[Jotform Thank You Page](https://www.jotform.com/help/211-Setting-Up-the-Thank-You-Page/)、[Google Forms Presentation](https://support.google.com/docs/answer/2839588?hl=en)、[Tally input blocks](https://tally.so/help/input-blocks) 和 [Tally conditional logic](https://tally.so/help/conditional-form-logic)。

### 首版字段范围

先实现稳定且可审计的原子字段：短/长文本、邮箱、电话、数字、日期/时间、单选、多选、下拉、URL、文件、确认/同意、分节/分页。再增加两类 StagePilot 专属复合块：

- `Person/Participant`：一人或多人资料、联系人与角色；不直接创建 Person。
- `Position/Slot picker`：从 Campaign 声明的岗位和班次选择，并受容量规则约束。

节目标题、时长、参演人员、岗位、可用时间、文件作品集等要使用 **semantic key（语义字段）**。用户可以改文案、帮助说明和排序，但当结果映射依赖该字段时，不能无提示删除或把它改成不兼容类型。普通自定义字段则有稳定的内部 key，不参与正式对象映射。

条件逻辑首版只应支持“回答条件 → 显示/隐藏字段或页面、变为必填、跳转结束页”，并提供全路径预览测试。复杂任意公式、任意脚本和跨 Campaign 引用应推迟；逻辑越强，发布前测试和版本冻结越重要。

### 公共事实、Campaign 内容和审计

- Production 负责“这场活动是什么”：名称、时间、地点、主办方。
- Campaign 负责“为什么请你填写”：岗位要求、征集说明、材料规范、名额、审核说明。
- 动态信息块可以绑定 Production/Workspace 公共事实，避免四张表单手工维护同一场地和日期。
- 动态内容在页面上可以实时显示，但 Entry 在提交时需保存其展示快照（至少记录活动名称、时间、地点和 schema revision），这样日后改期仍能解释提交者当时看到的内容。

## 开放、容量和候补：四个数字不能混用

`submission_limit`、`capacity`、`target`、`waitlist_limit` 的含义不同：

```text
submission_limit  最多接收多少份 Entry；达到后关闭或改为候补收集
capacity          最终可确认多少单位（人、队、节目、岗位名额）
target            希望达到的数量，只做运营提示，不触发关闭
waitlist_limit    最多接收多少候补，不设置则按策略无限
```

Jotform 目前支持按日期、提交数或两者先到者关闭表单，并显示自定义关闭说明；这验证了开放期和接收量应成为独立规则。[Jotform Form Status](https://www.jotform.com/help/137-how-to-limit-submissions-in-a-form/) 。

对于招募和班次报名，容量应同时可配置在 Campaign 总体与 `Position/Slot` 上。SignUpGenius 的候补附在已满的具体 slot，而不是整个表单；Eventbrite 也将候补触发点与认领时限作为独立配置。[SignUpGenius waitlists](https://support.signupgenius.com/hc/en-us/articles/29838121963031-How-to-Add-a-Waitlist-to-Your-Sign-Up) [Eventbrite waitlist setup](https://www.eventbrite.com/help/en-nz/articles/811539/how-to-set-up-an-event-waitlist/) [Eventbrite release flow](https://www.eventbrite.com/help/en-us/articles/817355/) 。

因此确认不是一次写状态，而应是一个 reservation/offer 流程：

```text
WAITLISTED
  └─ 管理员释放名额 → OFFERED（有 expires_at）
       ├─ 填写者确认 → CONFIRMED → 计入 capacity
       └─ 到期/拒绝   → EXPIRED → 名额回收
```

这能避免高并发下“同一个名额确认两次”，也允许招募的录用候选人确认能否到岗。发布/提交/确认各临界点必须由数据库事务重新检查名额，不能只相信前端显示的余量。

## 审核与评分：与 Form 和最终决定分层

审核不是 Form 的字段，也不是每种 Campaign 都必需。建议的组合从轻到重：

```text
AUTO_ACCEPT              提交即确认（适合低风险活动报名）
MANUAL_DECISION          负责人通过 / 候补 / 拒绝
SCORED_REVIEW            按标准量表评分，再由负责人决定
MULTI_STAGE_REVIEW       初审 → 专业评审 → 终审
```

Submittable 的流程将 Intake、Review、Award/Decision 分成不同阶段，并且在 Review 中分配审核人、评分或反馈表。这与 StagePilot 的“Entry 暂存层 → 可选审核流 → 明确转正”模型一致。[Submittable review rounds](https://next.support.submittable.com/hc/en-us/articles/30264107224983-Set-Up-a-Review-Round) [Submittable scoring guidance](https://next.support.submittable.com/hc/en-us/articles/41778908026775-Set-Up-a-Review-Round-That-Actually-Tells-You-Something) 。

审核数据需要四类独立记录：

- `ReviewStage`：名称、截止时间、通过条件、该阶段可见字段。
- `ReviewAssignment`：谁在何时被分配、接受/拒绝/完成状态、冲突声明。
- `ReviewFeedback`：每位审核者自己的表单答案、分项得分、备注、提交时间。
- `Decision`：有权角色作出的最终业务决定，而不是由平均分自动覆盖。

评分量表必须描述每个分值的含义；不要把“节目整体好不好”写成一题，也不要给每个原始问题强行打分。建议首版只做固定 1–5 或 1–10 的分项量表、权重和人工最终决定；回避冲突、匿名评审、复杂自动分组和大规模随机分配放到第二阶段。

## 通过后的“转正”规则

不要允许管理员用任意字段拖拽映射到任意数据库表。每个 `CampaignKind` 应有受控的主结果契约，模板/管理员在这个契约内配置字段绑定；额外结果必须显式选择。

| 来源 | 首选正式结果 | 可以选择的次级动作 | 不应默认发生 |
| --- | --- | --- | --- |
| 节目征集 | `ProductionProgram`（未来模型） | 从确认节目人工提升/合并到 Workspace `Program` | 直接写入节目库、覆盖同名节目 |
| 摄影师/志愿者招募 | `ProductionPerson` + 岗位/班次（未来模型） | 在去重确认后链接/提升到 Workspace `Person`；单独“授予后台访问” | 自动创建 `ProductionMembership` 或 Workspace Membership |
| 观众/嘉宾报名 | `ProductionRegistration`（未来模型） | 为签到、徽章、分组创建参与记录 | 将每个报名者都加入人员库或成员库 |
| 设备/车辆/住宿信息收集 | 活动级 `Requirement` / `ResourceCommitment` / `FormResponse` | 管理员确认后链接已有设备、场地、文件或提升候选资产 | 把“自带设备”直接计入 Workspace 库存 |
| 场地线索收集 | `VenueCandidate` 或活动线索（未来模型） | 验证后创建 `Venue` + `VenueSpace`，再建立 `ProductionLocation` | 未核验即作为可排期场地 |

每次转正都需要展示“将创建/链接什么”，允许选择重复处理策略（创建、链接已有、合并、跳过），并写一条 `EntryMaterialization`。这既适配当前已经独立的现实人员与登录成员模型，也避免长期资产库被临时资料污染。

## 公共提交者体验、隐私和附件

### 可见性与身份

建议从一开始支持：

```text
PUBLIC              知道链接即可填写
UNLISTED            不列出但知道链接可填写
INVITE_ONLY         需要 Campaign invite/token
INTERNAL            仅有活动访问权的工作人员填写
```

不应强制外部申请者先成为 StagePilot User。需要草稿、补件、撤回或查询状态时，使用高熵、可撤销、可到期的 `EntryAccessToken`/恢复链接；账户登录可在后续作为增强，不是收集的门槛。和现有邀请模型一样，token 只保存 hash，原文只在创建/显示时出现一次。

公开表单是一个独立的攻击面：速率限制、防重放/幂等提交、可选 CAPTCHA、最小权限的上传凭证、审计日志以及关闭状态的服务端校验是 V1 前置条件。

### 附件的硬性前置条件

当前对象存储接口适合已登录 Workspace 成员，不适合外部节目 Demo、作品集、证件照或简历。公开附件能力应采用：

```text
Entry upload token
→ 限定 Campaign + Entry draft + 字段 + 字节数 + 过期时间
→ 隔离桶 / quarantine
→ 服务端检测大小、签名、允许类型与恶意内容状态
→ 通过扫描后才在审核界面生成受控下载链接
```

OWASP 建议按业务所需扩展名做 allowlist、不要信任客户端 `Content-Type`、改写存储文件名、限制大小、采用隔离存储，并尽可能扫描或沙箱处理文件。[OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) 。这不是锦上添花；一旦支持外部上传，它是发布门槛。

### 隐私和可访问性

- 默认只问完成目的所必需的数据；字段要标注用途和保留期，敏感字段/附件默认仅审核者可见。NIST 将最小化定义为仅处理与目的直接相关且必要的 PII，并只保留必要时长。[NIST minimization](https://csrc.nist.gov/glossary/term/minimization) 。
- 每个公开 Form 必须配置联系方、隐私说明/同意块、数据导出/删除策略；不能把同意文本埋在普通描述里。
- 无障碍不是后置美化：实际 label、fieldset/section、清晰说明、文本错误和成功/失败通知是首版 renderer 的基本要求。W3C 建议长表单拆为逻辑步骤并提供进度；WCAG 要求可检测的输入错误以文本指出并提供 label/instruction。[W3C Forms Tutorial](https://www.w3.org/WAI/tutorials/forms/) [WCAG 2.2 Input Assistance](https://www.w3.org/TR/WCAG22/) 。

## 模板、发布和版本策略

```text
SystemTemplate v3 (只读)
       │ copy
WorkspaceTemplate v4 (可编辑)
       │ create snapshot
Campaign Draft Revision 1
       │ publish
Campaign Revision 1 (Entry 可提交)
       │ later edit + publish
Campaign Revision 2 (新 Entry 使用；旧 Entry 仍关联 Revision 1)
```

创建 Campaign 只能复制模板快照，不实时继承模板。正在收集或已提交的数据不能因为模板后来改了一题而失去解释。发布校验至少包括：所有映射语义字段存在且类型兼容；逻辑不存在循环/死路；必填字段可达；开放与关闭时间在 Production 时区下有效；容量/岗位/候补策略一致；公开上传字段具备类型与大小规则；审核工作流有可执行的负责人。

推荐提供“测试提交”模式：不计容量、不进入正式审核队列、不生成正式结果；用它验证所有分支、文件、结束页、评分和转正预览。公开发布后若必须改表，默认做新 revision，并在 Entries 视图清楚显示每条记录使用的版本。

## 交付分期

### Phase 0：在写 Campaign 前补齐边界

1. 确认 `ProductionProgram`、`ProductionPerson/Crew Assignment`、设备分配/需求的最小领域契约和复合外键。
2. 为公开附件建立隔离上传与扫描状态；不要复用现有 Workspace-member 文件上传接口。
3. 定义 Campaign/Entry 细粒度权限，至少分离管理、查看敏感资料、审核、决定、导出和转正。
4. 确认反滥用、隐私说明、数据保留和删除责任人。

### Phase 1：可发布、可管理的基础 Campaign

- `Campaign`、模板快照、`CampaignRevision`、Form blocks/字段、公开/非公开可见性。
- `SUBMISSION`、`RECRUITMENT`、`REGISTRATION`、`COLLECTION` 四种创建向导和系统模板。
- 开放/截止、提交数上限、每申请者限制、草稿、撤回、关闭页。
- Entry 收件箱、基本筛选、人工通过/拒绝/候补、审计日志和不产生正式对象的结果预览。
- 以「征集与招募」单入口 + 四个业务分组替换当前占位入口。

### Phase 2：活动结果与招募运营

- `ProductionProgram`、`ProductionPerson`、`ProductionRegistration` 和 `Position/Slot` 的最小实现。
- 可确认的名额 reservation/offer、岗位/班次候补、签到前状态。
- 受控结果映射、去重/链接已有 Workspace 资源、幂等转正记录。
- “授予后台访问”作为从已通过人员发起的独立动作，复用现有 Production Invite/Membership 基础设施。

### Phase 3：专业审核与规模化

- 多阶段审核、审核分配、评分表、分项权重、冲突声明、审核字段可见性和 review dashboard。
- 补件/重提、共同提交者、候补批量 offer、导出和合规保留策略。
- 模板版本治理、模板推荐、批量导入和跨 Production 复用。

## 暂不建议进入首版的范围

- 让管理员写任意脚本、SQL 或跨 Campaign 自动化。
- 从任何普通表单自动创建 Workspace 长期资产。
- 把真实工作人员、登录用户和审核人合并成同一张成员表。
- 公开上传大文件、音视频转码、病毒扫描、外部存储连接器和支付同时上线。
- 首版即建设 Production 公共官网；小型活动直接使用 Campaign 的 presentation 欢迎页、内容 blocks 和结束页即可。未来公共活动页可以聚合多个 Campaign，但它是另一个领域。

## 决策清单

本研究建议现在冻结的产品决策：

1. UI 叫「征集与招募」，底层叫 `Campaign`；不要把模块降格为「表单」。
2. 征集与招募为独立业务组；报名和通用收集同时保留，避免以后把非人力需求硬塞进招募。
3. `Entry` 始终是暂存层；审核、评分和最终转化绝不直接写入同一对象。
4. 系统模板 → 工作空间模板 → Campaign 快照；发布与提交版本不可变。
5. `Person` 与 `ProductionMembership` 继续严格分离；通过招募不等于取得后台权限。
6. 场地/设备/文件信息先形成活动级候选或承诺；验证后才允许进入长期资源库。
7. 公共附件与最小权限/隔离扫描同为 V1 前置，不以当前成员文件接口折衷。

## 来源账本与停止条件

外部资料均为产品官方帮助文档、行业安全标准或 W3C/NIST 一手资料；截至 2026-09-06 已交叉核验。继续增加同类表单产品不会改变上述架构结论，因此在此停止扩展检索。

| 主张 | 一手来源 |
| --- | --- |
| Form 的欢迎、内容、结束体验可构成一体 | [Typeform Welcome](https://help.typeform.com/hc/en-us/articles/360052366812-Welcome-Screen), [Typeform End Screens](https://help.typeform.com/hc/en-us/articles/360051791392-End-Screens-and-redirects), [Tally blocks](https://tally.so/help/input-blocks) |
| 条件逻辑应可测试、作用于内容块/流程 | [Tally Conditional Logic](https://tally.so/help/conditional-form-logic) |
| 日期、数量关闭条件和关闭信息是独立可配规则 | [Jotform Form Status](https://www.jotform.com/help/137-how-to-limit-submissions-in-a-form/) |
| 候补应与具体容量/slot，及认领时限分离 | [SignUpGenius Waitlist](https://support.signupgenius.com/hc/en-us/articles/29838121963031-How-to-Add-a-Waitlist-to-Your-Sign-Up), [Eventbrite Waitlist](https://www.eventbrite.com/help/en-nz/articles/811539/how-to-set-up-an-event-waitlist/), [Eventbrite Release](https://www.eventbrite.com/help/en-us/articles/817355/) |
| Intake、Review、Decision 应为不同工作阶段 | [Submittable Review Rounds](https://next.support.submittable.com/hc/en-us/articles/30264107224983-Set-Up-a-Review-Round), [Submittable Scoring](https://next.support.submittable.com/hc/en-us/articles/41778908026775-Set-Up-a-Review-Round-That-Actually-Tells-You-Something) |
| 外部附件需要类型 allowlist、内容校验、隔离与限制 | [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) |
| 公开表单要可访问并最小化个人信息 | [W3C Forms Tutorial](https://www.w3.org/WAI/tutorials/forms/), [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [NIST minimization](https://csrc.nist.gov/glossary/term/minimization) |
