import {
  Building2,
  CalendarDays,
  FileText,
  FolderOpen,
  IdCard,
  LayoutPanelTop,
  ListMusic,
  MapPin,
  Package,
  UserRound,
} from "@/components/ui/icons";

export const FILE_TYPE_SCOPES = [
  "workspace",
  "membership",
  "person",
  "organization",
  "venue",
  "venue_space",
  "equipment",
  "program",
  "production",
  "file_library",
];

export const FILE_TYPE_SCOPE_META = {
  workspace: { label: "工作空间", description: "工作空间品牌、制度和公共资料。", icon: FileText },
  membership: { label: "工作空间成员", description: "成员身份、合同和合规材料。", icon: IdCard },
  person: { label: "人员库", description: "可长期复用的人员履历与作品资料。", icon: UserRound },
  organization: { label: "机构", description: "机构品牌、资质和合作资料。", icon: Building2 },
  venue: { label: "场地", description: "场地布局、技术和安全资料。", icon: MapPin },
  venue_space: { label: "场地空间", description: "舞台、座位和空间执行资料。", icon: LayoutPanelTop },
  equipment: { label: "设备", description: "设备识别、说明书和维护资料。", icon: Package },
  program: { label: "节目库", description: "节目海报、音视频和版权资料。", icon: ListMusic },
  production: { label: "活动", description: "本场活动的流程、合同和现场素材。", icon: CalendarDays },
  file_library: { label: "文件资料库", description: "跨资源复用的合同、项目和媒体资料。", icon: FolderOpen },
};

export const FILE_TYPE_SCOPE_SET = new Set(FILE_TYPE_SCOPES);
