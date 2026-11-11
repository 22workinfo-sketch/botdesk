export type FlowActionType =
  | "SEND_TEXT"
  | "OPEN_SUBMENU"
  | "URL"
  | "REQUEST_CONTACT"
  | "JOIN_CHANNELS";

export interface FlowButton {
  id: string;
  label: string;
  actionType: FlowActionType;
  replyText?: string | null;
  targetMenuId?: string | null;
  url?: string | null;
  urlLabel?: string | null;
  autoDeleteReply?: boolean;
  deleteAfterSeconds?: number;
  isEnabled: boolean;
  order: number;
}

export interface FlowMenu {
  id: string; // "root" for the main menu, or UUID/slug for submenus
  title: string;
  promptText?: string | null;
  buttons: FlowButton[];
}

export interface FlowStructure {
  rootMenu: FlowMenu;
  submenus: Record<string, FlowMenu>; // keyed by submenu ID
}

// =========================================================================
// FLOW V2 VISUAL GRAPH DEFINITIONS
// =========================================================================

export type FlowNodeType =
  | "START"
  | "TEXT"
  | "IMAGE"
  | "VIDEO"
  | "BUTTON_MENU"
  | "REQUEST_PHONE"
  | "CONDITION"
  | "USER_INPUT"
  | "END";

export interface FlowNodeButton {
  id: string;
  label: string;
  actionType: "TRANSITION" | "URL" | "BACK" | "MAIN_MENU" | "REQUEST_CONTACT";
  replyText?: string | null;
  url?: string | null;
  autoDeleteReply?: boolean;
  deleteAfterSeconds?: number;
  isEnabled: boolean;
  order: number;
}

export interface FlowNodeData {
  nodeType: FlowNodeType;
  title?: string;
  text?: string;
  // Media (Image / Video)
  mediaStorageKey?: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  caption?: string | null;
  // Buttons (for TEXT or BUTTON_MENU)
  buttons?: FlowNodeButton[];
  // Request Phone
  promptText?: string | null;
  buttonLabel?: string | null;
  // Condition
  conditionType?: "CHANNEL_MEMBERSHIP";
  channelId?: string | null;
  // User Input
  inputPrompt?: string | null;
  variableName?: string | null;
  isRequired?: boolean;
  minLength?: number;
  maxLength?: number;
  cancelButtonLabel?: string | null;
  // End
  endMessage?: string | null;
  // Common
  autoDeleteReply?: boolean;
  deleteAfterSeconds?: number;
  disabled?: boolean;
}

export interface FlowGraphNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null; // e.g. "joined" | "not_joined" | "verification_error" | button.id | "next"
  targetHandle?: string | null;
  label?: string | null;
}

export interface FlowGraph {
  version: 2;
  nodes: FlowGraphNode[];
  edges: FlowGraphEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

export type AnyFlowStructure = FlowStructure | FlowGraph;

// =========================================================================
// VALIDATION & METADATA
// =========================================================================

export interface FlowValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface FlowVersionSummary {
  id: string;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt: string | null;
  publishedByEmail: string | null;
  buttonCount: number;
  submenuCount: number;
  nodeCount?: number;
}

export interface BotFlowData {
  botId: string;
  draft: {
    id: string;
    version: number;
    status: string;
    structure: AnyFlowStructure;
    updatedAt: string;
  } | null;
  published: {
    id: string;
    version: number;
    status: string;
    structure: AnyFlowStructure;
    publishedAt: string | null;
    publishedById: string | null;
  } | null;
  versions: FlowVersionSummary[];
  hasUnpublishedChanges: boolean;
}

// =========================================================================
// TEMPLATES, COPYING & ANALYTICS
// =========================================================================

export interface FlowTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  category: string;
  createdAt: string;
  createdByEmail: string | null;
  nodeCount: number;
}

export interface FlowCopyPreview {
  sourceBotId: string;
  sourceBotName: string;
  destinationBotId: string;
  destinationBotName: string;
  nodeCount: number;
  channelConditions: Array<{
    nodeId: string;
    nodeTitle: string;
    channelId: string;
    channelName?: string;
    availableInTarget: boolean;
  }>;
  mediaNodes: Array<{
    nodeId: string;
    nodeTitle: string;
    storageKey?: string;
    mediaUrl?: string;
  }>;
  warnings: string[];
  canCopy: boolean;
}

export interface FlowAnalyticsSummary {
  botId: string;
  flowVersion: number;
  totalStarted: number;
  uniqueUsers: number;
  completedCount: number;
  completionRate: number; // percentage 0-100
  nodeVisits: Array<{
    nodeId: string;
    nodeTitle: string;
    nodeType: FlowNodeType;
    visitCount: number;
    uniqueUsers: number;
    dropOffCount: number;
    dropOffRate: number;
  }>;
  buttonClicks: Array<{
    nodeId: string;
    actionLabel: string;
    clickCount: number;
  }>;
  inputSubmissions: Array<{
    nodeId: string;
    variableName: string;
    submissionCount: number;
  }>;
  recentEvents: Array<{
    id: string;
    eventType: string;
    nodeId: string;
    actionLabel: string | null;
    createdAt: string;
  }>;
}
