import { patchItem } from '@core/commands'
import type { Door, Item, SdrawDoc, WallSide, Window } from '@core/types'
import { newId } from '@core/commands'
import { NumberField, Section, Switch, TextField } from './ui'

interface Props {
  doc: SdrawDoc
  item: Item | null
  onEdit: (doc: SdrawDoc) => void
  onSelect: (id: string | null) => void
}

const WALLS: Array<[WallSide, string]> = [
  ['top', 'Tường trên'],
  ['right', 'Tường phải'],
  ['bottom', 'Tường dưới'],
  ['left', 'Tường trái']
]

export function Inspector({ doc, item, onEdit, onSelect }: Props) {
  if (!item) return <RoomPanel doc={doc} onEdit={onEdit} />

  const patch = (p: Partial<Item>) => onEdit(patchItem(doc, item.id, p))

  return (
    <Section
      title="Món đang chọn"
      right={
        <button className="btn-ghost danger" onClick={() => {
          onEdit({ ...doc, items: doc.items.filter((i) => i.id !== item.id) })
          onSelect(null)
        }}>
          Xoá món
        </button>
      }
    >
      <div className="item-title">{item.name}</div>
      <div className="grid-2">
        <NumberField label="Rộng (mm)" value={item.w} min={50} onCommit={(w) => patch({ w })} />
        <NumberField label="Sâu (mm)" value={item.d} min={50} onCommit={(d) => patch({ d })} />
        <NumberField label="Tâm X (mm)" value={item.cx} onCommit={(cx) => patch({ cx })} />
        <NumberField label="Tâm Y (mm)" value={item.cy} onCommit={(cy) => patch({ cy })} />
        <NumberField
          label="Xoay (độ)"
          value={item.rotation}
          onCommit={(r) => patch({ rotation: ((r % 360) + 360) % 360 })}
        />
        <TextField label="Vật liệu" value={item.material} onCommit={(material) => patch({ material })} />
      </div>
      <div className="row-gap">
        <button className="btn" onClick={() => patch({ rotation: (item.rotation + 90) % 360 })}>
          Xoay 90°
        </button>
      </div>
      <Switch
        label="Khoá món này"
        hint="AI không được sửa hoặc di chuyển. Bạn vẫn sửa tay được."
        checked={item.locked}
        onChange={(locked) => patch({ locked })}
      />

      <div className="field">
        <label htmlFor="price-mode">Giá</label>
        <select
          id="price-mode"
          value={item.priceMode}
          onChange={(e) => patch({ priceMode: e.target.value as Item['priceMode'] })}
        >
          <option value="list">Theo bảng giá doanh nghiệp</option>
          <option value="manual">Nhập tay</option>
          <option value="blank">Để trống (chưa báo giá)</option>
        </select>
      </div>
      {item.priceMode === 'manual' ? (
        <NumberField
          label="Giá nhập tay (đ)"
          value={item.manualPrice ?? 0}
          min={0}
          onCommit={(manualPrice) => patch({ manualPrice })}
        />
      ) : null}
    </Section>
  )
}

function RoomPanel({ doc, onEdit }: { doc: SdrawDoc; onEdit: (doc: SdrawDoc) => void }) {
  const setDoor = (id: string, p: Partial<Door>) =>
    onEdit({ ...doc, doors: doc.doors.map((d) => (d.id === id ? { ...d, ...p } : d)) })

  const windows = doc.windows ?? []
  const setWindow = (id: string, p: Partial<Window>) =>
    onEdit({ ...doc, windows: windows.map((w) => (w.id === id ? { ...w, ...p } : w)) })

  return (
    <Section title="Phòng">
      <TextField label="Tên bản vẽ" value={doc.name} onCommit={(name) => onEdit({ ...doc, name })} />
      <TextField label="Area Home Assistant (tuỳ chọn)" value={doc.haArea ?? ''} onCommit={(haArea) => onEdit({ ...doc, haArea: haArea.trim() || undefined })} />
      <p className="hint">Nhập đúng tên Area trong Home Assistant (ví dụ "Phòng khách") để NeonPlan tự gắn đèn, rèm và cảm biến của phòng này.</p>
      <div className="grid-2">
        <NumberField
          label="Rộng (mm)"
          value={doc.room.widthMm}
          min={1000}
          onCommit={(widthMm) => onEdit({ ...doc, room: { ...doc.room, widthMm } })}
        />
        <NumberField
          label="Sâu (mm)"
          value={doc.room.depthMm}
          min={1000}
          onCommit={(depthMm) => onEdit({ ...doc, room: { ...doc.room, depthMm } })}
        />
      </div>

      <div className="section-head">
        <span className="eyebrow">Cửa ra vào</span>
        <button
          className="btn-ghost"
          onClick={() =>
            onEdit({
              ...doc,
              doors: [...doc.doors, { id: newId('d'), wall: 'bottom', offsetMm: 500, widthMm: 900 }]
            })
          }
        >
          Thêm cửa
        </button>
      </div>
      {doc.doors.length === 0 ? <p className="hint">Chưa có cửa. Thêm cửa để app kiểm tra lối vào.</p> : null}
      {doc.doors.map((d) => (
        <div className="door-row" key={d.id}>
          <select
            aria-label="Tường"
            value={d.wall}
            onChange={(e) => setDoor(d.id, { wall: e.target.value as WallSide })}
          >
            {WALLS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <NumberField label="Cách đầu (mm)" value={d.offsetMm} min={0} onCommit={(offsetMm) => setDoor(d.id, { offsetMm })} />
          <NumberField label="Rộng (mm)" value={d.widthMm} min={400} onCommit={(widthMm) => setDoor(d.id, { widthMm })} />
          <button
            className="btn-ghost danger"
            aria-label="Xoá cửa"
            onClick={() => onEdit({ ...doc, doors: doc.doors.filter((x) => x.id !== d.id) })}
          >
            Xoá
          </button>
        </div>
      ))}

      <div className="section-head">
        <span className="eyebrow">Cửa sổ và rèm</span>
        <button
          className="btn-ghost"
          onClick={() =>
            onEdit({
              ...doc,
              windows: [...windows, { id: newId('w'), wall: 'top', offsetMm: 1000, widthMm: 1200, heightMm: 1300, sillMm: 900, curtain: true }]
            })
          }
        >
          Thêm cửa sổ
        </button>
      </div>
      {windows.length === 0 ? <p className="hint">Chưa có cửa sổ. Cửa sổ và rèm giúp dựng đúng nhà thông minh khi xuất sang Home Assistant.</p> : null}
      {windows.map((w) => (
        <div className="window-row" key={w.id}>
          <select aria-label="Tường" value={w.wall} onChange={(e) => setWindow(w.id, { wall: e.target.value as WallSide })}>
            {WALLS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <NumberField label="Cách đầu (mm)" value={w.offsetMm} min={0} onCommit={(offsetMm) => setWindow(w.id, { offsetMm })} />
          <NumberField label="Rộng (mm)" value={w.widthMm} min={300} onCommit={(widthMm) => setWindow(w.id, { widthMm })} />
          <NumberField label="Cao (mm)" value={w.heightMm} min={300} onCommit={(heightMm) => setWindow(w.id, { heightMm })} />
          <NumberField label="Bệ (mm)" value={w.sillMm} min={0} onCommit={(sillMm) => setWindow(w.id, { sillMm })} />
          <label className="check">
            <input type="checkbox" checked={!!w.curtain} onChange={(e) => setWindow(w.id, { curtain: e.target.checked })} />
            Có rèm
          </label>
          <button className="btn-ghost danger" aria-label="Xoá cửa sổ" onClick={() => onEdit({ ...doc, windows: windows.filter((x) => x.id !== w.id) })}>
            Xoá
          </button>
        </div>
      ))}
    </Section>
  )
}
