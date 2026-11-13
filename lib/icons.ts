// Central Lucide icon re-export. Import icons from here (not directly from
// 'lucide-react') so icon choices live in one place and are easy to swap.
// 2px stroke, round caps are Lucide defaults.
export {
  Users,
  Heart,           // Families (the union glyph ⚭ was rejected — too light)
  Network,         // Tree + tree switcher
  BookOpen,        // Library
  Paperclip,       // Attach image to a journal entry
  MapPin,          // Places
  Circle,          // Places — "no location pin" mark
  FolderSearch,    // Cases
  Settings,        // Options
  Palette,         // Options nav: appearance
  Accessibility,   // Options nav: accessibility
  Languages,       // Options nav: language
  TreeDeciduous,   // Options nav: trees
  FlaskConical,    // Options nav: experimental
  HardDrive,       // Options nav: local data
  Sun,             // Theme: light
  Moon,            // Theme: dark
  Monitor,         // Theme: system
  CircleHelp,      // Storage persistence unknown
  LogOut,          // Sign out
  Menu,            // More
  Ellipsis,        // A row's overflow menu (Library Faces rows, #1156)
  Split,           // Library Faces: move one face to its own row (#1156)
  Search,
  SearchX,         // RecordNotFound (#697)
  ArrowLeft,       // RecordNotFound back link
  ArrowLeftRight,  // Relationship swap
  ChevronDown,
  ArrowDown,       // Sort direction (Places rail)
  ArrowUp,         // Sort direction (Places rail)
  ArrowDownFromLine, // Tree direction: descendants
  ArrowUpToLine,   // Tree direction: ancestors
  Target,          // Tree direction: focus; Focus here
  Crosshair,       // Tree: Bring into view
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown, // Tree switcher (drawer card) — signals "switch"
  Check,
  X,
  Share2,          // Manage sharing
  Link as LinkIcon, // Relationship calculator
  Package,         // Import / export
  ClipboardList,   // Audit log
  Calendar,        // Audit date-range filter
  RotateCcw,       // Revert an audit change
  Loader2,         // Spinner / loading state
  Trash2,          // Calm delete (danger)
  AlertTriangle,   // Type-to-confirm header
  Info,            // Calm confirm (default tone)
  Star,            // Upload primary-photo overlay
  ImageUp,         // Upload dropzone badge
  Copy,            // Upload tile: this file was picked twice in one batch (#592)
  Pencil,          // Edit / inline edit trigger
  Strikethrough,   // Strike out a journal entry (#1251)
  StickyNote,      // Show/hide an event row's attached notes (life-events timeline)
  Bookmark,        // Make preferred (notes rail row menu)
  BookmarkX,       // Unset preferred (notes rail row menu)
  Eye,             // Show names/boxes toggle
  EyeOff,          // Hide names/boxes toggle
  Lock,            // Locked / can't untag indicator
  Plus,            // Add / tag a face
  Download,        // Download action
  Upload,          // Choose a file to import
  Cloud,           // Google Drive backup section
  CloudUpload,     // Back up to Drive
  CloudDownload,   // Restore from Drive
  CloudOff,        // Disconnect Drive
  UserRound,       // Set-as-primary-photo person icon
  ScanFace,        // Lightbox scanning
  SlidersHorizontal, // Library filter button
  LayoutGrid,      // Places view toggle (cards mode)
  List,            // Places view toggle (list mode)
  Quote,           // Oral source placeholder
  ExternalLink,    // Source URL link
  ArrowUpRight,    // Deep-link to a form (intrinsic-event edit)
  Link2Off,        // Delete warning (source has citations)
  Shield,          // Edit role (share tree)
  PencilLine,      // Contribute role (share tree)
  UserMinus,       // Remove access (share tree)
  Mail,            // Invite email field icon (share tree)
  GitMerge,        // Merge-with-another-place placeholder (places edit, deferred)
  CheckCircle2,    // Saved / success toast confirmation
  // Life-event medallion glyphs (Timeline / event types)
  Sprout,          // Birth
  Home,            // Residence
  Stamp,           // Naturalization
  HeartCrack,      // Divorce / separation (family ending event)
  FileText,        // Marriage contract / license (family document event)
  ScrollText,      // Will
  Landmark,        // Census / civic record
  CalendarDays,    // Generic event fallback
  // Source-type glyphs (Library source cards; the rest reuse the event set above)
  Church,          // Church record
  Newspaper,       // Newspaper
  Mic,             // Oral history
  Camera,          // Photo source
  Crop,            // Portrait crop (phone person page)
  ImageIcon,       // Upload a photo from the phone
  Globe,           // Find a place on the map (phone place page)
  Tag,             // Another name of a place (place picker)
  Move,            // Move a place's pin (phone place page)
  Type,            // Rename a place (phone place page)
  Clock,           // Options: time zone (phone row)
} from 'lucide-react';

export type { LucideIcon } from 'lucide-react';
