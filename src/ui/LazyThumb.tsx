/**
 * A sticker thumbnail that is drawn only once it is near the screen, and then as a small picture
 * (`stickers/thumbnails.ts`). Until then it is a faint placeholder disc, so a long grid lays out
 * at once and costs nothing to scroll.
 */
import { useEffect, useRef, useState } from 'react'
import { cachedThumbnail, thumbnail } from '../stickers/thumbnails'

export function LazyThumb({ thumbKey, make, alt, size = 40 }: { thumbKey: string; make: () => string; alt: string; size?: number }) {
  const [url, setUrl] = useState<string | undefined>(() => cachedThumbnail(thumbKey))
  const [near, setNear] = useState(false)
  const holder = useRef<HTMLSpanElement>(null)
  const makeRef = useRef(make)
  makeRef.current = make

  useEffect(() => {
    const element = holder.current
    if (!element) return
    const observer = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { rootMargin: '160px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const known = cachedThumbnail(thumbKey)
    setUrl(known)
    if (known !== undefined || !near) return
    let live = true
    void thumbnail(thumbKey, () => makeRef.current()).then((drawn) => {
      if (live) setUrl(drawn)
    })
    return () => {
      live = false
    }
  }, [thumbKey, near])

  return (
    <span ref={holder} className="sticker-thumb sticker-thumb--lazy" style={{ width: size, height: size }}>
      {url ? <img src={url} alt={alt} width={size} height={size} draggable={false} /> : <span className="sticker-thumb__wait" aria-hidden="true" />}
    </span>
  )
}
