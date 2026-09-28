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

新上传先使用短期预签名 URL 写临时键。完成时原上传者必须仍有写权限，服务端检查大小并条件复制到从未签发 PUT URL 的版本专属键，再事务性记录待扫描版本和幂等扫描任务；接口返回 `202 processing`，此时不发布当前版本。后台 Worker 从私有对象读取不可变字节，先校验文件签名／MIME，再通过通用 `Scanner` 接口扫描。ClamAV 是首个 adapter，只有 Worker 能访问它；Program、ProductionProgram 和 API handler 不接触 ClamAV。只有结果为 clean 才更新当前版本指针。新版本扫描期间保留上一版 clean 当前版本；感染、格式冲突和扫描限额命中都不能下载或发布。`GET /v1/file-upload-sessions/{uploadId}` 仅原上传者可查询，结果只暴露 `processing / ready / rejected`。

全文件入口统一限制为十进制 `2,000,000,000` 字节。服务端同时核对声明／实际对象大小并检测内容签名；客户端 MIME 不作为事实来源。未知签名使用 `application/octet-stream` 且只作为附件下载，不启用内嵌预览。ClamAV 的流大小、单文件大小、归档展开总量、递归深度、文件数和扫描时间均有界，任何限额命中均拒绝发布。头像仍走单独的静态图像解码重编码管线，不进入文件库或 ClamAV。

ClamAV 暂时不可用时扫描任务保持处理中，并按退避策略重试；绝不降级为 clean。扫描任务记录 SHA-256、引擎与签名库版本和安全结果。历史 v1 回填默认 pending；Worker 等旧预签名 PUT 到期并将对象固化后才扫描，未通过前新下载请求一律拒绝。感染对象隔离 30 天后由 Worker 清除对象字节，文件、附件关联、SHA-256 和扫描审计记录保留。未完成上传与未提交复制仍由 Worker 幂等清理。

活动节目从来源节目复制时指定 `attachment_id` 与可选 `version_id`；服务端建立独立 `file_id` 和 v1，记录 `source_file_id/source_version_id`。活动 A、B 各有自己的文件与版本链，来源新版本不会自动同步。已签发的下载 URL 仍按现有五分钟到期，新请求总是重新授权。

## API

- 旧 `/v1/workspaces/{id}/files` 保留。新增 `GET/POST .../{fileId}/versions`、`GET .../{fileId}/versions/{versionId}/download`。
- `POST /v1/file-upload-sessions/{uploadId}/complete` 提交新版本或附件并返回 `202 processing`；`GET /v1/file-upload-sessions/{uploadId}` 由原上传者查询扫描状态。
- `GET/POST /v1/workspaces/{id}/programs/{programId}/attachments` 管理 Workspace 节目附件。
- `GET/POST /v1/productions/{productionId}/programs/{programId}/attachments` 管理活动节目附件；`POST .../attachments/copy` 复制固定来源版本。
- `GET/POST /v1/attachments/{attachmentId}/versions`、`GET /v1/attachments/{attachmentId}/download?version_id=...`、`DELETE /v1/attachments/{attachmentId}` 作用于持久化关联而非客户端声明的父对象。

公开 Campaign/Entry 文件字段、预览、全文搜索和可配置 ACL 不在本期；公开上传不能复用这些成员 API。

其他纵向领域的附件父对象、类型化关联、权限和接入验收契约见[文件与附件模块接入契约](file-attachment-integration.md)。
