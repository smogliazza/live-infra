import type { VisualStatus } from '../../engine/events';

export const STATUS_LABEL: Record<VisualStatus, string> = {
  idle: 'inactivo',
  queued: 'en cola',
  running: 'en ejecución',
  success: 'correcto',
  warning: 'aviso',
  failed: 'fallido',
  blocked: 'bloqueado',
  retrying: 'reintentando',
  'rolling-back': 'revirtiendo',
};

export function fmtTime(vms: number): string {
  return vms.toFixed(2).padStart(9, ' ');
}

export function fmtMs(ms: number): string {
  if (ms >= 100) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}
