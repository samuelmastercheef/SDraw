import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { commit, createHistory, redo, undo, type History } from '@core/history'
import {
  drawCircle, drawRectangle, drawPolygon, drawArc, arcPoints, bulgePoint, offsetFace, offsetPolygon, insetDistance, facePoints, splitFaceByPath, faceForSegment, onFaceEdge, faceTriangles, faceLoops, bounds, circlePoints, closestOnAxis, connectedFaces, copyFaces, deleteFaces, distance, dot, edges,
  emptyModel, expandToGroups, faceArea, faceCentroid, faceList, faceNormal, groupFaces, pickFace, pushPull,
  rayPlane, rectangleCorners, renameGroup, rotateFacesZ, rotateFaces, scaleFaces, arrayFaces, scale, setFaceColor, snapGrid, snapPoint, sub, add, translateFaces,
  ungroup, planeAxes, isModel3, type Model3, type SnapKind, type Vec3
} from '@core/model3d'
import { booleanOp, depthBehind, pushPullCut, setManifoldLoader, type BoolOp } from '@core/model3dBool'
import manifoldWasm from 'manifold-3d/manifold.wasm?url'
import { MATERIAL_LIBRARY, faceTrianglesUV, pruneMaterials, setFaceMaterial, textureMaterial, updateMaterial } from '@core/materials'
import { addDimension, buildSheet, deleteDimensions, dimOffset, sheetToDxf, sheetToSvg, VIEW_LABEL, type ViewName } from '@core/drawing2d'
import { runAiTool } from '@core/aiTools'
import { faceLoopPath, followPath } from '@core/sweep'
import { CloudOpenDialog, StorePublishDialog, openFromCloud, saveToCloud, type CloudRef } from './CloudModels'
import { receiveModel3d } from './model3dInbox'
import { addSketchTo3d, DEFAULT_HEIGHT_MM } from '@core/sketch3d'
import { Gen3dDialog } from './Gen3dDialog'
import { componentList, makeComponent, makeUnique, placeComponent, propagateComponents, renameComponent } from '@core/components'
import { runSkill, type Skill } from '@core/skills'
import { setAiHandler } from './aiBridge'
import { AiPanel } from './AiPanel'
import { glbImages, shrinkImage, textureFor, thumbFor } from './materialTex'
import { DEFAULT_FACE_COLOR, importMesh, modelFromScene, toGlb, toObj, toStl } from '@core/model3dIo'
import { buildScene } from '@core/scene3d'
import type { Sample, SdrawDoc } from '@core/types'
import { useRooms } from './View3D'

// Phép toán khối chạy WebAssembly của Manifold, nạp file .wasm đã đóng gói cùng ứng dụng
setManifoldLoader(async () => (await import('manifold-3d')).default({ locateFile: () => manifoldWasm }))

/** Các khối (nhóm, hoặc tập mặt liền nhau) chứa những mặt đang chọn, theo thứ tự chọn. */
function solidsOf(m: Model3, ids: string[]): string[][] {
  const out: string[][] = []
  const taken = new Set<string>()
  for (const id of ids) {
    if (!m.faces[id] || taken.has(id)) continue
    const solid = expandToGroups(m, [id])
    const all = solid.length > 1 ? solid : connectedFaces(m, id)
    all.forEach((f) => taken.add(f))
    out.push(all)
  }
  return out
}

const BOOL_LABEL: Record<BoolOp, string> = { subtract: 'Trừ khối', union: 'Hợp khối', intersect: 'Giao khối' }

type Tool = 'select' | 'line' | 'arc' | 'offset' | 'rect' | 'circle' | 'pushpull' | 'move' | 'rotate' | 'scale' | 'follow' | 'dim' | 'tape' | 'orbit'

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'select', label: 'Chọn', key: 'Space', hint: 'Bấm chọn mặt, Shift để chọn thêm, bấm đôi chọn cả khối. Delete để xoá.' },
  { id: 'line', label: 'Đường', key: 'L', hint: 'Bấm từng điểm. Nối hai điểm trên mép một mặt để chia đôi mặt; bấm lại điểm đầu để khép thành mặt. Esc để dừng.' },
  { id: 'arc', label: 'Cung', key: 'A', hint: 'Bấm điểm đầu, điểm cuối, rồi bấm điểm cung đi qua. Hai đầu nằm trên mép mặt thì mặt được chia (bo góc). Gõ độ võng (mm) rồi Enter.' },
  { id: 'rect', label: 'Chữ nhật', key: 'R', hint: 'Bấm góc thứ nhất trên nền hoặc trên mặt, rồi bấm góc đối diện. Vẽ trong một mặt thì mặt đó được cắt. Gõ "2000,1500" rồi Enter để nhập kích thước (mm).' },
  { id: 'circle', label: 'Tròn', key: 'C', hint: 'Bấm tâm rồi bấm điểm trên đường tròn. Gõ bán kính (mm) rồi Enter.' },
  { id: 'pushpull', label: 'Đẩy kéo', key: 'P', hint: 'Bấm một mặt, rê chuột để đẩy hoặc kéo, bấm lần nữa để xong. Gõ khoảng cách (mm) rồi Enter.' },
  { id: 'offset', label: 'Offset', key: 'F', hint: 'Bấm một mặt, rê chuột để vẽ viền cách đều mép (vào trong hoặc ra ngoài), bấm lần nữa để xong. Gõ khoảng cách (mm) rồi Enter.' },
  { id: 'move', label: 'Di chuyển', key: 'M', hint: 'Chọn hình trước, bấm điểm gốc rồi điểm đích. Giữ Shift để di chuyển theo chiều đứng, Ctrl để chép. Gõ "x,y,z" hoặc một khoảng cách. Sau khi chép, gõ "x5" để thành dãy 5 bản, "/5" để chia đều 5 bản.' },
  { id: 'rotate', label: 'Xoay', key: 'Q', hint: 'Chọn hình trước. Bấm tâm xoay (trên mặt nào thì xoay quanh pháp tuyến mặt đó, trên nền thì quanh trục đứng), bấm điểm mốc, rê chuột rồi bấm. Bắt góc 15°. Gõ số độ rồi Enter.' },
  { id: 'scale', label: 'Co giãn', key: 'S', hint: 'Chọn hình trước. Bấm điểm gốc, bấm điểm nắm, rê chuột rồi bấm. Hoặc gõ hệ số (1.5) hay theo trục (1,2,1) rồi Enter; số âm để lật.' },
  { id: 'follow', label: 'Chạy dọc', key: 'W', hint: 'Bấm mặt cắt (vẽ đứng ở góc, vuông góc với cạnh), rồi bấm mặt làm đường: mặt cắt chạy quanh viền mặt đó. Dùng cho len chân tường, phào trần, viền mặt bàn.' },
  { id: 'dim', label: 'Kích thước', key: 'D', hint: 'Bấm điểm đầu, điểm cuối (bám đỉnh, trung điểm), rồi bấm chỗ đặt đường kích thước. Kích thước được lưu trong mô hình và in ra bản vẽ.' },
  { id: 'tape', label: 'Đo', key: 'T', hint: 'Bấm hai điểm để đo khoảng cách.' },
  { id: 'orbit', label: 'Xoay cảnh', key: 'O', hint: 'Kéo chuột trái để xoay. Ở mọi công cụ: kéo chuột giữa để xoay, chuột phải để dời, cuộn để phóng to.' }
]

const COLORS = ['#d9dee4', '#f4efe6', '#c9b79c', '#8d6e4f', '#7fa7b5', '#2fb4c4', '#e0a96d', '#a3b18a', '#b5838d', '#3d4a5c']
const SNAP_LABEL: Record<SnapKind, string> = { vertex: 'Đỉnh', midpoint: 'Trung điểm', edge: 'Trên cạnh', none: '' }
const SEL_COLOR = new THREE.Color('#4f8cff')
const HOVER_COLOR = new THREE.Color('#ffd166')

/** Giữ mô hình khi chuyển qua lại giữa các màn. */
let kept: { history: History<Model3>; name: string; path: string | null; cloud: CloudRef | null } | null = null

const mm = (v: number) => `${Math.round(v).toLocaleString('vi-VN')} mm`

type Op =
  | { kind: 'rect' | 'circle'; start: Vec3; normal: Vec3; host: string | null }
  | { kind: 'line'; points: Vec3[]; normal: Vec3 }
  | { kind: 'arc'; a: Vec3; b: Vec3 | null; normal: Vec3; host: string | null }
  | { kind: 'offset'; faceId: string; normal: Vec3; origin: Vec3; dist: number }
  | { kind: 'pushpull'; faceId: string; base: Vec3; normal: Vec3; dist: number }
  | { kind: 'move'; from: Vec3; faces: string[]; delta: Vec3; vertical: boolean }
  | { kind: 'tape'; start: Vec3 }
  | { kind: 'dim'; a: Vec3; b: Vec3 | null }
  | { kind: 'follow'; profile: string }
  | { kind: 'rotate'; center: Vec3; axis: Vec3; ref: Vec3 | null; faces: string[]; angle: number }
  | { kind: 'scale'; anchor: Vec3; grip: Vec3 | null; faces: string[]; factor: number }

interface Hit { point: Vec3; normal: Vec3; faceId: string | null; snap: SnapKind }

/** Mặt phẳng ép con trỏ khi đang vẽ dở. */
function opPlane(op: Op | null): { p: Vec3; n: Vec3 } | undefined {
  if (!op) return undefined
  if (op.kind === 'rect' || op.kind === 'circle') return { p: op.start, n: op.normal }
  if (op.kind === 'line') return { p: op.points[0]!, n: op.normal }
  if (op.kind === 'arc') return { p: op.a, n: op.normal }
  if (op.kind === 'offset') return { p: op.origin, n: op.normal }
  if (op.kind === 'rotate') return { p: op.center, n: op.axis }
  return undefined
}

function parseNums(s: string): number[] | null {
  const parts = s.split(/[;,]|\s+/).map((t) => t.trim()).filter(Boolean).map((t) => Number(t.replace(/mm$/i, '')))
  return parts.length && parts.every((n) => Number.isFinite(n)) ? parts : null
}

/** Nhãn chữ cố định cỡ trên màn hình, đặt tại điểm p (mm). */
function labelSprite(text: string, p: Vec3): THREE.Sprite {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  ctx.font = 'bold 28px sans-serif'
  const w = Math.ceil(ctx.measureText(text).width) + 16
  c.width = w; c.height = 40
  ctx.font = 'bold 28px sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(0, 0, w, 40)
  ctx.fillStyle = '#1f5fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, 8, 21)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }))
  // Nhóm mô hình thu nhỏ 0.001 (mm sang m) nên cỡ nhãn nhân lại 1000
  sp.scale.set(32 * (w / 40), 32, 1)
  sp.position.set(p[0], p[1], p[2])
  sp.renderOrder = 10
  return sp
}

/** Góc (độ) từ ref tới p quanh trục axis qua center; bắt bội số 15° khi lệch dưới 2°. */
function angleIn(center: Vec3, axis: Vec3, ref: Vec3, p: Vec3): number {
  const [u0] = [sub(ref, center)]
  const n = scale(axis, 1 / Math.hypot(...axis))
  const a = sub(u0, scale(n, dot(u0, n))), b = sub(sub(p, center), scale(n, dot(sub(p, center), n)))
  if (Math.hypot(...a) < 1e-6 || Math.hypot(...b) < 1e-6) return 0
  const cr = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] as Vec3
  let deg = (Math.atan2(dot(cr, n), dot(a, b)) * 180) / Math.PI
  const snap = Math.round(deg / 15) * 15
  deg = Math.abs(deg - snap) < 2 ? snap : Math.round(deg)
  return deg
}

export function Model3DView(props: { doc: SdrawDoc; link: { projectId: string; roomId: string } | null; catalog: Sample[]; onNotice: (t: string, tone?: 'ok' | 'error') => void; online?: boolean }) {
  const [history, setHistory] = useState<History<Model3>>(() => kept?.history ?? createHistory(emptyModel()))
  const [name, setName] = useState(() => kept?.name ?? 'Mô hình mới')
  const [path, setPath] = useState<string | null>(() => kept?.path ?? null)
  const [cloud, setCloud] = useState<CloudRef | null>(() => kept?.cloud ?? null)
  const [cloudDlg, setCloudDlg] = useState<'open' | 'store' | 'gen3d' | null>(null)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [tool, setTool] = useState<Tool>('rect')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<Hit | null>(null)
  const [op, setOp] = useState<Op | null>(null)
  const [cursor, setCursor] = useState<Hit | null>(null)
  const [vcb, setVcb] = useState('')
  // Bản vẽ 2D
  const [drawViews, setDrawViews] = useState<ViewName[]>(['top', 'front', 'right'])
  const [drawHidden, setDrawHidden] = useState(false)
  const [sheetSvg, setSheetSvg] = useState<string | null>(null)
  const [measure, setMeasure] = useState<string>('')
  const model = history.present
  const hoverFaceId = hover?.faceId ?? null
  const rooms = useRooms(props.doc, props.link)
  const notify = props.onNotice

  useEffect(() => { kept = { history, name, path, cloud } }, [history, name, path, cloud])

  const host = useRef<HTMLDivElement>(null)
  const vcbRef = useRef<HTMLInputElement>(null)
  const three = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls
    model: THREE.Group; preview: THREE.Group; marker: THREE.Mesh
  } | null>(null)

  const apply = useCallback((next: Model3) => {
    // Sửa một bản cấu kiện thì các bản khác đổi theo
    setHistory((h) => commit(h, propagateComponents(next)))
  }, [])

  const run = useCallback((fn: () => Model3) => {
    try { apply(fn()); return true } catch (e) { notify((e as Error).message, 'error'); return false }
  }, [apply, notify])

  // ---------- Dựng cảnh three.js (một lần) ----------
  useEffect(() => {
    const el = host.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)
    renderer.domElement.setAttribute('aria-label', 'Khung dựng hình 3D')
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#eef3f6')
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000)
    camera.up.set(0, 0, 1)
    camera.position.set(6, -9, 6)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }
    controls.target.set(0, 0, 0)
    controls.update()
    scene.add(new THREE.HemisphereLight('#ffffff', '#8a9aa6', 1.6))
    const sun = new THREE.DirectionalLight('#ffffff', 1.4)
    sun.position.set(4, -6, 10)
    scene.add(sun)
    const grid = new THREE.GridHelper(40, 40, '#9fb3bf', '#d3dde3')
    grid.rotateX(Math.PI / 2)
    scene.add(grid)
    const axis = (to: [number, number, number], color: string) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(...to)])
      scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color })))
    }
    axis([20, 0, 0], '#d1495b'); axis([0, 20, 0], '#2a9d8f'); axis([0, 0, 20], '#3a6ea5')
    const modelGroup = new THREE.Group(); modelGroup.scale.setScalar(0.001); scene.add(modelGroup)
    const preview = new THREE.Group(); preview.scale.setScalar(0.001); scene.add(preview)
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff6b35', depthTest: false }))
    marker.renderOrder = 10
    marker.visible = false
    scene.add(marker)
    three.current = { renderer, scene, camera, controls, model: modelGroup, preview, marker }
    const resize = () => {
      const w = el.clientWidth, h = Math.max(el.clientHeight, 360)
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera) })
    return () => {
      ro.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      three.current = null
    }
  }, [])

  useEffect(() => {
    const t = three.current
    if (t) t.controls.mouseButtons.LEFT = (tool === 'orbit' ? THREE.MOUSE.ROTATE : null) as unknown as THREE.MOUSE
  }, [tool])

  // Mô hình đang hiện: bản xem trước của thao tác dở dang, hoặc mô hình thật
  const shown = useMemo(() => {
    if (op?.kind === 'pushpull' && Math.abs(op.dist) >= 1) {
      try { return pushPull(model, op.faceId, op.dist) } catch { return model }
    }
    if (op?.kind === 'move') return translateFaces(model, op.faces, op.delta)
    if (op?.kind === 'rotate' && op.angle) return rotateFaces(model, op.faces, op.center, op.axis, op.angle)
    if (op?.kind === 'scale' && op.grip && Math.abs(op.factor) > 0.01 && op.factor !== 1) { try { return scaleFaces(model, op.faces, op.anchor, op.factor) } catch { return model } }
    return model
  }, [model, op])

  // ---------- Vẽ lại hình ----------
  useEffect(() => {
    const t = three.current
    if (!t) return
    const g = t.model
    g.children.forEach((c) => {
      (c as THREE.Mesh).geometry?.dispose()
      if (c instanceof THREE.Sprite) { c.material.map?.dispose(); c.material.dispose() }
    })
    g.clear()
    const pos: number[] = [], col: number[] = []
    // Mặt có vật liệu: gom theo vật liệu, có toạ độ vân; màu đỉnh trắng (hoặc pha màu chọn) nhân với vân
    const byMat = new Map<string, { pos: number[]; col: number[]; uv: number[] }>()
    const hoverFace = tool === 'pushpull' || tool === 'select' ? hoverFaceId : null
    const tint = (f: { id: string }, base: THREE.Color) => selected.has(f.id) ? base.clone().lerp(SEL_COLOR, 0.55) : f.id === hoverFace ? base.clone().lerp(HOVER_COLOR, 0.45) : base
    const white = new THREE.Color('#ffffff')
    for (const f of faceList(shown)) {
      const mat = f.material ? shown.materials?.[f.material] : undefined
      if (mat) {
        let b = byMat.get(mat.id)
        if (!b) { b = { pos: [], col: [], uv: [] }; byMat.set(mat.id, b) }
        const c = tint(f, white)
        for (const { tri, uv } of faceTrianglesUV(shown, f, mat.size)) tri.forEach((p, i) => { b!.pos.push(...p); b!.col.push(c.r, c.g, c.b); b!.uv.push(uv[i]![0], uv[i]![1]) })
        continue
      }
      const c = tint(f, new THREE.Color(f.color ?? DEFAULT_FACE_COLOR))
      for (const tri of faceTriangles(shown, f)) for (const p of tri) { pos.push(...p); col.push(c.r, c.g, c.b) }
    }
    const meshOpts = { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }
    if (pos.length) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
      geo.computeVertexNormals()
      g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial(meshOpts)))
    }
    for (const [id, b] of byMat) {
      const mat = shown.materials![id]!
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
      geo.computeVertexNormals()
      g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ ...meshOpts, map: textureFor(mat) })))
    }
    const selVerts = new Set<string>()
    for (const id of selected) { const f = shown.faces[id]; if (f) faceLoops(f).flat().forEach((v) => selVerts.add(v)) }
    const lines: number[] = [], selLines: number[] = []
    for (const [a, b] of edges(shown)) (selVerts.has(a) && selVerts.has(b) ? selLines : lines).push(...shown.vertices[a]!, ...shown.vertices[b]!)
    const addLines = (arr: number[], color: string) => {
      if (!arr.length) return
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3))
      g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color })))
    }
    addLines(lines, '#1d2733'); addLines(selLines, '#1f5fff')
    // Đường ghi kích thước: hai đường gióng, đường kích thước và nhãn số luôn quay về phía camera
    const dimLines: number[] = []
    for (const d of Object.values(shown.dims ?? {})) {
      const o = dimOffset(d)
      const ol = Math.hypot(...o)
      const ext = ol > 1 ? scale(o, 1 + 60 / ol) : o
      const pa = add(d.a, o), pb = add(d.b, o)
      dimLines.push(...d.a, ...add(d.a, ext), ...d.b, ...add(d.b, ext), ...pa, ...pb)
      g.add(labelSprite(mm(distance(d.a, d.b)).replace(' mm', ''), scale(add(pa, pb), 0.5)))
    }
    addLines(dimLines, '#1f5fff')
  }, [shown, selected, hoverFaceId, tool])

  // ---------- Xem trước nét vẽ ----------
  useEffect(() => {
    const t = three.current
    if (!t) return
    t.preview.children.forEach((c) => (c as THREE.Line).geometry?.dispose())
    t.preview.clear()
    const loop = (pts: Vec3[], color: string, closed = true) => {
      if (pts.length < 2) return
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)))
      const mat = new THREE.LineBasicMaterial({ color, depthTest: false })
      const line = closed ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat)
      line.renderOrder = 9
      t.preview.add(line)
    }
    if (op && cursor) {
      if (op.kind === 'rect') loop(rectangleCorners(op.start, cursor.point, op.normal), '#ff6b35')
      if (op.kind === 'circle') loop(circlePoints(op.start, Math.max(1, distance(op.start, cursor.point)), op.normal), '#ff6b35')
      if (op.kind === 'tape') loop([op.start, cursor.point], '#7b2cbf', false)
      if (op.kind === 'dim') {
        if (!op.b) loop([op.a, cursor.point], '#1f5fff', false)
        else { const o = dimOffset({ a: op.a, b: op.b, p: cursor.point }); loop([op.a, add(op.a, o), add(op.b, o), op.b], '#1f5fff', false) }
      }
      if (op.kind === 'rotate') loop(op.ref ? [op.ref, op.center, cursor.point] : [op.center, cursor.point], '#7b2cbf', false)
      if (op.kind === 'scale') loop(op.grip ? [op.anchor, cursor.point] : [op.anchor, cursor.point], '#7b2cbf', false)
      if (op.kind === 'line') loop([...op.points, cursor.point], '#ff6b35', false)
      if (op.kind === 'arc') loop(op.b ? arcPoints(op.a, cursor.point, op.b) : [op.a, cursor.point], '#ff6b35', false)
      if (op.kind === 'offset' && model.faces[op.faceId] && Math.abs(op.dist) >= 1) {
        try { loop(offsetPolygon(facePoints(model, model.faces[op.faceId]!), op.dist, op.normal), '#ff6b35') } catch { /* bỏ qua */ }
      }
      if (op.kind === 'move') loop([op.from, add(op.from, op.delta)], '#7b2cbf', false)
    }
    const m = t.marker
    const p = cursor?.point
    m.visible = !!p && tool !== 'select' && tool !== 'orbit'
    if (p) m.position.set(p[0] / 1000, p[1] / 1000, p[2] / 1000)
    ;(m.material as THREE.MeshBasicMaterial).color.set(cursor?.snap === 'vertex' ? '#2a9d8f' : cursor?.snap === 'midpoint' ? '#00b4d8' : cursor?.snap === 'edge' ? '#d1495b' : '#ff6b35')
  }, [op, cursor, tool, model])

  // ---------- Tia chuột ----------
  const ray = useCallback((e: { clientX: number; clientY: number }): { o: Vec3; d: Vec3 } | null => {
    const t = three.current
    if (!t) return null
    const r = t.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    const rc = new THREE.Raycaster()
    rc.setFromCamera(ndc, t.camera)
    const o = rc.ray.origin, d = rc.ray.direction
    return { o: [o.x * 1000, o.y * 1000, o.z * 1000], d: [d.x, d.y, d.z] }
  }, [])

  const snapTol = () => {
    const t = three.current
    return t ? t.camera.position.distanceTo(t.controls.target) * 1000 * 0.012 : 50
  }

  /** Điểm dưới chuột: trên mặt, trên nền, hoặc trên mặt phẳng ép (khi đang vẽ). */
  const hitAt = useCallback((e: { clientX: number; clientY: number }, plane?: { p: Vec3; n: Vec3 }): Hit | null => {
    const r = ray(e)
    if (!r) return null
    const face = plane ? null : pickFace(model, r.o, r.d)
    let point: Vec3 | null, normal: Vec3, faceId: string | null = null
    if (face) { point = face.point; normal = faceNormal(model, model.faces[face.faceId]!); faceId = face.faceId }
    else { const pl = plane ?? { p: [0, 0, 0] as Vec3, n: [0, 0, 1] as Vec3 }; point = rayPlane(r.o, r.d, pl.p, pl.n); normal = pl.n }
    if (!point) return null
    const s = snapPoint(model, point, snapTol())
    let p = s.point
    if (s.kind === 'none') p = faceId ? point : snapGrid(point, 10)
    if (plane) p = sub(p, scale(plane.n, dot(sub(p, plane.p), plane.n)))
    return { point: p, normal, faceId, snap: s.kind }
  }, [model, ray])

  const cancel = useCallback(() => { setOp(null); setVcb(''); setMeasure('') }, [])

  const pickTool = useCallback((t: Tool) => {
    setTool(t); setOp(null); setVcb(''); setMeasure('')
    if (t === 'move' && selected.size === 0) notify('Chọn hình cần di chuyển trước (công cụ Chọn).')
  }, [selected, notify])

  // ---------- Hoàn tất thao tác ----------
  const finishRect = useCallback((a: Vec3, b: Vec3, n: Vec3, host: string | null) => {
    if (run(() => drawRectangle(model, a, b, n, { host }).model)) { setOp(null); setTool('pushpull'); setVcb('') }
  }, [model, run])
  const finishCircle = useCallback((c: Vec3, radius: number, n: Vec3, host: string | null) => {
    if (run(() => drawCircle(model, c, radius, n, { host }).model)) { setOp(null); setTool('pushpull'); setVcb('') }
  }, [model, run])
  const finishArc = useCallback((a: Vec3, c: Vec3, b: Vec3, normal: Vec3, host: string | null) => {
    if (run(() => drawArc(model, a, c, b, { host, normal: host ? undefined : normal }).model)) { setOp(null); setVcb(''); setMeasure('') }
  }, [model, run])
  const finishOffset = useCallback((faceId: string, dist: number) => {
    if (Math.abs(dist) < 1) { setOp(null); return }
    if (run(() => offsetFace(model, faceId, dist).model)) { setOp(null); setVcb(''); setTool('pushpull') }
  }, [model, run])
  /** Thêm một điểm cho công cụ Đường: khép thành mặt, hoặc chia mặt khi nối hai điểm trên mép. */
  const lineClick = useCallback((p: Vec3, normal: Vec3) => {
    if (op?.kind !== 'line') { setOp({ kind: 'line', points: [p], normal }); return }
    const pts = op.points
    if (distance(p, pts[pts.length - 1]!) < 1) return
    if (pts.length >= 3 && distance(p, pts[0]!) < Math.max(1, snapTol())) {
      const host = faceForSegment(model, pts[0]!, pts[1]!)
      if (run(() => drawPolygon(model, pts, { host, normal: op.normal }).model)) { setOp(null); setMeasure('') }
      return
    }
    const next = [...pts, p]
    const host = faceForSegment(model, next[0]!, next[1]!)
    if (host && onFaceEdge(model, host, next[0]!) && onFaceEdge(model, host, p)) {
      if (run(() => splitFaceByPath(model, host, next))) { setOp(null); setMeasure('Đã chia mặt') }
      return
    }
    setOp({ ...op, points: next })
  }, [op, model, run])
  const [busy, setBusy] = useState(false)
  const runAsync = useCallback(async (fn: () => Promise<Model3>, done?: string) => {
    setBusy(true)
    try { apply(await fn()); setSelected(new Set()); if (done) setMeasure(done); return true } catch (e) { notify((e as Error).message, 'error'); return false } finally { setBusy(false) }
  }, [apply, notify])
  const finishPush = useCallback((faceId: string, dist: number) => {
    if (Math.abs(dist) < 1) { setOp(null); return }
    // Đẩy hết chiều dày khối, hoặc hình nằm sát mép: khoét bằng phép trừ khối
    const depth = dist < 0 ? depthBehind(model, faceId) : 0
    const viaCut = (d: number, msg: string) => { setOp(null); setVcb(''); void runAsync(() => pushPullCut(model, faceId, d), msg) }
    if (dist < 0 && depth > 0 && -dist >= depth - 0.5) { viaCut(-depth, 'Đã khoét xuyên khối'); return }
    try { apply(pushPull(model, faceId, dist)); setOp(null); setVcb('') } catch (e) {
      const msg = (e as Error).message
      if (dist < 0 && /sát mép/.test(msg)) viaCut(dist, 'Đã khoét hốc sát mép')
      else notify(msg, 'error')
    }
  }, [model, apply, notify, runAsync])
  const doBool = useCallback((op: BoolOp) => {
    const solids = solidsOf(model, [...selected])
    if (solids.length !== 2) { notify('Chọn đúng hai khối: khối giữ lại chọn trước, khối dùng để trừ chọn sau (Shift để chọn thêm).'); return }
    void runAsync(() => booleanOp(model, solids[0]!, solids[1]!, op), `Đã ${BOOL_LABEL[op].toLowerCase()}`)
  }, [model, selected, notify, runAsync])
  // Lần chép gần nhất (để gõ "x5" hoặc "/5" thành dãy)
  const [lastCopy, setLastCopy] = useState<{ before: Model3; faces: string[]; delta: Vec3 } | null>(null)
  const finishMove = useCallback((faces: string[], delta: Vec3, copy: boolean) => {
    if (copy) {
      try {
        const c = copyFaces(model, faces, delta); apply(c.model); setSelected(new Set(c.faceIds))
        setLastCopy({ before: model, faces, delta })
        setMeasure('Đã chép. Gõ "x5" để thành dãy 5 bản, "/5" để chia đều.')
      } catch (e) { notify((e as Error).message, 'error') }
    } else { run(() => translateFaces(model, faces, delta)); setLastCopy(null) }
    setOp(null); setVcb('')
  }, [model, run, apply, notify])
  const makeArray = useCallback((n: number, divide: boolean) => {
    if (!lastCopy) { notify('Chép một bản trước (Di chuyển + Ctrl), rồi gõ "x5".'); return }
    try {
      const delta = divide ? scale(lastCopy.delta, 1 / n) : lastCopy.delta
      const r = arrayFaces(lastCopy.before, lastCopy.faces, delta, n)
      // Thay bản chép đơn bằng cả dãy, một bước hoàn tác
      setHistory((h) => commit(undo(h), propagateComponents(r.model)))
      setSelected(new Set(r.copies.flat())); setVcb(''); setMeasure(`Đã chép thành dãy ${n} bản`)
    } catch (e) { notify((e as Error).message, 'error') }
  }, [lastCopy, notify])
  const finishRotate = useCallback((faces: string[], center: Vec3, axis: Vec3, deg: number) => {
    if (Math.abs(deg) >= 0.01) run(() => rotateFaces(model, faces, center, axis, deg))
    setOp(null); setVcb(''); setLastCopy(null)
  }, [model, run])
  const finishScale = useCallback((faces: string[], anchor: Vec3, factor: number | Vec3) => {
    if (factor !== 1) run(() => scaleFaces(model, faces, anchor, factor))
    setOp(null); setVcb(''); setLastCopy(null)
  }, [model, run])

  // ---------- Chuột ----------
  const onMove = (e: React.PointerEvent) => {
    if (op?.kind === 'pushpull') {
      const r = ray(e)
      if (!r) return
      const s = hitAt(e)
      const dist = s && s.snap !== 'none' ? dot(sub(s.point, op.base), op.normal) : Math.round(closestOnAxis(op.base, op.normal, r.o, r.d))
      setOp({ ...op, dist })
      setMeasure(`Khoảng cách: ${mm(dist)}`)
      setCursor(s)
      return
    }
    if (op?.kind === 'move') {
      let delta: Vec3
      const r = ray(e)
      if (!r) return
      if (e.shiftKey) delta = [0, 0, Math.round(closestOnAxis(op.from, [0, 0, 1], r.o, r.d))]
      else {
        const h = hitAt(e)
        const p = h && h.snap !== 'none' ? h.point : rayPlane(r.o, r.d, op.from, [0, 0, 1]) ?? op.from
        delta = h && h.snap !== 'none' ? sub(p, op.from) : snapGrid(sub(p, op.from), 10)
      }
      setOp({ ...op, delta })
      setMeasure(`Dời: ${mm(Math.hypot(...delta))} (x ${Math.round(delta[0])}, y ${Math.round(delta[1])}, z ${Math.round(delta[2])})`)
      return
    }
    const plane = opPlane(op)
    const h = hitAt(e, plane)
    setCursor(h)
    setHover(h)
    if (op && h) {
      if (op.kind === 'rect') {
        const [u, v] = planeAxes(op.normal)
        const ab = sub(h.point, op.start)
        setMeasure(`${mm(Math.abs(dot(ab, u)))} × ${mm(Math.abs(dot(ab, v)))}`)
      }
      if (op.kind === 'circle') setMeasure(`Bán kính: ${mm(distance(op.start, h.point))}`)
      if (op.kind === 'tape') setMeasure(`Khoảng cách: ${mm(distance(op.start, h.point))}`)
      if (op.kind === 'dim') setMeasure(`Kích thước: ${mm(distance(op.a, op.b ?? h.point))}`)
      if (op.kind === 'rotate' && op.ref) {
        const angle = angleIn(op.center, op.axis, op.ref, h.point)
        if (angle !== op.angle) setOp({ ...op, angle })
        setMeasure(`Góc: ${angle}°`)
      }
      if (op.kind === 'scale' && op.grip) {
        const g = sub(op.grip, op.anchor)
        const factor = Math.round((dot(sub(h.point, op.anchor), g) / dot(g, g)) * 100) / 100
        if (factor !== op.factor) setOp({ ...op, factor })
        setMeasure(`Hệ số: ${factor}`)
      }
      if (op.kind === 'line') setMeasure(`Đoạn: ${mm(distance(op.points[op.points.length - 1]!, h.point))}`)
      if (op.kind === 'arc') setMeasure(op.b ? `Dây cung: ${mm(distance(op.a, op.b))}` : `Dây cung: ${mm(distance(op.a, h.point))}`)
      if (op.kind === 'offset') {
        const dist = Math.round(insetDistance(model, op.faceId, h.point))
        if (dist !== op.dist) setOp({ ...op, dist })
        setMeasure(`Offset: ${mm(dist)}`)
      }
    }
  }

  const onClick = (e: React.MouseEvent) => {
    if (e.button !== 0 || tool === 'orbit') return
    if (tool === 'select') {
      const r = ray(e)
      const hit = r ? pickFace(model, r.o, r.d) : null
      if (!hit) { if (!e.shiftKey) setSelected(new Set()); return }
      const ids = expandToGroups(model, [hit.faceId])
      setSelected((s) => {
        if (!e.shiftKey) return new Set(ids)
        const n = new Set(s)
        const on = ids.every((id) => n.has(id))
        ids.forEach((id) => (on ? n.delete(id) : n.add(id)))
        return n
      })
      return
    }
    if (tool === 'pushpull') {
      if (op?.kind === 'pushpull') { finishPush(op.faceId, op.dist); return }
      const h = hitAt(e)
      if (!h?.faceId) { notify('Bấm vào một mặt để đẩy kéo.'); return }
      const f = model.faces[h.faceId]!
      setOp({ kind: 'pushpull', faceId: h.faceId, base: faceCentroid(model, f), normal: faceNormal(model, f), dist: 0 })
      return
    }
    if (tool === 'move') {
      if (op?.kind === 'move') { finishMove(op.faces, op.delta, e.ctrlKey || e.metaKey); return }
      if (!selected.size) { notify('Chọn hình cần di chuyển trước (công cụ Chọn).'); return }
      const h = hitAt(e)
      if (h) setOp({ kind: 'move', from: h.point, faces: expandToGroups(model, selected), delta: [0, 0, 0], vertical: false })
      return
    }
    const plane = opPlane(op)
    const h = hitAt(e, plane)
    if (!h) return
    if (tool === 'rotate') {
      if (op?.kind !== 'rotate') {
        if (!selected.size) { notify('Chọn hình cần xoay trước (công cụ Chọn).'); return }
        setOp({ kind: 'rotate', center: h.point, axis: h.faceId ? h.normal : [0, 0, 1], ref: null, faces: expandToGroups(model, selected), angle: 0 }); return
      }
      if (!op.ref) { if (distance(op.center, h.point) >= 1) setOp({ ...op, ref: h.point }); return }
      finishRotate(op.faces, op.center, op.axis, op.angle)
      return
    }
    if (tool === 'scale') {
      if (op?.kind !== 'scale') {
        if (!selected.size) { notify('Chọn hình cần co giãn trước (công cụ Chọn).'); return }
        setOp({ kind: 'scale', anchor: h.point, grip: null, faces: expandToGroups(model, selected), factor: 1 }); return
      }
      if (!op.grip) { if (distance(op.anchor, h.point) >= 1) setOp({ ...op, grip: h.point }); return }
      finishScale(op.faces, op.anchor, op.factor)
      return
    }
    if (tool === 'arc') {
      if (op?.kind !== 'arc') { setOp({ kind: 'arc', a: h.point, b: null, normal: h.normal, host: h.faceId }); return }
      if (!op.b) { if (distance(op.a, h.point) >= 1) setOp({ ...op, b: h.point }); return }
      finishArc(op.a, h.point, op.b, op.normal, op.host)
      return
    }
    if (tool === 'offset') {
      if (op?.kind === 'offset') { finishOffset(op.faceId, op.dist); return }
      if (!h.faceId) { notify('Bấm vào một mặt để offset.'); return }
      const f = model.faces[h.faceId]!
      setOp({ kind: 'offset', faceId: h.faceId, normal: faceNormal(model, f), origin: h.point, dist: 0 })
      return
    }
    if (tool === 'line') { lineClick(h.point, h.normal); return }
    if (tool === 'follow') {
      if (!h.faceId) { notify(op?.kind === 'follow' ? 'Bấm vào mặt làm đường (ví dụ mặt sàn).' : 'Bấm vào mặt cắt trước.'); return }
      if (op?.kind !== 'follow') { setOp({ kind: 'follow', profile: h.faceId }); setSelected(new Set([h.faceId])); setMeasure('Đã chọn mặt cắt. Bấm mặt làm đường.'); return }
      if (h.faceId === op.profile) { notify('Mặt làm đường phải khác mặt cắt.'); return }
      if (run(() => followPath(model, op.profile, faceLoopPath(model, h.faceId!), { closed: true }).model)) { setOp(null); setSelected(new Set()); setMeasure('Đã chạy mặt cắt dọc đường') }
      return
    }
    if (tool === 'dim') {
      if (op?.kind !== 'dim') { setOp({ kind: 'dim', a: h.point, b: null }); return }
      if (!op.b) { if (distance(op.a, h.point) >= 1) setOp({ ...op, b: h.point }); return }
      if (run(() => addDimension(model, op.a, op.b!, h.point).model)) { setOp(null); setMeasure(`Đã ghi kích thước ${mm(distance(op.a, op.b))}`) }
      return
    }
    if (tool === 'tape') {
      if (op?.kind === 'tape') { setMeasure(`Đo được: ${mm(distance(op.start, h.point))}`); setOp(null) }
      else setOp({ kind: 'tape', start: h.point })
      return
    }
    if (tool === 'rect' || tool === 'circle') {
      if (!op) { setOp({ kind: tool, start: h.point, normal: h.normal, host: h.faceId }); return }
      if (op.kind === 'rect') finishRect(op.start, h.point, op.normal, op.host)
      if (op.kind === 'circle') finishCircle(op.start, distance(op.start, h.point), op.normal, op.host)
    }
  }

  const onDouble = (e: React.MouseEvent) => {
    if (tool !== 'select') return
    const r = ray(e)
    const hit = r ? pickFace(model, r.o, r.d) : null
    if (hit) setSelected(new Set(connectedFaces(model, hit.faceId)))
  }

  // ---------- Ô nhập kích thước ----------
  const submitVcb = () => {
    const arr = /^\s*([x*/])\s*(\d+)\s*$/i.exec(vcb)
    if (arr) { makeArray(Number(arr[2]), arr[1] === '/'); return }
    const nums = parseNums(vcb)
    if (!nums) { notify('Nhập số milimét, ví dụ 2000,1500', 'error'); return }
    if (op?.kind === 'rect' && nums.length >= 2) {
      const [u, v] = planeAxes(op.normal)
      const cur = cursor ? sub(cursor.point, op.start) : add(u, v)
      const su = dot(cur, u) < 0 ? -1 : 1, sv = dot(cur, v) < 0 ? -1 : 1
      finishRect(op.start, add(op.start, add(scale(u, su * nums[0]!), scale(v, sv * nums[1]!))), op.normal, op.host)
    } else if (op?.kind === 'circle') finishCircle(op.start, Math.abs(nums[0]!), op.normal, op.host)
    else if (op?.kind === 'arc' && op.b) finishArc(op.a, bulgePoint(op.a, op.b, op.normal, Math.abs(nums[0]!), cursor?.point), op.b, op.normal, op.host)
    else if (op?.kind === 'offset') finishOffset(op.faceId, (op.dist < 0 ? -1 : 1) * Math.abs(nums[0]!))
    else if (op?.kind === 'line' && cursor) {
      const last = op.points[op.points.length - 1]!
      const dir = sub(cursor.point, last)
      const l = Math.hypot(...dir)
      if (l < 1) { notify('Rê chuột theo hướng của đoạn trước, rồi gõ độ dài.'); return }
      lineClick(add(last, scale(dir, nums[0]! / l)), op.normal); setVcb('')
    }
    else if (op?.kind === 'pushpull') finishPush(op.faceId, (op.dist < 0 ? -1 : 1) * nums[0]!)
    else if (op?.kind === 'move') {
      if (nums.length >= 3) finishMove(op.faces, [nums[0]!, nums[1]!, nums[2]!], false)
      else {
        const l = Math.hypot(...op.delta)
        if (l < 1) { notify('Rê chuột theo hướng cần dời trước, rồi gõ khoảng cách.'); return }
        finishMove(op.faces, scale(op.delta, nums[0]! / l), false)
      }
    } else if (op?.kind === 'rotate') finishRotate(op.faces, op.center, op.axis, nums[0]!)
    else if (tool === 'scale' && (op?.kind === 'scale' || selected.size)) {
      const faces = op?.kind === 'scale' ? op.faces : expandToGroups(model, selected)
      // Không bấm điểm gốc thì lấy tâm đáy khung bao của hình đang chọn
      const b = bounds({ ...model, faces: Object.fromEntries(faces.map((id) => [id, model.faces[id]!])) })
      const anchor: Vec3 = op?.kind === 'scale' ? op.anchor : b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]] : [0, 0, 0]
      finishScale(faces, anchor, nums.length >= 3 ? [nums[0]!, nums[1]!, nums[2]!] : nums[0]!)
    } else if (selected.size === 1 && tool === 'pushpull') {
      const id = [...selected][0]!
      finishPush(id, nums[0]!)
    } else notify('Bắt đầu một thao tác (bấm điểm đầu hoặc chọn mặt) rồi mới gõ kích thước.')
  }

  // ---------- Phím tắt ----------
  const selRef = useRef(selected); selRef.current = selected
  const modelRef = useRef(model); modelRef.current = model
  const delSelected = useCallback(() => {
    if (!selRef.current.size) return
    apply(deleteFaces(modelRef.current, selRef.current)); setSelected(new Set())
  }, [apply])
  const doComponent = useCallback(() => {
    if (!selRef.current.size) return
    try {
      const r = makeComponent(modelRef.current, selRef.current)
      apply(r.model); setSelected(new Set(faceList(r.model).filter((f) => f.group === r.groupId).map((f) => f.id)))
      notify('Đã tạo cấu kiện. Chép hoặc bấm "Đặt thêm" để có thêm bản; sửa một bản thì mọi bản đổi theo.')
    } catch (e) { notify((e as Error).message, 'error') }
  }, [apply, notify])
  const placeMore = useCallback((componentId: string) => {
    const m = modelRef.current
    const b = bounds(m)
    try {
      const r = placeComponent(m, componentId, b ? [b.max[0] + 200, b.min[1], 0] : [0, 0, 0])
      apply(r.model); setSelected(new Set(r.faceIds))
    } catch (e) { notify((e as Error).message, 'error') }
  }, [apply, notify])
  const doGroup = useCallback(() => {
    if (!selRef.current.size) return
    try {
      const r = groupFaces(modelRef.current, selRef.current, 'Nhóm')
      apply(r.model); setSelected(new Set(faceList(r.model).filter((f) => f.group === r.groupId).map((f) => f.id)))
    } catch (e) { notify((e as Error).message, 'error') }
  }, [apply, notify])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); setHistory((h) => (e.shiftKey ? redo(h) : undo(h))); setOp(null); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); setHistory((h) => redo(h)); return }
      if (typing && target !== vcbRef.current) return
      if (e.key === 'Escape') { cancel(); vcbRef.current?.blur(); return }
      if (typing) return
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(new Set(Object.keys(modelRef.current.faces))); return }
      if ((/^[0-9\-.,;]$/.test(e.key) || (tool === 'move' && /^[x*/]$/i.test(e.key))) && tool !== 'select' && tool !== 'orbit') { e.preventDefault(); setVcb((v) => v + e.key); vcbRef.current?.focus(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { delSelected(); return }
      const k = e.key.toLowerCase()
      if (k === ' ') { e.preventDefault(); pickTool('select') }
      else if (k === 'r') pickTool('rect')
      else if (k === 'l') pickTool('line')
      else if (k === 'a') pickTool('arc')
      else if (k === 'f') pickTool('offset')
      else if (k === 'c') pickTool('circle')
      else if (k === 'p') pickTool('pushpull')
      else if (k === 'm') pickTool('move')
      else if (k === 'q') pickTool('rotate')
      else if (k === 's') pickTool('scale')
      else if (k === 't') pickTool('tape')
      else if (k === 'd') pickTool('dim')
      else if (k === 'w') pickTool('follow')
      else if (k === 'o') pickTool('orbit')
      else if (k === 'g') doGroup()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool, cancel, pickTool, delSelected, doGroup])

  // ---------- Camera ----------
  const frame = useCallback((m: Model3, dir: [number, number, number] = [0.55, -0.8, 0.6]) => {
    const t = three.current
    if (!t) return
    const b = bounds(m)
    const c = b ? new THREE.Vector3(...b.min).add(new THREE.Vector3(...b.max)).multiplyScalar(0.0005) : new THREE.Vector3()
    const size = b ? Math.max(...sub(b.max, b.min)) / 1000 : 6
    t.controls.target.copy(c)
    t.camera.position.copy(c.clone().add(new THREE.Vector3(...dir).normalize().multiplyScalar(Math.max(2, size * 1.8))))
    t.controls.update()
  }, [])

  // ---------- Tệp ----------
  const newModel = () => { setHistory(createHistory(emptyModel())); setName('Mô hình mới'); setPath(null); setCloud(null); setSelected(new Set()); cancel() }
  const save = async (as = false) => {
    try {
      const p = await window.sdraw.saveModel3d(model, name, as ? null : path)
      if (p) { setPath(p); notify(`Đã lưu ${p}`) }
    } catch (e) { notify(`Không lưu được: ${(e as Error).message}`, 'error') }
  }
  const open = async () => {
    try {
      const r = await window.sdraw.openModel3d()
      if (!r) return
      setHistory(createHistory(r.model)); setName(r.name); setPath(r.path); setCloud(null); setSelected(new Set()); cancel(); frame(r.model)
    } catch (e) { notify(`Không mở được: ${(e as Error).message}`, 'error') }
  }
  // ---------- Liên kết Socin: lưu/mở trên máy chủ ----------
  const cloudSave = async (asNew = false) => {
    if (!faceList(model).length) { notify('Mô hình chưa có mặt nào để lưu.'); return }
    setCloudBusy(true)
    try {
      const ref = await saveToCloud(model, name, cloud, asNew)
      setCloud(ref); notify(`Đã lưu "${name}" lên Socin (bản ${ref.rev}). Người trong doanh nghiệp mở được từ "Mở từ Socin".`)
    } catch (e) {
      const err = e as Error & { conflict?: boolean }
      notify(err.conflict ? `${err.message} Bấm "Lưu bản mới lên Socin" để giữ cả hai.` : `Không lưu được lên Socin: ${err.message}`, 'error')
    } finally { setCloudBusy(false) }
  }
  const cloudOpen = async (id: string) => {
    try {
      const r = await openFromCloud(id)
      setHistory(createHistory(r.model)); setName(r.name); setPath(null); setCloud(r.ref); setSelected(new Set()); cancel(); frame(r.model)
      setCloudDlg(null); notify(`Đã mở "${r.name}" từ Socin`)
    } catch (e) { notify(`Không mở được: ${(e as Error).message}`, 'error') }
  }
  const exportAs = async (kind: 'obj' | 'stl' | 'glb') => {
    if (!faceList(model).length) { notify('Mô hình chưa có mặt nào để xuất.'); return }
    try {
      const data = kind === 'obj' ? toObj(model, name) : kind === 'stl' ? toStl(model, name) : toGlb(model, await glbImages(model.materials))
      const p = await window.sdraw.exportModel3d(kind, data, name)
      if (p) notify(`Đã xuất ${p}`)
    } catch (e) { notify(`Không xuất được: ${(e as Error).message}`, 'error') }
  }
  // ---------- Lệnh từ AI và skill ----------
  const nameRef = useRef(name); nameRef.current = name
  const commitAi = useCallback((next: Model3) => {
    const wasEmpty = !faceList(modelRef.current).length
    modelRef.current = next
    setHistory((h) => commit(h, next))
    if (wasEmpty) frame(next)
  }, [frame])
  const runSkillHere = useCallback(async (s: Skill, params: Record<string, unknown>) => {
    const m = modelRef.current
    const r = await runSkill({ model: m, name: nameRef.current, glbImages: () => glbImages(m.materials) }, s, params)
    commitAi(r.model)
    const last = [...r.results].reverse().find((x) => x.data)?.data
    return { text: `Đã chạy skill "${s.name}" (${r.results.length} bước)`, data: last }
  }, [commitAi])
  useEffect(() => {
    setAiHandler(async (call) => {
      if (call.name === 'undo') { setHistory((h) => undo(h)); return { ok: true, text: 'Đã hoàn tác' } }
      if (call.name === 'run_skill' && call.skill) {
        const r = await runSkillHere(call.skill, (call.args['params'] ?? {}) as Record<string, unknown>)
        notify(`AI: ${r.text}`)
        return { ok: true, text: r.text, ...(r.data ? { data: r.data } : {}) }
      }
      const m = modelRef.current
      const r = await runAiTool({ model: m, name: nameRef.current, glbImages: () => glbImages(m.materials) }, call.name, call.args)
      if (r.model) { commitAi(r.model); notify(`AI: ${r.text}`) }
      return { ok: true, text: r.text, ...(r.data ? { data: r.data } : {}), ...(r.file ? { file: r.file } : {}) }
    })
    return () => setAiHandler(null)
  }, [commitAi, runSkillHere, notify])

  const makeSheet = () => buildSheet(model, drawViews, name || 'Bản vẽ', { hidden: drawHidden })
  const previewSheet = () => {
    try { setSheetSvg(sheetToSvg(makeSheet())) } catch (e) { notify((e as Error).message, 'error') }
  }
  const exportSheet = async (kind: 'pdf' | 'dxf') => {
    try {
      const sh = makeSheet()
      const p = await window.sdraw.exportModel3d(kind, kind === 'pdf' ? sheetToSvg(sh) : sheetToDxf(sh), `${name || 'ban-ve'} - ban ve`)
      if (p) notify(`Đã xuất bản vẽ (tỉ lệ 1:${sh.scale}): ${p}`)
    } catch (e) { notify(`Không xuất được bản vẽ: ${(e as Error).message}`, 'error') }
  }
  const pickTexture = async () => {
    if (!selInfo.ids.length) { notify('Chọn mặt cần dán vân trước.'); return }
    try {
      const img = await window.sdraw.openReferenceImage()
      if (!img) return
      if (!img.src.startsWith('data:image/')) { notify('Ảnh vân cần là PNG hoặc JPG.', 'error'); return }
      const src = await shrinkImage(img.src)
      const mat = textureMaterial(`t${model.seq}`, img.name.replace(/\.[^.]+$/, ''), src)
      apply(setFaceMaterial({ ...model, seq: model.seq + 1 }, selInfo.ids, mat))
      notify(`Đã dán vân "${mat.name}". Chỉnh cỡ vân ở bảng bên nếu vân to hoặc nhỏ quá.`)
    } catch (e) { notify(`Không dán được vân: ${(e as Error).message}`, 'error') }
  }
  const importFile = async () => {
    try {
      const f = await window.sdraw.importModel3d()
      if (!f) return
      const r = importMesh(model, f.kind, f.data, f.name)
      apply(r.model)
      setSelected(new Set(faceList(r.model).filter((x) => x.group === r.groupId).map((x) => x.id)))
      frame(r.model)
      notify(`Đã nhập ${f.name}${r.skipped ? `, bỏ ${r.skipped} tam giác hỏng` : ''}. OBJ và STL được coi là milimét, GLB là mét.`)
    } catch (e) { notify(`Không nhập được: ${(e as Error).message}`, 'error') }
  }
  // Mô hình gửi tới từ Store
  const applyRef = useRef(apply); applyRef.current = apply
  useEffect(() => receiveModel3d((d) => {
    try {
      if (d.kind === 'sketch') {
        // Đặt bên phải mô hình đang có (cách 500 mm) để không chồng lên
        const cur = modelRef.current
        const b = bounds(cur)
        const r = addSketchTo3d(cur, d.doc, b ? [Math.round(b.max[0] + 500), 0, 0] : [0, 0, 0])
        if (!r.groupIds.length) { notify('Bản phác thảo chưa có hình khép kín nào để dựng 3D. Khép kín nét vẽ (bấm lại nút đầu) rồi thử lại.', 'error'); return }
        applyRef.current(r.model); setSelected(new Set(r.groupIds.flatMap((g) => faceList(r.model).filter((f) => f.group === g).map((f) => f.id)))); frame(r.model)
        if (!b && name === 'Mô hình mới') setName(d.name || 'Phác thảo')
        notify(r.mode === 'parts'
          ? `Đã dựng "${d.name}" thành ${r.groupIds.length} bộ phận theo thông số phác thảo. Mỗi bộ phận là một nhóm, dùng Đẩy kéo để chỉnh.`
          : `Đã đùn ${r.groupIds.length} hình khép kín của "${d.name}" lên cao ${d.doc.heightMm > 0 ? d.doc.heightMm : DEFAULT_HEIGHT_MM} mm${r.skipped ? `, bỏ qua ${r.skipped} hình tự cắt hoặc quá nhỏ` : ''}.`)
        return
      }
      if (d.kind === 'sdraw3d') {
        const doc = JSON.parse(new TextDecoder().decode(d.data)) as { format?: unknown; name?: unknown; model?: unknown }
        if (doc.format !== 'sdraw3d' || !isModel3(doc.model)) throw new Error('Tệp không phải mô hình S Draw hợp lệ')
        const nm = typeof doc.name === 'string' && doc.name ? doc.name : d.name.replace(/\.sdraw3d$/i, '')
        setHistory(createHistory(doc.model)); setName(nm); setPath(null); setCloud(null); setSelected(new Set()); frame(doc.model)
        notify(`Đã mở "${nm}" từ Store`)
      } else {
        const r = importMesh(modelRef.current, 'glb', d.data, d.name)
        applyRef.current(r.model); frame(r.model)
        notify(`Đã nhập ${d.name} từ Store vào mô hình đang mở`)
      }
    } catch (e) { notify(`Không mở được: ${(e as Error).message}`, 'error') }
  }), [frame, notify, name])
  const fromLayout = () => {
    const m = modelFromScene(buildScene(rooms, props.catalog))
    if (!faceList(m).length) { notify('Bố cục phòng chưa có gì để dựng.'); return }
    setHistory((h) => commit(h, m)); setSelected(new Set()); cancel(); frame(m)
    if (name === 'Mô hình mới') setName(props.doc.name || 'Phòng')
    notify('Đã dựng sàn, tường và đồ nội thất từ bố cục phòng. Mỗi món là một nhóm, dùng Đẩy kéo để chỉnh.')
  }

  // ---------- Thông tin lựa chọn ----------
  const selInfo = useMemo(() => {
    const ids = [...selected].filter((id) => model.faces[id])
    const area = ids.reduce((s, id) => s + faceArea(model, model.faces[id]!), 0)
    const groups = [...new Set(ids.map((id) => model.faces[id]!.group).filter((g): g is string => !!g))]
    const mats = new Set(ids.map((id) => model.faces[id]!.material))
    const material = mats.size === 1 ? [...mats][0] : undefined
    const instance = groups.length === 1 && model.groups[groups[0]!]?.component ? groups[0] : undefined
    return { ids, area, groups, instance, material, hasMaterial: ids.some((id) => model.faces[id]!.material), solids: ids.length > 1 ? solidsOf(model, ids).length : ids.length }
  }, [selected, model])

  const toolDef = TOOLS.find((t) => t.id === tool)!
  const status = [cursor?.snap && cursor.snap !== 'none' ? SNAP_LABEL[cursor.snap] : '', measure].filter(Boolean).join(' · ')

  return (
    <div className="page model3d">
      <div className="row model3d-bar">
        <input className="model3d-name" aria-label="Tên mô hình" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" onClick={newModel}>Mô hình mới</button>
        <button className="btn" onClick={() => void open()}>Mở mô hình…</button>
        <button className="btn" onClick={() => void save()}>Lưu mô hình</button>
        <button className="btn" onClick={() => void importFile()}>Nhập OBJ/STL/GLB…</button>
        <button className="btn" onClick={fromLayout}>Dựng từ bố cục phòng</button>
        <button className="btn" onClick={() => setCloudDlg('gen3d')}>Tạo hình bằng AI…</button>
        {props.online && (
          <>
            <button className="btn" disabled={cloudBusy} onClick={() => void cloudSave()} title={cloud ? `Đang liên kết bản ${cloud.rev} trên Socin` : 'Lưu một bản lên Socin của doanh nghiệp'}>{cloud ? 'Lưu lên Socin' : 'Lưu lên Socin…'}</button>
            {cloud && <button className="btn" disabled={cloudBusy} onClick={() => void cloudSave(true)}>Lưu bản mới lên Socin</button>}
            <button className="btn" onClick={() => setCloudDlg('open')}>Mở từ Socin…</button>
            <button className="btn" onClick={() => { if (faceList(model).length) setCloudDlg('store'); else notify('Mô hình chưa có mặt nào để đăng.') }}>Đăng lên Store…</button>
          </>
        )}
        <span className="grow" />
        <button className="btn" aria-label="Hoàn tác" disabled={!history.past.length} onClick={() => setHistory(undo(history))}>↶</button>
        <button className="btn" aria-label="Làm lại" disabled={!history.future.length} onClick={() => setHistory(redo(history))}>↷</button>
      </div>
      <div className="model3d-main">
        <div className="model3d-tools" role="toolbar" aria-label="Công cụ dựng hình">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? 'tool on' : 'tool'} title={`${t.label} (${t.key})`} aria-pressed={tool === t.id} onClick={() => pickTool(t.id)}>
              {t.label}<kbd>{t.key}</kbd>
            </button>
          ))}
        </div>
        <div className="model3d-canvas" ref={host} onPointerMove={onMove} onClick={onClick} onDoubleClick={onDouble} onPointerLeave={() => { setHover(null) }} onContextMenu={(e) => e.preventDefault()} />
        <aside className="model3d-side">
          <h3>Mô hình</h3>
          <ul className="side-list">
            <li><span>Mặt</span><strong>{faceList(model).length}</strong></li>
            <li><span>Nhóm</span><strong>{Object.keys(model.groups).length}</strong></li>
          </ul>
          <div className="chips">
            <button className="chip" onClick={() => frame(model)}>Vừa khung</button>
            <button className="chip" onClick={() => frame(model, [0.001, -0.001, 1])}>Trên</button>
            <button className="chip" onClick={() => frame(model, [0, -1, 0.05])}>Trước</button>
          </div>
          <h3>Đang chọn</h3>
          {selInfo.ids.length === 0 ? <p className="hint">Chưa chọn gì. Dùng công cụ Chọn (phím cách).</p> : (
            <>
              <ul className="side-list">
                <li><span>Số mặt</span><strong>{selInfo.ids.length}</strong></li>
                <li><span>Diện tích</span><strong>{(selInfo.area / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} m²</strong></li>
              </ul>
              {selInfo.groups.length === 1 && (() => {
                const g = model.groups[selInfo.groups[0]!]
                const comp = g?.component ? componentList(model).find((c) => c.id === g.component) : undefined
                return (
                  <>
                    <div className="field"><label htmlFor="gname">{comp ? 'Tên cấu kiện' : 'Tên nhóm'}</label>
                      <div className="input-wrap"><input id="gname" value={g?.name ?? ''} onChange={(e) => apply(comp ? renameComponent(model, comp.id, e.target.value) : renameGroup(model, selInfo.groups[0]!, e.target.value))} /></div>
                    </div>
                    {comp && <p className="hint">Bản của cấu kiện "{comp.name}" ({comp.instances} bản). Sửa bản này thì mọi bản đổi theo.</p>}
                  </>
                )
              })()}
              <div className="swatches" role="group" aria-label="Màu mặt">
                {COLORS.map((c) => <button key={c} className="swatch" style={{ background: c }} aria-label={`Màu ${c}`} onClick={() => apply(pruneMaterials(setFaceColor(model, selInfo.ids, c === DEFAULT_FACE_COLOR ? undefined : c)))} />)}
              </div>
              <h4 className="model3d-sub">Vật liệu</h4>
              <div className="mat-grid" role="group" aria-label="Vật liệu">
                {MATERIAL_LIBRARY.map((mt) => (
                  <button key={mt.id} className={selInfo.material === mt.id ? 'mat on' : 'mat'} title={mt.name} aria-label={`Vật liệu ${mt.name}`} onClick={() => apply(setFaceMaterial(model, selInfo.ids, model.materials?.[mt.id] ?? mt))}>
                    <img src={thumbFor(mt)} alt="" />
                  </button>
                ))}
                {Object.values(model.materials ?? {}).filter((mt) => mt.texture).map((mt) => (
                  <button key={mt.id} className={selInfo.material === mt.id ? 'mat on' : 'mat'} title={mt.name} aria-label={`Vật liệu ${mt.name}`} onClick={() => apply(setFaceMaterial(model, selInfo.ids, mt))}>
                    <img src={thumbFor(mt)} alt="" />
                  </button>
                ))}
              </div>
              <div className="chips">
                <button className="chip" onClick={() => void pickTexture()}>Ảnh vân…</button>
                {selInfo.hasMaterial && <button className="chip" onClick={() => apply(setFaceMaterial(model, selInfo.ids, undefined))}>Bỏ vật liệu</button>}
              </div>
              {selInfo.material && model.materials?.[selInfo.material] && (
                <div className="field"><label htmlFor="matsize">{model.materials[selInfo.material]!.name}: cỡ vân (mm)</label>
                  <div className="input-wrap"><input id="matsize" type="number" min={10} step={10} value={model.materials[selInfo.material]!.size} onChange={(e) => { const v = Number(e.target.value); if (v >= 10) apply(updateMaterial(model, selInfo.material!, { size: v })) }} /></div>
                </div>
              )}
              <div className="chips">
                <button className="chip" onClick={doGroup}>Nhóm (G)</button>
                {selInfo.instance
                  ? <button className="chip" onClick={() => apply(makeUnique(model, selInfo.instance!))}>Tách riêng</button>
                  : <button className="chip" onClick={doComponent}>Tạo cấu kiện</button>}
                {selInfo.groups.length > 0 && <button className="chip" onClick={() => { let m = model; selInfo.groups.forEach((g) => { m = ungroup(m, g) }); apply(m) }}>Bỏ nhóm</button>}
                <button className="chip" onClick={() => {
                  const b = bounds({ ...model, faces: Object.fromEntries(selInfo.ids.map((id) => [id, model.faces[id]!])) })
                  if (b) apply(rotateFacesZ(model, selInfo.ids, scale(add(b.min, b.max), 0.5), 90))
                }}>Xoay 90°</button>
                <button className="chip danger" onClick={delSelected}>Xoá</button>
              </div>
              {selInfo.solids === 2 && (
                <div className="chips" role="group" aria-label="Phép toán khối">
                  {(Object.keys(BOOL_LABEL) as BoolOp[]).map((k) => <button key={k} className="chip" disabled={busy} onClick={() => doBool(k)}>{BOOL_LABEL[k]}</button>)}
                </div>
              )}
              {selInfo.solids === 2 && <p className="hint">Trừ khối: khoét khối chọn sau khỏi khối chọn trước.</p>}
            </>
          )}
          {componentList(model).length > 0 && (
            <>
              <h3>Cấu kiện</h3>
              <ul className="side-list comp-list">
                {componentList(model).map((c) => (
                  <li key={c.id}>
                    <span>{c.name} <small>· {c.instances} bản</small></span>
                    <button className="chip" onClick={() => placeMore(c.id)}>Đặt thêm</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>Xuất</h3>
          <div className="chips">
            <button className="chip" onClick={() => void exportAs('glb')}>GLB</button>
            <button className="chip" onClick={() => void exportAs('obj')}>OBJ</button>
            <button className="chip" onClick={() => void exportAs('stl')}>STL</button>
            <button className="chip" onClick={() => void save(true)}>Lưu thành…</button>
          </div>
          <h3>Bản vẽ</h3>
          <div className="draw-views" role="group" aria-label="Hình chiếu">
            {(Object.keys(VIEW_LABEL) as ViewName[]).map((v) => (
              <label key={v} className="check">
                <input type="checkbox" checked={drawViews.includes(v)} onChange={(e) => setDrawViews((cur) => e.target.checked ? (Object.keys(VIEW_LABEL) as ViewName[]).filter((x) => x === v || cur.includes(x)) : cur.filter((x) => x !== v))} />
                {VIEW_LABEL[v]}
              </label>
            ))}
            <label className="check"><input type="checkbox" checked={drawHidden} onChange={(e) => setDrawHidden(e.target.checked)} />Vẽ nét khuất</label>
          </div>
          <div className="chips">
            <button className="chip" onClick={previewSheet}>Xem bản vẽ</button>
            <button className="chip" onClick={() => void exportSheet('pdf')}>PDF</button>
            <button className="chip" onClick={() => void exportSheet('dxf')}>DXF</button>
          </div>
          {Object.keys(model.dims ?? {}).length > 0 && (
            <p className="hint">{Object.keys(model.dims!).length} kích thước đã ghi. <button className="linkish" onClick={() => apply(deleteDimensions(model, Object.keys(model.dims!)))}>Xoá hết</button></p>
          )}
          <AiPanel notify={notify} onRunSkill={async (s, p) => { try { const r = await runSkillHere(s, p); notify(r.text) } catch (e) { notify((e as Error).message, 'error') } }} />
        </aside>
      </div>
      <div className="row model3d-status">
        <span className="hint grow">{toolDef.hint}</span>
        <span className="model3d-measure" aria-live="polite">{status}</span>
        <label className="model3d-vcb">
          <span>Kích thước</span>
          <input ref={vcbRef} aria-label="Nhập kích thước (mm)" value={vcb} placeholder="mm" onChange={(e) => setVcb(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitVcb() } }} />
        </label>
      </div>
      {cloudDlg === 'open' && <CloudOpenDialog onOpen={(id) => void cloudOpen(id)} onClose={() => setCloudDlg(null)} onNotice={notify} />}
      {cloudDlg === 'gen3d' && (
        <Gen3dDialog onClose={() => setCloudDlg(null)} onNotice={notify}
          onGlb={(data, nm) => {
            try {
              const r = importMesh(modelRef.current, 'glb', data, nm)
              apply(r.model); setSelected(new Set(faceList(r.model).filter((x) => x.group === r.groupId).map((x) => x.id))); frame(r.model); setCloudDlg(null)
            } catch (e) { notify(`Không nhập được mô hình: ${(e as Error).message}`, 'error') }
          }}
          onTexture={selInfo.ids.length ? (src, nm) => {
            void shrinkImage(src).then((small) => {
              const m = modelRef.current
              const mat = textureMaterial(`t${m.seq}`, nm.slice(0, 40), small)
              apply(setFaceMaterial({ ...m, seq: m.seq + 1 }, selInfo.ids, mat)); notify(`Đã dán vân "${mat.name}"`)
            }).catch((e: Error) => notify(`Không dán được vân: ${e.message}`, 'error'))
          } : undefined} />
      )}
      {cloudDlg === 'store' && <StorePublishDialog model={model} name={name} onClose={() => setCloudDlg(null)} onNotice={notify} />}
      {sheetSvg && (
        <div className="sheet-modal" role="dialog" aria-label="Xem bản vẽ" onClick={() => setSheetSvg(null)}>
          <div className="sheet-box" onClick={(e) => e.stopPropagation()}>
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(sheetSvg)}`} alt="Bản vẽ" />
            <div className="row">
              <span className="grow hint">Khổ A3 ngang. Ghi thêm kích thước bằng công cụ Kích thước (D).</span>
              <button className="btn" onClick={() => void exportSheet('pdf')}>Xuất PDF bản vẽ</button>
              <button className="btn" onClick={() => void exportSheet('dxf')}>Xuất DXF bản vẽ</button>
              <button className="btn" onClick={() => setSheetSvg(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
