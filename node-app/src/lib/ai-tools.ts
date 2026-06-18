export type ToolId = string;

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  icon: string;
  requiredEnvVars: string[];
}

export const TOOL_REGISTRY: Record<ToolId, ToolDefinition> = {};

export function getToolsByIds(toolIds: ToolId[]): any {
  const selected = toolIds.filter((id) => Boolean(TOOL_REGISTRY[id]));

  // Tool runtime implementations are unavailable in this compatibility build.
  // Returning an empty map keeps analysis flows functional in text-only mode.
  if (selected.length === 0) {
    return {};
  }

  return {};
}