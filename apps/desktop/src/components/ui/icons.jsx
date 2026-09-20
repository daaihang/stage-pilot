import * as React from "react";
import * as Remix from "@remixicon/react";

/**
 * The only application boundary for product icons. Remix Icon's line family
 * is the default; aliases below keep call sites readable without coupling
 * pages to a vendor package.
 */
function withIconDefaults(Icon) {
  return React.forwardRef(function StagePilotIcon(
    { "aria-hidden": ariaHidden, focusable, ...props },
    ref,
  ) {
    const hasAccessibleName = Boolean(
      props["aria-label"] || props.title || props.role === "img" || props.role === "status",
    );
    return React.createElement(Icon, {
      ref,
      ...props,
      "aria-hidden": ariaHidden ?? (hasAccessibleName ? undefined : "true"),
      focusable: focusable ?? "false",
    });
  });
}

const iconDefinitions = {
  add: Remix.RiAddLine,
  alert: Remix.RiAlertLine,
  archive: Remix.RiArchiveLine,
  archiveStack: Remix.RiArchiveStackLine,
  arrowDown: Remix.RiArrowDownLine,
  arrowDownS: Remix.RiArrowDownSLine,
  arrowLeft: Remix.RiArrowLeftLine,
  arrowLeftRight: Remix.RiArrowLeftRightLine,
  arrowLeftS: Remix.RiArrowLeftSLine,
  arrowRight: Remix.RiArrowRightLine,
  arrowRightS: Remix.RiArrowRightSLine,
  arrowUp: Remix.RiArrowUpLine,
  arrowUpDown: Remix.RiArrowUpDownLine,
  arrowUpS: Remix.RiArrowUpSLine,
  article: Remix.RiArticleLine,
  bankCard: Remix.RiBankCardLine,
  bell: Remix.RiBellLine,
  box: Remix.RiBox3Line,
  building: Remix.RiBuilding2Line,
  calendar: Remix.RiCalendarLine,
  calendarEvent: Remix.RiCalendarEventLine,
  calendarSchedule: Remix.RiCalendarScheduleLine,
  check: Remix.RiCheckLine,
  checkboxCircle: Remix.RiCheckboxCircleLine,
  circle: Remix.RiCircleLine,
  clipboard: Remix.RiClipboardLine,
  close: Remix.RiCloseLine,
  closeCircle: Remix.RiCloseCircleLine,
  computer: Remix.RiComputerLine,
  contacts: Remix.RiContactsBookLine,
  cornerDownRight: Remix.RiCornerDownRightLine,
  creditCard: Remix.RiBankCardLine,
  dashboard: Remix.RiDashboardLine,
  database: Remix.RiDatabaseLine,
  delete: Remix.RiDeleteBinLine,
  download: Remix.RiDownloadLine,
  draggable: Remix.RiDraggable,
  edit: Remix.RiEditLine,
  equalizer: Remix.RiEqualizer2Line,
  errorWarning: Remix.RiErrorWarningLine,
  eye: Remix.RiEyeLine,
  file: Remix.RiFileTextLine,
  fileCheck: Remix.RiFileCheckLine,
  fileCopy: Remix.RiFileCopyLine,
  fileList: Remix.RiFileListLine,
  fileMusic: Remix.RiFileMusicLine,
  fileSettings: Remix.RiFileSettingsLine,
  filter: Remix.RiFilter3Line,
  folder: Remix.RiFolderLine,
  folderAdd: Remix.RiFolderAddLine,
  folderOpen: Remix.RiFolderOpenLine,
  flowChart: Remix.RiFlowChart,
  gitBranch: Remix.RiGitBranchLine,
  grid: Remix.RiGridLine,
  idCard: Remix.RiIdCardLine,
  info: Remix.RiInformationLine,
  kanban: Remix.RiKanbanView,
  key: Remix.RiKeyLine,
  layout: Remix.RiLayoutLine,
  layoutGrid: Remix.RiLayoutGridLine,
  list: Remix.RiListView,
  loader: Remix.RiLoaderLine,
  loader4: Remix.RiLoader4Line,
  lock: Remix.RiLockLine,
  logout: Remix.RiLogoutBoxLine,
  mapPin: Remix.RiMapPinLine,
  menu: Remix.RiMenuLine,
  mic: Remix.RiMic2Line,
  minus: Remix.RiSubtractLine,
  more: Remix.RiMoreLine,
  moon: Remix.RiMoonLine,
  movie: Remix.RiMovieLine,
  pencil: Remix.RiPencilLine,
  play: Remix.RiPlayLine,
  playlist: Remix.RiPlayListLine,
  refresh: Remix.RiRefreshLine,
  repeat: Remix.RiRepeatLine,
  restart: Remix.RiRestartLine,
  save: Remix.RiSaveLine,
  scissors: Remix.RiScissorsLine,
  search: Remix.RiSearchLine,
  settings: Remix.RiSettings3Line,
  settingsAdvanced: Remix.RiSettings5Line,
  share: Remix.RiShareForwardLine,
  shieldCheck: Remix.RiShieldCheckLine,
  shieldKeyhole: Remix.RiShieldKeyholeLine,
  sidebar: Remix.RiSideBarLine,
  sidebarFold: Remix.RiSidebarFoldLine,
  sidebarUnfold: Remix.RiSidebarUnfoldLine,
  sparkling: Remix.RiSparklingLine,
  splitCells: Remix.RiSplitCellsHorizontal,
  square: Remix.RiSquareLine,
  stack: Remix.RiStackLine,
  stop: Remix.RiStopLine,
  subtract: Remix.RiSubtractLine,
  team: Remix.RiTeamLine,
  terminal: Remix.RiTerminalBoxLine,
  time: Remix.RiTimeLine,
  tools: Remix.RiToolsLine,
  trash: Remix.RiDeleteBinLine,
  upload: Remix.RiUpload2Line,
  usb: Remix.RiUsbLine,
  user: Remix.RiUserLine,
  userSettings: Remix.RiUserSettingsLine,
  vip: Remix.RiVipCrownLine,
  workflow: Remix.RiFlowChart,
};

const wrappedMap = Object.fromEntries(
  Object.entries(iconDefinitions).map(([name, IconComponent]) => [name, withIconDefaults(IconComponent)]),
);

export const iconMap = wrappedMap;

export const Icon = React.forwardRef(function Icon({ name, ...props }, ref) {
  const IconComponent = wrappedMap[name];
  if (!IconComponent) return null;
  return React.createElement(IconComponent, { ref, ...props });
});

// Lucide-compatible semantic aliases used during the migration. Every alias
// is still a Remix Icon *Line component and has the same accessibility defaults.
export const AddIcon = wrappedMap.add;
export const AlertTriangle = wrappedMap.alert;
export const Archive = wrappedMap.archive;
export const ArrowDown = wrappedMap.arrowDown;
export const ArrowLeft = wrappedMap.arrowLeft;
export const ArrowRight = wrappedMap.arrowRight;
export const ArrowUp = wrappedMap.arrowUp;
export const Bell = wrappedMap.bell;
export const Boxes = wrappedMap.archiveStack;
export const Building2 = wrappedMap.building;
export const Cable = wrappedMap.usb;
export const CalendarClock = wrappedMap.calendarSchedule;
export const CalendarDays = wrappedMap.calendar;
export const CalendarRange = wrappedMap.calendarSchedule;
export const Check = wrappedMap.check;
export const CheckCircle2 = wrappedMap.checkboxCircle;
export const ChevronDown = wrappedMap.arrowDownS;
export const ChevronsUpDown = wrappedMap.arrowUpDown;
export const Circle = wrappedMap.circle;
export const Clipboard = wrappedMap.clipboard;
export const ClipboardCheck = wrappedMap.fileCheck;
export const ClipboardList = wrappedMap.fileList;
export const Clock3 = wrappedMap.time;
export const ContactRound = wrappedMap.contacts;
export const Copy = wrappedMap.fileCopy;
export const CreditCard = wrappedMap.creditCard;
export const Database = wrappedMap.database;
export const Download = wrappedMap.download;
export const Ellipsis = wrappedMap.more;
export const Eye = wrappedMap.eye;
export const FileCog = wrappedMap.fileSettings;
export const FileMusic = wrappedMap.fileMusic;
export const FileText = wrappedMap.file;
export const FileUp = wrappedMap.upload;
export const Folder = wrappedMap.folder;
export const FolderKanban = wrappedMap.kanban;
export const FolderOpen = wrappedMap.folderOpen;
export const GanttChartSquare = wrappedMap.flowChart;
export const Gauge = wrappedMap.dashboard;
export const GitBranch = wrappedMap.gitBranch;
export const GripVertical = wrappedMap.draggable;
export const Info = wrappedMap.info;
export const IdCard = withIconDefaults(Remix.RiIdCardLine);
export const KeyRound = wrappedMap.key;
export const LayoutGrid = wrappedMap.layoutGrid;
export const LayoutList = wrappedMap.list;
export const LayoutPanelTop = wrappedMap.layout;
export const LayoutTemplate = wrappedMap.layout;
export const Link = withIconDefaults(Remix.RiExternalLinkLine);
export const Link2 = withIconDefaults(Remix.RiLinksLine);
export const ListMusic = wrappedMap.playlist;
export const ListTree = wrappedMap.list;
export const LockKeyhole = wrappedMap.lock;
export const MapPin = wrappedMap.mapPin;
export const Menu = wrappedMap.menu;
export const Maximize2 = withIconDefaults(Remix.RiFullscreenLine);
export const Mic2 = wrappedMap.mic;
export const Minus = wrappedMap.minus;
export const MonitorCog = wrappedMap.computer;
export const Moon = wrappedMap.moon;
export const MoreHorizontal = wrappedMap.more;
export const Package = wrappedMap.box;
export const PanelRightClose = wrappedMap.sidebarFold;
export const PanelRightOpen = wrappedMap.sidebarUnfold;
export const Pencil = wrappedMap.pencil;
export const Play = wrappedMap.play;
export const Plus = wrappedMap.add;
export const Power = withIconDefaults(Remix.RiShutDownLine);
export const RefreshCw = wrappedMap.refresh;
export const RotateCcw = wrappedMap.restart;
export const Save = wrappedMap.save;
export const Search = wrappedMap.search;
export const ServerOff = withIconDefaults(Remix.RiServerLine);
export const Settings = wrappedMap.settings;
export const Settings2 = wrappedMap.settingsAdvanced;
export const ShieldAlert = wrappedMap.alert;
export const ShieldCheck = wrappedMap.shieldCheck;
export const SlidersHorizontal = wrappedMap.equalizer;
export const Sparkles = wrappedMap.sparkling;
export const Square = wrappedMap.square;
export const Star = withIconDefaults(Remix.RiStarLine);
export const Terminal = wrappedMap.terminal;
export const Theater = wrappedMap.movie;
export const Trash2 = wrappedMap.trash;
export const UserRound = wrappedMap.user;
export const UsersRound = wrappedMap.team;
export const Workflow = wrappedMap.workflow;
export const X = wrappedMap.close;
export const XCircle = wrappedMap.closeCircle;

// Existing low-level UI and ReUI components use explicit Remix names;
// re-export them through this boundary so they receive the same defaults.
export const RiAddLine = wrappedMap.add;
export const RiArchiveLine = wrappedMap.archive;
export const RiArrowDownSLine = wrappedMap.arrowDownS;
export const RiArrowLeftSLine = wrappedMap.arrowLeftS;
export const RiArrowRightSLine = wrappedMap.arrowRightS;
export const RiArrowUpSLine = wrappedMap.arrowUpS;
export const RiArrowLeftRightLine = wrappedMap.arrowLeftRight;
export const RiArrowUpDownLine = wrappedMap.arrowUpDown;
export const RiCalendarLine = wrappedMap.calendar;
export const RiCheckboxCircleLine = wrappedMap.checkboxCircle;
export const RiCheckLine = wrappedMap.check;
export const RiClipboardLine = wrappedMap.clipboard;
export const RiCloseCircleLine = wrappedMap.closeCircle;
export const RiCloseLine = wrappedMap.close;
export const RiCornerDownRightLine = wrappedMap.cornerDownRight;
export const RiDeleteBinLine = wrappedMap.trash;
export const RiDraggable = wrappedMap.draggable;
export const RiEqualizer2Line = wrappedMap.equalizer;
export const RiErrorWarningLine = wrappedMap.errorWarning;
export const RiFileCopyLine = wrappedMap.fileCopy;
export const RiFilter3Line = wrappedMap.filter;
export const RiFolderAddLine = wrappedMap.folderAdd;
export const RiFolderLine = wrappedMap.folder;
export const RiInformationLine = wrappedMap.info;
export const RiLoader4Line = wrappedMap.loader4;
export const RiLoaderLine = wrappedMap.loader;
export const RiLogoutBoxLine = wrappedMap.logout;
export const RiMoreLine = wrappedMap.more;
export const RiPencilLine = wrappedMap.pencil;
export const RiRefreshLine = wrappedMap.refresh;
export const RiRepeatLine = wrappedMap.repeat;
export const RiScissorsLine = wrappedMap.scissors;
export const RiSettings3Line = wrappedMap.settings;
export const RiShareForwardLine = wrappedMap.share;
export const RiSideBarLine = wrappedMap.sidebar;
export const RiSparklingLine = wrappedMap.sparkling;
export const RiSplitCellsHorizontal = wrappedMap.splitCells;
export const RiStackLine = wrappedMap.stack;
export const RiSubtractLine = wrappedMap.subtract;
export const RiTerminalBoxLine = wrappedMap.terminal;
export const RiTimeLine = wrappedMap.time;
export const RiUpload2Line = wrappedMap.upload;
export const RiUserLine = wrappedMap.user;
export const RiVipCrownLine = wrappedMap.vip;

export const remixIconMap = {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpSLine,
  RiCalendarLine,
  RiCheckLine,
  RiCloseLine,
  RiDraggable,
  RiRepeatLine,
  RiSettings3Line,
  RiSubtractLine,
  RiTimeLine,
};
