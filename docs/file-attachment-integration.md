# 文件与附件模块接入契约

本文说明 Workspace、Production 及其他纵向模块如何接入横向文件能力。它描述的是模块接入边界与必须满足的契约，不代表所有列出的领域都已经有附件 API。

当前已落地的试点是 Workspace `Program` 和活动 `ProductionProgram`。文件版本与权限基座见[文件版本与节目附件基座](file-attachments.md)。

## 领域边界

```text
纵向业务模块
  ├─ 决定附件属于哪个业务对象、哪些人能看和能改
  ├─ 用类型化关联表把附件连到真实父对象
  └─ 向页面提供父对象上下文
          ↓
文件附件服务
  ├─ 校验父对象、租户范围和操作权限
  ├─ 管理逻辑文件、版本、上传会话和附件关联
  ├─ 返回服务端计算的 capabilities
  └─ 通过存储适配层读写对象
          ↓
对象存储 / 后台处理器
```

纵向模块不直接调用 MinIO/S3，不自行实现预签名、版本和对象清理，也不把物理对象键写入业务表。文件服务不猜业务权限；它通过明确的父对象解析器调用该领域的授权规则。

核心概念分别是：

| 对象 | 责任 | 接入规则 |
| --- | --- | --- |
| `files` | 稳定逻辑文件 ID、租户及当前版本指针 | 业务页面不直接读写对象键 |
| `file_versions` | 不可变内容快照、创建者、来源版本 | 新版本通过上传会话提交；历史版本只读 |
| `file_attachments` | 文件分类、敏感级别、软解除关联 | 一个附件文件只绑定一个授权父对象 |
| 领域关联表 | 把附件绑定到 Program、Equipment 等真实父对象 | 每种父对象使用明确的类型化表和复合外键 |
| `file_types` | 文件分类，例如说明书、版权资料 | 分类不授予访问权，也不能降低敏感级别 |

当前 `file_attachments.file_id` 有唯一约束，附件不是可任意多处复用的共享链接。需要活动固定快照时，复制指定版本并记录来源；若未来需要一个对象被多个父对象共同引用，必须先单独设计多父对象授权语义，不能绕过现有唯一约束。

## 父对象接入契约

每个新领域接入前，先写清楚下面这些决定：

1. **父对象是什么**：例如 `equipment_item`、`venue_space`、`person`、`membership`、`entry`。`User`、`Person` 和 `WorkspaceMembership` 是不同对象，不可混为一个文件所有者。
2. **归属范围是什么**：父对象真实的 `workspace_id`；若属于活动，还要验证其真实 `production_id`。请求体中的 ID 只能作为查找条件，不能作为授权依据。
3. **生命周期如何影响附件**：父对象归档、软删除或活动撤销后，附件是否只读、不可见或仍可审计。每个领域要明确规则。
4. **安全级别有哪些**：至少区分普通资料和受限资料。身份证明、健康材料、合同等不能因为选了某个 `file_type` 就自动得到普通成员可见权限。
5. **角色动作矩阵是什么**：谁能查看元数据、下载字节、创建附件、上传新版、解除关联。`view` 和 `download` 必要时应分别授权。
6. **附件语义是什么**：随父对象共享、独立快照、仅本人可见、公开提交材料等，语义不同就使用不同授权规则和上传入口。

### 数据库

为每种父对象建立类型化关联表，不使用 `parent_type + parent_id` 指向任意表。示意：

```sql
CREATE TABLE equipment_file_attachments (
    attachment_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    equipment_item_id TEXT NOT NULL,
    FOREIGN KEY (workspace_id, attachment_id)
        REFERENCES file_attachments(workspace_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (workspace_id, equipment_item_id)
        REFERENCES equipment_items(workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX equipment_file_attachments_parent_idx
    ON equipment_file_attachments(workspace_id, equipment_item_id);
```

实际迁移应按目标表的复合唯一键和活动归属约束调整；活动内父对象通常还要把 `production_id` 放进外键，确保父对象和活动不能跨租户或跨活动拼接。新表采用软解除关联，不物理删除文件或历史版本。

### 服务端

服务端为父对象增加显式解析与授权适配：

- 按允许的父对象类型从数据库读取记录，再取得 Workspace、Production、状态和授权上下文。
- 对租户、Production 和父对象 ID 做组合验证；任何不匹配都拒绝，不回退到客户端声明的归属。
- 对附件列表只返回当前用户可见的记录，避免通过名称、文件类型或附件数量泄漏受限资料。
- 每条附件以及列表级响应返回服务端计算的 `capabilities`。桌面端用能力控制入口；服务端仍对每次写入、下载和历史版本请求重新授权。
- 保持附件 ID 操作的授权父对象来自已保存的关联表。客户端不能通过换 URL 中的 Workspace/Production ID 改变附件范围。

动作名沿用现有文件动作：`view`、`download`、`attach`、`upload_version`、`detach`、`delete`。常见能力字段为 `can_attach`、`can_attach_restricted`、`can_download`、`can_upload_version`、`can_detach`。能力返回只是 UI 提示，不替代实际 API 鉴权。

### API 与桌面页面

创建和列表使用带领域上下文的路由；附件的版本、下载和解除关联使用附件 ID，但服务端从持久化关系解析真实父对象。新领域可遵循以下形态：

```text
GET/POST /v1/workspaces/{workspaceId}/equipment/{equipmentId}/attachments
GET/POST /v1/attachments/{attachmentId}/versions
GET      /v1/attachments/{attachmentId}/download?version_id=...
DELETE   /v1/attachments/{attachmentId}
```

路由名字应沿用该领域已有 API 命名。创建附件时，类型必须属于父对象的 Workspace 和领域 scope；活动复制等快照动作还必须同时校验来源读取权和目标附加权。

桌面端在现有资源详情区域组合共享附件 UI 与薄领域适配器；页面不自建 Sheet/抽屉，不接触对象存储 URL 以外的底层存储协议，也不复制授权规则。共享组件只负责列表、上传、新版本、历史下载、解除关联和反馈；领域适配器负责调用正确的父对象端点、文件类型 scope 和可选的复制操作。

当前 `FileAttachmentsSection` 仍直接识别 Program/ProductionProgram 路由，是首个试点组件，不是已经完成的任意父对象插件。接入第二种领域时，应先把它拆成通用展示组件与小型领域适配层，再接入新页面；不要把更多 `if (type === ...)` 长期堆进同一个组件。

## 上传、版本和安全扫描

正常成员附件沿用现有流程：创建上传会话、直传临时对象、服务端完成时复验上传者与权限和对象大小、服务端复制到版本专属对象键、事务写入版本并切换当前版本。版本发布后不可由原预签名 PUT 覆盖。

本仓库目前没有病毒扫描器容器、扫描服务或扫描状态工作流。接入模块不能把“对象上传完成”描述成“内容安全”。扫描器应作为后台处理器调用的独立接口，例如 `Scan(objectRef) -> clean | infected | unsupported | error`；ClamAV 将来可以是一个实现，不能成为 Program、Person 或表单模块的直接依赖。扫描任务应可重试、幂等，失败或不支持的文件不能默认为 clean。对象存储事件也可能重复或乱序，后台处理应以持久化任务状态和对象版本标识去重。[AWS S3 事件通知说明](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html)

在实际扫描服务与发布状态接通前，不开放匿名公开上传、身份证明/健康材料等高敏附件，也不提供可内嵌执行主动内容的预览。普通内部文件目前仍按既有成员文件流程运行；这是现状，不代表它们已经扫描。上传文件还应校验实际内容类型和签名，不能只信客户端 `Content-Type`；[OWASP 文件上传指南](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)对此有明确建议。

公开 Campaign/Entry 上传必须使用独立的公开上传凭证，绑定 Campaign、Entry 草稿、字段、大小和过期时间，并在扫描通过前保持隔离。不得把匿名请求接到 Workspace 成员文件 API。当前表单文件字段仍不可提交，含文件字段的公开版本也不可发布，见[Campaign 契约](domain/campaign-contract-v1.md)。

## 各领域文件需求与接入顺序

| 领域 | 典型附件 | 当前状态 | 建议顺序与注意事项 |
| --- | --- | --- | --- |
| Workspace 文件库 | 跨资源的制度、合同、资料 | 独立文件库已支持 | 与父对象附件分开；没有自然父对象时才放文件库 |
| Workspace Program | 海报、音视频、技术资料、版权 | 已接入 | 现有试点 |
| ProductionProgram | 本场活动使用的节目文件 | 已接入 | 按指定版本复制，活动副本独立演进 |
| Equipment | 说明书、规格书、维护记录 | 分类已预置，附件未接 | 建议第二个试点：Workspace 级、低耦合、权限路径简单 |
| Venue / VenueSpace | 场地平面图、舞台布局、安全和技术资料 | 分类及资源已存在，附件未接 | 区分场地级与具体空间级文件；明确归档后是否仍可读 |
| Organization | 机构资质、合作协议、宣传资料 | 分类已预置，附件未接 | 先确定普通资料与受限合同的可见角色 |
| Person | 履历、作品集、合同、身份证明 | 分类已预置，附件未接 | 身份证明不能随普通通讯录读取权限开放；扫描与审计策略先行 |
| WorkspaceMembership | 成员合同、资质、身份、健康资料 | 分类已预置，附件未接 | 需要本人访问、管理员治理及高敏访问审计规则；不要和 Person 共用父对象 |
| Production 其他对象 | ProductionPerson、地点、资源承诺、执行材料 | 活动文件库可存通用资料；对象附件未接 | 随各业务实体稳定后逐个接入，并遵循有效 Production 权限 |
| Campaign / Entry | 报名作品、证明、附件答案 | 文件字段被禁止 | 最后接入；独立匿名凭证、字段级限制、隔离扫描和隐私生命周期 |
| 账号 User | 头像 | 目前为 `avatar_url` | 作为账号图片资产单独设计；不自动进入 Workspace 人员附件 |
| 公告 | 公告封面和附件 | 尚无已落地附件模型 | 等公告领域确定后，把文件关联公告并继承公告受众；通知记录不拥有附件 |

## 接入验收清单

- [ ] 父对象、租户、Production 归属和生命周期规则已写清楚。
- [ ] 文件类型 scope 与敏感级别分开定义；类型不会授予权限。
- [ ] 数据库使用类型化关联表、复合外键和父对象索引，没有多态裸 ID。
- [ ] API 从数据库解析父对象；跨 Workspace、跨 Production 和伪造父对象测试均拒绝。
- [ ] 列表只展示当前用户可见的附件，并返回服务端能力；隐藏附件不泄漏元数据。
- [ ] 当前版本与任意合法历史版本走相同父对象授权；未知或其他文件的版本 ID 被拒绝。
- [ ] 新版本不可变；解除关联只软隐藏关系；快照复制记录来源文件与版本。
- [ ] UI 放在现有详情面板，使用共享通知反馈；无页面级重复抽屉。
- [ ] 高敏或公开入口具备扫描、失败隔离、限额、保留期和审计方案；扫描器未配置时不把文件标为已扫描。

## 参考

- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [OpenFGA Parent-Child Objects](https://openfga.dev/docs/modeling/parent-child)
- [Amazon S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html)
