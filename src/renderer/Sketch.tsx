import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addShape, allNodes, constrainAngle, dist, insertNodeAfter, makeShape, mirrorShapeX, moveNode, outlineBounds,
  isSharp, removeNode, removeShape, round1, shapeToSvgPath, toggleSharp, sketchSize, sketchToSvg, snapPoint, translateShape, updateShape,
  type Pt, type Shape, type SketchDoc, type Underlay
} from '@core/shapes'
import { isPdfDataUrl, pdfFirstPageToPng } from './pdf'
import { isoDrawing } from '@core/isometric'
import { partsFor } from '@core/parts'
import { TABLE_LABEL, rebuildFromParams, type FurnitureCategory, specsFor, syncFromOutline, type TableKind } from '@core/furniture'
import { SOFA_LABEL, paramsFromSketch, type SofaKind } from '@core/sofa'
import { NumberField } from './ui'

type Tool = 'select' | 'pen' | 'line' | 'rect' | 'ellipse' | 'dim' | 'hand' | 'calib'

const TOOLS: { id: Tool; label: string; key: string; tip: string }[] = [
  { id: 'select', label: 'Chọn', key: 'V', tip: 'Chọn hình, kéo nút. Bấm đôi vào điểm giữa cạnh để thêm nút' },
  { id: 'pen', label: 'Bút', key: 'P', tip: 'Bấm để thêm nút. Enter hoặc bấm đôi để kết thúc, bấm nút đầu để khép kín' },
  { id: 'line', label: 'Đoạn', key: 'L', tip: 'Kéo để vẽ một đoạn thẳng' },
  { id: 'rect', label: 'Chữ nhật', key: 'R', tip: 'Kéo để vẽ hình chữ nhật' },
  { id: 'ellipse', label: 'Elip', key: 'E', tip: 'Kéo từ tâm ra' },
  { id: 'dim', label: 'Kích thước', key: 'D', tip: 'Kéo để ghi kích thước' },
  { id: 'hand', label: 'Tay', key: 'H', tip: 'Kéo để dời khung nhìn (hoặc giữ Space)' },
  { id: 'calib', label: 'Tỉ lệ ảnh', key: 'K', tip: 'Bấm hai điểm trên ảnh nền rồi nhập khoảng cách thật' }
]

const GRID = 50

interface Props {
  doc: SketchDoc
  canUndo: boolean
  canRedo: boolean
  onEdit: (d: SketchDoc) => void
  onUndo: () => void
  onRedo: () => void
  loadId: number
  /** underlay: ảnh nền hiện tại, để ghi cùng file */
  onSave: (underlay: Underlay | null) => void
  onOpen: () => void
  onToLibrary: () => void
  onExportSvg: () => void
  /** Dựng hình 3D từ bản phác thảo và mở màn Dựng 3D */
  onTo3d: () => void
  onIllustrate: (pngBase64: string, prompt: string) => Promise<string | null>
  onNew: (category: FurnitureCategory, kind?: string) => void
}

interface View { x: number; y: number; w: number }

/** Ảnh nền để dò nét: vị trí góc trên trái (mm), mm trên mỗi điểm ảnh, độ mờ. */
type RefImg = Underlay

/** Biến SVG khung nét thành PNG base64 để gửi bộ tạo ảnh. Chỉ nét vẽ trắng đen, không có dữ liệu khác. */
async function svgToPng(svg: string, width: number, height: number): Promise<string> {
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  const k = Math.min(width / img.width, height / img.height)
  ctx.drawImage(img, (width - img.width * k) / 2, (height - img.height * k) / 2, img.width * k, img.height * k)
  return canvas.toDataURL('image/png').split(',')[1] ?? ''
}

export function SketchEditor(p: Props) {
  const { doc } = p
  const wrap = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [view, setView] = useState<View>({ x: -400, y: -400, w: 4000 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selNode, setSelNode] = useState<number | null>(null)
  const [draft, setDraft] = useState<SketchDoc | null>(null)
  const [drawing, setDrawing] = useState<{ tool: Tool; pts: Pt[]; cursor: Pt } | null>(null)
  const [snap, setSnap] = useState(true)
  const [guide, setGuide] = useState<{ x?: number; y?: number } | null>(null)
  const [full, setFull] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [image, setImage] = useState<{ src: string; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const [ref, setRef] = useState<RefImg | null>(doc.underlay ?? null)
  // Mỗi lần nạp phác thảo mới (mở file, tạo mới, sau khi lưu) thì lấy ảnh nền theo tệp.
  useEffect(() => { setRef(doc.underlay ?? null); setCalib(null) }, [p.loadId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [calib, setCalib] = useState<{ pts: Pt[]; real: string } | null>(null)
  const drag = useRef<null | { kind: 'node' | 'shape' | 'pan'; id?: string; i?: number; start: Pt; startClient: Pt; startView: View; moved: boolean }>(null)

  const shown = draft ?? doc
  const selected = shown.shapes.find((s) => s.id === selectedId) ?? null
  const size = sketchSize(shown)
  const params = useMemo(() => paramsFromSketch(doc), [doc])

  // Khung nhìn vừa với bản phác thảo khi mở hoặc đổi mẫu.
  const fit = useCallback(() => {
    const b = outlineBounds(doc)
    const el = svgRef.current
    if (!b || !el) return
    const bw = b.maxX - b.minX + 800
    const bh = b.maxY - b.minY + 800
    const aspect = Math.max(0.2, el.clientWidth) / Math.max(0.2, el.clientHeight || 1)
    const w = Math.max(bw, bh * aspect)
    const h = w / aspect
    setView({ x: (b.minX + b.maxX) / 2 - w / 2, y: (b.minY + b.maxY) / 2 - h / 2, w })
  }, [doc.name, doc.kind]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fit() }, [doc.name, doc.kind, full]) // eslint-disable-line react-hooks/exhaustive-deps

  const toMm = useCallback((clientX: number, clientY: number): Pt => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const m = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: m.x, y: m.y }
  }, [])

  const pxToMm = (px: number): number => {
    const el = svgRef.current
    return el ? (px * view.w) / Math.max(1, el.clientWidth) : px
  }

  const snapTo = (pt: Pt, exceptId?: string, anchor?: Pt, shift = false, alt = false): Pt => {
    let q = pt
    if (shift && anchor) q = constrainAngle(anchor, q)
    if (!snap || alt) { setGuide(null); return { x: round1(q.x), y: round1(q.y) } }
    const r = snapPoint(q, GRID, allNodes(shown, exceptId), pxToMm(8))
    setGuide(r.hit)
    return r.p
  }

  const finishPath = (pts: Pt[], closed: boolean) => {
    if (pts.length >= 2) {
      const s = makeShape({ kind: 'path', nodes: pts, closed: closed && pts.length >= 3, name: 'Đường vẽ tay', role: 'free' })
      p.onEdit(addShape(doc, s))
      setSelectedId(s.id)
    }
    setDrawing(null)
    setGuide(null)
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 1 || tool === 'hand' || spaceDown) {
      drag.current = { kind: 'pan', start: { x: 0, y: 0 }, startClient: { x: e.clientX, y: e.clientY }, startView: view, moved: false }
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      return
    }
    if (e.button !== 0) return
    const raw = toMm(e.clientX, e.clientY)
    if (tool === 'calib' && ref) {
      const pts = calib && calib.pts.length < 2 ? [...calib.pts, raw] : [raw]
      setCalib({ pts, real: '' })
      return
    }
    if (tool === 'pen') {
      const pts = drawing?.pts ?? []
      const pt = snapTo(raw, undefined, pts[pts.length - 1], e.shiftKey, e.altKey)
      if (pts.length >= 3 && dist(pt, pts[0]!) < pxToMm(10)) return finishPath(pts, true)
      setDrawing({ tool, pts: [...pts, pt], cursor: pt })
      return
    }
    if (tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'dim') {
      const pt = snapTo(raw, undefined, undefined, false, e.altKey)
      setDrawing({ tool, pts: [pt], cursor: pt })
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      return
    }
    // chọn: bấm vào nền thì bỏ chọn
    setSelectedId(null)
    setSelNode(null)
  }

  const beginNodeDrag = (e: React.PointerEvent, s: Shape, i: number) => {
    e.stopPropagation()
    setSelectedId(s.id)
    setSelNode(i)
    if (s.locked) return
    drag.current = { kind: 'node', id: s.id, i, start: toMm(e.clientX, e.clientY), startClient: { x: e.clientX, y: e.clientY }, startView: view, moved: false }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

  const beginShapeDrag = (e: React.PointerEvent, s: Shape) => {
    if (tool !== 'select' || spaceDown) return
    e.stopPropagation()
    setSelectedId(s.id)
    setSelNode(null)
    if (s.locked) return
    drag.current = { kind: 'shape', id: s.id, start: toMm(e.clientX, e.clientY), startClient: { x: e.clientX, y: e.clientY }, startView: view, moved: false }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (d?.kind === 'pan') {
      const k = d.startView.w / Math.max(1, svgRef.current!.clientWidth)
      setView({ ...d.startView, x: d.startView.x - (e.clientX - d.startClient.x) * k, y: d.startView.y - (e.clientY - d.startClient.y) * k })
      return
    }
    const raw = toMm(e.clientX, e.clientY)
    if (d?.kind === 'node' && d.id !== undefined && d.i !== undefined) {
      d.moved = true
      const anchor = doc.shapes.find((s) => s.id === d.id)?.nodes[(d.i + 1) % 2]
      const pt = snapTo(raw, d.id, anchor, e.shiftKey, e.altKey)
      setDraft(updateShape(doc, d.id, (s) => moveNode(s, d.i!, pt), true))
      return
    }
    if (d?.kind === 'shape' && d.id) {
      d.moved = true
      const dx = Math.round((raw.x - d.start.x) / (snap ? GRID : 1)) * (snap ? GRID : 1)
      const dy = Math.round((raw.y - d.start.y) / (snap ? GRID : 1)) * (snap ? GRID : 1)
      setDraft(updateShape(doc, d.id, (s) => translateShape(s, dx, dy), true))
      return
    }
    if (drawing) {
      const anchor = drawing.pts[drawing.pts.length - 1]
      setDrawing({ ...drawing, cursor: snapTo(raw, undefined, anchor, e.shiftKey, e.altKey) })
    }
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.kind === 'node' || d?.kind === 'shape') {
      if (draft && d.moved) {
        let next = draft
        // Kéo nút khung ngoài thì cập nhật thông số rộng/sâu theo khung.
        const moved = next.shapes.find((s) => s.id === d.id)
        if (moved?.role === 'outline') next = syncFromOutline(next)
        p.onEdit(next)
      }
      setDraft(null)
      setGuide(null)
      return
    }
    if (drawing && drawing.tool !== 'pen') {
      const a = drawing.pts[0]!
      const b = drawing.cursor
      if (dist(a, b) > 5) {
        let s: Shape | null = null
        if (drawing.tool === 'line') s = makeShape({ kind: 'path', nodes: [a, b], name: 'Đoạn thẳng' })
        else if (drawing.tool === 'rect')
          s = makeShape({ kind: 'path', closed: true, name: 'Chữ nhật', nodes: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }] })
        else if (drawing.tool === 'ellipse') s = makeShape({ kind: 'ellipse', nodes: [a, { x: b.x, y: b.y }], closed: true })
        else if (drawing.tool === 'dim') s = makeShape({ kind: 'dim', nodes: [a, b], role: 'dimension', strokeWidth: 1, stroke: '#2FB4C4' })
        if (s) {
          p.onEdit(addShape(doc, s))
          setSelectedId(s.id)
        }
      }
      setDrawing(null)
      setGuide(null)
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    const at = toMm(e.clientX, e.clientY)
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15
    const w = Math.min(40000, Math.max(300, view.w * k))
    const r = w / view.w
    setView({ x: at.x - (at.x - view.x) * r, y: at.y - (at.y - view.y) * r, w })
  }

  // ---- thao tác trên hình đang chọn ----
  const edit = (fn: (s: Shape) => Shape, manual = true) => {
    if (selectedId) p.onEdit(updateShape(doc, selectedId, fn, manual))
  }
  const deleteSelection = () => {
    if (!selected || selected.locked) return
    if (selNode !== null && selected.kind === 'path') {
      const next = removeNode(selected, selNode)
      if (next !== selected) { edit(() => next); setSelNode(null); return }
    }
    p.onEdit(removeShape(doc, selected.id))
    setSelectedId(null)
    setSelNode(null)
  }
  const mirror = () => {
    if (!selected) return
    const b = outlineBounds(doc)
    const axis = b ? (b.minX + b.maxX) / 2 : 0
    edit((s) => mirrorShapeX(s, axis))
  }

  const toggleFull = useCallback(async () => {
    const el = wrap.current?.closest('.sketch-root') as HTMLElement | null
    if (!el) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await el.requestFullscreen()
    } catch {
      setFull((f) => !f)
    }
  }, [])
  useEffect(() => {
    const h = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const mod = e.ctrlKey || e.metaKey
      if (e.key === ' ') { setSpaceDown(e.type === 'keydown'); if (e.type === 'keydown') e.preventDefault(); return }
      if (e.type !== 'keydown') return
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) p.onRedo(); else p.onUndo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); p.onRedo(); return }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); p.onSave(ref); return }
      if (mod) return
      if (e.key === 'Escape') { setCalib(null); setDrawing(null); setSelectedId(null); setSelNode(null); return }
      if (e.key === 'Enter' && drawing?.tool === 'pen') { finishPath(drawing.pts, false); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return }
      if (e.key.toLowerCase() === 'f') { void toggleFull(); return }
      if (e.key === '0') { fit(); return }
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase() && (x.id !== 'calib' || ref))
      if (t) { setTool(t.id); setDrawing(null) }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey) }
  })

  const setParams = (patch: Record<string, number>, kind?: string) => p.onEdit(rebuildFromParams(doc, patch, kind))

  const illustrate = async () => {
    if (!prompt.trim()) return
    setBusy(true)
    try {
      const svg = sketchToSvg(doc)
      const png = await svgToPng(svg, 768, 512)
      const out = await p.onIllustrate(png, prompt.trim())
      if (out) setImage({ src: `data:image/png;base64,${out}`, label: 'Ảnh minh hoạ AI, không phải bản vẽ kỹ thuật' })
    } finally {
      setBusy(false)
    }
  }

  const loadRef = async () => {
    try {
      let r = await window.sdraw.openReferenceImage()
      if (!r) return
      if (isPdfDataUrl(r.src)) {
        const png = await pdfFirstPageToPng(r.src)
        r = { ...r, src: png.src, width: png.width, height: png.height, name: r.name.replace(/\.pdf$/i, '') + ' (trang 1).png' }
      }
      // Mặc định 1 điểm ảnh = 1 mm; người dùng đặt tỉ lệ bằng hai điểm ngay sau đó.
      setRef({ src: r.src, name: r.name, px: r.width, py: r.height, x: 0, y: 0, scale: 1, opacity: 0.5 })
      setTool('calib')
      setCalib(null)
    } catch (e) {
      window.alert((e as Error).message)
    }
  }
  const applyCalib = () => {
    if (!ref || !calib || calib.pts.length !== 2) return
    const real = Number(calib.real.replace(',', '.'))
    const measured = dist(calib.pts[0]!, calib.pts[1]!)
    if (!Number.isFinite(real) || real <= 0 || measured < 1) return
    const k = real / measured
    const a = calib.pts[0]!
    // Điểm thứ nhất đứng yên, ảnh co giãn quanh nó.
    setRef({ ...ref, scale: ref.scale * k, x: a.x - (a.x - ref.x) * k, y: a.y - (a.y - ref.y) * k })
    setCalib(null)
    setTool('select')
  }

  const cursor = tool === 'hand' || spaceDown ? 'grab' : tool === 'select' ? 'default' : 'crosshair'
  const hs = pxToMm(5) // bán kính nút theo mm
  const vbH = (view.w * (svgRef.current?.clientHeight ?? 600)) / Math.max(1, svgRef.current?.clientWidth ?? 800)
  const gridStep = view.w > 12000 ? 1000 : view.w > 5000 ? 500 : 100

  const dimLabel = (s: Shape) => `${Math.round(dist(s.nodes[0]!, s.nodes[1]!))} mm`

  return (
    <div className={`sketch-root${full ? ' is-full' : ''}`}>
      <div className="sketch-top">
        <strong className="sketch-name">{doc.name}</strong>
        <span className="muted">{size.w} × {size.d} × {doc.heightMm} mm</span>
        <span className="sep" />
        <button className="btn" onClick={p.onOpen}>Mở</button>
        <button className="btn" onClick={() => p.onSave(ref)}>Lưu</button>
        <button className="btn icon" aria-label="Hoàn tác" disabled={!p.canUndo} onClick={p.onUndo}>↶</button>
        <button className="btn icon" aria-label="Làm lại" disabled={!p.canRedo} onClick={p.onRedo}>↷</button>
        <button className="btn" onClick={fit} title="Phím 0">Vừa khung</button>
        <label className="check"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Bám nút và lưới</label>
        <span className="sep" />
        <button className="btn" onClick={p.onExportSvg}>Xuất SVG</button>
        <button className="btn" onClick={p.onTo3d} title="Dựng khối 3D theo nét vẽ và kích thước của bản phác thảo, mở trong Dựng 3D">Dựng 3D từ phác thảo</button>
        <button className="btn-cta" onClick={p.onToLibrary}>Lưu vào kho mẫu</button>
        <button className="btn" onClick={() => void toggleFull()} title="Phím F">{full ? 'Thoát toàn màn hình' : 'Toàn màn hình'}</button>
      </div>

      <div className="sketch-body">
        <div className="toolbar" role="toolbar" aria-label="Công cụ vẽ">
          {TOOLS.filter((t) => t.id !== 'calib' || ref).map((t) => (
            <button key={t.id} className={tool === t.id ? 'tool on' : 'tool'} title={`${t.tip} (${t.key})`} onClick={() => { setTool(t.id); setDrawing(null) }}>
              <span>{t.label}</span><kbd>{t.key}</kbd>
            </button>
          ))}
        </div>

        <div className="sketch-canvas" ref={wrap}>
          <svg
            ref={svgRef}
            viewBox={`${view.x} ${view.y} ${view.w} ${vbH}`}
            style={{ cursor }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            onDoubleClick={() => { if (drawing?.tool === 'pen') finishPath(drawing.pts.slice(0, -1), false) }}
          >
            <defs>
              <pattern id="g" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
                <path d={`M${gridStep} 0H0V${gridStep}`} fill="none" stroke="#DCE8EA" strokeWidth={view.w / 1600} />
              </pattern>
            </defs>
            <rect x={view.x - 20000} y={view.y - 20000} width={40000 + view.w} height={40000 + vbH} fill="url(#g)" />
            {ref ? (
              <image href={ref.src} x={ref.x} y={ref.y} width={ref.px * ref.scale} height={ref.py * ref.scale} opacity={ref.opacity} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />
            ) : null}
            <line x1={0} y1={view.y - 20000} x2={0} y2={view.y + 40000} stroke="#B7CDD1" strokeWidth={view.w / 1200} />
            <line y1={0} x1={view.x - 20000} y2={0} x2={view.x + 40000} stroke="#B7CDD1" strokeWidth={view.w / 1200} />

            {shown.shapes.filter((s) => s.visible).map((s) => (
              <g key={s.id} opacity={s.role === 'reference' ? 0.45 : 1}>
                {s.kind === 'dim' ? (
                  <>
                    <line x1={s.nodes[0]!.x} y1={s.nodes[0]!.y} x2={s.nodes[1]!.x} y2={s.nodes[1]!.y} stroke={s.stroke} strokeWidth={view.w / 900} />
                    <text x={(s.nodes[0]!.x + s.nodes[1]!.x) / 2} y={(s.nodes[0]!.y + s.nodes[1]!.y) / 2 - hs * 2} fontSize={hs * 3.2} textAnchor="middle" fill="#1B8794">{dimLabel(s)}</text>
                  </>
                ) : (
                  <path d={shapeToSvgPath(s)} fill={s.fill ?? 'none'} stroke={s.id === selectedId ? '#FFB020' : s.stroke} strokeWidth={Math.max(s.strokeWidth * (view.w / 1600), view.w / 1200)} strokeLinejoin="round" strokeLinecap="round" onPointerDown={s.fill ? (e) => beginShapeDrag(e, s) : undefined} />
                )}
                {/* vùng bấm rộng để dễ chọn */}
                <path d={shapeToSvgPath(s)} fill="none" stroke="transparent" strokeWidth={hs * 3} onPointerDown={(e) => beginShapeDrag(e, s)} style={{ cursor: tool === 'select' ? 'move' : cursor }} />
              </g>
            ))}

            {selected && tool === 'select' && !selected.locked ? (
              <g>
                {selected.kind === 'path' && selected.nodes.map((n, i) => {
                  const nxt = selected.nodes[(i + 1) % selected.nodes.length]!
                  const hasEdge = selected.closed || i < selected.nodes.length - 1
                  return hasEdge ? (
                    <circle key={`m${i}`} cx={(n.x + nxt.x) / 2} cy={(n.y + nxt.y) / 2} r={hs * 0.8} fill="#fff" stroke="#2FB4C4" strokeWidth={hs / 4}
                      onDoubleClick={(e) => { e.stopPropagation(); edit((s) => insertNodeAfter(s, i)) }}>
                      <title>Bấm đôi để thêm nút</title>
                    </circle>
                  ) : null
                })}
                {selected.nodes.map((n, i) => (
                  <rect key={i} x={n.x - hs} y={n.y - hs} width={hs * 2} height={hs * 2} fill={i === selNode ? '#FFB020' : '#fff'} stroke="#0D1B2A" strokeWidth={hs / 3}
                    style={{ cursor: 'move' }} onPointerDown={(e) => beginNodeDrag(e, selected, i)} />
                ))}
              </g>
            ) : null}

            {guide ? (
              <g stroke="#E5484D" strokeWidth={view.w / 1600} strokeDasharray={`${hs * 2} ${hs * 2}`}>
                {guide.x !== undefined ? <line x1={guide.x} x2={guide.x} y1={view.y} y2={view.y + vbH} /> : null}
                {guide.y !== undefined ? <line y1={guide.y} y2={guide.y} x1={view.x} x2={view.x + view.w} /> : null}
              </g>
            ) : null}

            {calib ? (
              <g>
                {calib.pts.length === 2 ? <line x1={calib.pts[0]!.x} y1={calib.pts[0]!.y} x2={calib.pts[1]!.x} y2={calib.pts[1]!.y} stroke="#E5484D" strokeWidth={view.w / 800} /> : null}
                {calib.pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={hs} fill="#E5484D" />)}
              </g>
            ) : null}
            {drawing ? <DraftShape d={drawing} hs={hs} view={view} /> : null}
          </svg>
          <div className="sketch-status">
            {tool === 'pen' && drawing ? 'Enter để kết thúc · bấm nút đầu để khép kín · Esc để huỷ' : TOOLS.find((t) => t.id === tool)?.tip}
            {drawing && drawing.pts[0] ? ` · ${Math.round(dist(drawing.pts[drawing.pts.length - 1]!, drawing.cursor))} mm` : ''}
          </div>
        </div>

        <aside className="sketch-side">
          {doc.category === 'Sofa' ? (
            <section>
              <h3>Thông số sofa</h3>
              <div className="seg" role="group" aria-label="Kiểu sofa">
                {(['straight', 'L', 'round'] as SofaKind[]).map((k) => (
                  <button key={k} className={params.kind === k ? 'on' : ''} onClick={() => setParams({}, k)}>{SOFA_LABEL[k]}</button>
                ))}
              </div>
              <NumberField label="Rộng" suffix="mm" value={params.width} min={600} onCommit={(v) => setParams({ width: v })} />
              <NumberField label="Sâu" suffix="mm" value={params.depth} min={500} onCommit={(v) => setParams({ depth: v })} />
              {params.kind === 'L' ? <NumberField label="Chaise" suffix="mm" value={params.chaise} min={800} onCommit={(v) => setParams({ chaise: v })} /> : null}
              <NumberField label="Tay vịn" suffix="mm" value={params.arm} min={0} onCommit={(v) => setParams({ arm: v })} />
              <NumberField label="Lưng tựa" suffix="mm" value={params.back} min={50} onCommit={(v) => setParams({ back: v })} />
              <NumberField label="Cao" suffix="mm" value={params.height} min={300} onCommit={(v) => setParams({ height: v })} />
              <NumberField label="Số chỗ" value={params.seats} min={1} onCommit={(v) => setParams({ seats: v })} />
              {doc.manualEdits ? <p className="hint warn">Bạn đã kéo nút bằng tay. Đổi thông số sẽ vẽ lại khung, giữ nguyên các nét tự vẽ.</p> : null}
            </section>
          ) : (
            <section>
              <h3>Thông số {doc.category === 'Bàn' ? 'bàn' : doc.category === 'Giường' ? 'giường' : doc.category === 'Kệ sách' ? 'kệ' : doc.category === 'Tủ quần áo' ? 'tủ áo' : 'ghế'}</h3>
              {doc.category === 'Bàn' ? (
                <div className="seg" role="group" aria-label="Kiểu bàn">
                  {(['rect', 'round', 'oval'] as TableKind[]).map((k) => (
                    <button key={k} className={doc.kind === k ? 'on' : ''} onClick={() => setParams({}, k)}>{TABLE_LABEL[k]}</button>
                  ))}
                </div>
              ) : null}
              {specsFor(doc).map((sp) => (
                <NumberField key={sp.key} label={sp.label} suffix="mm" value={doc.params[sp.key] ?? sp.min} min={sp.min} onCommit={(v) => setParams({ [sp.key]: v })} />
              ))}
              {doc.manualEdits ? <p className="hint warn">Bạn đã kéo nút bằng tay. Đổi thông số sẽ vẽ lại khung, giữ nguyên các nét tự vẽ.</p> : null}
            </section>
          )}

          <Preview3D doc={doc} />

          <section>
            <h3>Hình đang chọn</h3>
            {selected ? (
              <>
                <input className="name-input" value={selected.name} aria-label="Tên hình" onChange={(e) => edit((s) => ({ ...s, name: e.target.value }), false)} />
                <div className="row">
                  <button className="btn" onClick={() => edit((s) => ({ ...s, locked: !s.locked }), false)}>{selected.locked ? 'Mở khoá' : 'Khoá'}</button>
                  {selected.kind === 'path' ? <button className="btn" onClick={() => edit((s) => ({ ...s, smooth: !s.smooth }), false)}>{selected.smooth ? 'Bỏ làm mượt' : 'Làm mượt'}</button> : null}
                  {selected.kind === 'path' && selected.nodes.length >= 3 ? <button className="btn" onClick={() => edit((s) => ({ ...s, closed: !s.closed }), true)}>{selected.closed ? 'Mở đường' : 'Khép kín'}</button> : null}
                  {selected.kind === 'path' && selected.smooth && selNode !== null ? (
                    <button className="btn" onClick={() => edit((s) => toggleSharp(s, selNode), false)}>{isSharp(selected, selNode) ? 'Nút: làm mượt' : 'Nút: góc nhọn'}</button>
                  ) : null}
                  <button className="btn" onClick={mirror} disabled={selected.locked}>Lật ngang</button>
                  <button className="btn danger" onClick={deleteSelection} disabled={selected.locked}>{selNode !== null ? 'Xoá nút' : 'Xoá hình'}</button>
                </div>
                <label className="check"><input type="checkbox" checked={selected.fill !== null} onChange={(e) => edit((s) => ({ ...s, fill: e.target.checked ? '#E7F3F4' : null }), false)} /> Tô nền</label>
              </>
            ) : <p className="hint">Chưa chọn hình nào.</p>}
          </section>

          <section>
            <h3>Lớp</h3>
            <ul className="layers">
              {doc.shapes.map((s) => (
                <li key={s.id} className={s.id === selectedId ? 'on' : ''}>
                  <button className="link" onClick={() => { setSelectedId(s.id); setSelNode(null); setTool('select') }}>{s.name}</button>
                  <button className="mini" aria-label={s.visible ? 'Ẩn' : 'Hiện'} onClick={() => p.onEdit(updateShape(doc, s.id, (x) => ({ ...x, visible: !x.visible })))}>{s.visible ? 'Ẩn' : 'Hiện'}</button>
                  <button className="mini" aria-label={s.locked ? 'Mở khoá' : 'Khoá'} onClick={() => p.onEdit(updateShape(doc, s.id, (x) => ({ ...x, locked: !x.locked })))}>{s.locked ? '🔒' : '🔓'}</button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Ảnh minh hoạ AI</h3>
            <textarea rows={3} placeholder="Ví dụ: sofa vải bố xám, chân gỗ sồi, phong cách Bắc Âu" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <button className="btn" disabled={busy || !prompt.trim()} onClick={() => void illustrate()}>{busy ? 'Đang tạo…' : 'Tạo ảnh từ nét vẽ'}</button>
            <p className="hint">Chỉ gửi nét vẽ trắng đen và lời nhắc. Cần mạng và máy tạo ảnh.</p>
            {image ? (<figure className="ai-image"><img src={image.src} alt="Ảnh minh hoạ do AI tạo" /><figcaption>{image.label}</figcaption></figure>) : null}
          </section>

          <section>
            <h3>Ảnh nền để dò nét</h3>
            {ref ? (
              <>
                <p className="hint">{ref.name} · {Math.round(ref.px * ref.scale)} × {Math.round(ref.py * ref.scale)} mm</p>
                <label className="check">Độ mờ <input type="range" min={10} max={100} value={Math.round(ref.opacity * 100)} onChange={(e) => setRef({ ...ref, opacity: Number(e.target.value) / 100 })} /></label>
                <NumberField label="Dời ngang" suffix="mm" value={Math.round(ref.x)} onCommit={(v) => setRef({ ...ref, x: v })} />
                <NumberField label="Dời dọc" suffix="mm" value={Math.round(ref.y)} onCommit={(v) => setRef({ ...ref, y: v })} />
                <div className="row">
                  <button className="btn" onClick={() => { setTool('calib'); setCalib(null) }}>Đặt tỉ lệ</button>
                  <button className="btn" onClick={() => void loadRef()}>Đổi ảnh</button>
                  <button className="btn danger" onClick={() => { setRef(null); setCalib(null); if (tool === 'calib') setTool('select') }}>Gỡ ảnh</button>
                </div>
                {tool === 'calib' ? (
                  <div className="calib-box">
                    {calib && calib.pts.length === 2 ? (
                      <>
                        <label htmlFor="real">Khoảng cách thật giữa hai điểm (mm)</label>
                        <div className="row">
                          <input id="real" inputMode="decimal" autoFocus value={calib.real} onChange={(e) => setCalib({ ...calib, real: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') applyCalib() }} />
                          <button className="btn-cta" onClick={applyCalib}>Áp dụng</button>
                        </div>
                      </>
                    ) : <p className="hint">Bấm {calib?.pts.length === 1 ? 'điểm thứ hai' : 'điểm thứ nhất'} trên ảnh (chọn hai điểm cách xa nhau, biết rõ khoảng cách thật, ví dụ hai đầu một bức tường).</p>}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <button className="btn" onClick={() => void loadRef()}>Chọn ảnh…</button>
                <p className="hint">Ảnh mặt bằng hoặc ảnh sản phẩm làm nền để vẽ lại nét. Nhận PNG, JPG và PDF (lấy trang đầu). Ảnh chỉ ở trên máy, không gửi đi; được lưu kèm tệp .sdsketch khi bạn bấm Lưu, và không vào kho mẫu.</p>
              </>
            )}
          </section>

          <section>
            <h3>Phác thảo mới</h3>
            <div className="row">
              {(['straight', 'L', 'round'] as SofaKind[]).map((k) => (<button key={k} className="btn" onClick={() => p.onNew('Sofa', k)}>Sofa {k === 'L' ? SOFA_LABEL[k] : SOFA_LABEL[k].toLowerCase()}</button>))}
              {(['rect', 'round', 'oval'] as TableKind[]).map((k) => (<button key={k} className="btn" onClick={() => p.onNew('Bàn', k)}>Bàn {TABLE_LABEL[k].toLowerCase()}</button>))}
              <button className="btn" onClick={() => p.onNew('Ghế')}>Ghế ăn</button>
              <button className="btn" onClick={() => p.onNew('Giường')}>Giường</button>
              <button className="btn" onClick={() => p.onNew('Kệ sách')}>Kệ sách</button>
              <button className="btn" onClick={() => p.onNew('Tủ quần áo')}>Tủ áo</button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function DraftShape({ d, hs, view }: { d: { tool: Tool; pts: Pt[]; cursor: Pt }; hs: number; view: View }) {
  const sw = view.w / 1000
  const a = d.pts[0]!
  const c = d.cursor
  const common = { fill: 'none', stroke: '#2FB4C4', strokeWidth: sw, strokeDasharray: `${hs * 2} ${hs}` }
  if (d.tool === 'pen') {
    const pts = [...d.pts, c]
    return (
      <g>
        <polyline points={pts.map((q) => `${q.x},${q.y}`).join(' ')} {...common} />
        {d.pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={hs * (i === 0 ? 1.2 : 0.8)} fill={i === 0 ? '#FFB020' : '#fff'} stroke="#0D1B2A" strokeWidth={hs / 4} />)}
      </g>
    )
  }
  if (d.tool === 'rect') return <rect x={Math.min(a.x, c.x)} y={Math.min(a.y, c.y)} width={Math.abs(c.x - a.x)} height={Math.abs(c.y - a.y)} {...common} />
  if (d.tool === 'ellipse') return <ellipse cx={a.x} cy={a.y} rx={Math.abs(c.x - a.x)} ry={Math.abs(c.y - a.y)} {...common} />
  return <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} {...common} />
}

/** Xem trước 3D thô theo thông số (nhìn từ phía trước bên phải). Chân, tầng, cánh và đệm đều có; không phải bản dựng cuối. */
function Preview3D(props: { doc: SketchDoc }) {
  const parts = useMemo(() => partsFor(props.doc), [props.doc])
  const draw = useMemo(() => (parts ? isoDrawing(parts, 300) : null), [parts])
  if (!draw || draw.polys.length === 0) return null
  return (
    <section>
      <h3>Xem trước 3D</h3>
      <svg className="preview3d" viewBox={`0 0 ${draw.width} ${draw.height}`} role="img" aria-label={`Xem trước 3D ${props.doc.name}`}>
        {draw.polys.map((p, i) => <polygon key={i} points={p.points} fill={p.fill} stroke="#075E6B" strokeWidth={0.8} strokeLinejoin="round" />)}
      </svg>
      <p className="hint">Hình thô để kiểm tra khối. Khi xuất sang SketchUp, plugin dựng đúng các khối này nếu mẫu chưa có file .skp.</p>
    </section>
  )
}
