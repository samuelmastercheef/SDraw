import { useCallback, useEffect, useState } from 'react'
import { Cover, shrinkCover } from './Cover'
import { WAREHOUSE_NOTE } from './Warehouse'
import type { Sample } from '@core/types'

type Notify = (text: string, tone?: 'ok' | 'error') => void
const errText = (d: unknown): string => (d as { error?: string })?.error ?? 'Có lỗi xảy ra'

interface Mine { id: string; title: string; category: string; status: 'draft' | 'pending' | 'approved' | 'rejected'; hasFile: boolean; hasCover: boolean; fileName: string | null; fileSize: number; rejectReason: string | null }

const STATUS: Record<Mine['status'], { label: string; cls: string }> = {
  draft: { label: 'Nháp', cls: 'badge' },
  pending: { label: 'Chờ duyệt', cls: 'badge warn' },
  approved: { label: 'Đang bán', cls: 'badge ok' },
  rejected: { label: 'Bị từ chối', cls: 'badge bad' }
}
const mb = (n: number) => `${(n / 1048576).toFixed(1).replace('.', ',')} MB`

/** Đăng bán mẫu kèm file .skp. Chỉ file được chọn ở đây mới rời khỏi máy; các mẫu khác của doanh nghiệp vẫn ở lại. */
export function StoreSellView(props: { catalog: Sample[]; onBack: () => void; onNotice: Notify }) {
  const own = props.catalog.filter((s) => s.origin !== 'store')
  const [mine, setMine] = useState<Mine[]>([])
  const [sampleId, setSampleId] = useState(own[0]?.id ?? '')
  const [title, setTitle] = useState(own[0]?.name ?? '')
  const [desc, setDesc] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const sample = own.find((x) => x.id === sampleId)

  const load = useCallback(async () => {
    const r = await window.sdraw.net('GET', '/v1/store/mine')
    if (r.status === 200) setMine((r.data as { items: Mine[] }).items)
    else props.onNotice(errText(r.data), 'error')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])

  const pickSample = (id: string) => {
    setSampleId(id)
    setTitle(own.find((x) => x.id === id)?.name ?? '')
  }

  const create = async () => {
    if (!sample) return
    setBusy(true)
    try {
      const r = await window.sdraw.net('POST', '/v1/store/listings', {
        title: title.trim() || sample.name, category: sample.category, w: sample.w, d: sample.d, h: sample.h,
        tags: sample.tags ?? [], styles: sample.styles ?? [], materials: sample.materials ?? [], description: desc, copyrightConfirmed: ok, withFile: true
      })
      if (r.status !== 201) return props.onNotice(errText(r.data), 'error')
      props.onNotice('Đã tạo gói nháp. Chọn "Tải file .skp" để đính kèm file rồi gửi duyệt.')
      setOk(false)
      await load()
    } finally { setBusy(false) }
  }

  const upload = async (m: Mine) => {
    setBusy(true)
    try {
      const r = await window.sdraw.storeUploadFile(m.id)
      if (!r) return
      if (r.status === 200) props.onNotice('Đã tải file lên. Bấm "Gửi duyệt" khi sẵn sàng.')
      else props.onNotice(errText(r.data), 'error')
      await load()
    } finally { setBusy(false) }
  }
  const [bust, setBust] = useState(0)
  const cover = async (m: Mine) => {
    setBusy(true)
    try {
      const img = await window.sdraw.openReferenceImage()
      if (!img || img.src.startsWith('data:application/pdf')) return
      const r = await window.sdraw.storePutCover(m.id, await shrinkCover(img.src))
      props.onNotice(r.status === 200 ? 'Đã cập nhật ảnh bìa' : errText(r.data), r.status === 200 ? 'ok' : 'error')
      setBust((n) => n + 1)
      await load()
    } catch (e) { props.onNotice(`Không đặt được ảnh bìa: ${(e as Error).message}`, 'error') } finally { setBusy(false) }
  }
  const submit = async (m: Mine) => {
    const r = await window.sdraw.net('POST', `/v1/store/listings/${m.id}/submit`)
    props.onNotice(r.status === 200 ? 'Đã gửi duyệt. Gói hiển thị trên Store sau khi được duyệt.' : errText(r.data), r.status === 200 ? 'ok' : 'error')
    await load()
  }
  const remove = async (m: Mine) => {
    const r = await window.sdraw.net('DELETE', `/v1/store/listings/${m.id}`)
    props.onNotice(r.status === 200 ? `Đã gỡ "${m.title}" và xoá file khỏi máy chủ` : errText(r.data), r.status === 200 ? 'ok' : 'error')
    await load()
  }

  return (
    <div className="page">
      <div className="row"><button className="btn" onClick={props.onBack}>← Về Store</button><h2>Đăng bán mẫu của tôi</h2></div>
      <div className="notice-card">Khi gửi duyệt, <strong>file .skp của gói đó</strong> được tải lên máy chủ để người mua tải về. Các mẫu khác của bạn vẫn ở lại trên máy. Gói được kiểm duyệt trước khi hiển thị; gỡ gói sẽ xoá file khỏi máy chủ.</div>

      <h3>Gói của doanh nghiệp ({mine.length})</h3>
      {mine.length === 0 ? <p className="hint">Chưa có gói nào.</p> : null}
      <ul className="cards">
        {mine.map((m) => (
          <li key={m.id} className="card">
            <Cover id={m.id} has={m.hasCover} alt={m.title} bust={bust} />
            <span className="row between"><strong>{m.title}</strong><span className={STATUS[m.status].cls}>{STATUS[m.status].label}</span></span>
            <span className="muted">{m.category} · {m.hasFile ? `${m.fileName} (${mb(m.fileSize)})` : 'chưa có file .skp'}</span>
            {m.status === 'rejected' && m.rejectReason ? <span className="reject">Lý do: {m.rejectReason}</span> : null}
            <span className="row">
              {m.status === 'draft' || m.status === 'rejected' ? <button className="btn" disabled={busy} onClick={() => void upload(m)}>{m.hasFile ? 'Đổi file .skp' : 'Tải file .skp'}</button> : null}
              {m.status === 'draft' || m.status === 'rejected' ? <button className="btn" disabled={busy} onClick={() => void cover(m)}>{m.hasCover ? 'Đổi ảnh bìa' : 'Ảnh bìa'}</button> : null}
              {(m.status === 'draft' || m.status === 'rejected') && m.hasFile ? <button className="btn-cta" onClick={() => void submit(m)}>Gửi duyệt</button> : null}
              <button className="btn-ghost danger" onClick={() => void remove(m)}>Gỡ</button>
            </span>
          </li>
        ))}
      </ul>

      <h3>Tạo gói mới (một mẫu, một file .skp)</h3>
      {own.length === 0 ? <p className="hint">Thư viện chưa có mẫu của doanh nghiệp để đăng.</p> : (
        <>
          <div className="field"><label htmlFor="ss">Mẫu từ thư viện của bạn</label><div className="input-wrap"><select id="ss" value={sampleId} onChange={(e) => pickSample(e.target.value)}>{own.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.category})</option>)}</select></div></div>
          <div className="field"><label htmlFor="st">Tên gói</label><div className="input-wrap"><input id="st" value={title} onChange={(e) => setTitle(e.target.value)} /></div></div>
          <div className="field"><label htmlFor="sd">Mô tả</label><div className="input-wrap"><textarea id="sd" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></div></div>
          <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />Mẫu do doanh nghiệp tự làm hoặc có quyền đăng bán</label>
          <p className="notice-card">{WAREHOUSE_NOTE} Mẫu lấy từ nguồn khác cũng cần có giấy phép cho phép bán lại.</p>
          <p className="hint">Giai đoạn đầu Store miễn phí. Giá và đường dẫn trên máy bạn không được gửi đi.</p>
          <div className="row"><button className="btn-cta" disabled={!ok || !sample || busy} onClick={() => void create()}>Tạo gói nháp</button></div>
        </>
      )}
    </div>
  )
}
