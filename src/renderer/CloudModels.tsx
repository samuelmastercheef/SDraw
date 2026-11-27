/**
 * Phần "liên kết Socin" của màn Dựng 3D: lưu và mở mô hình trên Socin, đăng mô hình lên Store.
 * Chỉ hiện khi đã đăng nhập; chế độ ngoại tuyến không gọi mạng.
 */
import { useEffect, useState } from 'react'
import { bounds, isModel3, type Model3 } from '@core/model3d'

const errText = (d: unknown, fallback = 'Có lỗi'): string => (d as { error?: string })?.error ?? fallback

export interface CloudRef { id: string; rev: number }

export interface CloudItem { id: string; name: string; faces: number; rev: number; ownerName: string; updatedAt: number; updatedBy: string }

function newCloudId(): string {
  return `m-${crypto.randomUUID()}`
}

/** Lưu mô hình lên Socin. Có ref thì ghi đè đúng bản đó (kiểm tra rev); asNew thì tạo bản mới. */
export async function saveToCloud(model: Model3, name: string, ref: CloudRef | null, asNew = false): Promise<CloudRef> {
  const id = ref && !asNew ? ref.id : newCloudId()
  const res = await window.sdraw.net('PUT', `/v1/models/${id}`, { name, model, ...(ref && !asNew ? { baseRev: ref.rev } : {}) })
  if (res.status === 409 && ref && !asNew) {
    const e = new Error(errText(res.data)) as Error & { conflict?: boolean }
    e.conflict = true
    throw e
  }
  if (res.status !== 200 && res.status !== 201) throw new Error(errText(res.data, `Lỗi ${res.status}`))
  const d = res.data as { id: string; rev: number }
  return { id: d.id, rev: d.rev }
}

export async function openFromCloud(id: string): Promise<{ model: Model3; name: string; ref: CloudRef }> {
  const res = await window.sdraw.net('GET', `/v1/models/${encodeURIComponent(id)}`)
  if (res.status !== 200) throw new Error(errText(res.data, `Lỗi ${res.status}`))
  const d = res.data as { id: string; name: string; rev: number; model: unknown }
  if (!isModel3(d.model)) throw new Error('Mô hình trên Socin bị hỏng')
  return { model: d.model, name: d.name, ref: { id: d.id, rev: d.rev } }
}

const when = (t: number) => new Date(t).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })

/** Hộp chọn mô hình trên Socin của doanh nghiệp. */
export function CloudOpenDialog(props: { onOpen: (id: string) => void; onClose: () => void; onNotice: (t: string, tone?: 'ok' | 'error') => void }) {
  const [items, setItems] = useState<CloudItem[] | null>(null)
  const load = async () => {
    const res = await window.sdraw.net('GET', '/v1/models')
    if (res.status === 200) setItems((res.data as { items: CloudItem[] }).items)
    else { props.onNotice(errText(res.data), 'error'); setItems([]) }
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const del = async (it: CloudItem) => {
    const res = await window.sdraw.net('DELETE', `/v1/models/${encodeURIComponent(it.id)}`)
    if (res.status === 200) { props.onNotice(`Đã xoá "${it.name}" trên Socin`); void load() }
    else props.onNotice(errText(res.data), 'error')
  }
  return (
    <div className="sheet-modal" role="dialog" aria-label="Mở từ Socin" onClick={props.onClose}>
      <div className="sheet-box cloud-box" onClick={(e) => e.stopPropagation()}>
        <h3>Mô hình trên Socin</h3>
        {items === null ? <p className="hint">Đang tải…</p> : items.length === 0 ? <p className="hint">Doanh nghiệp chưa lưu mô hình nào lên Socin.</p> : (
          <ul className="cloud-list">
            {items.map((it) => (
              <li key={it.id}>
                <div><strong>{it.name}</strong><div className="hint">{it.faces} mặt · sửa {when(it.updatedAt)} bởi {it.updatedBy}</div></div>
                <button className="btn" onClick={() => props.onOpen(it.id)}>Mở</button>
                <button className="btn danger" aria-label={`Xoá ${it.name}`} onClick={() => void del(it)}>Xoá</button>
              </li>
            ))}
          </ul>
        )}
        <div className="row"><span className="grow" /><button className="btn" onClick={props.onClose}>Đóng</button></div>
      </div>
    </div>
  )
}

const CATEGORIES = ['Tủ', 'Kệ', 'Bàn', 'Ghế', 'Giường', 'Sofa', 'Phào chỉ', 'Khác']

/** Đăng mô hình đang mở lên Store: tạo gói nháp, tải tệp .sdraw3d, gửi duyệt. */
export function StorePublishDialog(props: { model: Model3; name: string; onClose: () => void; onNotice: (t: string, tone?: 'ok' | 'error') => void }) {
  const b = bounds(props.model)
  const dim = (i: number) => (b ? Math.max(50, Math.round(b.max[i]! - b.min[i]!)) : 50)
  const [title, setTitle] = useState(props.name)
  const [category, setCategory] = useState('Tủ')
  const [description, setDescription] = useState('')
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const publish = async () => {
    setBusy(true)
    try {
      const c = await window.sdraw.net('POST', '/v1/store/listings', { title: title.trim(), category, w: dim(0), d: dim(1), h: dim(2), description, copyrightConfirmed: true, withFile: true, tags: ['mô hình 3D'] })
      if (c.status !== 201) throw new Error(errText(c.data))
      const id = (c.data as { id: string }).id
      const up = await window.sdraw.storeUploadData(id, `${title.trim() || 'mo-hinh'}.sdraw3d`, JSON.stringify({ format: 'sdraw3d', name: title.trim(), model: props.model }))
      if (up.status !== 200) throw new Error(errText(up.data))
      const sub = await window.sdraw.net('POST', `/v1/store/listings/${id}/submit`)
      if (sub.status !== 200) throw new Error(errText(sub.data))
      props.onNotice('Đã gửi mô hình lên Store, đang chờ duyệt. Xem trạng thái ở Store, mục Gói của tôi.')
      props.onClose()
    } catch (e) { props.onNotice(`Không đăng được: ${(e as Error).message}`, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="sheet-modal" role="dialog" aria-label="Đăng lên Store" onClick={props.onClose}>
      <div className="sheet-box cloud-box" onClick={(e) => e.stopPropagation()}>
        <h3>Đăng mô hình lên Store</h3>
        <div className="field"><label htmlFor="sp-title">Tên gói</label><div className="input-wrap"><input id="sp-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></div></div>
        <div className="field"><label htmlFor="sp-cat">Loại</label><div className="input-wrap"><select id="sp-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div></div>
        <div className="field"><label htmlFor="sp-desc">Mô tả</label><div className="input-wrap"><textarea id="sp-desc" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></div></div>
        <p className="hint">Kích thước tự đo: {dim(0)} × {dim(1)} × {dim(2)} mm. Tệp đăng là mô hình S Draw (.sdraw3d), người mua mở thẳng trong Dựng 3D.</p>
        <label className="check"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />Mô hình do doanh nghiệp tự làm hoặc có quyền đăng</label>
        <div className="row"><span className="grow" /><button className="btn" onClick={props.onClose}>Huỷ</button><button className="btn-cta" disabled={!rights || !title.trim() || busy} onClick={() => void publish()}>{busy ? 'Đang gửi…' : 'Gửi duyệt'}</button></div>
      </div>
    </div>
  )
}
