import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, Box, Braces, ChevronRight, CircleStop, Container, Copy, Cpu, ExternalLink, FileCode2,
  FileText, FolderOpen, Heart, Plus, RefreshCw, Search, Send, Settings2, TerminalSquare, Trash2, X
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ProcessEvent, ProjectCommand, ProjectDescriptor, ProjectDocument, ProjectKind, RunRequest, WorkspaceState } from '../../shared/types'

interface Session {
  id: string
  projectId: string
  projectName: string
  label: string
  command: string
  output: string
  status: 'running' | 'success' | 'failed'
}

const EMPTY_WORKSPACE: WorkspaceState = { roots: [], projects: [] }
const kindMeta: Record<ProjectKind, { label: string; icon: typeof Box }> = {
  node: { label: 'Node', icon: Braces },
  dotnet: { label: '.NET', icon: Box },
  rust: { label: 'Rust', icon: Settings2 },
  python: { label: 'Python', icon: FileCode2 },
  go: { label: 'Go', icon: Cpu },
  docker: { label: 'Docker', icon: Container },
  unity: { label: 'Unity', icon: Box },
  generic: { label: 'Project', icon: FolderOpen }
}

const cleanOutput = (value: string) => value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')

function ProjectGlyph({ project }: { project: ProjectDescriptor }) {
  const Icon = kindMeta[project.kinds[0]].icon
  return <span className={`project-glyph kind-${project.kinds[0]}`}><Icon size={16} strokeWidth={1.8} /></span>
}

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(EMPTY_WORKSPACE)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [commandSearch, setCommandSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [terminalOpen, setTerminalOpen] = useState(true)
  const [customFormOpen, setCustomFormOpen] = useState(false)
  const [documentSearch, setDocumentSearch] = useState('')
  const [selectedDocument, setSelectedDocument] = useState<{ project: ProjectDescriptor; document: ProjectDocument } | null>(null)
  const [documentContent, setDocumentContent] = useState('')
  const [documentLoading, setDocumentLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventBacklog = useRef(new Map<string, ProcessEvent[]>())
  const terminalOutputRef = useRef<HTMLPreElement>(null)

  const selectedProject = workspace.projects.find((project) => project.id === selectedId) ?? null
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null

  const topLevelProjects = useMemo(() => workspace.projects.filter((project) => !project.parentId), [workspace.projects])
  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase()
    return topLevelProjects.filter((project) => {
      const children = workspace.projects.filter((candidate) => candidate.parentId === project.id)
      return !query
        || project.name.toLowerCase().includes(query)
        || project.path.toLowerCase().includes(query)
        || children.some((child) => child.name.toLowerCase().includes(query) || child.path.toLowerCase().includes(query))
    })
  }, [topLevelProjects, workspace.projects, search])

  const visibleCommands = useMemo(() => {
    if (!selectedProject) return []
    const query = commandSearch.trim().toLowerCase()
    return [...selectedProject.commands, ...selectedProject.customCommands].filter((item) =>
      !query || item.label.toLowerCase().includes(query) || item.command.toLowerCase().includes(query)
    )
  }, [selectedProject, commandSearch])
  const childProjects = selectedProject
    ? workspace.projects.filter((project) => project.parentId === selectedProject.id)
    : []
  const readme = selectedProject?.documents.find((document) => document.isReadme) ?? null
  const visibleDocuments = (selectedProject?.documents ?? []).filter((document) => {
    if (document.id === readme?.id) return false
    const query = documentSearch.trim().toLowerCase()
    return !query || document.title.toLowerCase().includes(query) || document.relativePath.toLowerCase().includes(query)
  })

  useEffect(() => {
    window.masterCommander.loadWorkspace().then((state) => {
      setWorkspace(state)
      setSelectedId(state.projects[0]?.id ?? null)
    }).catch((reason) => setError(String(reason))).finally(() => setLoading(false))
  }, [])

  useEffect(() => window.masterCommander.onProcessEvent((event) => {
    let handled = false
    setSessions((current) => {
      if (!current.some((session) => session.id === event.sessionId)) return current
      handled = true
      return current.map((session) => {
        if (session.id !== event.sessionId) return session
        const status = event.type === 'exit' ? (event.exitCode === 0 ? 'success' : 'failed') : event.type === 'error' ? 'failed' : session.status
        return { ...session, output: session.output + cleanOutput(event.data), status }
      })
    })
    if (!handled) eventBacklog.current.set(event.sessionId, [...(eventBacklog.current.get(event.sessionId) ?? []), event])
  }), [])

  useEffect(() => {
    if (terminalOutputRef.current) terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight
  }, [activeSession?.output])

  useEffect(() => {
    setDocumentSearch('')
    setSelectedDocument(null)
  }, [selectedId])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedDocument(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [])

  async function addFolder() {
    setError(null)
    const state = await window.masterCommander.addFolder()
    if (!state) return
    setWorkspace(state)
    setSelectedId((current) => current && state.projects.some((project) => project.id === current) ? current : state.projects[0]?.id ?? null)
  }

  async function refresh() {
    setLoading(true)
    try {
      const state = await window.masterCommander.refresh()
      setWorkspace(state)
      setSelectedId((current) => current && state.projects.some((project) => project.id === current) ? current : state.projects[0]?.id ?? null)
    } finally { setLoading(false) }
  }

  function requestFor(project: ProjectDescriptor, item: ProjectCommand): RunRequest {
    return { projectId: project.id, cwd: project.path, command: item.command, label: item.label }
  }

  async function runIntegrated(project: ProjectDescriptor, item: ProjectCommand) {
    setError(null)
    try {
      const result = await window.masterCommander.runIntegrated(requestFor(project, item))
      const initial = `❯ ${item.command}\n\n`
      const buffered = eventBacklog.current.get(result.sessionId) ?? []
      eventBacklog.current.delete(result.sessionId)
      let status: Session['status'] = 'running'
      let output = initial
      for (const event of buffered) {
        output += cleanOutput(event.data)
        if (event.type === 'exit') status = event.exitCode === 0 ? 'success' : 'failed'
        if (event.type === 'error') status = 'failed'
      }
      setSessions((current) => [...current, {
        id: result.sessionId, projectId: project.id, projectName: project.name,
        label: item.label, command: item.command, output, status
      }])
      setActiveSessionId(result.sessionId)
      setTerminalOpen(true)
    } catch (reason) { setError(String(reason)) }
  }

  async function runExternal(project: ProjectDescriptor, item: ProjectCommand) {
    try { await window.masterCommander.runExternal(requestFor(project, item)) }
    catch (reason) { setError(String(reason)) }
  }

  async function removeSelected() {
    if (!selectedProject || !confirm(`Remove “${selectedProject.name}” from the list? Its files will not be changed.`)) return
    const state = await window.masterCommander.removeProject(selectedProject.id)
    setWorkspace(state)
    setSelectedId(state.projects[0]?.id ?? null)
  }

  async function toggleFavorite() {
    if (!selectedProject) return
    setWorkspace(await window.masterCommander.toggleFavorite(selectedProject.id))
  }

  async function addCustomCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProject) return
    const values = new FormData(event.currentTarget)
    const label = String(values.get('label') ?? '').trim()
    const value = String(values.get('command') ?? '').trim()
    if (!label || !value) return
    const custom: ProjectCommand = { id: `custom-${Date.now()}`, label, command: value, source: 'Custom' }
    setWorkspace(await window.masterCommander.addCustomCommand(selectedProject.id, custom))
    setCustomFormOpen(false)
  }

  async function removeCustomCommand(commandId: string) {
    if (!selectedProject) return
    setWorkspace(await window.masterCommander.removeCustomCommand(selectedProject.id, commandId))
  }

  async function openDocument(project: ProjectDescriptor, document: ProjectDocument) {
    setSelectedDocument({ project, document })
    setDocumentContent('')
    setDocumentLoading(true)
    try { setDocumentContent(await window.masterCommander.readDocument(project.id, document.id)) }
    catch (reason) { setError(String(reason)); setSelectedDocument(null) }
    finally { setDocumentLoading(false) }
  }

  function Markdown({ content, compact = false }: { content: string; compact?: boolean }) {
    return (
      <div className={`markdown-body ${compact ? 'compact' : ''}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          a: ({ href, children }) => (
            <a href={href} onClick={(event) => {
              if (!href || !/^https?:\/\//i.test(href)) return
              event.preventDefault()
              window.masterCommander.openExternal(href)
            }}>{children}</a>
          )
        }}>{content}</ReactMarkdown>
      </div>
    )
  }

  function closeSession(id: string) {
    setSessions((current) => current.filter((session) => session.id !== id))
    if (activeSessionId === id) {
      const remaining = sessions.filter((session) => session.id !== id)
      setActiveSessionId(remaining.at(-1)?.id ?? null)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">MC</span><span>Master Commander</span></div>
        <div className="global-search">
          <Search size={15} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects…" aria-label="Search projects" />
          <kbd>Ctrl K</kbd>
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={refresh} title="Rescan commands"><RefreshCw size={16} className={loading ? 'spin' : ''} /></button>
          <button className="primary-button" onClick={addFolder}><Plus size={16} /> Add</button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-heading"><span>PROJECTS</span><span className="count">{topLevelProjects.length}</span></div>
        <nav className="project-list">
          {visibleProjects.map((project) => {
            const children = workspace.projects.filter((candidate) => candidate.parentId === project.id)
            const expanded = project.id === selectedId || selectedProject?.parentId === project.id || search.trim().length > 0
            return <div className="project-group" key={project.id}>
              <button className={`project-item ${project.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(project.id)}>
                <ProjectGlyph project={project} />
                <span className="project-item-copy"><strong>{project.name}</strong><small>{project.kinds.map((kind) => kindMeta[kind].label).join(' · ')}{children.length ? ` · ${children.length} subprojects` : ''}</small></span>
                {project.favorite && <Heart className="favorite-indicator" size={12} fill="currentColor" />}
                <ChevronRight className={`project-chevron ${expanded ? 'expanded' : ''}`} size={14} />
              </button>
              {expanded && children.map((child) => (
                <button key={child.id} className={`project-item child-project ${child.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(child.id)}>
                  <ProjectGlyph project={child} />
                  <span className="project-item-copy"><strong>{child.name}</strong><small>{child.kinds.map((kind) => kindMeta[kind].label).join(' · ')}</small></span>
                </button>
              ))}
            </div>
          })}
        </nav>
        {!loading && topLevelProjects.length === 0 && (
          <div className="sidebar-empty">Add a project or a folder containing multiple projects.</div>
        )}
        <div className="sidebar-footer"><span className="status-dot" /> Local workspace</div>
      </aside>

      <main className={`workspace ${terminalOpen && activeSession ? 'with-terminal' : ''}`}>
        {selectedProject ? (
          <>
            <section className="project-header">
              <div className="project-title-row">
                <ProjectGlyph project={selectedProject} />
                <div><h1>{selectedProject.name}</h1><button className="path-button" onClick={() => window.masterCommander.openFolder(selectedProject.path)}>{selectedProject.path}<FolderOpen size={13} /></button></div>
              </div>
              <div className="project-actions">
                <button className={`icon-button ${selectedProject.favorite ? 'active' : ''}`} onClick={toggleFavorite} title="Favorite"><Heart size={17} fill={selectedProject.favorite ? 'currentColor' : 'none'} /></button>
                <button className="icon-button danger-hover" onClick={removeSelected} title="Remove from list"><Trash2 size={17} /></button>
              </div>
            </section>

            <section className="command-area">
              {readme && (
                <section className="readme-section">
                  <div className="content-section-heading">
                    <div><BookOpen size={16} /><h2>README</h2><span>{readme.relativePath}</span></div>
                    <button className="secondary-button" onClick={() => openDocument(selectedProject, readme)}><BookOpen size={14} /> Read full document</button>
                  </div>
                  <div className="readme-preview" role="button" tabIndex={0} onClick={() => openDocument(selectedProject, readme)} onKeyDown={(event) => { if (event.key === 'Enter') openDocument(selectedProject, readme) }} aria-label="Open full README">
                    <Markdown content={readme.preview} compact />
                    <span className="preview-fade">Open full document <ChevronRight size={13} /></span>
                  </div>
                </section>
              )}

              {(visibleDocuments.length > 0 || documentSearch || (selectedProject.documents.length > (readme ? 1 : 0))) && (
                <section className="documents-section">
                  <div className="content-section-heading">
                    <div><FileText size={16} /><h2>Documentation</h2><span>{selectedProject.documents.length - (readme ? 1 : 0)} Markdown files</span></div>
                    <label className="compact-search"><Search size={14} /><input value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} placeholder="Search documentation" /></label>
                  </div>
                  <div className="document-list">
                    {visibleDocuments.map((document) => (
                      <button className="document-row" key={document.id} onClick={() => openDocument(selectedProject, document)}>
                        <FileText size={15} />
                        <span><strong>{document.title}</strong><small>{document.relativePath}</small></span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                    {visibleDocuments.length === 0 && <div className="documents-empty">No matching documents.</div>}
                  </div>
                </section>
              )}

              {childProjects.length > 0 && (
                <div className="subprojects-section">
                  <div className="subprojects-heading"><h2>Subprojects</h2><span>{childProjects.length}</span></div>
                  <div className="subprojects-list">
                    {childProjects.map((child) => (
                      <button key={child.id} className="subproject-row" onClick={() => setSelectedId(child.id)}>
                        <ProjectGlyph project={child} />
                        <span><strong>{child.name}</strong><small>{child.path.slice(selectedProject.path.length + 1)}</small></span>
                        <span className="subproject-kind">{child.kinds.map((kind) => kindMeta[kind].label).join(' · ')}</span>
                        <span className="subproject-command-count">{child.commands.length + child.customCommands.length} commands</span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="command-toolbar">
                <div><h2>Commands</h2><p>{visibleCommands.length} available in this project</p></div>
                <div className="command-tools">
                  <label className="compact-search"><Search size={14} /><input value={commandSearch} onChange={(event) => setCommandSearch(event.target.value)} placeholder="Filter commands" /></label>
                  <button className="secondary-button" onClick={() => setCustomFormOpen(true)}><Plus size={15} /> Command</button>
                </div>
              </div>

              {customFormOpen && (
                <form className="custom-command-form" onSubmit={addCustomCommand}>
                  <input name="label" placeholder="Command name" autoFocus required />
                  <input name="command" className="mono-input" placeholder="e.g. npm run dev -- --host" required />
                  <button className="primary-button" type="submit">Save</button>
                  <button className="icon-button" type="button" onClick={() => setCustomFormOpen(false)}><X size={16} /></button>
                </form>
              )}

              <div className="command-list">
                {visibleCommands.map((item) => {
                  const custom = selectedProject.customCommands.some((command) => command.id === item.id)
                  return (
                    <div className="command-row" key={item.id}>
                      <button className="run-button" onClick={() => runIntegrated(selectedProject, item)} title="Run in the integrated console"><ChevronRight size={17} fill="currentColor" /></button>
                      <button className="command-main" onClick={() => runIntegrated(selectedProject, item)}>
                        <span className="command-name">{item.label}</span>
                        <code>{item.command}</code>
                      </button>
                      <span className="command-source">{custom ? 'Custom' : item.source}</span>
                      <button className="row-action" onClick={() => navigator.clipboard.writeText(item.command)} title="Copy command"><Copy size={15} /></button>
                      <button className="row-action external-action" onClick={() => runExternal(selectedProject, item)} title="Open in an external terminal"><ExternalLink size={15} /></button>
                      {custom && <button className="row-action danger-hover" onClick={() => removeCustomCommand(item.id)} title="Delete command"><Trash2 size={15} /></button>}
                    </div>
                  )
                })}
                {visibleCommands.length === 0 && <div className="no-commands">No commands found. You can add a custom command.</div>}
              </div>
            </section>
          </>
        ) : (
          <section className="welcome-state">
            <div className="welcome-symbol"><TerminalSquare size={38} /></div>
            <h1>Your workspace, under control.</h1>
            <p>Add a project or a folder. Available commands will be detected automatically.</p>
            <button className="primary-button large" onClick={addFolder}><FolderOpen size={17} /> Choose a folder</button>
            <div className="supported-stack"><span>Node</span><span>.NET</span><span>Rust</span><span>Python</span><span>Go</span><span>Docker</span></div>
          </section>
        )}
      </main>

      {activeSession && terminalOpen && (
        <section className="terminal-panel">
          <div className="terminal-tabs">
            <div className="terminal-label"><TerminalSquare size={14} /> CONSOLE</div>
            <div className="session-tabs">
              {sessions.map((session) => (
                <button key={session.id} className={`session-tab ${session.id === activeSessionId ? 'active' : ''}`} onClick={() => setActiveSessionId(session.id)}>
                  <span className={`session-status ${session.status}`} />{session.projectName}: {session.label}
                  <X size={12} onClick={(event) => { event.stopPropagation(); closeSession(session.id) }} />
                </button>
              ))}
            </div>
            <div className="terminal-actions">
              {activeSession.status === 'running' && <button onClick={() => window.masterCommander.stopProcess(activeSession.id)}><CircleStop size={14} /> Stop</button>}
              <button onClick={() => setTerminalOpen(false)}><X size={15} /></button>
            </div>
          </div>
          <pre className="terminal-output" ref={terminalOutputRef}>{activeSession.output || 'Starting…'}</pre>
          {activeSession.status === 'running' && (
            <form className="terminal-input" onSubmit={(event) => {
              event.preventDefault()
              const input = event.currentTarget.elements.namedItem('stdin') as HTMLInputElement
              window.masterCommander.sendInput(activeSession.id, `${input.value}\n`)
              input.value = ''
            }}>
              <span>stdin</span><input name="stdin" autoComplete="off" placeholder="Send input to the process…" /><button><Send size={14} /></button>
            </form>
          )}
        </section>
      )}

      {!terminalOpen && sessions.length > 0 && <button className="reopen-terminal" onClick={() => setTerminalOpen(true)}><TerminalSquare size={15} /> Console <span>{sessions.length}</span></button>}
      {selectedDocument && (
        <div className="document-overlay" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedDocument(null) }}>
          <article className="document-reader">
            <header className="document-reader-header">
              <div><span>DOCUMENTATION</span><h2>{selectedDocument.document.title}</h2><p>{selectedDocument.project.name} / {selectedDocument.document.relativePath}</p></div>
              <button className="icon-button" onClick={() => setSelectedDocument(null)} title="Close"><X size={18} /></button>
            </header>
            <div className="document-reader-content">
              {documentLoading ? <div className="document-loading">Loading document…</div> : <Markdown content={documentContent} />}
            </div>
          </article>
        </div>
      )}
      {error && <div className="error-toast"><span>{error}</span><button onClick={() => setError(null)}><X size={14} /></button></div>}
    </div>
  )
}

export default App
