# 节目单云端版本与受控分享

节目单编辑数据存储在 `program_sheets` 和 `program_sheet_items`。发布时服务端在事务中生成 `program_sheet_releases` 不可变快照，分享链接只绑定发布快照，不直接读取可变草稿。

## 链接

- 长链接：`/share/program-sheet/<token>`，默认长期有效，可撤销。
- 短链接：`/s/ps/XXXXX-XXXXX`，使用独立的 Crockford Base32 10 位短码，默认 30 天有效，可轮换。它与邀请短码不共用语义或数据库记录。
- 数据库只保存 token 的 hash；链接不使用 query string bearer token。
- 外部分享需要配置 `PUBLIC_WEB_ORIGIN`，不能使用 Tauri 本地 origin。

## 范围

`link` 允许持有链接的人只读访问一个发布快照；`members` 需要当前有效的 Workspace 或活动成员授权。两种范围都只返回观众可见条目，不返回备注和执行标记。

链接必须同时满足：短码未过期、链接未撤销、发布快照存在且节目单仍为 `published`。节目单归档或停用后，所有指向它的链接立即失效；重新发布新版本需要创建新的发布快照和分享链接。

旧版本 `productionProgramSheets:{productionId}:v1` 只由前端迁移服务读取。管理员首次打开节目单时提交迁移；服务端已有数据时不会覆盖，迁移成功后才删除本地快照。迁移失败会保留快照，方便重试。
