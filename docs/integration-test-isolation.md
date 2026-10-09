# 后端集成测试隔离

API 和 Worker 集成测试会创建用户、Workspace、文件版本及对象。测试只能使用 `stagepilot-tests` 项目的独立 PostgreSQL 和 MinIO；不要把运行中的应用库或主文件桶用作测试资源。测试库与对象桶一起重置，避免数据库仍引用已经清理的测试对象。

在仓库根目录启动测试资源：

```powershell
docker compose -f docker/compose.test.yaml up -d postgres minio
docker compose -f docker/compose.test.yaml run --rm migrate
docker compose -f docker/compose.test.yaml run --rm minio-setup
```

在运行 Go 测试的同一个 PowerShell 会话中设置连接：

```powershell
$env:TEST_DATABASE_URL = 'postgres://stagepilot_test:stagepilot-test-password@localhost:15433/stagepilot_test?sslmode=disable'
$env:S3_ENDPOINT = 'http://localhost:19020'
$env:S3_PUBLIC_ENDPOINT = 'http://localhost:19020'
$env:S3_ACCESS_KEY = 'stagepilot-test'
$env:S3_SECRET_KEY = 'stagepilot-test-secret'
$env:S3_BUCKET = 'stagepilot-test'
$env:S3_STAGING_BUCKET = 'stagepilot-test-staging'
$env:S3_PATH_STYLE = 'true'
$env:FILES_WORKSPACE_PHYSICAL_MAX_BYTES = '100000000000'
```

然后分别在 `backend/api`、`backend/worker` 目录运行 `go test ./...`。不设置 `TEST_DATABASE_URL` 时，集成测试跳过；单元测试照常运行。测试入口拒绝数据库名不以 `_test` 结尾的连接；涉及对象存储的测试还要求 `*-test` 正式桶和对应的 `*-test-staging` 暂存桶。

测试完成后，从仓库根目录清理**整个独立测试项目**：

```powershell
docker compose -f docker/compose.test.yaml down -v
```

这个命令只删除 `stagepilot-tests` 的容器和卷；主应用的 `docker/compose.yaml` 数据卷不在其范围内。若要保留测试现场用于调试，暂不执行此命令，但也不要单独删除正式文件对象：回收期内的文件版本仍被测试数据库引用。
