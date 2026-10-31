import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export function TerminalView({ sessionId, output, running }: { sessionId: string; output: string; running: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const written = useRef(0)
  const runningRef = useRef(running)
  runningRef.current = running

  useEffect(() => {
    if (!host.current) return
    const terminal = new Terminal({ cursorBlink: true, fontSize: 12, fontFamily: 'monospace', scrollback: 10000, theme: { background: '#0b0e0c', foreground: '#bfc8c1', cursor: '#c7f464' } })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host.current)
    terminalRef.current = terminal
    written.current = 0
    const input = terminal.onData((data) => { if (runningRef.current) void window.masterCommander.sendInput(sessionId, data) })
    const resize = () => {
      if (!host.current?.clientWidth || !host.current.clientHeight) return
      fit.fit()
      void window.masterCommander.resizeTerminal(sessionId, terminal.cols, terminal.rows)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host.current)
    resize()
    terminal.focus()
    return () => { observer.disconnect(); input.dispose(); terminal.dispose(); terminalRef.current = null }
  }, [sessionId])

  useEffect(() => {
    terminalRef.current?.write(output.slice(written.current))
    written.current = output.length
  }, [sessionId, output])

  return <div ref={host} className="terminal-emulator" aria-label="Interactive project terminal" />
}
