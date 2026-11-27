import { useEffect, useId, useState, type ReactNode } from 'react'

/** Ô nhập số: chỉ ghi vào bản vẽ khi rời ô hoặc nhấn Enter, để Hoàn tác không bị đầy. */
export function NumberField(props: {
  label: string
  value: number
  onCommit: (v: number) => void
  min?: number
  step?: number
  suffix?: string
}) {
  const id = useId()
  const [text, setText] = useState(String(props.value))
  useEffect(() => setText(String(props.value)), [props.value])

  const commit = () => {
    const n = Number(text.replace(',', '.'))
    if (!Number.isFinite(n) || (props.min != null && n < props.min)) {
      setText(String(props.value))
      return
    }
    if (n !== props.value) props.onCommit(n)
  }

  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <div className="input-wrap">
        <input
          id={id}
          inputMode="decimal"
          value={text}
          step={props.step}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setText(String(props.value))
          }}
        />
        {props.suffix ? <span className="suffix">{props.suffix}</span> : null}
      </div>
    </div>
  )
}

export function TextAreaField(props: { label: string; value: string; onCommit: (v: string) => void; rows?: number; placeholder?: string }) {
  const id = useId()
  const [text, setText] = useState(props.value)
  useEffect(() => setText(props.value), [props.value])
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <textarea
        id={id}
        className="area"
        rows={props.rows ?? 3}
        value={text}
        placeholder={props.placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== props.value && props.onCommit(text)}
      />
    </div>
  )
}

export function TextField(props: { label: string; value: string; onCommit: (v: string) => void }) {
  const id = useId()
  const [text, setText] = useState(props.value)
  useEffect(() => setText(props.value), [props.value])
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <div className="input-wrap">
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== props.value && props.onCommit(text)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
    </div>
  )
}

export function Switch(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="switch-row">
      <span>
        <span className="switch-label">{props.label}</span>
        {props.hint ? <span className="hint">{props.hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        className={props.checked ? 'switch on' : 'switch'}
        onClick={() => props.onChange(!props.checked)}
      >
        <span />
      </button>
    </div>
  )
}

export function Section(props: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">{props.title}</span>
        {props.right}
      </div>
      {props.children}
    </section>
  )
}
