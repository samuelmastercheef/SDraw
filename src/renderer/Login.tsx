import { useState } from 'react'
import type { Settings } from '../preload/api'
import { DEFAULT_SERVER_URL } from '@core/server'

const errText = (d: unknown): string => (d as { error?: string })?.error ?? 'Đăng nhập không được'

const POINTS: [string, string][] = [
  ['Mẫu của bạn ở lại trên máy', 'File .skp và ảnh gốc không bị tải lên.'],
  ['Dữ liệu riêng dùng được khi mất mạng', 'Gợi ý từ hệ thống và hiểu yêu cầu cần có mạng.'],
  ['Xuất bản vẽ và file dựng sẵn', 'DXF, bảng kê Excel, kế hoạch dựng cho SketchUp và Home Assistant.']
]

/** Màn đăng nhập đầu tiên: tài khoản Socin, hoặc mở ngoại tuyến với dữ liệu riêng. */
export function LoginScreen(props: { settings: Settings; update: (p: Partial<Settings>) => Promise<Settings>; onOffline: () => void; linking?: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const login = async () => {
    setBusy(true); setError('')
    try {
      await props.update({ serverUrl: props.settings.serverUrl || DEFAULT_SERVER_URL })
      const res = await window.sdraw.net('POST', '/v1/auth/login', { username: email, password })
      setPassword('')
      if (res.status !== 200) { setError(errText(res.data)); return }
      const d = res.data as { token: string; user: NonNullable<Settings['user']> }
      await props.update({ token: d.token, user: d.user })
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <div className="login-screen">
      <section className="login-brand">
        <div className="login-logo">Sdraw AI</div>
        <div className="grow" />
        <h1>Từ yêu cầu của khách đến bản vẽ phác thảo trong vài phút.</h1>
        <ol className="login-points">
          {POINTS.map(([t, d], i) => (
            <li key={t}><span className="login-num">{i + 1}</span><div><strong>{t}</strong><div>{d}</div></div></li>
          ))}
        </ol>
      </section>
      <section className="login-form">
        <form onSubmit={(e) => { e.preventDefault(); void login() }}>
          <div><h2>{props.linking ? 'Liên kết tài khoản Socin' : 'Đăng nhập'}</h2><p className="muted">{props.linking ? 'Liên kết để lưu mô hình lên Socin, dùng chung trong doanh nghiệp, mở Store và gợi ý từ hệ thống. Dữ liệu trên máy vẫn giữ nguyên.' : 'Dùng tài khoản socin.org của doanh nghiệp bạn.'}</p></div>
          <div className="field"><label htmlFor="le">Tên đăng nhập</label><div className="input-wrap"><input id="le" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div></div>
          <div className="field"><label htmlFor="lp">Mật khẩu</label><div className="input-wrap"><input id="lp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div></div>
          {error ? <p className="login-error" role="alert">{error}</p> : null}
          <button className="btn-cta login-cta" type="submit" disabled={busy || !email.trim() || !password}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập với Socin'}</button>
          <p className="hint">Mật khẩu chỉ được gửi để xác nhận với Socin, app không lưu lại.</p>
          <div className="login-or"><span>hoặc</span></div>
          <button type="button" className="btn login-offline" onClick={props.onOffline}>{props.linking ? 'Tiếp tục ngoại tuyến' : 'Mở ngoại tuyến với dữ liệu riêng'}</button>
          <p className="hint">Dùng được khi không có mạng, app nhớ lựa chọn này. Dựng hình, bản vẽ, xuất file và cổng AI trên máy vẫn dùng đủ. Gợi ý từ hệ thống, Store, lưu lên Socin và tạo ảnh qua Socin sẽ tắt cho đến khi bạn liên kết tài khoản (nút "Ngoại tuyến · Liên kết Socin" ở thanh trên).</p>
          <div className="notice-card warn"><strong>Chưa được cấp quyền?</strong> Nếu đăng nhập báo tài khoản chưa có quyền, hãy nhờ chủ doanh nghiệp bật quyền "Sdraw AI" cho bạn trong phần cài đặt nhân viên.</div>
          <p className="hint">Hệ thống AI tự động học từ dữ liệu và hành vi sử dụng để nâng cấp hệ thống. Dữ liệu của mỗi doanh nghiệp chỉ được giữ trong phạm vi doanh nghiệp đó.</p>
        </form>
      </section>
    </div>
  )
}
