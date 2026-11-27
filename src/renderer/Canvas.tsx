import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, Image as KImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { doorClearZone, wallSegment } from '@core/geometry'
import type { Issue, SdrawDoc, WallSide } from '@core/types'

const SNAP_MM = 50
const PAD = 48
/** Chỉ số hai góc của vùng cửa nằm sát tường, để vẽ nét cửa */
const WALL_EDGE: Record<WallSide, [number, number]> = {
  top: [0, 1],
  bottom: [2, 3],
  left: [0, 3],
  right: [1, 2]
}

interface Props {
  doc: SdrawDoc
  selectedId: string | null
  issues: Issue[]
  onSelect: (id: string | null) => void
  onMove: (id: string, cx: number, cy: number) => void
  /** Hiện ảnh mặt bằng nền (nếu dự án có) */
  showPlan?: boolean
}

export function Canvas({ doc, selectedId, issues, onSelect, onMove, showPlan = true }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const { room } = doc
  const [planImg, setPlanImg] = useState<HTMLImageElement | null>(null)
  const planSrc = doc.plan?.src
  useEffect(() => {
    if (!planSrc) { setPlanImg(null); return }
    const i = new window.Image()
    i.onload = () => setPlanImg(i)
    i.src = planSrc
    return () => { i.onload = null }
  }, [planSrc])
  const scale = Math.max(
    0.01,
    Math.min((size.w - PAD * 2) / room.widthMm, (size.h - PAD * 2) / room.depthMm)
  )
  const ox = (size.w - room.widthMm * scale) / 2
  const oy = (size.h - room.depthMm * scale) / 2

  const bad = useMemo(() => new Set(issues.flatMap((i) => i.itemIds)), [issues])

  const gridLines: number[][] = []
  for (let x = 0; x <= room.widthMm; x += 500) gridLines.push([x, 0, x, room.depthMm])
  for (let y = 0; y <= room.depthMm; y += 500) gridLines.push([0, y, room.widthMm, y])

  return (
    <div className="canvas-wrap" ref={wrap}>
      <Stage
        width={size.w}
        height={size.h}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage()) onSelect(null)
        }}
      >
        <Layer>
          <Group x={ox} y={oy}>
            <Rect
              width={room.widthMm * scale}
              height={room.depthMm * scale}
              fill="#FFFFFF"
              onMouseDown={() => onSelect(null)}
            />
            {showPlan && planImg ? <KImage image={planImg} width={room.widthMm * scale} height={room.depthMm * scale} opacity={0.45} listening={false} /> : null}
            {gridLines.map((p, i) => (
              <Line
                key={i}
                points={p.map((v) => v * scale)}
                stroke="#E2EDEF"
                strokeWidth={1}
                listening={false}
              />
            ))}
            <Rect
              width={room.widthMm * scale}
              height={room.depthMm * scale}
              stroke="#0D1B2A"
              strokeWidth={6}
              listening={false}
            />
            {doc.doors.map((d) => {
              const z = doorClearZone(d, room)
              return (
                <Group key={d.id} listening={false}>
                  <Line
                    points={z.flatMap((p) => [p.x * scale, p.y * scale])}
                    closed
                    fill="rgba(11,127,143,0.06)"
                    stroke="#9FB2BC"
                    dash={[6, 4]}
                    strokeWidth={1}
                  />
                  <Line
                    points={WALL_EDGE[d.wall]
                      .map((i) => z[i]!)
                      .flatMap((p) => [p.x * scale, p.y * scale])}
                    stroke="#075E6B"
                    strokeWidth={8}
                  />
                </Group>
              )
            })}
            {(doc.windows ?? []).map((wd) => {
              const [a, b] = wallSegment(wd, room)
              const horizontal = wd.wall === 'top' || wd.wall === 'bottom'
              const inward = wd.wall === 'top' || wd.wall === 'left' ? 1 : -1
              const k = 16 * inward
              return (
                <Group key={wd.id} listening={false}>
                  <Line points={[a.x * scale, a.y * scale, b.x * scale, b.y * scale]} stroke="#2FB4C4" strokeWidth={10} />
                  <Line points={[a.x * scale, a.y * scale, b.x * scale, b.y * scale]} stroke="#fff" strokeWidth={3} />
                  {wd.curtain ? (
                    <Line
                      points={horizontal ? [a.x * scale, a.y * scale + k, b.x * scale, b.y * scale + k] : [a.x * scale + k, a.y * scale, b.x * scale + k, b.y * scale]}
                      stroke="#C77A00"
                      strokeWidth={3}
                      dash={[8, 4]}
                    />
                  ) : null}
                </Group>
              )
            })}
            {doc.items.map((it) => {
              const selected = it.id === selectedId
              const hasIssue = bad.has(it.id)
              const w = it.w * scale
              const d = it.d * scale
              return (
                <Group
                  key={it.id}
                  x={it.cx * scale}
                  y={it.cy * scale}
                  rotation={it.rotation}
                  draggable
                  onMouseDown={(e) => {
                    e.cancelBubble = true
                    onSelect(it.id)
                  }}
                  onDragStart={() => onSelect(it.id)}
                  dragBoundFunc={(pos) => ({
                    x: ox + Math.round((pos.x - ox) / scale / SNAP_MM) * SNAP_MM * scale,
                    y: oy + Math.round((pos.y - oy) / scale / SNAP_MM) * SNAP_MM * scale
                  })}
                  onDragEnd={(e) => {
                    const cx = Math.round(e.target.x() / scale / SNAP_MM) * SNAP_MM
                    const cy = Math.round(e.target.y() / scale / SNAP_MM) * SNAP_MM
                    onMove(it.id, cx, cy)
                  }}
                >
                  <Rect
                    x={-w / 2}
                    y={-d / 2}
                    width={w}
                    height={d}
                    cornerRadius={Math.min(10, d / 4)}
                    fill={it.locked ? '#F5FAFB' : '#E7F3F4'}
                    stroke={hasIssue ? '#D6404A' : selected ? '#0B7F8F' : it.locked ? '#0D1B2A' : '#9FB2BC'}
                    strokeWidth={selected || hasIssue ? 3 : 2}
                  />
                  <Text
                    x={-w / 2}
                    y={-7}
                    width={w}
                    align="center"
                    text={it.locked ? `${it.name} (khoá)` : it.name}
                    fontSize={12}
                    fontFamily="Be Vietnam Pro, system-ui, sans-serif"
                    fill="#0D1B2A"
                    listening={false}
                  />
                </Group>
              )
            })}
          </Group>
        </Layer>
      </Stage>
      <div className="canvas-foot">
        Lưới 500 mm · Snap {SNAP_MM} mm · Phòng {room.widthMm} × {room.depthMm} mm
      </div>
    </div>
  )
}
