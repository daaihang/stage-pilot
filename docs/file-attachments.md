# 文件版本与节目附件基座

`Workspace` 是租户；`Production` 是活动执行范围。文件能力横跨两者，但不创建第三层租户。业务身份分为三层：

| 记录 | 职责 |
| --- | --- |
| `files` | 稳定逻辑文件 ID、原始安全范围、当前版本与软删除状态 |
| `file_versions` | 不可变的内容快照；版本号、对象键、大小、上传者和来源版本 |
| `file_attachments` | 文件和父业务对象的关联、文件类型与敏感级别；节目和活动节目各有复合外键关联表 |

`file_types` 只分类，不授权。`program.rights` 上传时强制成为 `restricted`，亦可显式选择敏感资料。敏感级别在本期不可降低。附件文件的 `access_mode='attachment'`，不会出现在旧文件库列表或通过旧 `/files/{id}` 下载；解除关联只软隐藏附件，不删除文件和版本。

## 服务端授权

统一动作是 `view`、`download`、`attach`、`upload_version`、`detach`、`delete`。服务端先从附件 ID 查其持久化父对象，再按父对象的真实 Workspace／Production 与 active membership 授权；新建时也必须查父对象，不接受客户端指定的归属作为授权依据。历史版本下载与当前版本使用同一附件授权。

| 父对象与级别 | 查看／下载 | 创建／新版／解除关联 |
| --- | --- | --- |
| Workspace 节目普通 | active Member 及以上 | active Owner/Admin |
| Workspace 节目敏感 | active Owner/Admin | active Owner/Admin |
| 活动节目普通 | 有效 `production.view` | 有效 `production.edit` |
| 活动节目敏感 | Workspace Owner/Admin 或该活动有效直接 Producer | 同左 |

活动权限沿用 `productionAccessFor`，包含直接成员、暂停／撤销与时间窗口。复制附件需同时有来源读取和目标附加权限；不会把来源文件的权限扩散到目标活动。列表只返回当前用户可见附件及服务端计算的 `capabilities`，桌面入口据此展示。

## 上传、版本与活动副本

迁移 42 将原有 `uploaded` 文件按同一 `file_id` 回填为 v1，不移动旧对象；后续 Worker 在旧预签名 URL 过期后将旧 v1 固化为服务端专用对象键。已有 `pending / abandoned` 记录继续沿用原清理路径。迁移 43 约束一个附件文件只能绑定一个父对象。

新上传先使用短期预签名 URL 写临时键。完成时原上传者必须仍有写权限，服务端检查大小并条件复制到从未签发 PUT URL 的版本专属键，再事务性记录版本和切换当前指针。已完成的上传会话重复完成返回同一版本；并发完成只提交一个版本。未完成会话、预签名链接过期后的已完成会话临时键，以及未提交的复制尝试由 Worker 重试回收；正式文件及其历史版本不做物理清理。单次 S3 Copy 超过 5 GB 时使用分段服务端复制。

活动节目从来源节目复制时指定 `attachment_id` 与可选 `version_id`；服务端建立独立 `file_id` 和 v1，记录 `source_file_id/source_version_id`。活动 A、B 各有自己的文件与版本链，来源新版本不会自动同步。已签发的下载 URL 仍按现有五分钟到期，新请求总是重新授权。

## API

- 旧 `/v1/workspaces/{id}/files` 保留。新增 `GET/POST .../{fileId}/versions`、`GET .../{fileId}/versions/{versionId}/download`。
- `POST /v1/file-upload-sessions/{uploadId}/complete` 确认新版本或附件上传。
- `GET/POST /v1/workspaces/{id}/programs/{programId}/attachments` 管理 Workspace 节目附件。
- `GET/POST /v1/productions/{productionId}/programs/{programId}/attachments` 管理活动节目附件；`POST .../attachments/copy` 复制固定来源版本。
- `GET/POST /v1/attachments/{attachmentId}/versions`、`GET /v1/attachments/{attachmentId}/download?version_id=...`、`DELETE /v1/attachments/{attachmentId}` 作用于持久化关联而非客户端声明的父对象。

公开 Campaign/Entry 文件字段、预览、全文搜索、病毒扫描工作流和可配置 ACL 不在本期；公开上传不能复用这些成员 API。
