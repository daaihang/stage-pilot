# 场地与空间

`Venue` 表示长期可复用的场所资料，记录类型、城市、地址、时区和说明。`VenueSpace` 是 Venue 内可被活动实际选择的空间，例如主剧场、排练厅、后台或户外区域。

容量与技术条件属于 VenueSpace，不应放在 Venue 上。场地和空间可独立归档；后续活动选址将引用具体 VenueSpace，并以 Workspace 复合外键保证隔离。
