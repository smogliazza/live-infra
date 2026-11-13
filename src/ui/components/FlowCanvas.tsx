/**
 * Canvas 2D por capas (XYFlow). SÓLO presentación: dibuja la topología del
 * escenario y el estado que expone el motor (transfers, runtime, workloads).
 *
 * - Las posiciones arrastradas por el usuario son estado visual (store) y no
 *   modifican source/target, protocolos ni comportamiento.
 * - Ocultar una capa atenúa sus elementos pero conserva las relaciones; no
 *   afecta a la simulación, la selección, los eventos ni las trazas.
 */
import { createContext, memo, useContext, useEffect, useMemo } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  ControlButton,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useInternalNode,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { Info, LayoutGrid, LocateFixed, Map as MapIcon } from 'lucide-react';
import { providers } from '../../catalog';
import type { Transfer, SimulationEngine } from '../../engine/engine';
import { nodeVisualStatus } from '../../engine/observability';
import type { VisualStatus } from '../../engine/events';
import type { Boundary, EdgeDef, NodeDef } from '../../model/schemas';
import { useEngine, useSim } from '../state/store';
import { STATUS_LABEL } from './status';
import { INTENT_ICON, STATUS_ICON } from './icons';
import { boundaryLayer, isVisible, LAYERS, nodeLayers, type LayerId } from '../layers';
import { EDGE_CLASS_LABEL, edgeClass, type EdgeClass } from '../edgeClass';

const NODE_W = 172;
const NODE_H = 74;
const MIN_LABEL_EDGE_PX = 120;

interface CanvasContextValue {
  engine: SimulationEngine;
  transfers: Map<string, Transfer[]>;
  highlightedEdges: Set<string>;
  highlightedNodes: Set<string>;
  neighborNodes: Set<string>;
  /** Conexiones cuya etiqueta se muestra (foco explícito: nodo o conexión). */
  labelEdges: Set<string>;
  focusActive: boolean;
  selectedEdgeId?: string;
  hidden: ReadonlySet<string>;
  layersOf: Map<string, LayerId[]>;
  reducedMotion: boolean;
  secondary: boolean;
  selectTrace: (id?: string) => void;
}

const CanvasContext = createContext<CanvasContextValue | null>(null);
const useCanvas = () => useContext(CanvasContext)!;

const providerShort = (id: string) => (id === 'generic' ? '' : id === 'cloudflare' ? 'Cloudflare' : (providers.find((p) => p.id === id)?.shortName ?? id));

// ------------------------------------------------------------------ nodes

type ComponentNodeData = { def: NodeDef };
type BoundaryNodeData = { def: Boundary; dimmed: boolean };

const ComponentNode = memo(function ComponentNode({ data, selected }: NodeProps<Node<ComponentNodeData>>) {
  const { engine, highlightedNodes, neighborNodes, focusActive, hidden, layersOf, secondary } = useCanvas();
  const def = data.def;
  const svc = engine.catalog.get(def.service);
  const status: VisualStatus = nodeVisualStatus(engine, def.id);
  const rt = engine.runtime.get(def.id);
  const workload = engine.workloads.get(def.id);
  const layers = layersOf.get(def.id) ?? [];
  const ghost = !isVisible(layers, hidden);
  const related = selected || highlightedNodes.has(def.id) || neighborNodes.has(def.id);
  const Icon = INTENT_ICON[def.intent];
  const StatusIcon = STATUS_ICON[status];
  const active = (rt?.active ?? 0) > 0;
  const prov = svc ? providerShort(svc.provider) : '';
  return (
    <div
      className={[
        'cfl-node',
        `status-${status}`,
        selected ? 'is-selected' : '',
        highlightedNodes.has(def.id) ? 'is-highlighted' : '',
        neighborNodes.has(def.id) ? 'is-neighbor' : '',
        focusActive && !related ? 'is-faded' : '',
        ghost ? 'is-ghost' : '',
        active ? 'is-active' : '',
        secondary ? '' : 'is-draggable',
      ].join(' ')}
      data-testid={`node-${def.id}`}
      aria-label={`${def.label} — ${svc?.name ?? ''} — estado ${STATUS_LABEL[status]}`}
      title={`${svc?.name ?? def.label}\n${svc?.role ?? ''}\nCapas: ${layers.map((l) => LAYERS.find((x) => x.id === l)?.label).join(', ')}`}
    >
      <Handle type="target" position={Position.Left} className="cfl-handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="cfl-handle" isConnectable={false} />
      <div className="cfl-node-head">
        <span className="cfl-node-icon" aria-hidden>
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <div className="cfl-node-titles">
          <span className="cfl-node-label">{def.label}</span>
          <span className="cfl-node-sub">
            {svc?.category}
            {prov ? ` · ${prov}` : ''}
          </span>
        </div>
        {active && (
          <span className="cfl-badge" title={`${rt!.active} operaciones en curso`}>
            {rt!.active}
          </span>
        )}
      </div>
      <div className="cfl-node-foot">
        <span className={`cfl-status status-${status}`}>
          <StatusIcon size={11} strokeWidth={2.2} aria-hidden className={status === 'running' ? 'spin' : ''} />
          {STATUS_LABEL[status]}
        </span>
        <span className="cfl-layer-dots" aria-label={`Capas: ${layers.join(', ')}`}>
          {layers.map((l) => (
            <span key={l} className={`cfl-layer-dot layer-${l}`} />
          ))}
        </span>
      </div>
      {workload && (
        <div className="cfl-pods" aria-label={`${workload.pods.filter((p) => p.ready).length}/${workload.replicas} pods Ready`}>
          {workload.pods.map((p) => (
            <span
              key={p.name}
              className={`cfl-pod phase-${p.phase} ${p.ready ? 'ready' : 'not-ready'} ${p.version === workload.version ? 'v-current' : 'v-next'}`}
              title={`${p.name} · ${p.version} · ${p.phase}${p.ready ? ' · Ready' : ''}`}
            />
          ))}
          <span className="cfl-version">
            v{workload.version}
            {workload.targetVersion ? ` → ${workload.targetVersion}` : ''}
          </span>
        </div>
      )}
    </div>
  );
});

const BoundaryNode = memo(function BoundaryNode({ data }: NodeProps<Node<BoundaryNodeData>>) {
  const def = data.def;
  return (
    <div className={`cfl-boundary kind-${def.kind} ${data.dimmed ? 'is-ghost' : ''}`} style={{ width: def.width, height: def.height }}>
      <span className="cfl-boundary-label">{def.label}</span>
    </div>
  );
});

// ------------------------------------------------------------------ edges

function borderPoint(cx: number, cy: number, w: number, h: number, tx: number, ty: number) {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const s = Math.max(Math.abs(dx) / (w / 2), Math.abs(dy) / (h / 2));
  return { x: cx + dx / s, y: cy + dy / s };
}

function hashOffset(id: string | undefined, spread: number): number {
  if (!id) return 0;
  let h = 0;
  for (let i = 0; i < 6 && i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 5) - 2) * (spread / 2);
}

type FlowEdgeData = { def: EdgeDef; cls: EdgeClass };

const FlowEdge = memo(function FlowEdge({ id, source, target, data }: EdgeProps<Edge<FlowEdgeData>>) {
  const { engine, transfers, highlightedEdges, labelEdges, selectedEdgeId, focusActive, hidden, layersOf, reducedMotion, selectTrace } = useCanvas();
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t || !data) return null;
  const sw = s.measured.width ?? NODE_W;
  const sh = s.measured.height ?? NODE_H;
  const tw = t.measured.width ?? NODE_W;
  const th = t.measured.height ?? NODE_H;
  const scx = s.internals.positionAbsolute.x + sw / 2;
  const scy = s.internals.positionAbsolute.y + sh / 2;
  const tcx = t.internals.positionAbsolute.x + tw / 2;
  const tcy = t.internals.positionAbsolute.y + th / 2;
  const p1 = borderPoint(scx, scy, sw + 6, sh + 6, tcx, tcy);
  const p2 = borderPoint(tcx, tcy, tw + 6, th + 6, scx, scy);
  const path = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
  const nx = -(p2.y - p1.y) / len;
  const ny = (p2.x - p1.x) / len;

  const def = data.def;
  const cls = data.cls;
  const active = transfers.get(id) ?? [];
  const selected = selectedEdgeId === id;
  const highlighted = highlightedEdges.has(id);
  const ghost = !isVisible(layersOf.get(def.source) ?? [], hidden) || !isVisible(layersOf.get(def.target) ?? [], hidden);
  const faded = focusActive && !highlighted && !selected;
  const hasError = active.some((tx) => !tx.ok);
  // En conexiones cortas la etiqueta taparía los nodos: queda en el tooltip y el inspector.
  const showLabel = (selected || labelEdges.has(id)) && len > MIN_LABEL_EDGE_PX;
  const now = engine.now;
  const classes = [
    'cfl-edge',
    `cls-${cls}`,
    active.length ? 'is-active' : '',
    highlighted ? 'is-highlighted' : '',
    selected ? 'is-selected' : '',
    faded ? 'is-faded' : '',
    ghost ? 'is-ghost' : '',
    hasError ? 'has-error' : '',
  ].join(' ');

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={`url(#cfl-arrow-${cls})`} className={classes} interactionWidth={0} />
      <path d={path} fill="none" stroke="transparent" strokeWidth={14} className="cfl-edge-hit">
        <title>{`${def.source} → ${def.target}\n${def.protocol}${def.port ? ` :${def.port}` : ''}\n${EDGE_CLASS_LABEL[cls]}`}</title>
      </path>
      {!ghost &&
        active.map((tx) => {
          const span = Math.max(tx.end - tx.start, 1e-6);
          const progress = Math.min(1, Math.max(0, (now - tx.start) / span));
          const f = reducedMotion ? 0.5 : tx.reverse ? 1 - progress : progress;
          const lane = tx.kind === 'delivery' ? 7 : tx.reverse ? -4 : 4;
          const jitter = tx.kind === 'delivery' ? 0 : hashOffset(tx.traceId, 3);
          const x = p1.x + (p2.x - p1.x) * f + nx * (lane + jitter);
          const y = p1.y + (p2.y - p1.y) * f + ny * (lane + jitter);
          const cl = `cfl-pulse kind-${tx.kind} pcls-${cls} ${tx.ok ? 'ok' : 'error'} ${reducedMotion ? 'static' : ''}`;
          const title = `${tx.kind === 'delivery' ? 'delivery' : tx.reverse ? 'respuesta' : 'request'} · ${tx.label ?? ''}${tx.traceId ? ` · trace ${tx.traceId.slice(0, 8)}` : ''}`;
          return tx.kind === 'delivery' ? (
            <rect key={tx.id} x={x - 4.5} y={y - 4.5} width={9} height={9} rx={1.5} transform={`rotate(45 ${x} ${y})`} className={cl}>
              <title>{title}</title>
            </rect>
          ) : (
            <circle
              key={tx.id}
              cx={x}
              cy={y}
              r={tx.kind === 'response' ? 3.6 : 4.6}
              className={cl}
              onClick={(ev) => {
                ev.stopPropagation();
                selectTrace(tx.traceId);
              }}
            >
              <title>{title}</title>
            </circle>
          );
        })}
      {showLabel && !ghost && (
        <EdgeLabelRenderer>
          <div className={`cfl-edge-label cls-${cls}`} style={{ transform: `translate(-50%, -50%) translate(${(p1.x + p2.x) / 2}px, ${(p1.y + p2.y) / 2}px)` }}>
            {def.protocol}
            {def.port ? <span className="mono"> :{def.port}</span> : null}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const nodeTypes = { component: ComponentNode, boundary: BoundaryNode };
const edgeTypes = { flow: FlowEdge };

function ArrowMarkers() {
  const classes: EdgeClass[] = ['traffic', 'internal', 'delivery', 'control', 'iac'];
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {classes.map((c) => (
          <marker key={c} id={`cfl-arrow-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className={`cfl-arrow cls-${c}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

/** Consume peticiones de navegación del store (centrar selección / ajustar vista). */
function NavigationBridge({ nodeId, enabled }: { nodeId?: string; enabled: boolean }) {
  const { fitView } = useReactFlow();
  const centerSeq = useSim((s) => s.centerSeq);
  const fitSeq = useSim((s) => s.fitSeq);
  useEffect(() => {
    if (enabled && centerSeq > 0 && nodeId) void fitView({ nodes: [{ id: nodeId }], padding: 1.2, duration: 400, maxZoom: 1.4 });
  }, [centerSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (enabled && fitSeq > 0) void fitView({ padding: 0.05, duration: 400 });
  }, [fitSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Legend() {
  const open = useSim((s) => s.legendOpen);
  if (!open) return null;
  const statuses: VisualStatus[] = ['idle', 'running', 'success', 'warning', 'retrying', 'failed', 'blocked', 'rolling-back'];
  return (
    <Panel position="bottom-right" className="cfl-legend" data-testid="legend">
      <div className="cfl-legend-col">
        <h5>Conexiones</h5>
        {(['traffic', 'internal', 'delivery', 'control', 'iac'] as EdgeClass[]).map((c) => (
          <div key={c} className="cfl-legend-row">
            <svg width="34" height="10" aria-hidden>
              <line x1="0" y1="5" x2="34" y2="5" className={`cfl-legend-line cls-${c}`} />
            </svg>
            {EDGE_CLASS_LABEL[c]}
          </div>
        ))}
      </div>
      <div className="cfl-legend-col">
        <h5>Pulsos</h5>
        <div className="cfl-legend-row">
          <svg width="14" height="14" aria-hidden>
            <circle cx="7" cy="7" r="4.6" className="cfl-pulse kind-request ok" />
          </svg>
          request
        </div>
        <div className="cfl-legend-row">
          <svg width="14" height="14" aria-hidden>
            <circle cx="7" cy="7" r="3.6" className="cfl-pulse kind-response ok" />
          </svg>
          respuesta OK
        </div>
        <div className="cfl-legend-row">
          <svg width="14" height="14" aria-hidden>
            <circle cx="7" cy="7" r="3.6" className="cfl-pulse kind-response error" />
          </svg>
          respuesta con error
        </div>
        <div className="cfl-legend-row">
          <svg width="14" height="14" aria-hidden>
            <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" transform="rotate(45 7 7)" className="cfl-pulse kind-delivery pcls-delivery" />
          </svg>
          delivery / control
        </div>
        <h5>Pods</h5>
        <div className="cfl-legend-row">
          <span className="cfl-pod v-current ready" /> versión actual · <span className="cfl-pod v-next ready" /> nueva · <span className="cfl-pod phase-ImagePullBackOff" /> error
        </div>
      </div>
      <div className="cfl-legend-col">
        <h5>Estados</h5>
        {statuses.map((s) => {
          const I = STATUS_ICON[s];
          return (
            <div key={s} className={`cfl-legend-row status-text status-${s}`}>
              <I size={12} aria-hidden /> {STATUS_LABEL[s]}
            </div>
          );
        })}
        <h5>Capas</h5>
        {LAYERS.map((l) => (
          <div key={l.id} className="cfl-legend-row">
            <span className={`cfl-layer-dot layer-${l.id}`} /> {l.label}
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ----------------------------------------------------------------- canvas

interface FlowCanvasProps {
  /** Motor a dibujar; por defecto el principal. En comparación, el secundario. */
  engine?: SimulationEngine;
  /** Canvas secundario: sin selección, arrastre ni correlación con la consola. */
  secondary?: boolean;
  /** Sin minimapa ni leyenda (paneles pequeños del modo comparación). */
  compact?: boolean;
  testId?: string;
}

export function FlowCanvas({ engine: engineProp, secondary = false, compact = false, testId = 'canvas' }: FlowCanvasProps) {
  const primary = useEngine();
  const engine = engineProp ?? primary;
  const advancedView = useSim((s) => s.advancedView);
  const reducedMotion = useSim((s) => s.reducedMotion);
  const theme = useSim((s) => s.theme);
  const hiddenLayers = useSim((s) => s.hiddenLayers);
  const allPositions = useSim((s) => s.nodePositions);
  const storeSelectedNodeId = useSim((s) => s.selectedNodeId);
  const storeSelectedEventSeq = useSim((s) => s.selectedEventSeq);
  const storeSelectedTraceId = useSim((s) => s.selectedTraceId);
  const storeSelectedEdgeId = useSim((s) => s.selectedEdgeId);
  const focus = useSim((s) => s.inspectorFocus);
  const storeSelectNode = useSim((s) => s.selectNode);
  const storeSelectTrace = useSim((s) => s.selectTrace);
  const selectEdge = useSim((s) => s.selectEdge);
  const moveNode = useSim((s) => s.moveNode);
  const resetLayout = useSim((s) => s.resetLayout);
  const requestCenter = useSim((s) => s.requestCenter);
  const legendOpen = useSim((s) => s.legendOpen);
  const minimapOpen = useSim((s) => s.minimapOpen);
  const setMinimapOpen = useSim((s) => s.setMinimapOpen);
  const setLegendOpen = useSim((s) => s.setLegendOpen);
  const selectedNodeId = secondary ? undefined : storeSelectedNodeId;
  const selectedEventSeq = secondary ? undefined : storeSelectedEventSeq;
  const selectedTraceId = secondary ? undefined : storeSelectedTraceId;
  const selectedEdgeId = secondary ? undefined : storeSelectedEdgeId;
  const selectNode = secondary ? () => undefined : storeSelectNode;
  const selectTrace = secondary ? () => undefined : storeSelectTrace;
  const scenario = engine.scenario;
  const positions = allPositions[scenario.id];
  const hidden = useMemo(() => new Set(hiddenLayers), [hiddenLayers]);

  const layersOf = useMemo(() => {
    const m = new Map<string, LayerId[]>();
    for (const n of scenario.nodes) m.set(n.id, nodeLayers(n, engine.catalog.get(n.service)));
    return m;
  }, [scenario, engine.catalog]);

  const nodeById = useMemo(() => new Map(scenario.nodes.map((n) => [n.id, n])), [scenario]);
  const visibleNodeIds = useMemo(() => new Set(scenario.nodes.filter((n) => advancedView || !n.advanced).map((n) => n.id)), [scenario, advancedView]);

  const nodes = useMemo<Node[]>(() => {
    const boundaries: Node[] = scenario.boundaries.map((b) => ({
      id: `b-${b.id}`,
      type: 'boundary',
      position: { x: b.x, y: b.y },
      data: { def: b, dimmed: hidden.has(boundaryLayer(b)) },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      style: { width: b.width, height: b.height },
      // Nodos controlados: el minimapa necesita conocer el tamaño de antemano.
      initialWidth: b.width,
      initialHeight: b.height,
    }));
    const comps: Node[] = scenario.nodes
      .filter((n) => visibleNodeIds.has(n.id))
      .map((n) => ({
        id: n.id,
        type: 'component',
        position: positions?.[n.id] ?? { x: n.x, y: n.y },
        data: { def: n },
        selected: n.id === selectedNodeId,
        draggable: !secondary,
        ariaLabel: n.label,
        initialWidth: NODE_W,
        initialHeight: n.workload ? NODE_H + 18 : NODE_H,
      }));
    return [...boundaries, ...comps];
  }, [scenario, visibleNodeIds, selectedNodeId, positions, hidden, secondary]);

  const edges = useMemo<Edge[]>(
    () =>
      scenario.edges
        .filter((e) => (advancedView || !e.advanced) && visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
        .map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'flow', data: { def: e, cls: edgeClass(e, nodeById) }, focusable: false })),
    [scenario, advancedView, visibleNodeIds, nodeById],
  );

  const transfers = new Map<string, Transfer[]>();
  for (const tx of engine.transfers.values()) {
    const list = transfers.get(tx.edgeId);
    if (list) list.push(tx);
    else transfers.set(tx.edgeId, [tx]);
  }

  const logLength = engine.log.length;
  const { highlightedEdges, highlightedNodes, neighborNodes, labelEdges } = useMemo(() => {
    const le = new Set<string>();
    const he = new Set<string>();
    const hn = new Set<string>();
    const nn = new Set<string>();
    if (selectedEventSeq !== undefined && focus === 'event') {
      const ev = engine.log[selectedEventSeq];
      if (ev) {
        hn.add(ev.componentId);
        if (ev.edgeId) he.add(ev.edgeId);
      }
    }
    if (selectedTraceId) {
      for (const ev of engine.log) {
        if (ev.traceId !== selectedTraceId) continue;
        hn.add(ev.componentId);
        if (ev.edgeId) he.add(ev.edgeId);
      }
    }
    if (selectedNodeId && focus === 'node') {
      for (const e of scenario.edges) {
        if (e.source === selectedNodeId || e.target === selectedNodeId) {
          he.add(e.id);
          le.add(e.id);
          nn.add(e.source === selectedNodeId ? e.target : e.source);
        }
      }
    }
    if (selectedEdgeId && focus === 'edge') {
      const e = scenario.edges.find((x) => x.id === selectedEdgeId);
      if (e) {
        nn.add(e.source);
        nn.add(e.target);
      }
    }
    return { highlightedEdges: he, highlightedNodes: hn, neighborNodes: nn, labelEdges: le };
    // logLength: recalcular cuando llegan eventos nuevos de la traza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, scenario, selectedEventSeq, selectedTraceId, selectedNodeId, selectedEdgeId, focus, logLength]);

  // Atenuar lo no relacionado sólo cuando hay un foco explícito en el canvas.
  const focusActive = !secondary && ((focus === 'node' && Boolean(selectedNodeId)) || (focus === 'edge' && Boolean(selectedEdgeId)));

  const ctx: CanvasContextValue = {
    engine,
    transfers,
    highlightedEdges,
    highlightedNodes,
    neighborNodes,
    labelEdges,
    focusActive,
    selectedEdgeId,
    hidden,
    layersOf,
    reducedMotion,
    secondary,
    selectTrace,
  };

  const onNodesChange = (changes: NodeChange[]) => {
    if (secondary) return;
    for (const c of changes) {
      // Sólo cambios de POSICIÓN visual; la selección es del store.
      if (c.type === 'position' && c.position && nodeById.has(c.id)) {
        moveNode(scenario.id, c.id, { x: Math.round(c.position.x), y: Math.round(c.position.y) }, !c.dragging);
      }
    }
  };

  const hasCustomLayout = Boolean(positions && Object.keys(positions).length);

  return (
    <CanvasContext.Provider value={ctx}>
      <div
        className="cfl-canvas"
        data-testid={testId}
        onKeyDown={(ev) => {
          // Accesibilidad: Enter/Espacio sobre un nodo con foco lo selecciona.
          if (secondary || (ev.key !== 'Enter' && ev.key !== ' ')) return;
          const el = (ev.target as HTMLElement).closest('.react-flow__node');
          const id = el?.getAttribute('data-id');
          if (id && engine.nodes.has(id)) {
            ev.preventDefault();
            ev.stopPropagation();
            selectNode(id);
          }
        }}
      >
        <ArrowMarkers />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          fitView
          fitViewOptions={{ padding: 0.04 }}
          minZoom={0.2}
          maxZoom={2.5}
          nodesConnectable={false}
          nodesDraggable={!secondary}
          // La selección es SÓLO nuestra (store): los nodos son controlados y
          // mezclarla con la selección interna de React Flow provocaba un bucle
          // de actualizaciones (React error #185) al cambiar de nodo.
          elementsSelectable={false}
          proOptions={{ hideAttribution: false }}
          colorMode={theme}
          onNodeClick={(_, n) => n.type === 'component' && selectNode(n.id)}
          onEdgeClick={(_, e) => !secondary && selectEdge(e.id)}
          onPaneClick={() => {
            if (secondary) return;
            selectNode(undefined);
            selectEdge(undefined);
          }}
        >
          <Background gap={24} size={1} color="var(--canvas-grid)" />
          {!compact && minimapOpen && (
            <MiniMap
              pannable
              zoomable
              position="top-left"
              nodeColor={(n) => (n.type === 'boundary' ? 'var(--b-neutral-line)' : minimapColor(nodeVisualStatus(engine, n.id)))}
              maskColor="var(--minimap-mask)"
              style={{ width: 150, height: 90 }}
            />
          )}
          <Controls showInteractive={false} position="bottom-left">
            {!secondary && (
              <>
                <ControlButton onClick={() => requestCenter()} title="Centrar en la selección (c)" aria-label="Centrar en la selección" disabled={!selectedNodeId}>
                  <LocateFixed size={14} />
                </ControlButton>
                <ControlButton
                  onClick={() => resetLayout(scenario.id)}
                  title="Restaurar la disposición original (las posiciones son sólo visuales)"
                  aria-label="Restaurar disposición"
                  disabled={!hasCustomLayout}
                  data-testid="reset-layout"
                >
                  <LayoutGrid size={14} />
                </ControlButton>
                <ControlButton onClick={() => setMinimapOpen(!minimapOpen)} title="Minimapa" aria-label="Mostrar minimapa" aria-pressed={minimapOpen} data-testid="minimap-toggle">
                  <MapIcon size={14} />
                </ControlButton>
                <ControlButton onClick={() => setLegendOpen(!legendOpen)} title="Leyenda" aria-label="Mostrar leyenda" aria-pressed={legendOpen} data-testid="legend-toggle">
                  <Info size={14} />
                </ControlButton>
              </>
            )}
          </Controls>
          {!compact && <Legend />}
          <NavigationBridge nodeId={selectedNodeId} enabled={!secondary} />
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  );
}

function minimapColor(s: VisualStatus): string {
  return s === 'idle' ? 'var(--muted)' : `var(--st-${s})`;
}
