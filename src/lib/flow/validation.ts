import {
  FlowStructure,
  FlowValidationResult,
  FlowMenu,
  FlowGraph,
  FlowGraphNode,
  FlowGraphEdge,
  AnyFlowStructure,
} from "./types";
import { isFlowGraphV2 } from "./converter";

/**
 * Validates any flow structure (V1 hierarchical or V2 FlowGraph).
 */
export function validateFlowStructure(structure: AnyFlowStructure): FlowValidationResult {
  if (isFlowGraphV2(structure)) {
    return validateFlowGraph(structure);
  }
  return validateLegacyFlowStructure(structure as FlowStructure);
}

/**
 * Validates a FlowGraph V2 visual definition.
 * Checks nodes, edges, reachability, cyclical automatic transitions, and node requirements.
 */
export function validateFlowGraph(graph: FlowGraph): FlowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!graph || typeof graph !== "object") {
    return {
      isValid: false,
      errors: ["Invalid flow graph: Structure must be an object."],
      warnings: [],
    };
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];

  if (nodes.length === 0) {
    return {
      isValid: false,
      errors: ["Flow graph has no nodes. Please add at least a Start node and a message node."],
      warnings: [],
    };
  }

  const nodeMap = new Map<string, FlowGraphNode>();
  const startNodes: FlowGraphNode[] = [];

  for (const node of nodes) {
    if (!node.id) {
      errors.push("A node is missing a unique ID.");
      continue;
    }
    if (nodeMap.has(node.id)) {
      errors.push(`Duplicate node ID '${node.id}' found.`);
    }
    nodeMap.set(node.id, node);

    const data = node.data || ({} as any);
    if (data.nodeType === "START") {
      startNodes.push(node);
    }
  }

  // 1. Start Node validation
  if (startNodes.length === 0) {
    errors.push("Flow graph must contain exactly one Start node.");
  } else if (startNodes.length > 1) {
    errors.push(`Flow graph contains ${startNodes.length} Start nodes. Only one Start node is allowed.`);
  }

  // 2. Edge integrity check
  const outgoingEdges = new Map<string, FlowGraphEdge[]>();
  const incomingEdges = new Map<string, FlowGraphEdge[]>();

  for (const edge of edges) {
    if (!edge.id) {
      errors.push("An edge is missing an ID.");
      continue;
    }
    if (!nodeMap.has(edge.source)) {
      errors.push(`Edge '${edge.id}' connects from non-existent node '${edge.source}'.`);
    }
    if (!nodeMap.has(edge.target)) {
      errors.push(`Edge '${edge.id}' connects to non-existent node '${edge.target}'.`);
    }
    if (edge.source && edge.source === edge.target) {
      errors.push(`Edge '${edge.id}' creates an invalid direct self-loop on node '${edge.source}'.`);
    }

    if (!outgoingEdges.has(edge.source)) outgoingEdges.set(edge.source, []);
    outgoingEdges.get(edge.source)!.push(edge);

    if (!incomingEdges.has(edge.target)) incomingEdges.set(edge.target, []);
    incomingEdges.get(edge.target)!.push(edge);
  }

  // 3. Specific Node Validations
  for (const node of nodes) {
    const data = node.data || ({} as any);
    const nodeLabel = data.title || node.id;
    const type = data.nodeType;

    switch (type) {
      case "START": {
        const out = outgoingEdges.get(node.id) || [];
        if (out.length === 0) {
          errors.push(`Start node '${nodeLabel}' has no outgoing connection.`);
        }
        break;
      }

      case "TEXT": {
        if (!data.text || !data.text.trim()) {
          errors.push(`Text message node '${nodeLabel}' has no message text.`);
        }
        if (Array.isArray(data.buttons)) {
          validateNodeButtons(nodeLabel, data.buttons, errors);
        }
        break;
      }

      case "IMAGE": {
        if (!data.mediaUrl && !data.mediaStorageKey) {
          errors.push(`Image node '${nodeLabel}' has no photo uploaded or configured.`);
        }
        break;
      }

      case "VIDEO": {
        if (!data.mediaUrl && !data.mediaStorageKey) {
          errors.push(`Video node '${nodeLabel}' has no video uploaded or configured.`);
        }
        break;
      }

      case "BUTTON_MENU": {
        if (!Array.isArray(data.buttons) || data.buttons.filter((b: any) => b.isEnabled).length === 0) {
          errors.push(`Menu node '${nodeLabel}' must have at least one enabled button.`);
        } else {
          validateNodeButtons(nodeLabel, data.buttons, errors);
        }
        break;
      }

      case "REQUEST_PHONE": {
        if (!data.promptText || !data.promptText.trim()) {
          warnings.push(`Phone collection node '${nodeLabel}' should have an explanation prompt.`);
        }
        break;
      }

      case "CONDITION": {
        if (!data.channelId) {
          errors.push(`Condition node '${nodeLabel}' has no target channel selected.`);
        }
        const out = outgoingEdges.get(node.id) || [];
        const hasJoined = out.some((e) => e.sourceHandle === "joined");
        const hasNotJoined = out.some((e) => e.sourceHandle === "not_joined");
        if (!hasJoined) {
          warnings.push(`Condition node '${nodeLabel}' has no branch for 'joined'.`);
        }
        if (!hasNotJoined) {
          warnings.push(`Condition node '${nodeLabel}' has no branch for 'not_joined'.`);
        }
        break;
      }

      case "USER_INPUT": {
        if (!data.inputPrompt || !data.inputPrompt.trim()) {
          errors.push(`User input node '${nodeLabel}' must have a prompt message.`);
        }
        if (!data.variableName || !data.variableName.trim()) {
          errors.push(`User input node '${nodeLabel}' must have a variable name to store the answer.`);
        } else {
          const varName = data.variableName.trim();
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
            errors.push(
              `User input node '${nodeLabel}': Variable name '${varName}' must only contain letters, numbers, and underscores.`
            );
          }
        }
        if (data.minLength != null && data.maxLength != null && data.minLength > data.maxLength) {
          errors.push(`User input node '${nodeLabel}': Min length cannot be greater than max length.`);
        }
        break;
      }

      case "END":
        // End node doesn't require outgoing edges
        break;

      default:
        errors.push(`Unknown or unsupported node type '${type}' on node '${node.id}'.`);
    }
  }

  // 4. Reachability analysis from Start node
  if (startNodes.length === 1) {
    const reachable = new Set<string>();
    const queue: string[] = [startNodes[0].id];
    reachable.add(startNodes[0].id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const out = outgoingEdges.get(current) || [];
      for (const edge of out) {
        if (edge.target && !reachable.has(edge.target) && nodeMap.has(edge.target)) {
          reachable.add(edge.target);
          queue.push(edge.target);
        }
      }
    }

    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        warnings.push(`Node '${node.data?.title || node.id}' is disconnected and not reachable from Start.`);
      }
    }
  }

  // 5. Automatic transition loop detection (prevent infinite runtime loops)
  // An automatic node is one that auto-transitions without waiting for user input or button tap:
  // e.g. TEXT without buttons, IMAGE without buttons, VIDEO without buttons, CONDITION.
  const isAutoNode = (nodeId: string): boolean => {
    const n = nodeMap.get(nodeId);
    if (!n) return false;
    const type = n.data?.nodeType;
    if (type === "BUTTON_MENU" || type === "USER_INPUT" || type === "REQUEST_PHONE" || type === "END") {
      return false;
    }
    if (type === "TEXT") {
      const btns = (n.data?.buttons || []).filter((b) => b.isEnabled);
      return btns.length === 0;
    }
    return true;
  };

  const checkAutoCycle = (startId: string, visited: Set<string>, path: string[]): boolean => {
    visited.add(startId);
    path.push(startId);

    const out = outgoingEdges.get(startId) || [];
    for (const edge of out) {
      if (!isAutoNode(edge.target)) continue;
      if (path.includes(edge.target)) {
        return true; // Cycle detected
      }
      if (!visited.has(edge.target)) {
        if (checkAutoCycle(edge.target, visited, [...path])) {
          return true;
        }
      }
    }
    return false;
  };

  const autoVisited = new Set<string>();
  for (const node of nodes) {
    if (isAutoNode(node.id) && !autoVisited.has(node.id)) {
      if (checkAutoCycle(node.id, autoVisited, [])) {
        errors.push(
          "Infinite loop detected: The flow contains an automatic transition loop without user interaction."
        );
        break;
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates button list inside a menu or text node.
 */
function validateNodeButtons(nodeLabel: string, buttons: any[], errors: string[]): void {
  const seenLabels = new Set<string>();

  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const prefix = `In '${nodeLabel}', button #${i + 1}`;

    if (!btn.label || !btn.label.trim()) {
      errors.push(`${prefix}: Label is required.`);
      continue;
    }

    const trimmed = btn.label.trim();
    if (trimmed.length > 64) {
      errors.push(`${prefix} ('${trimmed}'): Label cannot exceed 64 characters.`);
    }

    if (btn.isEnabled) {
      const lower = trimmed.toLowerCase();
      if (seenLabels.has(lower)) {
        errors.push(`In '${nodeLabel}': Duplicate button label '${trimmed}'. Each button must have a unique label.`);
      }
      seenLabels.add(lower);
    }
  }
}

/**
 * Validates legacy V1 hierarchical structure.
 */
export function validateLegacyFlowStructure(structure: FlowStructure): FlowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!structure || typeof structure !== "object") {
    return {
      isValid: false,
      errors: ["Invalid flow structure: Root structure must be an object."],
      warnings: [],
    };
  }

  // 1. Root Menu Validation
  if (!structure.rootMenu || typeof structure.rootMenu !== "object") {
    errors.push("Root menu is missing from the flow structure.");
  } else {
    if (structure.rootMenu.id !== "root") {
      errors.push("Root menu ID must be 'root'.");
    }

    if (!Array.isArray(structure.rootMenu.buttons)) {
      errors.push("Root menu must contain a 'buttons' array.");
    } else {
      const enabledRootButtons = structure.rootMenu.buttons.filter((b) => b.isEnabled);
      if (enabledRootButtons.length === 0) {
        errors.push("Main menu must have at least one enabled button.");
      }
      validateMenuButtons(structure.rootMenu, structure, errors, warnings);
    }
  }

  // 2. Submenus Validation
  const submenus = structure.submenus || {};
  if (typeof submenus !== "object") {
    errors.push("'submenus' must be an object keyed by submenu ID.");
  } else {
    const reachableSubmenuIds = new Set<string>();

    for (const [submenuId, submenu] of Object.entries(submenus)) {
      if (!submenu || typeof submenu !== "object") {
        errors.push(`Submenu '${submenuId}' is invalid or empty.`);
        continue;
      }

      if (submenu.id !== submenuId) {
        errors.push(`Submenu key '${submenuId}' does not match submenu.id '${submenu.id}'.`);
      }

      if (!submenu.title || !submenu.title.trim()) {
        errors.push(`Submenu '${submenuId}' must have a title.`);
      }

      if (!Array.isArray(submenu.buttons)) {
        errors.push(`Submenu '${submenu.title || submenuId}' must contain a 'buttons' array.`);
      } else {
        const enabledButtons = submenu.buttons.filter((b) => b.isEnabled);
        if (enabledButtons.length === 0) {
          errors.push(`Submenu '${submenu.title || submenuId}' has no enabled buttons.`);
        }
        validateMenuButtons(submenu, structure, errors, warnings);
      }
    }

    const collectReachable = (menu: FlowMenu) => {
      for (const btn of menu.buttons || []) {
        if (btn.isEnabled && btn.actionType === "OPEN_SUBMENU" && btn.targetMenuId) {
          if (!reachableSubmenuIds.has(btn.targetMenuId) && submenus[btn.targetMenuId]) {
            reachableSubmenuIds.add(btn.targetMenuId);
            collectReachable(submenus[btn.targetMenuId]);
          }
        }
      }
    };

    if (structure.rootMenu) {
      collectReachable(structure.rootMenu);
    }

    for (const submenuId of Object.keys(submenus)) {
      if (!reachableSubmenuIds.has(submenuId)) {
        warnings.push(`Submenu '${submenus[submenuId]?.title || submenuId}' is not reachable from the Main Menu.`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateMenuButtons(
  menu: FlowMenu,
  structure: FlowStructure,
  errors: string[],
  warnings: string[]
): void {
  const menuName = menu.title || (menu.id === "root" ? "Main Menu" : menu.id);
  const seenLabels = new Set<string>();

  for (let i = 0; i < menu.buttons.length; i++) {
    const btn = menu.buttons[i];
    const btnPrefix = `In '${menuName}', button #${i + 1}`;

    if (!btn.label || !btn.label.trim()) {
      errors.push(`${btnPrefix}: Label is required.`);
      continue;
    }

    const trimmedLabel = btn.label.trim();
    if (trimmedLabel.length > 64) {
      errors.push(`${btnPrefix} ('${trimmedLabel}'): Label cannot exceed 64 characters.`);
    }

    if (btn.isEnabled) {
      const lower = trimmedLabel.toLowerCase();
      if (seenLabels.has(lower)) {
        errors.push(
          `In '${menuName}': Duplicate button label '${trimmedLabel}'. Each button in the same menu must have a unique label.`
        );
      }
      seenLabels.add(lower);
    }

    if (btn.actionType === "OPEN_SUBMENU") {
      if (!btn.targetMenuId || !structure.submenus?.[btn.targetMenuId]) {
        errors.push(`${btnPrefix}: Target submenu '${btn.targetMenuId || "undefined"}' does not exist.`);
      }
    }

    if (btn.actionType === "URL") {
      if (!btn.url || !btn.url.trim()) {
        errors.push(`${btnPrefix}: URL is required for URL action buttons.`);
      } else if (!btn.url.startsWith("http://") && !btn.url.startsWith("https://")) {
        errors.push(`${btnPrefix}: Invalid URL format. URL must start with http:// or https://.`);
      }
    }

    if (btn.autoDeleteReply) {
      if (
        typeof btn.deleteAfterSeconds !== "number" ||
        btn.deleteAfterSeconds < 5 ||
        btn.deleteAfterSeconds > 86400
      ) {
        errors.push(`${btnPrefix}: Auto-delete timer must be an integer between 5 and 86,400 seconds.`);
      }
    }
  }
}
