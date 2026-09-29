# 文件后台任务运营与灾备

本文记录文件扫描、存储对账、敏感访问审计、双 S3 复制和 PostgreSQL 恢复的运维边界。它不承诺法律保留期限，也不代表本地 Compose 的两个 MinIO 实例构成真正的异地灾备。

## 后台扫描任务

Worker 从不可变文件版本读取内容并调用扫描端口。ClamAV 不可用时 Worker 先做 PING 检查，不领取扫描任务，也不增加尝试次数；任务继续保持处理中。扫描执行失败按退避重试，累计 12 次后进入 `needs_attention`，不再自动领取。对象缺失或实际大小不符会立即进入人工处理状态；感染、格式冲突和扫描限额命中属于用户可见的安全拒绝，不等于后台故障。

用户侧只看到 `processing / ready / rejected`。`needs_attention`、最近错误和扫描器签名信息仅由运维查询。

```powershell
docker compose -f docker/compose.yaml exec api file-ops scan-status
docker compose -f docker/compose.yaml exec api file-ops scan-list --workspace <workspace-id>
docker compose -f docker/compose.yaml exec api file-ops scan-retry --task <task-id> --actor <operator> --reason "已确认对象恢复" --case INC-1234
docker compose -f docker/compose.yaml exec api file-ops replica-list --workspace <workspace-id>
docker compose -f docker/compose.yaml exec api file-ops replica-retry --task <replication-task-id> --actor <operator> --reason "已确认副端配置修复" --case INC-1234
```

人工重试只允许 `needs_attention` 任务；重置尝试次数并写入追加式扫描尝试与运维审计记录。操作者、原因和案件/工单引用均必填。

## 持久化对象对账

Worker 每 6 小时遍历 Workspace 正式版本、历史版本、上传暂存、待提交副本、未完成分段，并独立清点账户头像。头像不计入任何 Workspace 的存储额度。每次清点保存 run 与逐对象 finding；在途复制或删除任务视为已知对象，不当作孤儿。

- 引用存在但对象缺失：立即记录 finding 并阻止该 Workspace 新上传。
- 对象大小与数据库不符：立即记录并阻止该 Workspace 新上传。
- 未知对象和遗留分段：连续两次完整清点仍存在才确认；确认的未知对象计入真实物理占用，但不自动删除。
- finding 只有在重新核验确认差异消失后才能关闭；关闭本身也写入运维审计。

```powershell
docker compose -f docker/compose.yaml exec api file-ops reconcile-run --actor <operator> --reason "例行完整核对" --case OPS-4321
docker compose -f docker/compose.yaml exec api file-ops reconcile-run --workspace <workspace-id> --actor <operator> --reason "调查上传阻断" --case INC-1234
docker compose -f docker/compose.yaml exec api file-ops reconcile-list
docker compose -f docker/compose.yaml exec api file-ops reconcile-recheck --finding <finding-id> --actor <operator> --reason "修复后复核" --case INC-1234
```

Workspace 范围的清点会更新物理账本与上传阻断状态；头像清点单独记录，不改变 Workspace 额度。重新核验只确认差异是否已消失，不会删除对象或改写来源记录。

## 文件列表分页

文件库、回收站、节目附件和版本历史统一接受 `limit` 与不透明 `cursor`。默认 50 条，最大 100 条；排序键为 `(created_at DESC, id DESC)`。响应保留 `items`、`total` 和现有权限能力字段，并增加 `next_cursor`。受限附件会在 SQL 查询中过滤后才分页，列表总数也只统计当前用户有权看到的项目。桌面端通过“加载更多”继续请求，不一次加载全量历史。

## 敏感文件访问审计

`file_security_audit_events` 记录敏感附件下载授权签发、已知敏感附件的拒绝访问、解除关联和恢复。成功的下载授权审计必须先成功写入数据库，再把五分钟预签名 URL 返回客户端；数据库故障时不签发链接。授权事件包含用户、附件、版本、父对象、权限依据和请求标识，但不存储对象密钥、预签名 URL 或对象存储凭据。

MinIO 的 webhook 接收器只接受带 Bearer token 的内部请求，只持久化 `GetObject` / `DeleteObject` 的时间、bucket、object key、存储请求 ID、状态码和结果。MinIO 原始事件含请求头和查询参数，接收器使用白名单字段解析，不存储或记录签名查询参数和 Authorization 头；未处理操作会忽略。因为原始 webhook payload 含签名材料，本地配置不启用会把原始 payload 写盘的持久失败队列；API 暂时不可用时事件可能无法补录。对象事件不包含 StagePilot 人类身份，需按对象键和时间与应用授权事件尽力关联；多份同时有效的预签名 URL 不承诺精确到人的数据面归因。外部 S3 上线时必须启用对应的数据访问事件记录，并使用等价的脱敏接收器，同时评估审计传输失败和签名材料在供应商侧的处理。[MinIO 审计日志配置](https://min.io/docs/minio/linux/reference/minio-server/settings/metrics-and-logging.html) [MinIO 审计事件结构](https://min.io/docs/minio/linux/operations/monitoring/minio-logging.html)

## 主、副 S3

主端继续使用 `S3_ENDPOINT / S3_BUCKET`。Worker 另外使用 `S3_REPLICA_ENDPOINT / S3_REPLICA_BUCKET` 和独立凭据，将每个不可变版本及头像对象复制到副端原键；数据库任务记录租约、重试、字节数和 SHA-256，复制后再次读回副本核验。历史对象由 Worker 扫描补入任务表。副端任务失败不会影响在线读取，但 `needs_attention` 和积压须由运维定期检查。

正式部署中，副 S3 必须使用独立账户或至少独立故障域；仅让 Worker 与备份组件拥有副端凭据。主桶与副桶均关闭 S3 版本控制，采用应用级复制，不使用依赖桶版本控制的原生 S3 Replication。主端物理清理后，副本再保留 30 天；副本从不随普通软删除立即删除。Compose 的 `minio-replica` 只是连通性和故障重试测试，和主 MinIO 同主机、同 Docker 环境，不是灾备副本。

`S3_REPLICA_REQUIRED=true` 时，文件对象只有在副本状态为 `replicated` 后才允许物理清理。副端不可用或副本完整性不符会延后清理，避免主、副两端同时丢失唯一副本。工作进程每轮更新连续复制水位；积压与最早待复制时间通过下方 `backup-status` 查看。

## PostgreSQL 备份与恢复

自管 Compose 使用固定 WAL-G 3.0.9 镜像：每日做一次 base backup，通过 `wal-receive` 连续接收 WAL 至副 S3，并保留约 31 份完整备份。实际保留跨度受成功备份频率影响。复制 slot 在备份组件中断时可能保留 WAL；PostgreSQL 为 slot 配置 10 GiB 上限，超过上限会使 slot 失效，需要运维检查 `backup-status` 并重新建立 WAL 接收链路。[WAL-G PostgreSQL 命令](https://github.com/wal-g/wal-g/blob/master/docs/PostgreSQL.md) [PostgreSQL 连续归档与 PITR](https://www.postgresql.org/docs/17/continuous-archiving.html)

```powershell
docker compose -f docker/compose.yaml exec api file-ops backup-status
docker compose -f docker/compose.yaml exec pg-backup restore-drill
```

恢复演练会把最近 base backup 下载到隔离临时目录，回放可用 WAL、启动隔离 PostgreSQL 并执行 `SELECT 1`，然后更新 `file_backup_status`。演练验证“可以启动并读库”，不是完整业务验收；发布恢复演练还应核对数据库中随机抽样的文件版本、头像键能否在副 S3 读取，执行文件对象对账，并启动 API/Worker 冒烟测试。

安全恢复点只在 base backup、WAL 归档水位和连续对象副本水位都存在时报告，按数据库 WAL 水位与副本完整水位中较早者计算。目标 RPO ≤ 1 小时、RTO ≤ 4 小时是部署目标，不是当前自动告警承诺；本期没有 Prometheus/Alertmanager，也没有自动通知。需由后续统一监控接入 `backup-status`、积压、`needs_attention`、清点失败、WAL slot 与恢复演练结果。生产若用托管 PostgreSQL，应以供应商 PITR 替代本 Compose 的 WAL-G，并保证副本水位和数据库恢复时间可比较。

数据库备份与对象副本必须使用不同存储桶和专用最小权限凭据。不要把恢复演练直接指向生产数据目录；真实灾备演练必须使用隔离数据库与隔离 S3 读取凭据，记录操作者、恢复点和核验结果。备份桶本身也需要访问控制、静态加密和独立故障域。
