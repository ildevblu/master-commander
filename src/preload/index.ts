import { contextBridge, ipcRenderer } from 'electron'
import type { ProcessEvent, ProjectCommand, RunRequest, WorkspaceState } from '../shared/types'

const api = {
  loadWorkspace: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:load'),
  addFolder: (): Promise<WorkspaceState | null> => ipcRenderer.invoke('workspace:add-folder'),
  refresh: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:refresh'),
  removeProject: (id: string): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:remove-project', id),
  toggleFavorite: (id: string): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:toggle-favorite', id),
  addCustomCommand: (projectId: string, command: ProjectCommand): Promise<WorkspaceState> =>
    ipcRenderer.invoke('workspace:add-command', projectId, command),
  removeCustomCommand: (projectId: string, commandId: string): Promise<WorkspaceState> =>
    ipcRenderer.invoke('workspace:remove-command', projectId, commandId),
  runIntegrated: (request: RunRequest): Promise<{ sessionId: string }> => ipcRenderer.invoke('process:run', request),
  runExternal: (request: RunRequest): Promise<void> => ipcRenderer.invoke('process:external', request),
  stopProcess: (sessionId: string): Promise<void> => ipcRenderer.invoke('process:stop', sessionId),
  sendInput: (sessionId: string, input: string): Promise<void> => ipcRenderer.invoke('process:input', sessionId, input),
  openFolder: (path: string): Promise<void> => ipcRenderer.invoke('system:open-folder', path),
  readDocument: (projectId: string, documentId: string): Promise<string> => ipcRenderer.invoke('document:read', projectId, documentId),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('system:open-external', url),
  onProcessEvent: (callback: (event: ProcessEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ProcessEvent) => callback(payload)
    ipcRenderer.on('process:event', listener)
    return () => { ipcRenderer.removeListener('process:event', listener) }
  }
}

contextBridge.exposeInMainWorld('masterCommander', api)
export type MasterCommanderApi = typeof api
