import { useMemo, useState } from 'react'
import { meshBounds, meshIso, parseGlb, parseObj, rotateMeshZ, type Mesh } from '@core/mesh'
import type { Sample } from '@core/types'

const CATEGORIES = ['Sofa', 'Bàn', 'Ghế', 'Giường', 'Kệ sách', 'Tủ quần áo', 'Kệ tivi', 'Khác']
const UNITS: { label: string; mm: number }[] = [{ label: 'mm', mm: 1 }, { label: 'cm', mm: 10 }, { label: 'm', mm: 1000 }, { label: 'inch', mm: 25.4 }]

/** Đoán đơn vị theo kích thước lớn nhất: nhỏ hơn 10 thường là mét, nhỏ hơn 400 thường là cm. */
export function guessUnit(maxSize: number): number {
  return maxSize < 10 ? 2 : maxSize < 400 ? 1 : 0
}

interface Props {
  onNotice: (text: string, tone?: 'ok' | 'error') => void
  catalog: Sample[]
  onChange: (catalog: Sample[]) => void
}

/** Xem trước file .obj/.glb trên máy và lưu vào kho mẫu. File nằm yên trên máy, app chỉ lưu đường dẫn. */
export function MeshViewButton(props: Props) {
  const [shown, setShown] = useState<{ path: string; name: string; mesh: Mesh } | null>(null)

  async function open() {
    try {
      const f = await window.sdraw.openMesh()
      if (!f) return
      setShown({ path: f.path, name: f.name, mesh: f.kind === 'glb' ? parseGlb(f.data) : parseObj(new TextDecoder().decode(f.data)) })
    } catch (e) {
      props.onNotice(e instanceof Error ? e.message : 'Không đọc được mô hình', 'error')
    }
  }

  return (
    <>
      <button className="btn" onClick={() => void open()}>Xem file 3D…</button>
      {shown && (
        <MeshDialog
          {...shown}
          onClose={() => setShown(null)}
          onSave={(s) => {
            props.onChange([...props.catalog, s])
            props.onNotice(`Đã thêm "${s.name}" vào kho mẫu`)
            setShown(null)
          }}
        />
      )}
    </>
  )
}

function MeshDialog(props: { path: string; name: string; mesh: Mesh; onClose: () => void; onSave: (s: Sample) => void }) {
  const [rot, setRot] = useState<0 | 90 | 180 | 270>(0)
  const rotated = useMemo(() => rotateMeshZ(props.mesh, rot), [props.mesh, rot])
  const draw = useMemo(() => meshIso(rotated, 420), [rotated])
  const size = meshBounds(rotated).size
  const [unit, setUnit] = useState(guessUnit(Math.max(...size)))
  const [name, setName] = useState(props.name.replace(/\.(obj|glb)$/i, ''))
  const [category, setCategory] = useState('Khác')
  const mm = size.map((v) => Math.round(v * UNITS[unit]!.mm))
  const ok = name.trim().length > 0 && mm.every((v) => v >= 50 && v <= 20000)

  function save() {
    props.onSave({
      id: `mesh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(), category, w: mm[0]!, d: mm[1]!, h: mm[2]!,
      meshPath: props.path, meshRotation: rot, origin: 'upload', sourceType: 'mesh'
    })
  }

  return (
    <div className="modal" role="dialog" aria-label={`Xem 3D ${props.name}`}>
      <div className="modal-card">
        <h3>{props.name}</h3>
        <svg className="preview3d" viewBox={`0 0 ${draw.width} ${draw.height}`} role="img" aria-label="Xem trước mô hình 3D">
          {draw.polys.map((p, i) => <polygon key={i} points={p.points} fill={p.fill} stroke={p.fill} strokeWidth={0.4} />)}
        </svg>
        <p className="hint">
          {props.mesh.triangles.length / 3} tam giác. Chỉ xem hình khối, chưa đọc màu hay vật liệu.
          Kích thước file: {size.map((v) => v.toFixed(1)).join(' × ')}.
        </p>
        <div className="row">
          <button className="btn" onClick={() => setRot(((rot + 90) % 360) as 0 | 90 | 180 | 270)}>Xoay 90°</button>
          <span className="hint">Mặt trước của đồ nên hướng về phía người xem (góc dưới bên phải trong hình). Đang xoay {rot}°.</span>
        </div>
        <label>Tên mẫu <input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Loại <select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Đơn vị của file <select value={unit} onChange={(e) => setUnit(Number(e.target.value))}>{UNITS.map((u, i) => <option key={u.label} value={i}>{u.label}</option>)}</select></label>
        <p className="hint">Kích thước lưu vào kho: {mm.join(' × ')} mm (rộng × sâu × cao). {ok ? '' : 'Ngoài khoảng 50 mm đến 20 m, hãy đổi đơn vị.'}</p>
        <div className="row">
          <button className="btn" onClick={props.onClose}>Đóng</button>
          <button className="btn-cta" disabled={!ok} onClick={save}>Lưu vào kho mẫu</button>
        </div>
      </div>
    </div>
  )
}
