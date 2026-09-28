import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus } from 'lucide-react'
import {
  PAGE_GAP_PX,
  PAGE_PX,
  paginateResume,
  renderResumeHtml,
  type ResumeDocument
} from '../../../../shared/resume'
import { Button } from '../../components/ui'

/**
 * Live preview: renders the same HTML the PDF export uses into a sandboxed
 * iframe (no scripts run inside it) and paginates it with the same function,
 * so page breaks here match the downloaded PDF.
 */
export function ResumePreview({ doc }: { doc: ResumeDocument }): React.JSX.Element {
  const [html, setHtml] = useState(() => renderResumeHtml(doc, { mode: 'preview' }))
  const [pages, setPages] = useState(1)
  const [zoom, setZoom] = useState(0.7)
  const [fit, setFit] = useState(true)
  const [current, setCurrent] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const page = PAGE_PX[doc.pageSize]

  // Debounced re-render while typing.
  useEffect(() => {
    const t = setTimeout(() => setHtml(renderResumeHtml(doc, { mode: 'preview' })), 200)
    return () => clearTimeout(t)
  }, [doc])

  // Fit-to-width follows the pane size.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !fit) return
    const apply = (): void =>
      setZoom(Math.max(0.3, Math.min(1.6, (el.clientWidth - 32) / page.width)))
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit, page.width])

  const onLoad = (): void => {
    const d = frame.current?.contentDocument
    if (!d) return
    setPages(Math.max(1, paginateResume(d)))
  }

  const height = pages * (page.height + PAGE_GAP_PX) + PAGE_GAP_PX
  const goTo = (i: number): void => {
    const n = Math.max(0, Math.min(pages - 1, i))
    setCurrent(n)
    scroller.current?.scrollTo({ top: n * (page.height + PAGE_GAP_PX) * zoom, behavior: 'smooth' })
  }
  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    setCurrent(Math.min(pages - 1, Math.round(el.scrollTop / ((page.height + PAGE_GAP_PX) * zoom))))
  }
  const zoomLabel = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom])

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-white/[0.07] bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2 text-[11px] text-slate-300">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Previous page"
            onClick={() => goTo(current - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span data-testid="preview-pages">
            Page {Math.min(current + 1, pages)} of {pages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Next page"
            onClick={() => goTo(current + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        <span className="text-slate-500">
          {doc.pageSize === 'a4' ? 'A4' : 'US Letter'} · preview matches the PDF
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom out"
            onClick={() => {
              setFit(false)
              setZoom((z) => Math.max(0.3, z - 0.1))
            }}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-10 text-center tabular-nums">{zoomLabel}</span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom in"
            onClick={() => {
              setFit(false)
              setZoom((z) => Math.min(1.6, z + 0.1))
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant={fit ? 'primary' : 'ghost'}
            aria-label="Fit width"
            onClick={() => setFit(true)}
            icon={<Maximize2 className="h-3 w-3" />}
          >
            Fit
          </Button>
        </div>
      </div>
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto bg-slate-700/40"
        data-testid="resume-preview"
      >
        <div
          style={{ width: page.width * zoom, height: height * zoom }}
          className="relative mx-auto"
        >
          <iframe
            ref={frame}
            title="Resume preview"
            sandbox="allow-same-origin"
            srcDoc={html}
            onLoad={onLoad}
            style={{
              width: page.width,
              height,
              border: 0,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              position: 'absolute',
              top: 0,
              left: 0,
              background: 'transparent'
            }}
          />
        </div>
      </div>
    </div>
  )
}
