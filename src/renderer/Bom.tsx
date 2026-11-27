import { useMemo } from 'react'
import { buildBom, formatVnd, SOURCE_LABEL } from '@core/bom'
import type { Sample, SdrawDoc } from '@core/types'
import { Section } from './ui'

export function BomPanel(props: {
  doc: SdrawDoc
  catalog: Sample[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const bom = useMemo(() => buildBom(props.doc, props.catalog), [props.doc, props.catalog])

  return (
    <Section title="Bảng kê" right={<span className="hint">Cập nhật theo bản vẽ</span>}>
      {bom.rows.length === 0 ? <p className="hint">Chưa có món nào trong bản vẽ.</p> : null}
      <ul className="bom">
        {bom.rows.map((r) => (
          <li key={r.itemId}>
            <button
              className={r.itemId === props.selectedId ? 'bom-row sel' : 'bom-row'}
              onClick={() => props.onSelect(r.itemId)}
            >
              <span className="bom-name">{r.name}</span>
              <span className={r.unitPrice == null ? 'bom-price blank' : 'bom-price'}>
                {r.unitPrice == null ? 'Chưa báo giá' : formatVnd(r.unitPrice)}
              </span>
              <span className={`tag src-${r.source}`}>{SOURCE_LABEL[r.source]}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="bom-total">
        <span>Tạm tính</span>
        <span>{formatVnd(bom.total)}</span>
      </div>
      {bom.unpriced > 0 ? <p className="hint">Chưa gồm {bom.unpriced} món chưa báo giá.</p> : null}
    </Section>
  )
}
