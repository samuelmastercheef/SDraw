import { useCallback, useEffect, useState } from 'react'
import { emptyDoc } from '@core/commands'
import type { HouseRoom } from '@core/neonplan'
import type { Sample, SdrawDoc } from '@core/types'
import type { ProjectRec } from '../preload/api'

const TEMPLATES: { id: string; name: string; w: number; d: number; note: string }[] = [
  { id: 'empty', name: 'Phòng trống', w: 5000, d: 4000, note: 'Bắt đầu từ khung phòng 5 × 4 m' },
  { id: 'living', name: 'Phòng khách', w: 5500, d: 4500, note: 'Sofa, bàn trà, kệ tivi' },
  { id: 'bed', name: 'Phòng ngủ', w: 4000, d: 4000, note: 'Giường, tủ áo, bàn làm việc' },
  { id: 'dining', name: 'Bếp và phòng ăn', w: 5000, d: 3500, note: 'Bàn ăn, ghế, tủ bếp' }
]

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Dự án cũ chỉ có một bản vẽ thì coi như một phòng ở tầng trệt. */
export function roomsOf(p: ProjectRec): HouseRoom[] {
  return p.rooms && p.rooms.length ? p.rooms : [{ id: 'main', floor: 0, doc: p.doc }]
}

function floorLabel(f: number): string {
  return f === 0 ? 'Tầng trệt' : f < 0 ? `Hầm ${-f}` : `Tầng ${f}`
}

export function ProjectsView(props: {
  current: SdrawDoc
  link: { projectId: string; roomId: string } | null
  catalog: Sample[]
  onOpen: (doc: SdrawDoc) => void
  onOpenRoom: (doc: SdrawDoc, projectId: string, roomId: string) => void
  onNotice: (text: string, tone?: 'ok' | 'error') => void
}) {
  const [list, setList] = useState<ProjectRec[]>([])
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [customer, setCustomer] = useState('')
  const [tpl, setTpl] = useState('empty')

  const load = useCallback(async () => setList(await window.sdraw.listProjects()), [])
  useEffect(() => { void load() }, [load])

  const create = async () => {
    const t = TEMPLATES.find((x) => x.id === tpl) ?? TEMPLATES[0]!
    const doc = emptyDoc(name.trim() || t.name, t.w, t.d)
    await window.sdraw.saveProject({ id: newId(), name: doc.name, customer: customer.trim(), updatedAt: Date.now(), doc })
    setName(''); setCustomer('')
    await load()
    props.onOpen(doc)
  }
  const saveCurrent = async () => {
    const linked = props.link ? list.find((p) => p.id === props.link!.projectId) : undefined
    if (linked) return saveIntoRoom(linked)
    const existing = list.find((p) => p.name === props.current.name && p.customer === customer.trim())
    if (existing?.rooms) {
      props.onNotice('Dự án này có nhiều phòng. Hãy mở phòng từ danh sách rồi lưu vào phòng đó.', 'error')
      return
    }
    await window.sdraw.saveProject({ id: existing?.id ?? newId(), name: props.current.name, customer: customer.trim(), updatedAt: Date.now(), doc: props.current })
    props.onNotice(`Đã lưu "${props.current.name}" vào danh sách dự án`)
    await load()
  }
  const remove = async (p: ProjectRec) => {
    await window.sdraw.deleteProject(p.id)
    await load()
  }
  const [roomName, setRoomName] = useState('')
  const [roomFloor, setRoomFloor] = useState(0)

  const persist = async (p: ProjectRec, rooms: HouseRoom[]) => {
    await window.sdraw.saveProject({ ...p, rooms, doc: rooms[0]!.doc })
    await load()
  }
  const addRoom = async (p: ProjectRec) => {
    const t = TEMPLATES.find((x) => x.id === tpl) ?? TEMPLATES[0]!
    const doc = emptyDoc(roomName.trim() || t.name, t.w, t.d)
    await persist(p, [...roomsOf(p), { id: newId(), floor: roomFloor, doc }])
    setRoomName('')
    props.onNotice(`Đã thêm phòng "${doc.name}" vào ${p.name}`)
  }
  const patchRoom = (p: ProjectRec, id: string, patch: Partial<HouseRoom>) =>
    persist(p, roomsOf(p).map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const removeRoom = async (p: ProjectRec, id: string) => {
    const rest = roomsOf(p).filter((r) => r.id !== id)
    if (rest.length === 0) return
    await persist(p, rest)
  }
  /** Các phòng của dự án, thay bản vẽ đang mở vào đúng phòng đã liên kết. */
  const roomsWithCurrent = (p: ProjectRec): HouseRoom[] =>
    roomsOf(p).map((r) => (props.link?.projectId === p.id && props.link.roomId === r.id ? { ...r, doc: props.current } : r))
  const saveIntoRoom = async (p: ProjectRec) => {
    await persist(p, roomsWithCurrent(p))
    props.onNotice(`Đã lưu bản vẽ vào phòng của "${p.name}"`)
  }
  const exportHouse = async (p: ProjectRec) => {
    try {
      const r = await window.sdraw.exportNeonPlanHouse(roomsWithCurrent(p), props.catalog, p.name)
      if (!r) return
      props.onNotice(r.warnings.length ? `Đã xuất ${r.file}. ${r.warnings.length} món cần kiểm tra loại sau khi nhập NeonPlan` : `Đã xuất ${r.file}`)
    } catch (e) {
      props.onNotice(`Không xuất được: ${(e as Error).message}`, 'error')
    }
  }

  const key = q.trim().toLowerCase()
  const shown = list.filter((p) => !key || p.name.toLowerCase().includes(key) || p.customer.toLowerCase().includes(key))

  return (
    <div className="page">
      <h2>Dự án khách hàng</h2>
      <p className="muted">Dự án lưu ngay trên máy này. Chọn mẫu khởi đầu hoặc lưu bản vẽ đang mở.</p>
      <h3>Dự án mới</h3>
      <div className="tpl-grid">
        {TEMPLATES.map((t) => (
          <button key={t.id} className={tpl === t.id ? 'tpl on' : 'tpl'} aria-pressed={tpl === t.id} onClick={() => setTpl(t.id)}>
            <strong>{t.name}</strong>
            <span>{t.w / 1000} × {t.d / 1000} m</span>
            <span className="muted">{t.note}</span>
          </button>
        ))}
      </div>
      <div className="row">
        <div className="field"><label htmlFor="pn">Tên dự án</label><div className="input-wrap"><input id="pn" value={name} onChange={(e) => setName(e.target.value)} /></div></div>
        <div className="field"><label htmlFor="pc">Khách hàng</label><div className="input-wrap"><input id="pc" value={customer} onChange={(e) => setCustomer(e.target.value)} /></div></div>
      </div>
      <div className="row">
        <div className="field"><label htmlFor="rn">Tên phòng khi thêm vào dự án</label><div className="input-wrap"><input id="rn" value={roomName} onChange={(e) => setRoomName(e.target.value)} /></div></div>
        <div className="field"><label htmlFor="rf">Tầng (0 = trệt)</label><div className="input-wrap"><input id="rf" type="number" min={-5} max={60} value={roomFloor} onChange={(e) => setRoomFloor(Math.round(Number(e.target.value) || 0))} /></div></div>
      </div>
      <div className="row">
        <button className="btn-cta" onClick={() => void create()}>Tạo dự án</button>
        <button className="btn" onClick={() => void saveCurrent()}>Lưu bản vẽ đang mở vào danh sách</button>
      </div>
      <h3>Danh sách ({list.length})</h3>
      <div className="field"><label htmlFor="pq">Tìm theo tên hoặc khách hàng</label><div className="input-wrap"><input id="pq" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      {shown.length === 0 ? <p className="hint">{list.length === 0 ? 'Chưa có dự án nào.' : 'Không có dự án khớp.'}</p> : null}
      <ul className="cards wide">
        {shown.map((p) => (
          <li key={p.id} className="card">
            <strong>{p.name}</strong>
            <span className="muted">{p.customer || 'Chưa có khách hàng'} · {roomsOf(p).length} phòng · {new Date(p.updatedAt).toLocaleDateString('vi-VN')}</span>
            {roomsOf(p).map((r) => {
              const linked = props.link?.projectId === p.id && props.link.roomId === r.id
              const d = r.doc
              return (
                <div className="room-row" key={r.id}>
                  <span><strong>{d.name}</strong>{linked ? ' (đang mở)' : ''}<br /><span className="muted">{floorLabel(r.floor)} · {d.room.widthMm / 1000} × {d.room.depthMm / 1000} m · {d.items.length} món</span></span>
                  <label className="muted">Tầng<input type="number" aria-label={`Tầng của ${d.name}`} value={r.floor} min={-5} max={60} onChange={(e) => void patchRoom(p, r.id, { floor: Math.round(Number(e.target.value) || 0) })} /></label>
                  <label className="muted">X (mm)<input type="number" aria-label={`Vị trí X của ${d.name}`} placeholder="tự xếp" value={r.x ?? ''} onChange={(e) => void patchRoom(p, r.id, e.target.value === '' ? { x: undefined, y: undefined } : { x: Number(e.target.value), y: r.y ?? 0 })} /></label>
                  <label className="muted">Y (mm)<input type="number" aria-label={`Vị trí Y của ${d.name}`} placeholder="tự xếp" value={r.y ?? ''} disabled={r.x === undefined} onChange={(e) => void patchRoom(p, r.id, { y: Number(e.target.value) || 0 })} /></label>
                  <button className="btn" onClick={() => props.onOpenRoom(d, p.id, r.id)}>Mở</button>
                  {roomsOf(p).length > 1 ? <button className="btn-ghost danger" onClick={() => void removeRoom(p, r.id)}>Xoá phòng</button> : null}
                </div>
              )
            })}
            <span className="row">
              <button className="btn" onClick={() => void addRoom(p)}>Thêm phòng (mẫu đã chọn, {floorLabel(roomFloor)})</button>
              {props.link?.projectId === p.id ? <button className="btn" onClick={() => void saveIntoRoom(p)}>Lưu bản vẽ đang mở vào phòng</button> : null}
              <button className="btn" onClick={() => void exportHouse(p)}>Xuất cả nhà sang Home Assistant</button>
              <button className="btn-ghost danger" onClick={() => void remove(p)}>Xoá dự án</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
