/**
 * Preferencias de PRESENTACIÓN persistidas en localStorage.
 *
 * Nada de lo que hay aquí forma parte del modelo de simulación: el tema, el
 * tamaño de los paneles, las capas visibles y las posiciones de los nodos
 * son estado visual. Mover un nodo nunca cambia source/target, protocolos ni
 * comportamiento; sólo dónde se dibuja.
 */
export type ThemeId = 'dark' | 'light';

export interface NodePosition {
  x: number;
  y: number;
}

const KEY = {
  theme: 'cfl.theme',
  layout: 'cfl.layout.v1',
} as const;

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined; // modo privado / políticas del navegador
  }
}

export function loadTheme(): ThemeId {
  const saved = storage()?.getItem(KEY.theme);
  if (saved === 'dark' || saved === 'light') return saved;
  // Sin preferencia guardada: respetar el sistema como valor inicial.
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

export function saveTheme(theme: ThemeId): void {
  storage()?.setItem(KEY.theme, theme);
}

export function applyTheme(theme: ThemeId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export interface LayoutPrefs {
  inspectorWidth: number;
  inspectorOpen: boolean;
  consoleHeight: number;
  consoleOpen: boolean;
  hiddenLayers: string[];
  /** Posiciones visuales por escenario: { [scenarioId]: { [nodeId]: {x,y} } }. */
  nodePositions: Record<string, Record<string, NodePosition>>;
}

export const DEFAULT_LAYOUT: LayoutPrefs = {
  inspectorWidth: 560,
  inspectorOpen: true,
  consoleHeight: 250,
  consoleOpen: true,
  hiddenLayers: [],
  nodePositions: {},
};

export function loadLayout(): LayoutPrefs {
  const raw = storage()?.getItem(KEY.layout);
  if (!raw) return { ...DEFAULT_LAYOUT };
  try {
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>;
    return { ...DEFAULT_LAYOUT, ...parsed, nodePositions: parsed.nodePositions ?? {} };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(layout: LayoutPrefs): void {
  storage()?.setItem(KEY.layout, JSON.stringify(layout));
}
