# 人员与机构

`Person` 是业务通讯录实体，不等于可登录的 `User`，两者首版不自动绑定。人员类别为演出者、工作人员或联系人；技能和标签是检索信息。

`Organization` 是长期合作实体，如主办方、合作方、赞助方、供应商、学校或演出团体。`OrganizationContact` 把某个 Person 关联到 Organization，并记录职位和主联系人标志。关联只能发生在相同 Workspace。

Production 内的实际岗位、班次、部门与权限属于后续 Production 人员模型，不能把 Workspace 系统角色或登录账号角色混入 Person 数据。
