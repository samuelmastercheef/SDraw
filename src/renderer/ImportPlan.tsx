import { useRef, useState } from 'react'
import { emptyDoc } from '@core/commands'
import { detectPlan } from '@core/planDetect'
import type { Door, SdrawDoc } from '@core/types'
import { isPdfDataUrl, pdfFirstPageToPng } from './pdf'

interface Pt { x: number; y: number }
interface Img { src: string; width: number; height: number; name: string }

/** Nhập mặt bằng 3 bước: chọn file, đặt tỉ lệ bằng 2 điểm, xác nhận kích thước phòng. */
export function ImportPlanView(props: { onCreate: (doc: SdrawDoc) => void; onNotice: (t: string, tone?: 'ok' | 'error') => void }) {
  const [img, setImg] = useState<Img | null>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [scalePts, setScalePts] = useState<Pt[]>([])
  const [realMm, setRealMm] = useState(1000)
  const [roomPts, setRoomPts] = useState<Pt[]>([])
  const [w, setW] = useState(5000)
  const [d, setD] = useState(4000)
  const [name, setName] = useState('')
  const [doors, setDoors] = useState<Omit<Door, 'id'>[]>([])
  const ref = useRef<HTMLImageElement>(null)

  const pick = async () => {
    try {
      const r = await window.sdraw.openReferenceImage()
      if (!r) return
      const i = isPdfDataUrl(r.src) ? { ...(await pdfFirstPageToPng(r.src)), name: r.name } : r
      setImg(i); setName(r.name.replace(/\.[^.]+$/, '')); setScalePts([]); setRoomPts([]); setStep(2)
    } catch (e) { props.onNotice(`Không mở được mặt bằng: ${(e as Error).message}`, 'error') }
  }

  const click = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el || !img) return
    const b = el.getBoundingClientRect()
    const p = { x: ((e.clientX - b.left) / b.width) * img.width, y: ((e.clientY - b.top) / b.height) * img.height }
    if (step === 2) setScalePts((l) => (l.length >= 2 ? [p] : [...l, p]))
    if (step === 3) setRoomPts((l) => (l.length >= 2 ? [p] : [...l, p]))
  }

  const dist = scalePts.length === 2 ? Math.hypot(scalePts[1]!.x - scalePts[0]!.x, scalePts[1]!.y - scalePts[0]!.y) : 0
  const mmPerPx = dist > 0 && realMm > 0 ? realMm / dist : 0

  const toStep3 = () => { setRoomPts([]); setStep(3) }
  const measure = (pts: Pt[]) => {
    setRoomPts(pts)
    if (pts.length === 2 && mmPerPx > 0) {
      setW(Math.max(500, Math.round(Math.abs(pts[1]!.x - pts[0]!.x) * mmPerPx / 10) * 10))
      setD(Math.max(500, Math.round(Math.abs(pts[1]!.y - pts[0]!.y) * mmPerPx / 10) * 10))
    }
  }
  const onClickStep3 = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el || !img) return
    const b = el.getBoundingClientRect()
    const p = { x: ((e.clientX - b.left) / b.width) * img.width, y: ((e.clientY - b.top) / b.height) * img.height }
    setDoors([])
    measure(roomPts.length >= 2 ? [p] : [...roomPts, p])
  }

  /** Tìm tường và cửa trên ảnh; chỉ là gợi ý, người dùng kiểm tra lại số đo. */
  const auto = async () => {
    if (!img || mmPerPx <= 0) return
    try {
      const el = new Image()
      el.src = img.src
      await el.decode()
      const k = Math.min(1, 1600 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k))
      const g = c.getContext('2d', { willReadFrequently: true })
      if (!g) throw new Error('Không đọc được ảnh')
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
      g.drawImage(el, 0, 0, c.width, c.height)
      const px = g.getImageData(0, 0, c.width, c.height).data
      const lum = new Uint8ClampedArray(c.width * c.height)
      for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!
      const r = detectPlan({ width: c.width, height: c.height, data: lum }, mmPerPx / k)
      if (!r) { props.onNotice('Chưa nhận được bốn tường rõ ràng. Hãy bấm 2 góc phòng bằng tay.', 'error'); return }
      measure([{ x: r.x0 / k, y: r.y0 / k }, { x: r.x1 / k, y: r.y1 / k }])
      setDoors(r.doors)
      props.onNotice(`Nhận được phòng và ${r.doors.length} cửa. Hãy kiểm tra lại số đo trước khi tạo.`)
    } catch (e) { props.onNotice(`Không nhận được mặt bằng: ${(e as Error).message}`, 'error') }
  }

  const pct = (p: Pt) => ({ left: `${(p.x / (img?.width ?? 1)) * 100}%`, top: `${(p.y / (img?.height ?? 1)) * 100}%` })
  const rect = roomPts.length === 2
    ? { left: `${(Math.min(roomPts[0]!.x, roomPts[1]!.x) / img!.width) * 100}%`, top: `${(Math.min(roomPts[0]!.y, roomPts[1]!.y) / img!.height) * 100}%`, width: `${(Math.abs(roomPts[1]!.x - roomPts[0]!.x) / img!.width) * 100}%`, height: `${(Math.abs(roomPts[1]!.y - roomPts[0]!.y) / img!.height) * 100}%` }
    : null

  const create = async () => {
    const base = emptyDoc(name.trim() || 'Dự án từ mặt bằng', w, d)
    // Chỉ giữ cửa còn nằm gọn trên tường sau khi người dùng chỉnh số đo.
    const fit = doors.filter((x) => x.offsetMm >= 0 && x.offsetMm + x.widthMm <= (x.wall === 'top' || x.wall === 'bottom' ? w : d))
    const doc = { ...base, doors: fit.map((x, i) => ({ ...x, id: `door-${Date.now().toString(36)}-${i}` })) }
    // Có đo 2 góc phòng thì giữ vùng đó của ảnh làm nền cho màn Bố cục.
    let plan: { src: string } | undefined
    if (img && roomPts.length === 2) {
      try { plan = await cropPlan(img, roomPts as [Pt, Pt]) } catch { props.onNotice('Không giữ được ảnh nền, dự án vẫn được tạo', 'error') }
    }
    props.onCreate(plan ? { ...doc, plan } : doc)
  }

  return (
    <div className="page">
      <h2>Nhập mặt bằng</h2>
      <ol className="steps" aria-label="Các bước">
        {['Chọn file', 'Đặt tỉ lệ', 'Xác nhận phòng'].map((t, i) => <li key={t} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}>{i + 1}. {t}</li>)}
      </ol>
      {step === 1 ? (
        <section>
          <p>Chọn ảnh mặt bằng (PNG, JPG) hoặc PDF. File chỉ được xử lý trên máy này.</p>
          <button className="btn-cta" onClick={() => void pick()}>Chọn file…</button>
        </section>
      ) : null}
      {img && step > 1 ? (
        <>
          <div className="plan-wrap" onClick={step === 2 ? click : onClickStep3}>
            <img ref={ref} src={img.src} alt={img.name} draggable={false} />
            {(step === 2 ? scalePts : roomPts).map((p, i) => <span key={i} className="pt" style={pct(p)} />)}
            {step === 3 && rect ? <span className="room-rect" style={rect} /> : null}
          </div>
          {step === 2 ? (
            <div className="row">
              <p className="hint">Bấm 2 điểm trên một đoạn có kích thước đã biết (ví dụ chiều rộng cửa hoặc một bức tường).</p>
              <div className="field"><label htmlFor="real">Độ dài thật giữa 2 điểm (mm)</label><div className="input-wrap"><input id="real" type="number" min={1} value={realMm} onChange={(e) => setRealMm(Number(e.target.value))} /></div></div>
              <button className="btn-cta" disabled={mmPerPx <= 0} onClick={toStep3}>Tiếp tục</button>
              <button className="btn" onClick={() => setStep(1)}>Chọn file khác</button>
            </div>
          ) : (
            <div className="row">
              <p className="hint">Bấm 2 góc đối diện của phòng để đo, hoặc nhập kích thước trực tiếp.</p>
              <div className="field"><label htmlFor="pw2">Rộng (mm)</label><div className="input-wrap"><input id="pw2" type="number" min={500} value={w} onChange={(e) => setW(Number(e.target.value))} /></div></div>
              <div className="field"><label htmlFor="pd2">Sâu (mm)</label><div className="input-wrap"><input id="pd2" type="number" min={500} value={d} onChange={(e) => setD(Number(e.target.value))} /></div></div>
              <div className="field"><label htmlFor="pn2">Tên dự án</label><div className="input-wrap"><input id="pn2" value={name} onChange={(e) => setName(e.target.value)} /></div></div>
              <button className="btn-cta" disabled={w < 500 || d < 500} onClick={() => void create()}>Tạo dự án từ mặt bằng</button>
              <button className="btn" onClick={() => void auto()}>Tự nhận phòng và cửa</button>
              {doors.length > 0 ? <span className="hint">{doors.length} cửa nhận được sẽ được thêm vào dự án.</span> : null}
              <button className="btn" onClick={() => setStep(2)}>Quay lại</button>
            </div>
          )}
          <p className="hint">Nút "Tự nhận phòng và cửa" tìm bốn tường và các khoảng hở rộng 0,6 đến 1,5 m trên bản vẽ nét đen nền sáng; ảnh chụp hoặc bản vẽ nhiều chi tiết có thể nhận sai. Nếu bạn đo 2 góc phòng, vùng đó của ảnh được giữ làm nền mờ trong màn Bố cục để đối chiếu. Cửa đặt trong màn Bố cục.</p>
        </>
      ) : null}
    </div>
  )
}

const PLAN_MAX_PX = 1600

/** Cắt vùng phòng (2 góc đối diện, toạ độ điểm ảnh gốc) và thu nhỏ thành JPEG để lưu cùng dự án. */
export async function cropPlan(img: Img, pts: [Pt, Pt]): Promise<{ src: string }> {
  const x = Math.max(0, Math.min(pts[0].x, pts[1].x)), y = Math.max(0, Math.min(pts[0].y, pts[1].y))
  const w = Math.min(img.width - x, Math.abs(pts[1].x - pts[0].x)), h = Math.min(img.height - y, Math.abs(pts[1].y - pts[0].y))
  if (w < 4 || h < 4) throw new Error('Vùng phòng quá nhỏ')
  const el = new Image()
  el.src = img.src
  await el.decode()
  const k = Math.min(1, PLAN_MAX_PX / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
  const g = c.getContext('2d')
  if (!g) throw new Error('Không vẽ được ảnh')
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(el, x, y, w, h, 0, 0, c.width, c.height)
  return { src: c.toDataURL('image/jpeg', 0.8) }
}
