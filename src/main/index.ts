import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { ProjectCommand, ProjectDescriptor, ProjectDocument, ProjectKind, RunRequest, WorkspaceState } from '../shared/types'

const SKIPPED_FOLDERS = new Set([
  'node_modules', '.git', '.idea', '.vscode', 'dist', 'build', 'out', 'target',
  'bin', 'obj', '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'vendor',
  '.gradle', '.terraform', 'coverage'
])
const UNITY_GENERATED_FOLDERS = new Set(['Library', 'Temp', 'Logs', 'UserSettings', 'MemoryCaptures', 'Recordings'])
const PROJECT_MARKERS = new Set([
  'package.json', 'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'go.mod',
  'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'
])

let mainWindow: BrowserWindow | null = null
const runningProcesses = new Map<string, ChildProcessWithoutNullStreams>()

const emptyWorkspace = (): WorkspaceState => ({ roots: [], projects: [], excludedPaths: [] })
const idFor = (value: string): string => createHash('sha1').update(value.toLowerCase()).digest('hex').slice(0, 12)
const command = (label: string, value: string, source: string): ProjectCommand => ({
  id: idFor(`${source}:${label}:${value}`), label, command: value, source
})

function workspaceFile(): string {
  return path.join(app.getPath('userData'), 'workspace.json')
}

async function loadWorkspace(): Promise<WorkspaceState> {
  try {
    return JSON.parse(await fs.readFile(workspaceFile(), 'utf8')) as WorkspaceState
  } catch {
    return emptyWorkspace()
  }
}

async function saveWorkspace(state: WorkspaceState): Promise<WorkspaceState> {
  await fs.mkdir(path.dirname(workspaceFile()), { recursive: true })
  await fs.writeFile(workspaceFile(), JSON.stringify(state, null, 2), 'utf8')
  return state
}

async function safeDirectoryEntries(directory: string) {
  try {
    return await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

function looksLikeProject(entries: Awaited<ReturnType<typeof safeDirectoryEntries>>): boolean {
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name))
  const directories = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
  return [...PROJECT_MARKERS].some((marker) => files.has(marker))
    || entries.some((entry) => entry.isFile() && (entry.name.endsWith('.sln') || entry.name.endsWith('.csproj')))
    || (directories.has('Assets') && directories.has('ProjectSettings'))
}

function isUnityDirectory(entries: Awaited<ReturnType<typeof safeDirectoryEntries>>): boolean {
  const directories = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name))
  return directories.has('Assets') && directories.has('ProjectSettings')
}

async function findNestedProjectDirectories(root: string, maxDepth = 4, unityParent = false): Promise<string[]> {
  const found = new Set<string>()

  async function visit(directory: string, depth: number): Promise<void> {
    const entries = await safeDirectoryEntries(directory)
    if (directory !== root && looksLikeProject(entries)) found.add(directory)
    if (depth >= maxDepth) return

    await Promise.all(entries
      .filter((entry) => entry.isDirectory()
        && !SKIPPED_FOLDERS.has(entry.name)
        && !(unityParent && (UNITY_GENERATED_FOLDERS.has(entry.name) || entry.name === 'Assets' || entry.name === 'Packages'))
        && !entry.name.startsWith('.'))
      .map((entry) => visit(path.join(directory, entry.name), depth + 1)))
  }

  await visit(root, 0)
  return [...found]
}

async function findMarkdownDocuments(
  root: string,
  excludedProjectPaths: string[] = [],
  maxDepth = 7,
  unityProject = false
): Promise<ProjectDocument[]> {
  const documents: ProjectDocument[] = []
  const excluded = excludedProjectPaths.map((item) => path.resolve(item).toLowerCase())

  async function visit(directory: string, depth: number): Promise<void> {
    const resolvedDirectory = path.resolve(directory).toLowerCase()
    if (directory !== root && excluded.some((item) => resolvedDirectory === item || resolvedDirectory.startsWith(`${item}${path.sep}`))) return
    const entries = await safeDirectoryEntries(directory)

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
      const documentPath = path.join(directory, entry.name)
      try {
        const handle = await fs.open(documentPath, 'r')
        const buffer = Buffer.alloc(8192)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        await handle.close()
        const beginning = buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '')
        const heading = beginning.match(/^#\s+(.+)$/m)?.[1]?.trim()
        const relativePath = path.relative(root, documentPath)
        const isReadme = /^readme(?:[._-].*)?\.md$/i.test(entry.name)
        documents.push({
          id: idFor(documentPath),
          name: entry.name,
          path: documentPath,
          relativePath,
          title: heading || entry.name.replace(/\.md$/i, ''),
          preview: beginning.slice(0, 1800),
          isReadme
        })
      } catch { /* Ignore unreadable documentation files. */ }
    }

    if (depth >= maxDepth || documents.length >= 250) return
    await Promise.all(entries
      .filter((entry) => entry.isDirectory()
        && !SKIPPED_FOLDERS.has(entry.name)
        && !UNITY_GENERATED_FOLDERS.has(entry.name)
        && !(unityProject && (entry.name === 'Assets' || entry.name === 'Packages'))
        && !entry.name.startsWith('.'))
      .map((entry) => visit(path.join(directory, entry.name), depth + 1)))
  }

  await visit(root, 0)
  return documents.sort((a, b) => Number(b.isReadme) - Number(a.isReadme) || a.relativePath.localeCompare(b.relativePath))
}

async function inspectProject(
  directory: string,
  previous?: ProjectDescriptor,
  parentId?: string,
  excludedDocumentRoots: string[] = []
): Promise<ProjectDescriptor> {
  const entries = await safeDirectoryEntries(directory)
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name))
  const kinds: ProjectKind[] = []
  const commands: ProjectCommand[] = []
  const documents = await findMarkdownDocuments(directory, excludedDocumentRoots, 7, isUnityDirectory(entries))

  if (isUnityDirectory(entries)) kinds.push('unity')

  if (files.has('package.json')) {
    kinds.push('node')
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>
      }
      for (const [script, value] of Object.entries(manifest.scripts ?? {})) {
        commands.push(command(script, `npm run ${script}`, `package.json · ${value}`))
      }
      if (files.has('package-lock.json')) commands.unshift(command('Install dependencies', 'npm install', 'npm'))
      else if (files.has('pnpm-lock.yaml')) commands.unshift(command('Install dependencies', 'pnpm install', 'pnpm'))
      else if (files.has('yarn.lock')) commands.unshift(command('Install dependencies', 'yarn install', 'yarn'))
    } catch { /* An invalid package.json should not prevent the workspace from loading. */ }
  }

  const solution = entries.find((entry) => entry.isFile() && entry.name.endsWith('.sln'))?.name
  const csproj = entries.find((entry) => entry.isFile() && entry.name.endsWith('.csproj'))?.name
  if (solution || csproj) {
    kinds.push('dotnet')
    const target = solution ?? csproj!
    commands.push(
      command('Restore', `dotnet restore "${target}"`, '.NET'),
      command('Build', `dotnet build "${target}"`, '.NET'),
      command('Test', `dotnet test "${target}"`, '.NET')
    )
    if (csproj) commands.push(command('Run', `dotnet run --project "${csproj}"`, '.NET'))
  }

  if (files.has('Cargo.toml')) {
    kinds.push('rust')
    commands.push(
      command('Check', 'cargo check', 'Cargo'), command('Build', 'cargo build', 'Cargo'),
      command('Run', 'cargo run', 'Cargo'), command('Test', 'cargo test', 'Cargo')
    )
  }

  if (files.has('pyproject.toml') || files.has('requirements.txt')) {
    kinds.push('python')
    const runner = files.has('uv.lock') ? 'uv run ' : files.has('poetry.lock') ? 'poetry run ' : ''
    if (files.has('requirements.txt')) commands.push(command('Install dependencies', 'python -m pip install -r requirements.txt', 'Python'))
    commands.push(command('Run', `${runner}python .`, 'Python'), command('Test', `${runner}python -m pytest`, 'Python'))
  }

  if (files.has('go.mod')) {
    kinds.push('go')
    commands.push(command('Run', 'go run .', 'Go'), command('Build', 'go build ./...', 'Go'), command('Test', 'go test ./...', 'Go'))
  }

  const composeFile = ['compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml'].find((file) => files.has(file))
  if (composeFile) {
    kinds.push('docker')
    commands.push(
      command('Start services', `docker compose -f "${composeFile}" up`, 'Docker Compose'),
      command('Start in background', `docker compose -f "${composeFile}" up -d`, 'Docker Compose'),
      command('Stop services', `docker compose -f "${composeFile}" down`, 'Docker Compose'),
      command('Service status', `docker compose -f "${composeFile}" ps`, 'Docker Compose')
    )
  }

  return {
    id: idFor(directory),
    name: path.basename(directory),
    path: directory,
    parentId,
    kinds: kinds.length ? kinds : ['generic'],
    commands,
    customCommands: previous?.customCommands ?? [],
    documents,
    favorite: previous?.favorite ?? false,
    lastUsed: previous?.lastUsed
  }
}

async function refreshWorkspace(state?: WorkspaceState): Promise<WorkspaceState> {
  const current = state ?? await loadWorkspace()
  const previous = new Map(current.projects.map((project) => [project.path.toLowerCase(), project]))
  const descriptors: ProjectDescriptor[] = []
  const excluded = new Set((current.excludedPaths ?? []).map((item) => item.toLowerCase()))

  for (const root of current.roots.filter(existsSync)) {
    const rootEntries = await safeDirectoryEntries(root)
    const rootIsProject = looksLikeProject(rootEntries)
    const topLevelPaths = rootIsProject
      ? [root]
      : rootEntries
          .filter((entry) => entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name) && !entry.name.startsWith('.'))
          .map((entry) => path.join(root, entry.name))

    for (const topLevelPath of topLevelPaths) {
      if (excluded.has(topLevelPath.toLowerCase())) continue
      const topEntries = topLevelPath === root ? rootEntries : await safeDirectoryEntries(topLevelPath)
      const nestedPaths = await findNestedProjectDirectories(topLevelPath, 4, isUnityDirectory(topEntries))
      const parent = await inspectProject(topLevelPath, previous.get(topLevelPath.toLowerCase()), undefined, nestedPaths)
      descriptors.push(parent)
      for (const nestedPath of nestedPaths) {
        if (excluded.has(nestedPath.toLowerCase())) continue
        const deeperProjects = nestedPaths.filter((candidate) => candidate !== nestedPath && path.resolve(candidate).startsWith(`${path.resolve(nestedPath)}${path.sep}`))
        descriptors.push(await inspectProject(nestedPath, previous.get(nestedPath.toLowerCase()), parent.id, deeperProjects))
      }
    }
  }
  const compareProjects = (a: ProjectDescriptor, b: ProjectDescriptor) =>
    Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name)
  const parents = descriptors.filter((project) => !project.parentId).sort(compareProjects)
  const projects = parents.flatMap((parent) => [
    parent,
    ...descriptors.filter((project) => project.parentId === parent.id).sort(compareProjects)
  ])
  return saveWorkspace({ roots: current.roots.filter(existsSync), projects, excludedPaths: current.excludedPaths ?? [] })
}

function emitProcessEvent(sessionId: string, type: 'stdout' | 'stderr' | 'exit' | 'error', data: string, exitCode?: number | null) {
  mainWindow?.webContents.send('process:event', { sessionId, type, data, exitCode })
}

function runIntegrated(request: RunRequest): { sessionId: string } {
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const child = spawn(request.command, {
    cwd: request.cwd,
    shell: true,
    windowsHide: true,
    detached: process.platform !== 'win32',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
  })
  runningProcesses.set(sessionId, child)
  child.stdout.on('data', (data) => emitProcessEvent(sessionId, 'stdout', data.toString()))
  child.stderr.on('data', (data) => emitProcessEvent(sessionId, 'stderr', data.toString()))
  child.on('error', (error) => emitProcessEvent(sessionId, 'error', error.message))
  child.on('close', (code) => {
    runningProcesses.delete(sessionId)
    emitProcessEvent(sessionId, 'exit', `\nProcess exited with code ${code ?? 'unknown'}.\n`, code)
  })
  return { sessionId }
}

function runExternal(request: RunRequest): void {
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/k', request.command], { cwd: request.cwd, detached: true, stdio: 'ignore' })
    child.unref()
    return
  }

  const terminalCandidates = [process.env.TERMINAL, 'x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal'].filter(Boolean) as string[]
  const terminal = terminalCandidates.find((candidate) => spawnSync('which', [candidate]).status === 0)
  if (!terminal) throw new Error('No compatible terminal emulator was found.')
  const holdCommand = `${request.command}; printf '\\n[Master Commander] Command finished.\\n'; exec bash`
  let args: string[]
  if (terminal.includes('gnome-terminal')) args = [`--working-directory=${request.cwd}`, '--', 'bash', '-lc', holdCommand]
  else if (terminal.includes('konsole')) args = ['--workdir', request.cwd, '-e', 'bash', '-lc', holdCommand]
  else if (terminal.includes('xfce4-terminal')) args = [`--working-directory=${request.cwd}`, '--command', `bash -lc '${holdCommand.replaceAll("'", "'\\''")}'`]
  else args = ['-e', 'bash', '-lc', `cd "${request.cwd.replaceAll('"', '\\"')}"; ${holdCommand}`]
  const child = spawn(terminal, args, { detached: true, stdio: 'ignore' })
  child.unref()
}

function registerIpc(): void {
  ipcMain.handle('workspace:load', () => refreshWorkspace())
  ipcMain.handle('workspace:add-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'multiSelections'], title: 'Add projects or folders' })
    if (result.canceled) return null
    const state = await loadWorkspace()
    state.roots = [...new Set([...state.roots, ...result.filePaths])]
    const selected = new Set(result.filePaths.map((item) => item.toLowerCase()))
    state.excludedPaths = (state.excludedPaths ?? []).filter((item) => !selected.has(item.toLowerCase()))
    return refreshWorkspace(state)
  })
  ipcMain.handle('workspace:refresh', () => refreshWorkspace())
  ipcMain.handle('workspace:remove-project', async (_event, id: string) => {
    const state = await loadWorkspace()
    const project = state.projects.find((item) => item.id === id)
    if (!project) return state
    const isRoot = state.roots.some((root) => root.toLowerCase() === project.path.toLowerCase())
    if (isRoot) state.roots = state.roots.filter((root) => root.toLowerCase() !== project.path.toLowerCase())
    else state.excludedPaths = [...new Set([...(state.excludedPaths ?? []), project.path])]
    state.projects = state.projects.filter((item) => item.id !== id)
    return saveWorkspace(state)
  })
  ipcMain.handle('workspace:toggle-favorite', async (_event, id: string) => {
    const state = await loadWorkspace()
    const project = state.projects.find((item) => item.id === id)
    if (project) project.favorite = !project.favorite
    state.projects.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name))
    return saveWorkspace(state)
  })
  ipcMain.handle('workspace:add-command', async (_event, projectId: string, custom: ProjectCommand) => {
    const state = await loadWorkspace()
    const project = state.projects.find((item) => item.id === projectId)
    if (project) project.customCommands.push(custom)
    return saveWorkspace(state)
  })
  ipcMain.handle('workspace:remove-command', async (_event, projectId: string, commandId: string) => {
    const state = await loadWorkspace()
    const project = state.projects.find((item) => item.id === projectId)
    if (project) project.customCommands = project.customCommands.filter((item) => item.id !== commandId)
    return saveWorkspace(state)
  })
  ipcMain.handle('process:run', (_event, request: RunRequest) => runIntegrated(request))
  ipcMain.handle('process:external', (_event, request: RunRequest) => runExternal(request))
  ipcMain.handle('process:input', (_event, sessionId: string, input: string) => runningProcesses.get(sessionId)?.stdin.write(input))
  ipcMain.handle('process:stop', (_event, sessionId: string) => {
    const child = runningProcesses.get(sessionId)
    if (!child?.pid) return
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    else process.kill(-child.pid, 'SIGTERM')
  })
  ipcMain.handle('system:open-folder', (_event, folderPath: string) => shell.openPath(folderPath))
  ipcMain.handle('system:open-external', (_event, url: string) => {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('This link type is not allowed.')
    return shell.openExternal(parsed.toString())
  })
  ipcMain.handle('document:read', async (_event, projectId: string, documentId: string) => {
    const state = await loadWorkspace()
    const project = state.projects.find((item) => item.id === projectId)
    const document = project?.documents.find((item) => item.id === documentId)
    if (!project || !document) throw new Error('Document not found.')
    const relative = path.relative(path.resolve(project.path), path.resolve(document.path))
    if (relative.startsWith('..') || path.isAbsolute(relative) || path.extname(document.path).toLowerCase() !== '.md') {
      throw new Error('Invalid document path.')
    }
    const stats = await fs.stat(document.path)
    if (stats.size > 2 * 1024 * 1024) throw new Error('The document exceeds the 2 MB limit.')
    return fs.readFile(document.path, 'utf8')
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#101311',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
