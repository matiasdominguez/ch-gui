import {
  Alert,
  Box,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  useComputedColorScheme,
} from "@mantine/core";
import {
  Background,
  BackgroundVariant,
  Controls,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import dagre from "dagre";
import { useEffect } from "react";

import { fetchDependencyGraph } from "../lib/tauri";
import type {
  ConnectionConfigPayload,
  DependencyEdge,
  DependencyGraph,
  DependencyNode,
} from "../types";

import { ErrorBox } from "./Errors";

type NodeData = {
  database: string;
  table: string;
  engine: string;
  kind: DependencyNode["kind"];
  isRoot: boolean;
};

interface Props {
  payload: ConnectionConfigPayload | null;
  database: string;
  table: string;
  onPick?: (database: string, table: string) => void;
}

const MAX_DEPTH = 5;
const MAX_NODES = 200;
const NODE_WIDTH = 200;
const NODE_HEIGHT = 48;

/** Uses NUL because a ClickHouse identifier can contain a dot. */
const NODE_ID_SEPARATOR = "\u0000";

function keyOf(db: string, t: string): string {
  return `${db}${NODE_ID_SEPARATOR}${t}`;
}

function layout(graph: DependencyGraph): {
  nodes: Node[];
  edges: Edge[];
} {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 60 });

  for (const n of graph.nodes) {
    g.setNode(keyOf(n.database, n.table), {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  }
  for (const e of graph.edges) {
    g.setEdge(keyOf(e.from_db, e.from_table), keyOf(e.to_db, e.to_table));
  }
  dagre.layout(g);

  const rootKey = keyOf(graph.root_db, graph.root_table);
  const nodes: Node[] = graph.nodes.map((n) => {
    const k = keyOf(n.database, n.table);
    const laid = g.node(k) ?? { x: 0, y: 0 };
    return {
      id: k,
      position: {
        x: laid.x - NODE_WIDTH / 2,
        y: laid.y - NODE_HEIGHT / 2,
      },
      data: { ...n, isRoot: k === rootKey } as Record<string, unknown>,
      type: "default",
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e${i}`,
    source: keyOf(e.from_db, e.from_table),
    target: keyOf(e.to_db, e.to_table),
    animated: false,
    style: edgeStyle(e.kind),
  }));
  return { nodes, edges };
}

function edgeStyle(kind: DependencyEdge["kind"]): React.CSSProperties {
  if (kind === "primary") return {};
  return {
    strokeDasharray: "4 3",
    stroke: "var(--chg-text-3)",
  };
}

function nodeStyle(n: NodeData): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 7,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    fontSize: 11,
    fontFamily: "var(--mantine-font-family-monospace)",
    overflow: "hidden",
    color: "var(--chg-text)",
    boxShadow: "var(--chg-control-shadow)",
  };
  if (n.isRoot) {
    return {
      ...base,
      border: "1px solid var(--chg-accent)",
      background: "var(--chg-accent-soft)",
    };
  }
  if (n.kind === "dictionary") {
    return {
      ...base,
      border: "1px dashed var(--chg-line-strong)",
      background: "var(--chg-surface)",
      boxShadow: "none",
    };
  }
  return {
    ...base,
    border: "1px solid var(--chg-line-strong)",
    background: "var(--chg-surface)",
  };
}

function customNodeLabel(n: NodeData) {
  const subtitle = n.kind === "dictionary" ? "Dictionary" : n.engine;
  return (
    <Stack gap={0}>
      <Text
        size="xs"
        fw={n.isRoot ? 700 : 500}
        truncate
        style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
      >
        {n.database}.{n.table}
      </Text>
      {subtitle && (
        <Text size="xs" c="dimmed" truncate>
          {subtitle}
        </Text>
      )}
    </Stack>
  );
}

export function DependencyGraphView({
  payload,
  database,
  table,
  onPick,
}: Props) {
  const q = useQuery({
    queryKey: ["deps_graph", payload?.id, database, table],
    queryFn: () =>
      fetchDependencyGraph(payload!, database, table, MAX_DEPTH, MAX_NODES),
    enabled: Boolean(payload && database && table),
    staleTime: 30_000,
  });

  const graph = q.data;
  const colorMode = useComputedColorScheme("dark");
  // In controlled mode, React Flow keeps a selection only if `onNodesChange`
  // applies it. `useNodesState` provides that handler.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    if (!graph) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const laid = layout(graph);
    const styled = laid.nodes.map((n) => {
      const d = n.data as unknown as NodeData;
      return {
        ...n,
        data: {
          ...n.data,
          label: customNodeLabel(d),
        },
        style: nodeStyle(d),
      };
    });
    setNodes(styled);
    setEdges(laid.edges);
  }, [graph, setNodes, setEdges]);

  if (q.isLoading) {
    return (
      <Center h={220}>
        <Stack gap="xs" align="center">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading dependencies…
          </Text>
        </Stack>
      </Center>
    );
  }
  if (q.isError) {
    return (
      <ErrorBox
        message={String((q.error as Error).message ?? q.error)}
        onRetry={() => q.refetch()}
      />
    );
  }
  if (!graph) return null;

  if (graph.nodes.length <= 1) {
    return (
      <Text size="xs" c="dimmed">
        No views or tables depend on this table.
      </Text>
    );
  }

  return (
    <Stack gap={6}>
      {graph.truncated && (
        <Alert color="yellow" p="xs">
          <Text size="xs">
            The graph stops at {MAX_DEPTH} levels or {MAX_NODES} nodes, so it
            shows only part of the dependencies.
          </Text>
        </Alert>
      )}
      <Box className="chgui-depgraph" style={{ height: 360 }}>
        <ReactFlow
          colorMode={colorMode}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          proOptions={{ hideAttribution: true }}
          onNodeDoubleClick={(_, node) => {
            if (!onPick) return;
            const data = node.data as unknown as NodeData | undefined;
            // Dictionaries have no inspector to open.
            if (data?.kind === "dictionary") return;
            const [db, tbl] = node.id.split(NODE_ID_SEPARATOR);
            if (!db || !tbl) return;
            onPick(db, tbl);
          }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          zoomOnDoubleClick={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </Box>
      <GraphLegend />
    </Stack>
  );
}

function GraphLegend() {
  return (
    <Group gap="md" wrap="wrap">
      <LegendSwatch kind="primary" label="Source / MV / target" />
      <LegendSwatch kind="secondary" label="Joined table" />
      <LegendSwatch kind="dict" label="Dictionary" />
    </Group>
  );
}

function LegendSwatch({
  kind,
  label,
}: {
  kind: DependencyEdge["kind"];
  label: string;
}) {
  const solid = kind === "primary";
  return (
    <Group gap={6} wrap="nowrap">
      <Box
        style={{
          width: 22,
          height: 0,
          borderTop: solid
            ? "1.5px solid var(--chg-text-2)"
            : "1.5px dashed var(--chg-text-3)",
        }}
      />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}
