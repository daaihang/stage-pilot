export const programTypes = [
  { value: "music", label: "音乐" },
  { value: "dance", label: "舞蹈" },
  { value: "theater", label: "戏剧" },
  { value: "talk", label: "分享" },
];

export const programStatuses = [
  { value: "ready", label: "可用" },
  { value: "draft", label: "草稿" },
  { value: "archived", label: "已归档" },
];

export const programFixtures = [
  { id: "program-1", name: "星河序曲", type: "music", status: "ready", durationMinutes: 8, tags: ["开场", "器乐"], performers: "StagePilot 乐团", organization: "StagePilot 艺术中心", updatedAt: "2026-08-28" },
  { id: "program-2", name: "城市的回声", type: "theater", status: "ready", durationMinutes: 18, tags: ["原创", "叙事"], performers: "南岸剧社", organization: "南岸剧社", updatedAt: "2026-08-24" },
  { id: "program-3", name: "春日舞步", type: "dance", status: "draft", durationMinutes: 12, tags: ["群舞", "青春"], performers: "青少年舞团", organization: "新城文化馆", updatedAt: "2026-08-21" },
  { id: "program-4", name: "给未来的信", type: "talk", status: "ready", durationMinutes: 10, tags: ["分享", "主题演讲"], performers: "林安", organization: "独立创作者", updatedAt: "2026-08-18" },
  { id: "program-5", name: "雨夜爵士", type: "music", status: "ready", durationMinutes: 25, tags: ["爵士", "现场"], performers: "Blue Note 五重奏", organization: "蓝调文化工作室", updatedAt: "2026-08-14" },
  { id: "program-6", name: "纸上剧场", type: "theater", status: "archived", durationMinutes: 15, tags: ["亲子", "互动"], performers: "纸上剧场", organization: "纸上剧场", updatedAt: "2026-07-30" },
];

export const programTypeLabel = Object.fromEntries(programTypes.map((item) => [item.value, item.label]));
export const programStatusLabel = Object.fromEntries(programStatuses.map((item) => [item.value, item.label]));
