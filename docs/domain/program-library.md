# 节目库

`Program` 是 Workspace 的可复用节目资产，包含默认节目类型、时长、标签、描述和技术备注。它不是活动中的实际节目排期。

`ProgramType` 由每个 Workspace 独立管理。创建 Workspace 时复制音乐、舞蹈、戏剧、语言、其他五个默认类型；管理员可新增、排序和停用类型。停用类型保留历史引用，但不能作为新节目的选择项。

节目来源是审计信息：首版手工创建为 `manual`；导入、模板和未来从活动提升的节目分别使用 `import`、`template`、`promoted_from_production`。后续 `ProductionProgram` 将引用 Program 或创建活动级节目，并可显式提升到节目库。
