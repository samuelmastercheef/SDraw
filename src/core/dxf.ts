import { corners } from './geometry'
import type { SdrawDoc } from './types'

/** Xuất mặt bằng sang DXF (ASCII, đơn vị mm): lớp ROOM, DOOR, ITEMS, LABEL. Trục y lật lên trên theo chuẩn CAD. */
export function toDxf(doc: SdrawDoc): string {
  const out: string[] = []
  const add = (code: number, value: string | number) => {
    out.push(String(code), String(value))
  }
  const depth = doc.room.depthMm
  const fy = (y: number) => depth - y

  const layers = ['ROOM', 'DOOR', 'WINDOW', 'ITEMS', 'LABEL']
  add(0, 'SECTION')
  add(2, 'HEADER')
  add(9, '$ACADVER')
  add(1, 'AC1009')
  add(9, '$INSUNITS')
  add(70, 4)
  add(0, 'ENDSEC')
  add(0, 'SECTION')
  add(2, 'TABLES')
  add(0, 'TABLE')
  add(2, 'LAYER')
  add(70, layers.length)
  layers.forEach((name, i) => {
    add(0, 'LAYER')
    add(2, name)
    add(70, 0)
    add(62, i + 1)
    add(6, 'CONTINUOUS')
  })
  add(0, 'ENDTAB')
  add(0, 'ENDSEC')
  add(0, 'SECTION')
  add(2, 'ENTITIES')

  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    add(0, 'LINE')
    add(8, layer)
    add(10, x1.toFixed(2))
    add(20, fy(y1).toFixed(2))
    add(30, 0)
    add(11, x2.toFixed(2))
    add(21, fy(y2).toFixed(2))
    add(31, 0)
  }
  const text = (layer: string, x: number, y: number, height: number, value: string) => {
    add(0, 'TEXT')
    add(8, layer)
    add(10, x.toFixed(2))
    add(20, fy(y).toFixed(2))
    add(30, 0)
    add(40, height)
    add(1, value.replace(/[\r\n]+/g, ' '))
  }

  const { widthMm: W, depthMm: D } = doc.room
  line('ROOM', 0, 0, W, 0)
  line('ROOM', W, 0, W, D)
  line('ROOM', W, D, 0, D)
  line('ROOM', 0, D, 0, 0)

  for (const door of doc.doors) {
    const o = door.offsetMm
    const e = o + door.widthMm
    if (door.wall === 'top') line('DOOR', o, 0, e, 0)
    if (door.wall === 'bottom') line('DOOR', o, D, e, D)
    if (door.wall === 'left') line('DOOR', 0, o, 0, e)
    if (door.wall === 'right') line('DOOR', W, o, W, e)
  }

  for (const wd of doc.windows ?? []) {
    const o = wd.offsetMm
    const e = o + wd.widthMm
    if (wd.wall === 'top') line('WINDOW', o, 0, e, 0)
    if (wd.wall === 'bottom') line('WINDOW', o, D, e, D)
    if (wd.wall === 'left') line('WINDOW', 0, o, 0, e)
    if (wd.wall === 'right') line('WINDOW', W, o, W, e)
  }

  for (const item of doc.items) {
    const c = corners(item)
    for (let i = 0; i < 4; i++) {
      const a = c[i]!
      const b = c[(i + 1) % 4]!
      line('ITEMS', a.x, a.y, b.x, b.y)
    }
    text('LABEL', item.cx - item.w / 4, item.cy, 60, item.name)
  }

  add(0, 'ENDSEC')
  add(0, 'EOF')
  return out.join('\n') + '\n'
}
