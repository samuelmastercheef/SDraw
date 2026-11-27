/** Bảng "AI và Skill" trong màn Dựng 3D: bật cổng MCP cho AI, câu lệnh kết nối, chạy và xoá skill. */
import { useCallback, useEffect, useState } from 'react'
import type { Skill } from '@core/skills'
import type { AiGatewayStatus } from '../preload/api'

export function AiPanel(props: { onRunSkill: (s: Skill, params: Record<string, unknown>) => Promise<void>; notify: (t: string, tone?: 'ok' | 'error') => void }) {
  const { notify } = props
  const [st, setSt] = useState<AiGatewayStatus | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [vals, setVals] = useState<Record<string, string>>({})

  const loadSkills = useCallback(() => { window.sdraw.listSkills().then(setSkills).catch(() => setSkills([])) }, [])
  useEffect(() => {
    window.sdraw.aiStatus().then(setSt).catch(() => setSt(null))
    loadSkills()
    const off = window.sdraw.onSkillsChanged(loadSkills)
    // Cập nhật lần gọi gần nhất khi cổng đang bật
    const t = setInterval(() => { window.sdraw.aiStatus().then(setSt).catch(() => undefined) }, 4000)
    return () => { off(); clearInterval(t) }
  }, [loadSkills])

  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).then(() => notify(`Đã sao chép ${what}`)).catch(() => notify('Không sao chép được', 'error'))
  }
  const cli = st ? `claude mcp add --transport http sdraw ${st.url} --header "Authorization: Bearer ${st.token}"` : ''
  const json = st ? JSON.stringify({ mcpServers: { sdraw: { type: 'http', url: st.url, headers: { Authorization: `Bearer ${st.token}` } } } }, null, 2) : ''

  const pick = (s: Skill) => {
    setOpen(open === s.id ? null : s.id)
    setVals(Object.fromEntries(s.params.map((p) => [p.name, String(p.default)])))
  }
  const run = async (s: Skill) => {
    const params = Object.fromEntries(s.params.map((p) => [p.name, typeof p.default === 'number' ? Number(vals[p.name]) : vals[p.name]]))
    await props.onRunSkill(s, params)
  }

  return (
    <>
      <h3>AI và Skill</h3>
      <label className="check ai-toggle">
        <input type="checkbox" checked={!!st?.enabled} onChange={(e) => { window.sdraw.aiSetEnabled(e.target.checked).then(setSt).catch((err: Error) => notify(err.message, 'error')) }} />
        Cho AI kết nối (MCP)
      </label>
      {st?.enabled && (
        <div className="ai-box">
          <p className="hint">{st.running ? `Đang mở ở ${st.url}, chỉ máy này kết nối được.` : `Chưa mở được cổng${st.error ? `: ${st.error}` : ''}.`}</p>
          {st.lastCall && <p className="hint">Lệnh gần nhất: {st.lastCall}</p>}
          <div className="chips">
            <button className="chip" onClick={() => copy(cli, 'lệnh cho Claude Code')}>Chép lệnh Claude Code</button>
            <button className="chip" onClick={() => copy(json, 'cấu hình JSON')}>Chép cấu hình JSON</button>
            <button className="chip" onClick={() => { window.sdraw.aiNewToken().then((s) => { setSt(s); notify('Đã đổi mã khoá. AI cũ cần kết nối lại.') }).catch(() => undefined) }}>Đổi mã khoá</button>
          </div>
        </div>
      )}
      <h4 className="model3d-sub">Skill</h4>
      <ul className="skill-list">
        {skills.map((s) => (
          <li key={s.id}>
            <div className="skill-row">
              <button className="linkish skill-name" title={s.description} onClick={() => pick(s)}>{s.name}</button>
              {!s.builtin && <button className="linkish" aria-label={`Xoá skill ${s.name}`} onClick={() => { void window.sdraw.deleteSkill(s.id).then(loadSkills) }}>Xoá</button>}
            </div>
            {open === s.id && (
              <div className="skill-form">
                <p className="hint">{s.description}</p>
                {s.params.map((p) => (
                  <label key={p.name} className="skill-param"><span>{p.label ?? p.name}</span>
                    <input value={vals[p.name] ?? ''} inputMode={typeof p.default === 'number' ? 'decimal' : 'text'} onChange={(e) => setVals((v) => ({ ...v, [p.name]: e.target.value }))} />
                  </label>
                ))}
                <button className="chip" onClick={() => void run(s)}>Chạy</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
