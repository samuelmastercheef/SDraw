import { useEffect, useState } from 'react'

/** Ảnh bìa gói Store, tải khi hiện. Không có ảnh thì không chiếm chỗ. */
export function Cover(props: { id: string; has: boolean; alt: string; bust?: number; large?: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setSrc(null)
    if (props.has) void window.sdraw.storeCover(props.id).then((s) => { if (live) setSrc(s) })
    return () => { live = false }
  }, [props.id, props.has, props.bust])
  return src ? <img className={props.large ? 'cover cover-large' : 'cover'} src={src} alt={props.alt} /> : null
}

const COVER_MAX = 640

/** Thu nhỏ ảnh về tối đa 640 px cạnh dài, JPEG chất lượng 0,8, để nằm dưới giới hạn 600 KB của máy chủ. */
export async function shrinkCover(src: string): Promise<string> {
  const el = new Image()
  el.src = src
  await el.decode()
  const k = Math.min(1, COVER_MAX / Math.max(el.naturalWidth, el.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(el.naturalWidth * k)); c.height = Math.max(1, Math.round(el.naturalHeight * k))
  const g = c.getContext('2d')
  if (!g) throw new Error('Không xử lý được ảnh')
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(el, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.8)
}
