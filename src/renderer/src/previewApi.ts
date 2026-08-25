import type { MasterCommanderApi } from '../../preload'
import type { ProcessEvent, ProjectCommand, WorkspaceState } from '../../shared/types'

const demoState: WorkspaceState = {
  roots: ['C:\\Code'],
  excludedPaths: [],
  projects: [
    {
      id: 'atlas', name: 'atlas-dashboard', path: 'C:\\Code\\atlas-dashboard',
      kinds: ['node', 'docker'], favorite: true, lastUsed: Date.now(), customCommands: [], documents: [
        { id: 'readme', name: 'README.md', path: 'C:\\Code\\atlas-dashboard\\README.md', relativePath: 'README.md', title: 'Atlas Dashboard', isReadme: true, preview: '# Atlas Dashboard\n\nA sample full-stack dashboard used to demonstrate the Master Commander preview.\n\n## Quick start\n\nInstall dependencies and start the development server.\n\n```bash\nnpm install\nnpm run dev\n```' },
        { id: 'building', name: 'BUILDING.md', path: 'C:\\Code\\atlas-dashboard\\docs\\BUILDING.md', relativePath: 'docs\\BUILDING.md', title: 'Build and distribution', isReadme: false, preview: '# Build and distribution' },
        { id: 'architecture', name: 'ARCHITECTURE.md', path: 'C:\\Code\\atlas-dashboard\\docs\\ARCHITECTURE.md', relativePath: 'docs\\ARCHITECTURE.md', title: 'Architecture', isReadme: false, preview: '# Architecture' }
      ],
      commands: [
        { id: 'dev', label: 'dev', command: 'npm run dev', source: 'package.json · next dev' },
        { id: 'build', label: 'build', command: 'npm run build', source: 'package.json · next build' },
        { id: 'test', label: 'test', command: 'npm run test', source: 'package.json · vitest run' },
        { id: 'compose', label: 'Avvia servizi', command: 'docker compose -f "compose.yml" up', source: 'Docker Compose' }
      ]
    },
    { id: 'webapp', parentId: 'atlas', name: 'web-client', path: 'C:\\Code\\atlas-dashboard\\apps\\web-client', kinds: ['node'], customCommands: [], documents: [], commands: [
      { id: 'webdev', label: 'dev', command: 'npm run dev', source: 'package.json · next dev' }
    ] },
    { id: 'api', name: 'sample-api', path: 'C:\\Code\\sample-api', kinds: ['dotnet'], customCommands: [], documents: [], commands: [
      { id: 'dotrun', label: 'Avvia', command: 'dotnet run --project "Sample.Api.csproj"', source: '.NET' },
      { id: 'dottest', label: 'Test', command: 'dotnet test "Sample.sln"', source: '.NET' }
    ] },
    { id: 'tools', name: 'data-toolkit', path: 'C:\\Code\\data-toolkit', kinds: ['python'], customCommands: [], documents: [], commands: [
      { id: 'pytest', label: 'Test', command: 'uv run python -m pytest', source: 'Python' }
    ] },
    { id: 'engine', name: 'physics-engine', path: 'C:\\Code\\physics-engine', kinds: ['rust'], customCommands: [], documents: [], commands: [
      { id: 'cargo', label: 'Compila', command: 'cargo build', source: 'Cargo' }
    ] }
  ]
}

let state = structuredClone(demoState)
const listeners = new Set<(event: ProcessEvent) => void>()
const save = async () => structuredClone(state)

export function installPreviewApi() {
  const api: MasterCommanderApi = {
    loadWorkspace: save,
    addFolder: save,
    refresh: save,
    removeProject: async (id) => { state.projects = state.projects.filter((project) => project.id !== id); return save() },
    toggleFavorite: async (id) => { const project = state.projects.find((item) => item.id === id); if (project) project.favorite = !project.favorite; return save() },
    addCustomCommand: async (projectId: string, item: ProjectCommand) => { state.projects.find((project) => project.id === projectId)?.customCommands.push(item); return save() },
    removeCustomCommand: async (projectId, commandId) => { const project = state.projects.find((item) => item.id === projectId); if (project) project.customCommands = project.customCommands.filter((item) => item.id !== commandId); return save() },
    runIntegrated: async (request) => {
      const sessionId = `preview-${Date.now()}`
      setTimeout(() => listeners.forEach((listener) => listener({ sessionId, type: 'stdout', data: `Avvio ${request.label}…\nServer pronto su http://localhost:3000\n` })), 250)
      return { sessionId }
    },
    runExternal: async () => undefined,
    stopProcess: async (sessionId) => { listeners.forEach((listener) => listener({ sessionId, type: 'exit', data: '\nProcesso terminato.\n', exitCode: 0 })) },
    sendInput: async () => undefined,
    openFolder: async () => undefined,
    readDocument: async (_projectId, documentId) => state.projects.flatMap((project) => project.documents).find((document) => document.id === documentId)?.preview + '\n\n## Dettagli\n\nQuesta è la versione completa del documento, caricata su richiesta.\n\n- Primo elemento\n- Secondo elemento\n',
    openExternal: async () => undefined,
    onProcessEvent: (callback) => { listeners.add(callback); return () => { listeners.delete(callback) } }
  }
  window.masterCommander = api
}
