import {
  FlowStructure,
  FlowGraph,
  FlowGraphNode,
  FlowGraphEdge,
  FlowNodeData,
  FlowNodeButton,
  AnyFlowStructure,
} from "./types";

/**
 * Type guard to check if an arbitrary object is a FlowGraph V2.
 */
export function isFlowGraphV2(structure: any): structure is FlowGraph {
  return (
    Boolean(structure) &&
    typeof structure === "object" &&
    Array.isArray(structure.nodes) &&
    Array.isArray(structure.edges) &&
    structure.version === 2
  );
}

/**
 * Creates an empty/default starter FlowGraph V2.
 */
export function createDefaultV2FlowGraph(welcomeMessage?: string): FlowGraph {
  const welcome =
    welcomeMessage || "Welcome! Please choose an option from the menu.";

  const startNode: FlowGraphNode = {
    id: "node-start",
    type: "startNode",
    position: { x: 250, y: 50 },
    data: {
      nodeType: "START",
      title: "Flow Start",
    },
  };

  const menuNode: FlowGraphNode = {
    id: "node-main-menu",
    type: "menuNode",
    position: { x: 250, y: 200 },
    data: {
      nodeType: "BUTTON_MENU",
      title: "Main Menu",
      text: welcome,
      buttons: [
        {
          id: "btn-info-default",
          label: "ℹ️ Help / Info",
          actionType: "TRANSITION",
          replyText: welcome,
          isEnabled: true,
          order: 0,
        },
      ],
    },
  };

  const edge: FlowGraphEdge = {
    id: "edge-start-to-main",
    source: "node-start",
    target: "node-main-menu",
    sourceHandle: "start",
  };

  return {
    version: 2,
    nodes: [startNode, menuNode],
    edges: [edge],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/**
 * Converts a legacy V1 FlowStructure (hierarchical rootMenu + submenus)
 * into a modern FlowGraph V2 with nodes, edges and canvas coordinates.
 */
export function convertV1ToV2Graph(v1: FlowStructure): FlowGraph {
  if (!v1 || !v1.rootMenu) {
    return createDefaultV2FlowGraph();
  }

  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];

  // 1. Start Node
  nodes.push({
    id: "start-node",
    type: "startNode",
    position: { x: 300, y: 40 },
    data: {
      nodeType: "START",
      title: "Start",
    },
  });

  // 2. Root Menu Node
  const rootButtons: FlowNodeButton[] = (v1.rootMenu.buttons || []).map((b) => ({
    id: b.id,
    label: b.label,
    actionType:
      b.actionType === "URL"
        ? "URL"
        : b.actionType === "REQUEST_CONTACT"
        ? "REQUEST_CONTACT"
        : "TRANSITION",
    replyText: b.replyText,
    url: b.url,
    autoDeleteReply: b.autoDeleteReply,
    deleteAfterSeconds: b.deleteAfterSeconds,
    isEnabled: b.isEnabled,
    order: b.order,
  }));

  const rootNodeId = "menu-root";
  nodes.push({
    id: rootNodeId,
    type: "menuNode",
    position: { x: 300, y: 180 },
    data: {
      nodeType: "BUTTON_MENU",
      title: v1.rootMenu.title || "Main Menu",
      text: v1.rootMenu.promptText || "Welcome! Please choose an option from the menu.",
      buttons: rootButtons,
    },
  });

  // Edge from Start to Root Menu
  edges.push({
    id: "edge-start-root",
    source: "start-node",
    target: rootNodeId,
    sourceHandle: "start",
  });

  // 3. Submenus
  const submenus = v1.submenus || {};
  const submenuKeys = Object.keys(submenus);
  const colSpacing = 360;
  const startX = Math.max(50, 300 - ((submenuKeys.length - 1) * colSpacing) / 2);

  submenuKeys.forEach((key, index) => {
    const sm = submenus[key];
    const subNodeId = `menu-${sm.id || key}`;

    const subButtons: FlowNodeButton[] = (sm.buttons || []).map((b) => ({
      id: b.id,
      label: b.label,
      actionType:
        b.actionType === "URL"
          ? "URL"
          : b.actionType === "REQUEST_CONTACT"
          ? "REQUEST_CONTACT"
          : "TRANSITION",
      replyText: b.replyText,
      url: b.url,
      autoDeleteReply: b.autoDeleteReply,
      deleteAfterSeconds: b.deleteAfterSeconds,
      isEnabled: b.isEnabled,
      order: b.order,
    }));

    nodes.push({
      id: subNodeId,
      type: "menuNode",
      position: { x: startX + index * colSpacing, y: 460 },
      data: {
        nodeType: "BUTTON_MENU",
        title: sm.title || `Submenu ${key}`,
        text: sm.promptText || sm.title,
        buttons: subButtons,
      },
    });
  });

  // 4. Edges from buttons with OPEN_SUBMENU to target submenus
  // Root menu buttons
  (v1.rootMenu.buttons || []).forEach((b) => {
    if (b.actionType === "OPEN_SUBMENU" && b.targetMenuId) {
      const targetSubNodeId = `menu-${b.targetMenuId}`;
      if (nodes.some((n) => n.id === targetSubNodeId)) {
        edges.push({
          id: `edge-${rootNodeId}-${b.id}-${targetSubNodeId}`,
          source: rootNodeId,
          target: targetSubNodeId,
          sourceHandle: b.id,
          label: b.label,
        });
      }
    }
  });

  // Submenu buttons
  submenuKeys.forEach((key) => {
    const sm = submenus[key];
    const sourceSubNodeId = `menu-${sm.id || key}`;
    (sm.buttons || []).forEach((b) => {
      if (b.actionType === "OPEN_SUBMENU" && b.targetMenuId) {
        const targetSubNodeId = `menu-${b.targetMenuId}`;
        if (nodes.some((n) => n.id === targetSubNodeId)) {
          edges.push({
            id: `edge-${sourceSubNodeId}-${b.id}-${targetSubNodeId}`,
            source: sourceSubNodeId,
            target: targetSubNodeId,
            sourceHandle: b.id,
            label: b.label,
          });
        }
      }
    });
  });

  return {
    version: 2,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/**
 * Ensures any stored structure is returned as a FlowGraph V2.
 */
export function ensureFlowGraph(structure: any): FlowGraph {
  if (isFlowGraphV2(structure)) {
    return structure;
  }
  return convertV1ToV2Graph(structure as FlowStructure);
}
