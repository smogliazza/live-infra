/**
 * Iconografía técnica coherente (lucide-react, importación por icono).
 * Un icono por intención arquitectónica y por estado visual: el estado nunca
 * se comunica sólo con color.
 */
import {
  Archive,
  Blocks,
  Box,
  CircleCheck,
  CircleDot,
  CircleX,
  Clock,
  Database,
  FolderGit2,
  GitBranch,
  Globe,
  Hourglass,
  ListOrdered,
  Loader,
  Monitor,
  Package,
  RefreshCw,
  Router,
  Search,
  ShieldCheck,
  ShipWheel,
  Signpost,
  Split,
  TriangleAlert,
  Undo2,
  User,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { VisualStatus } from '../../engine/events';
import type { Intent } from '../../model/schemas';

export const INTENT_ICON: Record<Intent, LucideIcon> = {
  client: Monitor,
  'dns-resolver': Search,
  'dns-authoritative': Signpost,
  'edge-cdn': Globe,
  waf: ShieldCheck,
  'load-balancer': Split,
  'ingress-gateway': Router,
  microservice: Box,
  'gitops-controller': RefreshCw,
  cache: Zap,
  database: Database,
  'k8s-control-plane': ShipWheel,
  registry: Package,
  queue: ListOrdered,
  developer: User,
  'source-repo': GitBranch,
  ci: Workflow,
  'gitops-repo': FolderGit2,
  iac: Blocks,
  'iac-state': Archive,
};

export const STATUS_ICON: Record<VisualStatus, LucideIcon> = {
  idle: CircleDot,
  queued: Clock,
  running: Loader,
  success: CircleCheck,
  warning: TriangleAlert,
  failed: CircleX,
  blocked: Hourglass,
  retrying: RefreshCw,
  'rolling-back': Undo2,
};

export const ICON_SIZE = { sm: 13, md: 15, lg: 18 } as const;

