export type ProjectKind = 'node' | 'dotnet' | 'rust' | 'python' | 'go' | 'docker' | 'unity' | 'generic'

export interface ProjectCommand {
  id: string
  label: string
  command: string
  source: string
}

export interface ProjectDocument {
  id: string
  name: string
  path: string
  relativePath: string
  title: string
  preview: string
  isReadme: boolean
}

export interface ProjectDescriptor {
  id: string
  name: string
  path: string
  parentId?: string
  kinds: ProjectKind[]
  commands: ProjectCommand[]
  customCommands: ProjectCommand[]
  documents: ProjectDocument[]
  favorite?: boolean
  lastUsed?: number
}

export interface WorkspaceState {
  roots: string[]
  projects: ProjectDescriptor[]
  excludedPaths?: string[]
}

export interface ProcessEvent {
  sessionId: string
  type: 'stdout' | 'stderr' | 'exit' | 'error'
  data: string
  exitCode?: number | null
}

export interface RunRequest {
  projectId: string
  cwd: string
  command: string
  label: string
}
