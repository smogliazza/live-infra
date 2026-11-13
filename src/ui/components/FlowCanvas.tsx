import { createContext, memo, useContext, useMemo } from 'react';
import { Background, BaseEdge, Controls, Handle, MiniMap, Position, ReactFlow, useInternalNode, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import type { Transfer, SimulationEngine } from '../../engine/engine';
import { nodeVisualStatus } from '../../engine/observability';
import type { VisualStatus } from '../../engine/events';
import type { Boundary, EdgeDef, NodeDef } from '../../model/schemas';
import { useEngine, useSim } from '../state/store';
import { STATUS_LABEL } from './status';

const NODE_W = 150;
const NODE_H = 64;

interface CanvasContextValue {
  engine: SimulationEngine;
  transfers: Map<string, Transfer[]>;
  highlightedEdges: Set<string>;
  highlightedNodes: Set<string>;
  reducedMotion: boolean;
  selectTrace: (id?: string) => void;
}

const CanvasContext = createContext<CanvasContextValue | null>(null);
const useCanvas = () => useContext(CanvasContext)!;

// ------------------------------------------------------------------ nodes

type ComponentNodeData = { def: NodeDef };
type BoundaryNodeData = { def: Boundary };

const ComponentNode = memo(function ComponentNode({ data, selected }: NodeProps<Node<ComponentNodeData>>) {
  const { engine, highlightedNodes } = useCanvas();
  const def = data.def;
  const svc = engine.catalog.get(def.service);
  const status: VisualStatus = nodeVisualStatus(engine, def.id);
  const rt = engine.runtime.get(def.id);
  const workload = engine.workloads.get(def.id);
  const highlighted = highlightedNodes.has(def.id);
  return (
    <div
      className={`cfl-node status-${status} ${selected ? 'is-selected' : ''} ${highlighted ? 'is-highlighted' : ''}`}
      data-layer={svc?.layer}
      data-testid={`node-${def.id}`}
      aria-label={`${def.label} — ${svc?.name ?? ''} — estado ${STATUS_LABEL[status]}`}
      title={`${svc?.name ?? def.label} · ${STATUS_LABEL[status]}`}
    >
      <Handle type="target" position={Position.Left} className="cfl-handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="cfl-handle" isConnectable={false} />
      <div className="cfl-node-head">
        <span className={`cfl-dot status-${status}`} aria-hidden />
        <span className="cfl-node-label">{def.label}</span>
        {rt && rt.active > 0 && <span className="cfl-badge">{rt.active}</span>}
      </div>
      <div className="cfl-node-sub">{svc?.category}</div>
      {workload && (
        <div className="cfl-pods" aria-label={`${workload.pods.length} pods`}>
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
    <div className={`cfl-boundary kind-${def.kind}`} style={{ width: def.width, height: def.height }}>
      <span className="cfl-boundary-label">{def.label}</span>
    </div>
  );
});

// ------------------------------------------------------------------ edges

function borderPoint(cx: number, cy: number, w: number, h: number, tx: number, ty: number) {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = Math.abs(dx) / (w / 2);
  const sy = Math.abs(dy) / (h / 2);
  const s = Math.max(sx, sy);
  return { x: cx + dx / s, y: cy + dy / s };
}

function hashOffset(id: string | undefined, spread: number): number {
  if (!id) return 0;
  let h = 0;
  for (let i = 0; i < 6 && i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 5) - 2) * (spread / 2);
}

type FlowEdgeData = { def: EdgeDef };

const FlowEdge = memo(function FlowEdge({ id, source, target, data, markerEnd }: EdgeProps<Edge<FlowEdgeData>>) {
  const { engine, transfers, highlightedEdges, reducedMotion, selectTrace } = useCanvas();
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
  const p1 = borderPoint(scx, scy, sw, sh, tcx, tcy);
  const p2 = borderPoint(tcx, tcy, tw, th, scx, scy);
  const path = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
  // Normal unitaria para separar carriles (ida / vuelta / delivery).
  const nx = -(p2.y - p1.y) / len;
  const ny = (p2.x - p1.x) / len;

  const active = transfers.get(id) ?? [];
  const highlighted = highlightedEdges.has(id);
  const def = data.def;
  const now = engine.now;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={`cfl-edge traffic-${def.traffic} ${highlighted ? 'is-highlighted' : ''} ${active.length ? 'is-active' : ''}`}
      />
      {active.map((tx) => {
        const span = Math.max(tx.end - tx.start, 1e-6);
        const progress = Math.min(1, Math.max(0, (now - tx.start) / span));
        const f = reducedMotion ? 0.5 : tx.reverse ? 1 - progress : progress;
        const lane = tx.kind === 'delivery' ? 7 : tx.reverse ? -4 : 4;
        const jitter = tx.kind === 'delivery' ? 0 : hashOffset(tx.traceId, 3);
        const x = p1.x + (p2.x - p1.x) * f + nx * (lane + jitter);
        const y = p1.y + (p2.y - p1.y) * f + ny * (lane + jitter);
        const cls = `cfl-pulse kind-${tx.kind} ${tx.ok ? 'ok' : 'error'} ${reducedMotion ? 'static' : ''}`;
        const title = `${tx.kind === 'delivery' ? 'delivery' : tx.reverse ? 'respuesta' : 'request'} · ${tx.label ?? ''}${tx.traceId ? ` · trace ${tx.traceId.slice(0, 8)}` : ''}`;
        return tx.kind === 'delivery' ? (
          <rect key={tx.id} x={x - 5} y={y - 5} width={10} height={10} transform={`rotate(45 ${x} ${y})`} className={cls}>
            <title>{title}</title>
          </rect>
        ) : (
          <circle
            key={tx.id}
            cx={x}
            cy={y}
            r={tx.kind === 'response' ? 4 : 5}
            className={cls}
            onClick={(ev) => {
              ev.stopPropagation();
              selectTrace(tx.traceId);
            }}
          >
            <title>{title}</title>
          </circle>
        );
      })}
    </>
  );
});

const nodeTypes = { component: ComponentNode, boundary: BoundaryNode };
const edgeTypes = { flow: FlowEdge };

// ----------------------------------------------------------------- canvas

interface FlowCanvasProps {
  /** Motor a dibujar; por defecto el principal. En comparación, el secundario. */
  engine?: SimulationEngine;
  /** Canvas secundario: sin selección ni correlación con la consola. */
  secondary?: boolean;
  /** Sin minimapa (paneles pequeños del modo comparación). */
  compact?: boolean;
  testId?: string;
}

export function FlowCanvas({ engine: engineProp, secondary = false, compact = false, testId = 'canvas' }: FlowCanvasProps) {
  const primary = useEngine();
  const engine = engineProp ?? primary;
  const advancedView = useSim((s) => s.advancedView);
  const reducedMotion = useSim((s) => s.reducedMotion);
  const storeSelectedNodeId = useSim((s) => s.selectedNodeId);
  const storeSelectedEventSeq = useSim((s) => s.selectedEventSeq);
  const storeSelectedTraceId = useSim((s) => s.selectedTraceId);
  const storeSelectNode = useSim((s) => s.selectNode);
  const storeSelectTrace = useSim((s) => s.selectTrace);
  const selectedNodeId = secondary ? undefined : storeSelectedNodeId;
  const selectedEventSeq = secondary ? undefined : storeSelectedEventSeq;
  const selectedTraceId = secondary ? undefined : storeSelectedTraceId;
  const selectNode = secondary ? () => undefined : storeSelectNode;
  const selectTrace = secondary ? () => undefined : storeSelectTrace;
  const scenario = engine.scenario;

  const visibleNodeIds = useMemo(() => new Set(scenario.nodes.filter((n) => advancedView || !n.advanced).map((n) => n.id)), [scenario, advancedView]);

  const nodes = useMemo<Node[]>(() => {
    const boundaries: Node[] = scenario.boundaries.map((b) => ({
      id: `b-${b.id}`,
      type: 'boundary',
      position: { x: b.x, y: b.y },
      data: { def: b },
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
        position: { x: n.x, y: n.y },
        data: { def: n },
        selected: n.id === selectedNodeId,
        draggable: false,
        ariaLabel: n.label,
        initialWidth: NODE_W,
        initialHeight: n.workload ? NODE_H + 16 : NODE_H,
      }));
    return [...boundaries, ...comps];
  }, [scenario, visibleNodeIds, selectedNodeId]);

  const edges = useMemo<Edge[]>(
    () =>
      scenario.edges
        .filter((e) => (advancedView || !e.advanced) && visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'flow',
          data: { def: e },
          focusable: false,
        })),
    [scenario, advancedView, visibleNodeIds],
  );

  const transfers = new Map<string, Transfer[]>();
  for (const tx of engine.transfers.values()) {
    const list = transfers.get(tx.edgeId);
    if (list) list.push(tx);
    else transfers.set(tx.edgeId, [tx]);
  }

  const logLength = engine.log.length;
  const { highlightedEdges, highlightedNodes } = useMemo(() => {
    const he = new Set<string>();
    const hn = new Set<string>();
    if (selectedEventSeq !== undefined) {
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
    return { highlightedEdges: he, highlightedNodes: hn };
    // logLength: recalcular cuando llegan eventos nuevos de la traza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, selectedEventSeq, selectedTraceId, logLength]);

  const ctx: CanvasContextValue = {
    engine,
    transfers,
    highlightedEdges,
    highlightedNodes,
    reducedMotion,
    selectTrace,
  };

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
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.05 }}
          minZoom={0.2}
          maxZoom={2.5}
          nodesConnectable={false}
          nodesDraggable={false}
          // La selección es SÓLO nuestra (store): los nodos son controlados y
          // mezclarla con la selección interna de React Flow provocaba un bucle
          // de actualizaciones (React error #185) al cambiar de nodo.
          elementsSelectable={false}
          proOptions={{ hideAttribution: false }}
          colorMode="dark"
          onNodeClick={(_, n) => n.type === 'component' && selectNode(n.id)}
          onPaneClick={() => selectNode(undefined)}
        >
          <Background gap={24} size={1} color="#1d2533" />
          {!compact && (
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => (n.type === 'boundary' ? 'rgba(90,115,150,0.25)' : minimapColor(nodeVisualStatus(engine, n.id)))}
              position="top-left"
              maskColor="rgba(8,11,16,0.6)"
              style={{ background: '#0d1219', width: 150, height: 90 }}
            />
          )}
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  );
}

function minimapColor(s: VisualStatus): string {
  return s === 'idle' ? '#7b8aa0' : statusColor(s);
}

function statusColor(s: VisualStatus): string {
  const map: Record<VisualStatus, string> = {
    idle: '#4b5567',
    queued: '#8a93a6',
    running: '#4ea1ff',
    success: '#3fb68b',
    warning: '#e3b341',
    failed: '#f05252',
    blocked: '#c084fc',
    retrying: '#f59e0b',
    'rolling-back': '#fb7185',
  };
  return map[s];
}
