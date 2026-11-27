import type { ApplyResult, Item, Op, Sample, SdrawDoc } from './types'

let counter = 0
export function newId(prefix = 'i'): string {
  counter += 1
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`
}

export function itemFromSample(
  sample: Sample,
  cx: number,
  cy: number,
  rotation = 0,
  id = newId()
): Item {
  return {
    id,
    sampleId: sample.id,
    name: sample.name,
    cx,
    cy,
    w: sample.w,
    d: sample.d,
    rotation,
    locked: false,
    material: '',
    priceMode: sample.listPrice != null ? 'list' : 'blank'
  }
}

export function emptyDoc(name = 'Bản vẽ mới', widthMm = 5000, depthMm = 4000): SdrawDoc {
  return { version: 1, name, room: { widthMm, depthMm }, doors: [], items: [] }
}

/**
 * Áp dụng danh sách lệnh. Món đã khoá không bị đụng tới: lệnh bị bỏ qua kèm lý do.
 * Hàm thuần: không sửa doc đầu vào.
 */
export function applyOps(doc: SdrawDoc, ops: Op[]): ApplyResult {
  let items = doc.items.slice()
  const applied: Op[] = []
  const skipped: ApplyResult['skipped'] = []

  for (const op of ops) {
    if (op.op === 'add') {
      items.push(itemFromSample(op.sample, op.cx, op.cy, op.rotation ?? 0))
      applied.push(op)
      continue
    }
    const idx = items.findIndex((it) => it.id === op.id)
    const target = items[idx]
    if (!target) {
      skipped.push({ op, reason: 'notFound' })
      continue
    }
    if (target.locked) {
      skipped.push({ op, reason: 'locked' })
      continue
    }
    switch (op.op) {
      case 'move':
        items[idx] = { ...target, cx: op.cx, cy: op.cy }
        break
      case 'nudge':
        items[idx] = { ...target, cx: target.cx + op.dx, cy: target.cy + op.dy }
        break
      case 'rotate':
        items[idx] = { ...target, rotation: ((op.rotation % 360) + 360) % 360 }
        break
      case 'replace': {
        const next = itemFromSample(op.sample, target.cx, target.cy, target.rotation, target.id)
        items[idx] = { ...next, material: target.material }
        break
      }
      case 'remove':
        items = items.filter((it) => it.id !== op.id)
        break
      case 'setMaterial':
        items[idx] = { ...target, material: op.material }
        break
    }
    applied.push(op)
  }
  return { doc: { ...doc, items }, applied, skipped }
}

/** Sửa trực tiếp một món bằng tay (ô nhập, kéo thả). Khoá chỉ chặn AI, không chặn tay. */
export function patchItem(doc: SdrawDoc, id: string, patch: Partial<Item>): SdrawDoc {
  return { ...doc, items: doc.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) }
}
