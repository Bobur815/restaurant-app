import {
  ArrowLeft,
  Banknote,
  ChartColumn,
  Check,
  ClipboardList,
  CreditCard,
  ImageOff,
  Languages,
  LayoutGrid,
  LogOut,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Moon,
  Plus,
  Receipt,
  Search,
  Settings,
  Smartphone,
  SunMoon,
  Sun,
  Timer,
  Trash2,
  TriangleAlert,
  UtensilsCrossed,
  Users,
  Wallet,
  X,
  createElement,
  type IconNode,
} from 'lucide';

/** The icon set the app uses (lucide, built as real SVG nodes: no innerHTML, CSP-safe). */
const ICONS = {
  back: ArrowLeft,
  cash: Banknote,
  reports: ChartColumn,
  check: Check,
  sessions: ClipboardList,
  card: CreditCard,
  noImage: ImageOff,
  language: Languages,
  logout: LogOut,
  tables: LayoutGrid,
  minus: Minus,
  collapse: PanelLeftClose,
  expand: PanelLeftOpen,
  edit: Pencil,
  dark: Moon,
  plus: Plus,
  checks: Receipt,
  search: Search,
  settings: Settings,
  click: Smartphone,
  system: SunMoon,
  light: Sun,
  timer: Timer,
  trash: Trash2,
  warning: TriangleAlert,
  menu: UtensilsCrossed,
  users: Users,
  debt: Wallet,
  close: X,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 20): SVGElement {
  const el = createElement(ICONS[name]) as SVGElement;
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.classList.add('icon');
  return el;
}
