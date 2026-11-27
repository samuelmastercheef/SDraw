/**
 * Hộp "Tạo hình bằng AI": chọn nhà cung cấp (Tripo, Meshy, Hunyuan3D trên máy, Draw Things), làm theo hướng dẫn
 * kết nối, nhập mô tả hoặc ảnh, nhận GLB vào cảnh. Phần "Công cụ trên máy" tự dò công cụ chưa cài và cài bằng một nút.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { GEN3D_PROVIDERS, providerById, type Gen3dProvider } from '@core/gen3d'
import { localPrompt3d, PROMPT3D_SKILLS, skillById, type Prompt3dResult } from '@core/prompt3d'
import { shrinkImage } from './materialTex'
import type { ToolsStatusMsg, ToolStatusMsg } from '../preload/api'

type Notify = (t: string, tone?: 'ok' | 'error') => void

/** Bỏ tiền tố kỹ thuật của lỗi gọi IPC */
const msg = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')

export function Gen3dDialog(props: {
  onClose: () => void
  onNotice: Notify
  onGlb: (data: Uint8Array, name: string) => void
  /** Dán ảnh làm vân cho mặt đang chọn (nếu có mặt chọn) */
  onTexture?: (dataUrl: string, name: string) => void
}) {
  const [sel, setSel] = useState<Gen3dProvider>(GEN3D_PROVIDERS[0]!)
  const [keys, setKeys] = useState<Record<string, boolean>>({})
  const [tools, setTools] = useState<ToolsStatusMsg | null>(null)
  const [logs, setLogs] = useState<{ t: number; s: string }[]>([])
  const [keyInput, setKeyInput] = useState('')
  const [idea, setIdea] = useState('')
  const [skill, setSkill] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [promptInfo, setPromptInfo] = useState<{ notes: string[]; source: Prompt3dResult['source'] | 'manual' } | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [image, setImage] = useState<{ src: string; name: string } | null>(null)
  const [busy, setBusy] = useState<{ progress: number; text: string } | null>(null)
  const [preview, setPreview] = useState<{ dataUrl: string; name: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    const [g, t] = await Promise.all([window.sdraw.gen3dStatus(), window.sdraw.toolsStatus()])
    setKeys(Object.fromEntries(g.providers.map((p) => [p.id, p.hasKey])))
    setTools(t)
    setLogs(await window.sdraw.toolsLogs())
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  // Đang cài thì hỏi tiến độ đều đặn
  useEffect(() => {
    const loading = tools?.hunyuanRunning && tools.tools.find((x) => x.id === 'hunyuan')?.service !== 'running'
    if (!tools?.job?.running && !loading) return
    const h = setInterval(() => void refresh(), 1500)
    return () => clearInterval(h)
  }, [tools, refresh])
  useEffect(() => window.sdraw.onGen3dProgress((p) => setBusy({ progress: p.progress, text: p.text })), [])
  useEffect(() => window.sdraw.onToolsError((m) => props.onNotice(m, 'error')), []) // eslint-disable-line react-hooks/exhaustive-deps

  const toolOf = (id?: string): ToolStatusMsg | undefined => (id ? tools?.tools.find((t) => t.id === id) : undefined)
  const ready = (p: Gen3dProvider): { ok: boolean; label: string } => {
    if (p.where === 'cloud') return keys[p.id] ? { ok: true, label: 'Sẵn sàng' } : { ok: false, label: 'Chưa có khoá' }
    const t = toolOf(p.tool)
    if (!tools) return { ok: false, label: 'Đang kiểm tra…' }
    if (!t) return { ok: false, label: 'Không có trên hệ điều hành này' }
    if (t.service === 'running') return { ok: true, label: 'Đang chạy' }
    if (t.ok) return { ok: false, label: p.id === 'drawthings' ? 'Chưa bật API Server' : 'Chưa chạy' }
    return { ok: false, label: 'Chưa cài' }
  }

  const saveKey = async (clear = false) => {
    try {
      await window.sdraw.gen3dSetKey(sel.id, clear ? null : keyInput)
      setKeyInput(''); props.onNotice(clear ? `Đã xoá khoá ${sel.name}` : `Đã lưu khoá ${sel.name} (mã hoá trên máy này)`); void refresh()
    } catch (e) { props.onNotice(msg(e), 'error') }
  }
  const install = async (ids: string[]) => {
    try { await window.sdraw.toolsInstall(ids); setTimeout(() => void refresh(), 300) } catch (e) { props.onNotice(msg(e), 'error') }
  }
  const hunyuan = async (start: boolean) => {
    try { await (start ? window.sdraw.toolsStartHunyuan() : window.sdraw.toolsStopHunyuan()); props.onNotice(start ? 'Đang chạy máy chủ Hunyuan. Lần đầu sẽ tải mô hình AI, xem nhật ký bên dưới.' : 'Đã dừng máy chủ Hunyuan'); setTimeout(() => void refresh(), 1500) } catch (e) { props.onNotice(msg(e), 'error') }
  }
  const pickImage = (f: File | undefined) => {
    if (!f) return
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { props.onNotice('Ảnh phải là PNG, JPEG hoặc WebP', 'error'); return }
    if (f.size > 20 * 1024 * 1024) { props.onNotice('Ảnh lớn hơn 20 MB', 'error'); return }
    const r = new FileReader()
    r.onload = () => setImage({ src: String(r.result), name: f.name })
    r.readAsDataURL(f)
  }
  const target = sel.output === 'image' ? 'image' as const : 'model' as const
  const withImage = !!(image && sel.inputs.includes('image'))
  /** Soạn nhanh trên máy (khi bấm skill, hoặc khi không có AI Socin) */
  const quickPrompt = (sk: string | null, text = idea) => {
    const r = localPrompt3d({ text, target, provider: sel.name, hasImage: withImage, ...(sk ? { skill: sk } : {}) })
    setPrompt(r.prompt); setPromptInfo({ notes: r.notes, source: 'local' })
  }
  const pickSkill = (id: string) => {
    const next = skill === id ? null : id
    setSkill(next)
    if (next || idea.trim()) quickPrompt(next)
    else { setPrompt(''); setPromptInfo(null) }
  }
  /** Nhờ AI của Socin soạn prompt (kèm ảnh tham chiếu đã thu nhỏ); lỗi mạng thì dùng mẫu trên máy */
  const suggest = async () => {
    setSuggesting(true)
    try {
      const img = withImage ? await shrinkImage(image!.src, 768) : null
      const res = await window.sdraw.net('POST', '/v1/ai/prompt3d', { text: idea.trim(), target, provider: sel.name, ...(skill ? { skill } : {}), ...(img ? { image: img } : {}) })
      const d = res.data as Partial<Prompt3dResult> & { error?: string }
      if (res.status === 200 && typeof d.prompt === 'string') {
        setPrompt(d.prompt); setPromptInfo({ notes: d.notes ?? [], source: d.source ?? 'llm' })
        if (d.source === 'local') props.onNotice('Máy chủ Socin chưa bật AI soạn prompt, đã soạn theo mẫu nội thất.')
      } else {
        quickPrompt(skill)
        props.onNotice(`${res.status === 0 || res.status === 401 ? 'Chưa kết nối AI Socin (cần liên kết tài khoản)' : d.error ?? `Lỗi ${res.status}`}. Đã soạn prompt theo mẫu trên máy.`, 'error')
      }
    } catch (e) { quickPrompt(skill); props.onNotice(`Không gọi được AI Socin: ${msg(e)}. Đã soạn theo mẫu trên máy.`, 'error') } finally { setSuggesting(false) }
  }
  const run = async () => {
    const st = ready(sel)
    if (!st.ok) { props.onNotice(`${sel.name}: ${st.label.toLowerCase()}. Làm theo hướng dẫn bên trái.`, 'error'); return }
    setBusy({ progress: 0, text: 'Đang gửi…' }); setPreview(null)
    try {
      const finalPrompt = (prompt.trim() || idea.trim()).slice(0, 1000)
      const r = await window.sdraw.gen3dRun({ provider: sel.id, prompt: finalPrompt, ...(withImage ? { image: image!.src } : {}) })
      if (r.kind === 'glb') { props.onGlb(r.data, r.name); props.onNotice(`Đã đưa mô hình ${sel.name} vào cảnh. Mô hình AI tạo ra là lưới tam giác, dùng Co giãn (S) để chỉnh cỡ.`) }
      else setPreview({ dataUrl: r.dataUrl, name: r.name })
    } catch (e) { props.onNotice(`Không tạo được: ${msg(e)}`, 'error') } finally { setBusy(null) }
  }

  const st = ready(sel)
  const t = toolOf(sel.tool)
  const usesImage = sel.inputs.includes('image')
  const missingAuto = (tools?.tools ?? []).filter((x) => !x.ok && x.auto && !x.optional)

  return (
    <div className="sheet-modal" role="dialog" aria-label="Tạo hình bằng AI" onClick={props.onClose}>
      <div className="sheet-box gen3d-box" onClick={(e) => e.stopPropagation()}>
        <div className="row"><h3 className="grow">Tạo hình 3D bằng AI</h3><button className="btn" onClick={props.onClose}>Đóng</button></div>
        <div className="gen3d-main">
          <ul className="gen3d-providers" role="radiogroup" aria-label="Nhà cung cấp">
            {GEN3D_PROVIDERS.map((p) => {
              const r = ready(p)
              return (
                <li key={p.id}>
                  <button role="radio" aria-checked={sel.id === p.id} className={sel.id === p.id ? 'gen3d-prov on' : 'gen3d-prov'} onClick={() => { setSel(providerById(p.id)!); setKeyInput('') }}>
                    <strong>{p.name}</strong>
                    <span className="hint">{p.where === 'cloud' ? 'Đám mây, cần khoá API' : 'Trên máy, không cần mạng'} · {p.output === 'glb' ? 'ra mô hình 3D' : 'ra ảnh'}</span>
                    <span className={r.ok ? 'gen3d-badge ok' : 'gen3d-badge'}>{r.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <section className="gen3d-detail">
            <p>{sel.desc}</p>
            {!st.ok && (
              <div className="gen3d-guide">
                <strong>Kết nối {sel.name}</strong>
                <ol>{sel.guide.map((g) => <li key={g}>{g}</li>)}</ol>
              </div>
            )}
            {sel.where === 'cloud' && (
              <div className="row">
                <div className="input-wrap grow"><input aria-label={`Khoá API ${sel.name}`} type="password" autoComplete="off" placeholder={keys[sel.id] ? 'Đã có khoá. Dán khoá mới để thay.' : 'Dán khoá API vào đây'} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} /></div>
                <button className="btn" disabled={!keyInput.trim()} onClick={() => void saveKey()}>Lưu khoá</button>
                {keys[sel.id] && <button className="btn danger" onClick={() => void saveKey(true)}>Xoá khoá</button>}
                {sel.keyUrl && <button className="btn" onClick={() => void window.sdraw.toolsOpenUrl(sel.keyUrl!)}>Mở trang lấy khoá</button>}
              </div>
            )}
            {sel.where === 'local' && (
              <div className="row">
                {t && !t.ok && t.auto && <button className="btn-cta" disabled={!!tools?.job?.running} onClick={() => void install([t.id])}>Cài tự động {t.name}</button>}
                {t && !t.ok && !t.auto && t.manual?.url && <button className="btn" onClick={() => void window.sdraw.toolsOpenUrl(t.manual!.url!)}>Mở trang tải</button>}
                {sel.id === 'hunyuan-local' && t?.ok && t.service !== 'running' && <button className="btn-cta" onClick={() => void hunyuan(true)}>Chạy máy chủ Hunyuan</button>}
                {sel.id === 'hunyuan-local' && tools?.hunyuanRunning && <button className="btn" onClick={() => void hunyuan(false)}>Dừng máy chủ</button>}
                <button className="btn" onClick={() => void refresh()}>Kiểm tra lại</button>
              </div>
            )}
            <div className="gen3d-compose">
              <div className="gen3d-skill-head"><strong>Loại sản phẩm</strong><span className="hint">Bấm một loại để thêm bộ phận, vật liệu và kích thước chuẩn vào prompt</span></div>
              <div className="gen3d-skills" role="group" aria-label="Skill loại sản phẩm">
                {PROMPT3D_SKILLS.map((k) => (
                  <button key={k.id} className={skill === k.id ? 'chip on' : 'chip'} aria-pressed={skill === k.id} title={`${k.size.join(' × ')} mm`} onClick={() => pickSkill(k.id)}>{k.label}</button>
                ))}
              </div>
              <div className="field"><label htmlFor="g3-idea">{sel.output === 'image' ? 'Ý tưởng ảnh' : 'Ý tưởng'} {skill && <span className="hint">· {skillById(skill)!.label}</span>}</label>
                <div className="gen3d-frame"><textarea id="g3-idea" rows={2} maxLength={600} placeholder={sel.output === 'image' ? 'Ví dụ: vân gỗ óc chó, hoặc ảnh sản phẩm sofa nỉ xám' : 'Ví dụ: 3 chỗ bọc nỉ xám, chân gỗ sồi, dài 2m2, phong cách Bắc Âu'} value={idea} onChange={(e) => setIdea(e.target.value)} /></div>
              </div>
              <div className="row">
                <button className="btn" disabled={suggesting || (!idea.trim() && !skill && !withImage)} onClick={() => void suggest()}>{suggesting ? 'AI Socin đang soạn…' : 'Đề xuất prompt bằng AI Socin'}</button>
                <button className="btn" disabled={!idea.trim() && !skill} onClick={() => quickPrompt(skill)}>Soạn nhanh trên máy</button>
              </div>
              <div className="field"><label htmlFor="g3-prompt">Prompt gửi cho {sel.name} <span className="hint">(sửa được{promptInfo ? ` · ${promptInfo.source === 'llm' ? 'AI Socin soạn' : promptInfo.source === 'local' ? 'mẫu nội thất trên máy' : 'tự gõ'}` : ''})</span></label>
                <div className="gen3d-frame strong"><textarea id="g3-prompt" rows={4} maxLength={1000} placeholder="Bấm loại sản phẩm hoặc Đề xuất prompt, hoặc tự gõ prompt tiếng Anh" value={prompt} onChange={(e) => { setPrompt(e.target.value); setPromptInfo((p) => (p ? { ...p, source: 'manual' } : { notes: [], source: 'manual' })) }} /></div>
              </div>
              {promptInfo && promptInfo.notes.length > 0 && <ul className="gen3d-notes">{promptInfo.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            </div>
            {usesImage && (
              <div className="row gen3d-image">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
                <button className="btn" onClick={() => fileRef.current?.click()}>{image ? 'Đổi ảnh…' : 'Chọn ảnh…'}</button>
                {image && <><img src={image.src} alt={image.name} /><span className="hint grow">{image.name}</span><button className="btn" onClick={() => setImage(null)}>Bỏ ảnh</button></>}
                {!image && <span className="hint">Ảnh một món đồ, nền trơn, chụp chéo góc cho kết quả tốt nhất.</span>}
              </div>
            )}
            <div className="row">
              {busy ? (
                <>
                  <div className="gen3d-progress grow" role="progressbar" aria-valuenow={busy.progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${busy.progress}%` }} /><em>{busy.text}</em></div>
                  <button className="btn" onClick={() => void window.sdraw.gen3dCancel()}>Huỷ</button>
                </>
              ) : (
                <><span className="grow hint">{sel.where === 'cloud' ? 'Mỗi lượt tạo tính phí vào tài khoản của bạn ở ' + sel.name + '.' : 'Chạy trên máy, không gửi ảnh ra ngoài.'}</span>
                  <button className="btn-cta" disabled={!prompt.trim() && !idea.trim() && !withImage} onClick={() => void run()}>{sel.output === 'image' ? 'Vẽ ảnh' : 'Tạo mô hình'}</button></>
              )}
            </div>
            {preview && (
              <div className="gen3d-preview">
                <img src={preview.dataUrl} alt="Ảnh vừa vẽ" />
                <div className="chips">
                  <button className="chip" onClick={() => { setImage({ src: preview.dataUrl, name: preview.name }); setSel(providerById(keys['tripo'] ? 'tripo' : keys['meshy'] ? 'meshy' : 'hunyuan-local')!) }}>Dùng ảnh này để dựng 3D</button>
                  {props.onTexture && <button className="chip" onClick={() => props.onTexture!(preview.dataUrl, idea.trim() || 'Vân AI')}>Dán làm vân cho mặt đang chọn</button>}
                </div>
              </div>
            )}
          </section>
        </div>
        <details className="gen3d-tools" open={!!tools?.job || (tools?.missing.length ?? 0) > 0}>
          <summary>Công cụ trên máy {tools ? (tools.missing.length ? `· thiếu ${tools.missing.length}` : '· đủ') : ''}</summary>
          {tools && !tools.supported && <p className="hint">Tự cài chỉ hỗ trợ Mac và Windows.</p>}
          {missingAuto.length > 1 && <button className="btn" disabled={!!tools?.job?.running} onClick={() => void install(missingAuto.map((x) => x.id))}>Cài tất cả công cụ còn thiếu ({missingAuto.length})</button>}
          <ul className="gen3d-toollist">
            {(tools?.tools ?? []).map((x) => (
              <li key={x.id}>
                <span className={x.ok ? 'gen3d-dot ok' : 'gen3d-dot'} aria-hidden="true" />
                <div className="grow">
                  <strong>{x.name}</strong>{x.optional && <span className="hint"> (tuỳ chọn)</span>}
                  <div className="hint">{x.ok ? `${x.where}${x.note ? ` · ${x.note}` : ''}` : x.desc}{!x.ok && x.heavy ? ` · ${x.heavy}` : ''}</div>
                  {!x.ok && x.manual && <div className="hint">{x.manual.text}{x.manual.cmd && <code className="gen3d-cmd">{x.manual.cmd}</code>}</div>}
                </div>
                {!x.ok && x.auto && <button className="btn" disabled={!!tools?.job?.running} onClick={() => void install([x.id])}>{tools?.job?.current === x.id ? 'Đang cài…' : 'Cài tự động'}</button>}
                {!x.ok && x.manual?.cmd && <button className="btn" onClick={() => void navigator.clipboard.writeText(x.manual!.cmd!)}>Chép lệnh</button>}
                {!x.ok && x.manual?.url && <button className="btn" onClick={() => void window.sdraw.toolsOpenUrl(x.manual!.url!)}>Mở hướng dẫn</button>}
              </li>
            ))}
          </ul>
          {logs.length > 0 && <pre className="gen3d-log" aria-label="Nhật ký cài đặt">{logs.slice(-80).map((l) => l.s).join('\n')}</pre>}
        </details>
      </div>
    </div>
  )
}
