import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { HouseRoom } from '@core/neonplan'
import { fitMesh, parseGlb, parseObj, rotateMeshZ, type Mesh } from '@core/mesh'
import { buildScene, WALL_HEIGHT_M, type Box3 } from '@core/scene3d'
import type { Sample, SdrawDoc } from '@core/types'

const LOOK: Record<Box3['kind'], { fill: string; edge: string; opacity: number }> = {
  floor: { fill: '#07131f', edge: '#2fe6ff', opacity: 1 },
  wall: { fill: '#0b2233', edge: '#2fe6ff', opacity: 0.35 },
  door: { fill: '#3d2a08', edge: '#ffb020', opacity: 0.7 },
  window: { fill: '#12506a', edge: '#8be9ff', opacity: 0.45 },
  curtain: { fill: '#2b1a4a', edge: '#b77bff', opacity: 0.55 },
  light: { fill: '#ffe3a0', edge: '#ffe3a0', opacity: 1 },
  furniture: { fill: '#0a3b4a', edge: '#2fe6ff', opacity: 0.85 }
}

const LIGHT_COLOR = '#ffd37a'
/** Từ đèn trần xuống sàn (m), để đặt vệt sáng ngay trên sàn */
const WALL_TOP = WALL_HEIGHT_M - 0.06
const MAX_POINT_LIGHTS = 10

let glowTexture: THREE.CanvasTexture | null = null
/** Vầng sáng mềm dùng cho đèn và vệt sáng trên sàn. */
function glow(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,211,122,0.95)')
  grad.addColorStop(0.35, 'rgba(255,211,122,0.35)')
  grad.addColorStop(1, 'rgba(255,211,122,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  glowTexture = new THREE.CanvasTexture(c)
  return glowTexture
}

/** Lưới thật của mẫu, đã co giãn về kích thước món; Y hướng lên, tâm đáy ở gốc. Null nếu chưa có hoặc quá nặng. */
function meshGeometry(raw: Mesh, rotation: number, b: Box3): THREE.BufferGeometry | null {
  const fit = fitMesh(rotateMeshZ(raw, rotation), b.w * 1000, b.d * 1000, b.h * 1000)
  if (!fit) return null
  const pos = new Float32Array(fit.vertices.length)
  for (let i = 0; i < fit.vertices.length; i += 3) {
    pos[i] = fit.vertices[i]! / 1000 - b.w / 2
    pos[i + 1] = fit.vertices[i + 2]! / 1000 - b.h / 2
    pos[i + 2] = fit.vertices[i + 1]! / 1000 - b.d / 2
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setIndex(fit.triangles)
  geo.computeVertexNormals()
  return geo
}

function floorLabel(f: number): string {
  return f === 0 ? 'Tầng trệt' : f < 0 ? `Hầm ${-f}` : `Tầng ${f}`
}

/** Phòng của dự án đang mở (thay bản vẽ đang sửa vào đúng phòng), hoặc chỉ bản vẽ hiện tại. */
export function useRooms(doc: SdrawDoc, link: { projectId: string; roomId: string } | null): HouseRoom[] {
  const [rooms, setRooms] = useState<HouseRoom[] | null>(null)
  useEffect(() => {
    let alive = true
    if (!link) { setRooms(null); return }
    void window.sdraw.listProjects().then((list) => {
      const p = list.find((x) => x.id === link.projectId)
      if (alive) setRooms(p?.rooms ?? null)
    })
    return () => { alive = false }
  }, [link])
  return useMemo(() => {
    if (!link || !rooms) return [{ id: 'current', floor: 0, doc }]
    return rooms.map((r) => (r.id === link.roomId ? { ...r, doc } : r))
  }, [doc, link, rooms])
}

export function View3D(props: { doc: SdrawDoc; link: { projectId: string; roomId: string } | null; catalog: Sample[] }) {
  const rooms = useRooms(props.doc, props.link)
  const scene3d = useMemo(() => buildScene(rooms, props.catalog), [rooms, props.catalog])
  const [floor, setFloor] = useState<number | 'all'>('all')
  const [spin, setSpin] = useState(false)
  const [lights, setLights] = useState(true)
  const lightsRef = useRef(true)
  lightsRef.current = lights
  const [meshes, setMeshes] = useState<Map<string, Mesh>>(new Map())
  const requested = useRef(new Set<string>())
  const host = useRef<HTMLDivElement>(null)

  // Nạp lưới thật của các mẫu có file .obj hoặc .glb đang dùng trong cảnh (đọc dần, món chưa có lưới hiện khối hộp).
  useEffect(() => {
    const wanted = new Map<string, string>()
    for (const b of scene3d.boxes) {
      const path = b.kind === 'furniture' ? props.catalog.find((s) => s.id === b.sampleId)?.meshPath : undefined
      if (path) wanted.set(path, path)
    }
    for (const path of wanted.values()) {
      if (requested.current.has(path)) continue
      requested.current.add(path)
      void window.sdraw.readMesh(path).then((f) => {
        if (!f) return
        try {
          const mesh = f.kind === 'glb' ? parseGlb(f.data) : parseObj(new TextDecoder().decode(f.data))
          setMeshes((m) => new Map(m).set(path, mesh))
        } catch {
          // File hỏng: giữ khối hộp.
        }
      })
    }
  }, [scene3d, props.catalog])
  const spinRef = useRef(false)
  spinRef.current = spin

  useEffect(() => {
    const el = host.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)
    renderer.domElement.setAttribute('aria-label', 'Cảnh 3D, kéo chuột để xoay')
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#050d16')
    scene.add(new THREE.HemisphereLight('#bfe9f5', '#04121c', lights ? 0.55 : 1.1))
    const sun = new THREE.DirectionalLight('#ffffff', 0.7)
    sun.position.set(6, 12, 4)
    scene.add(sun)

    const { bounds } = scene3d
    const cx = (bounds.minX + bounds.maxX) / 2
    const cz = (bounds.minZ + bounds.maxZ) / 2
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 3)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500)
    camera.position.set(cx + span * 0.9, span * 0.9 + bounds.maxY / 2, cz + span * 1.1)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(cx, bounds.maxY / 3, cz)
    controls.enableDamping = true
    controls.maxPolarAngle = Math.PI * 0.49
    controls.minDistance = 1.5
    controls.maxDistance = span * 6
    controls.autoRotateSpeed = 1.2

    const disposables: Array<{ dispose(): void }> = []
    let pointLights = 0
    for (const b of scene3d.boxes) {
      if (floor !== 'all' && b.floor !== floor) continue
      const look = LOOK[b.kind]
      const sample = b.kind === 'furniture' ? props.catalog.find((s) => s.id === b.sampleId) : undefined
      const raw = sample?.meshPath ? meshes.get(sample.meshPath) : undefined
      const real = raw ? meshGeometry(raw, sample?.meshRotation ?? 0, b) : null
      const geo = real ?? new THREE.BoxGeometry(b.w, b.h, b.d)
      const lit = lights && (b.kind === 'light' || b.lamp)
      const mat = new THREE.MeshStandardMaterial({
        color: look.fill,
        transparent: look.opacity < 1,
        opacity: look.opacity,
        roughness: 0.8,
        emissive: lit ? LIGHT_COLOR : look.edge,
        emissiveIntensity: lit ? 1.4 : b.kind === 'floor' ? 0 : 0.06,
        side: real ? THREE.DoubleSide : THREE.FrontSide,
        depthWrite: look.opacity >= 0.8
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(b.x, b.y, b.z)
      mesh.rotation.y = b.rotY
      const edges = new THREE.EdgesGeometry(geo, real ? 35 : 1)
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: lit ? LIGHT_COLOR : look.edge }))
      mesh.add(line)
      scene.add(mesh)
      disposables.push(geo, mat, edges, line.material as THREE.Material)

      if (lit) {
        const top = new THREE.Vector3(b.x, b.kind === 'light' ? b.y - 0.05 : b.y + b.h / 2, b.z)
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
        halo.position.copy(top)
        halo.scale.setScalar(b.kind === 'light' ? 1.6 : 1.0)
        scene.add(halo)
        disposables.push(halo.material)
        if (pointLights < MAX_POINT_LIGHTS) {
          const pl = new THREE.PointLight(LIGHT_COLOR, b.kind === 'light' ? 5 : 2.5, 6, 1.6)
          pl.position.copy(top).add(new THREE.Vector3(0, -0.15, 0))
          scene.add(pl)
          pointLights++
        }
        if (b.kind === 'light') {
          const pool = new THREE.Mesh(
            new THREE.PlaneGeometry(4, 4),
            new THREE.MeshBasicMaterial({ map: glow(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 })
          )
          pool.rotation.x = -Math.PI / 2
          pool.position.set(b.x, b.y - (WALL_TOP - 0.01), b.z)
          scene.add(pool)
          disposables.push(pool.geometry, pool.material as THREE.Material)
        }
      }
    }

    const resize = () => {
      const w = el.clientWidth || 800
      const h = el.clientHeight || 500
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    let raf = 0
    const tick = () => {
      controls.autoRotate = spinRef.current
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      disposables.forEach((d) => d.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [scene3d, floor, meshes, lights, props.catalog])

  const floors = scene3d.floors
  return (
    <div className="page view3d">
      <div className="row view3d-bar">
        <h2>Xem 3D</h2>
        <div className="chips">
          <button className={floor === 'all' ? 'chip on' : 'chip'} onClick={() => setFloor('all')}>Cả nhà</button>
          {floors.length > 1 ? floors.map((f) => (
            <button key={f} className={floor === f ? 'chip on' : 'chip'} onClick={() => setFloor(f)}>{floorLabel(f)}</button>
          )) : null}
        </div>
        <label className="check"><input type="checkbox" checked={lights} onChange={(e) => setLights(e.target.checked)} />Bật đèn</label>
        <label className="check"><input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} />Tự xoay</label>
      </div>
      <div className="view3d-canvas" ref={host} />
      <p className="hint">Kéo chuột để xoay, cuộn để phóng to, kéo chuột phải để dời. Mẫu có file .obj hoặc .glb trong kho hiện đúng hình dạng, mẫu khác hiện khối hộp theo kích thước thật; cam là cửa, xanh nhạt là cửa sổ, tím là rèm. Mỗi phòng có một đèn trần; món thuộc danh mục Đèn cũng phát sáng.</p>
    </div>
  )
}
