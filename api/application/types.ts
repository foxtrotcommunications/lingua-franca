export interface WorkspaceBlueprint {
  name: string;
  systemPrompt: string;
  toolsEnabled: string[];
  domainType?: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface ApplicationManifest {
  id: string;
  name: string;
  version: string;
  plugin?: {
    package: string;
    version?: string;
  };
  metadata?: Record<string, unknown>;
  blueprints: Record<string, WorkspaceBlueprint>;
}
