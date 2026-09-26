/** Retained solid-vector GPU renderer. Unsupported SVG paints stay on the SVG renderer. */
type Point = [number, number]
type Color = [number, number, number, number]
type Camera = { x: number; y: number; k: number }
interface Mesh { buffer: WebGLBuffer; count: number }
interface GeometrySource { element: SVGPathElement; d: string; geometryKey: string }
interface Batch { paint: Color; winding: boolean; mesh: Mesh; cover: Mesh; sources: GeometrySource[] }
interface Pending { paint: Color; winding: boolean; records: GeometryRecord[] }
interface GeometryRecord {
  element: SVGPathElement; d: string; geometryKey: string; matrix: DOMMatrix
  style: CSSStyleDeclaration; fill: Color | null; stroke: Color | null; radius: number
}
interface CachedGeometry {
  d: string; key: string; fill: Float32Array; stroke: Float32Array; bounds: number[]; bytes: number
}
// Bound CPU vertex caching independently of GPU memory.
const GEOMETRY_CACHE_BYTES = 64 * 1024 * 1024

const straightPath = /^[MLZ0-9eE+.,\-]+$/
const rgba = (value: string, alpha: number): Color | null => {
  if (value === 'none') return null
  if (!/^rgba?\(/.test(value)) throw new Error('SVG paint requires SVG rendering')
  const n = value.match(/[\d.]+/g)?.map(Number)
  if (!n || n.length < 3) throw new Error('Unsupported color')
  return [n[0] / 255, n[1] / 255, n[2] / 255, alpha * (n[3] ?? 1)]
}
const vertex = (out: number[], p: Point, o: Point = [0, 0]) => out.push(p[0], p[1], o[0], o[1])

/** The same projected coordinates as SVG; no geographic simplification or resampling. */
function contours(d: string, matrix: DOMMatrix): { points: Point[]; closed: boolean }[] {
  if (!straightPath.test(d)) throw new Error('Curved SVG path requires SVG rendering')
  return (d.match(/M[^M]+/g) ?? []).map((part) => {
    const numbers = part.replace(/[MLZ]/g, ' ').trim().split(/[ ,]+/).map(Number)
    if (numbers.length % 2 || numbers.some((n) => !Number.isFinite(n))) throw new Error('Invalid path')
    const points: Point[] = []
    for (let i = 0; i < numbers.length; i += 2) {
      const p = new DOMPoint(numbers[i], numbers[i + 1]).matrixTransform(matrix)
      // Coincident vertices have no length and cannot define a stroke normal.
      if (!points.length || points.at(-1)![0] !== p.x || points.at(-1)![1] !== p.y) points.push([p.x, p.y])
    }
    const closed = part.endsWith('Z')
    if (closed && points.length > 1 && points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1]) points.pop()
    return { points, closed }
  })
}

function strokeMesh(points: Point[], closed: boolean, radius: number, style: CSSStyleDeclaration): number[] {
  const out: number[] = [], normals: Point[] = [], n = points.length
  if (n < 2) return out
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = points[i], b = points[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
    const normal: Point = [-dy / length * radius, dx / length * radius], opposite: Point = [-normal[0], -normal[1]]
    normals.push(normal)
    vertex(out, a, normal); vertex(out, a, opposite); vertex(out, b, normal)
    vertex(out, b, normal); vertex(out, a, opposite); vertex(out, b, opposite)
  }
  const arc = (p: Point, start: number, angle: number) => {
    // Tessellate only the exposed join/cap arc, with less than 0.001px chord error.
    const steps = Math.max(1, Math.ceil(Math.abs(angle) / (2 * Math.acos(Math.max(-1, 1 - 0.001 / radius)))))
    for (let i = 0; i < steps; i++) {
      vertex(out, p)
      vertex(out, p, [Math.cos(start + i * angle / steps) * radius, Math.sin(start + i * angle / steps) * radius])
      vertex(out, p, [Math.cos(start + (i + 1) * angle / steps) * radius, Math.sin(start + (i + 1) * angle / steps) * radius])
    }
  }
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    const a = normals[(i - 1 + normals.length) % normals.length], b = normals[i]
    if (style.strokeLinejoin === 'round') {
      const angle = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])
      const side = angle > 0 ? -1 : 1
      arc(points[i], Math.atan2(a[1] * side, a[0] * side), angle)
      continue
    }
    const denominator = 1 + (a[0] * b[0] + a[1] * b[1]) / (radius * radius)
    const m: Point = denominator > 1e-8 ? [(a[0] + b[0]) / denominator, (a[1] + b[1]) / denominator] : [0, 0]
    const miter = style.strokeLinejoin === 'miter' && denominator > 1e-8 && Math.hypot(...m) <= radius * Number(style.strokeMiterlimit)
    for (const sign of [-1, 1]) {
      const x: Point = [a[0] * sign, a[1] * sign], y: Point = [b[0] * sign, b[1] * sign]
      vertex(out, points[i]); vertex(out, points[i], x); vertex(out, points[i], y)
      if (miter) { vertex(out, points[i], x); vertex(out, points[i], [m[0] * sign, m[1] * sign]); vertex(out, points[i], y) }
    }
  }
  if (!closed && style.strokeLinecap === 'round') {
    arc(points[0], Math.atan2(normals[0][1], normals[0][0]), Math.PI)
    arc(points.at(-1)!, Math.atan2(normals.at(-1)![1], normals.at(-1)![0]), -Math.PI)
  }
  if (!closed && style.strokeLinecap === 'square') {
    for (const [index, normal, sign] of [[0, normals[0], -1], [n - 1, normals.at(-1)!, 1]] as const) {
      const p = points[index], a: Point = normal, b: Point = [-normal[0], -normal[1]]
      const along: Point = [normal[1] * sign, -normal[0] * sign]
      const c: Point = [a[0] + along[0], a[1] + along[1]], d: Point = [b[0] + along[0], b[1] + along[1]]
      vertex(out, p, a); vertex(out, p, b); vertex(out, p, c)
      vertex(out, p, c); vertex(out, p, b); vertex(out, p, d)
    }
  }
  return out
}

export class RetainedVectors {
  private canvas = document.createElement('canvas')
  private background: SVGRectElement
  private gl: WebGL2RenderingContext
  private program!: WebGLProgram
  private batches: Batch[] = []
  private position = 0
  private offset = 0
  private cameraUniform: WebGLUniformLocation | null = null
  private sizeUniform: WebGLUniformLocation | null = null
  private colorUniform: WebGLUniformLocation | null = null
  private width = 0
  private height = 0
  private active = false
  private lost = false
  private lastCamera: Camera | null = null
  private signature: string[] = []
  private geometryCache = new Map<SVGPathElement, CachedGeometry>()
  private geometryCacheBytes = 0
  private onLost = (event: Event) => {
    event.preventDefault()
    this.lost = true
    this.release()
    this.fallback('context-lost')
  }
  private onRestored = () => {
    try {
      // Restored contexts invalidate every old shader, buffer and uniform location.
      this.initializeProgram()
      this.lost = false
      if (this.lastCamera) this.sync(this.lastCamera)
    } catch {
      this.lost = true
      this.fallback('context-restore-failed')
    }
  }

  constructor(private svg: SVGSVGElement, private camera: SVGGElement, private geography: SVGGElement) {
    const background = svg.querySelector<SVGRectElement>(':scope > rect')
    if (!background) throw new Error('Missing map background')
    this.background = background
    const gl = this.canvas.getContext('webgl2', { antialias: true, stencil: true, alpha: true, premultipliedAlpha: true })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl
    this.initializeProgram()
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;display:none;width:100%;height:100%;pointer-events:none'
    this.canvas.setAttribute('data-map-gpu', '')
    this.svg.parentElement!.insertBefore(this.canvas, this.svg)
    this.canvas.addEventListener('webglcontextlost', this.onLost)
    this.canvas.addEventListener('webglcontextrestored', this.onRestored)
  }

  private initializeProgram() {
    const gl = this.gl
    const shaders: WebGLShader[] = []
    const shader = (type: number, source: string) => {
      const result = gl.createShader(type)
      if (!result) throw new Error('Shader allocation failed')
      shaders.push(result)
      gl.shaderSource(result, source); gl.compileShader(result)
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed')
      return result
    }
    const program = gl.createProgram()
    if (!program) throw new Error('Shader program allocation failed')
    try {
      const vs = shader(gl.VERTEX_SHADER, `#version 300 es
      in vec2 a_position; in vec2 a_offset; uniform vec3 u_camera; uniform vec2 u_size;
      void main(){vec2 p=a_position*u_camera.z+u_camera.xy+a_offset;gl_Position=vec4(p/u_size*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);}`)
      const fs = shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; uniform vec4 u_color; out vec4 color;
      void main(){color=vec4(u_color.rgb*u_color.a,u_color.a);}`)
      gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed')
      this.position = gl.getAttribLocation(program, 'a_position'); this.offset = gl.getAttribLocation(program, 'a_offset')
      this.cameraUniform = gl.getUniformLocation(program, 'u_camera'); this.sizeUniform = gl.getUniformLocation(program, 'u_size'); this.colorUniform = gl.getUniformLocation(program, 'u_color')
      this.program = program
    } catch (error) {
      gl.deleteProgram(program)
      throw error
    } finally {
      for (const compiled of shaders) gl.deleteShader(compiled)
    }
  }

  private upload(vertices: number[] | Float32Array[]): Mesh {
    const gl = this.gl, buffer = gl.createBuffer()
    if (!buffer) throw new Error('GPU buffer allocation failed')
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      let length: number
      if (vertices[0] instanceof Float32Array) {
        const parts = vertices as Float32Array[]
        length = parts.reduce((sum, p) => sum + p.length, 0)
        gl.bufferData(gl.ARRAY_BUFFER, length * 4, gl.STATIC_DRAW)
        let offset = 0
        for (const part of parts) { gl.bufferSubData(gl.ARRAY_BUFFER, offset, part); offset += part.byteLength }
      } else {
        length = vertices.length
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices as number[]), gl.STATIC_DRAW)
      }
      // WebGL allocation failures report an error rather than throwing a JS exception.
      if (gl.getError() !== gl.NO_ERROR) throw new Error('GPU buffer upload failed')
      return { buffer, count: length / 4 }
    } catch (error) {
      gl.deleteBuffer(buffer)
      throw error
    }
  }

  private release() {
    for (const batch of this.batches) { this.gl.deleteBuffer(batch.mesh.buffer); this.gl.deleteBuffer(batch.cover.buffer) }
    this.batches = []
    this.signature = []
  }

  fallback(reason: string) {
    this.active = false
    this.canvas.style.display = 'none'
    this.background.style.removeProperty('opacity')
    this.background.removeAttribute('data-gpu-source')
    this.geography.style.removeProperty('opacity')
    this.geography.removeAttribute('data-gpu-source')
    this.svg.dataset.renderer = `svg:${reason}`
  }

  private forgetGeometry(element: SVGPathElement) {
    const old = this.geometryCache.get(element)
    if (old) { this.geometryCacheBytes -= old.bytes; this.geometryCache.delete(element) }
  }

  private geometryFor(record: GeometryRecord): CachedGeometry {
    const { element, d, geometryKey, matrix, style, fill, stroke, radius } = record
    const cached = this.geometryCache.get(element)
    if (cached?.d === d && cached.key === geometryKey) {
      return cached
    }
    this.forgetGeometry(element)
    const fv: number[] = [], sv: number[] = [], bounds = [Infinity, Infinity, -Infinity, -Infinity]
    for (const { points, closed } of contours(d, matrix)) {
      for (const p of points) { bounds[0] = Math.min(bounds[0], p[0]); bounds[1] = Math.min(bounds[1], p[1]); bounds[2] = Math.max(bounds[2], p[0]); bounds[3] = Math.max(bounds[3], p[1]) }
      if (fill) for (let i = 1; i < points.length - 1; i++) { vertex(fv, points[0]); vertex(fv, points[i]); vertex(fv, points[i + 1]) }
      if (stroke && radius > 0) for (const v of strokeMesh(points, closed, radius, style)) sv.push(v)
    }
    const geometry = { d, key: geometryKey, fill: new Float32Array(fv), stroke: new Float32Array(sv), bounds, bytes: (fv.length + sv.length) * 4 }
    // Keep existing entries when full: a sequential scene scan must not evict every hit.
    if (this.geometryCacheBytes + geometry.bytes <= GEOMETRY_CACHE_BYTES) {
      this.geometryCache.set(element, geometry); this.geometryCacheBytes += geometry.bytes
    }
    return geometry
  }

  private replaceBatches(pending: Pending[]) {
    const byFirst = new Map<SVGPathElement, Batch[]>()
    for (const old of this.batches) {
      const first = old.sources[0]?.element
      if (first) { const list = byFirst.get(first) ?? []; list.push(old); byFirst.set(first, list) }
    }
    const reused = new Set<Batch>(), created: Batch[] = [], next: Batch[] = []
    try {
      for (const batch of pending) {
        const old = byFirst.get(batch.records[0].element)?.find((candidate) =>
          !reused.has(candidate) && candidate.winding === batch.winding &&
          candidate.sources.length === batch.records.length && candidate.sources.every((source, i) => {
            const record = batch.records[i]
            return source.element === record.element && source.d === record.d && source.geometryKey === record.geometryKey
          }))
        if (old) {
          reused.add(old)
          next.push({ ...old, paint: batch.paint })
          continue
        }
        const parts: Float32Array[] = [], bounds = [Infinity, Infinity, -Infinity, -Infinity]
        for (const record of batch.records) {
          const geometry = this.geometryFor(record)
          const vertices = batch.winding ? geometry.fill : geometry.stroke
          if (!vertices.length) continue
          parts.push(vertices)
          bounds[0] = Math.min(bounds[0], geometry.bounds[0]); bounds[1] = Math.min(bounds[1], geometry.bounds[1])
          bounds[2] = Math.max(bounds[2], geometry.bounds[2]); bounds[3] = Math.max(bounds[3], geometry.bounds[3])
        }
        if (!parts.length) continue
        const mesh = this.upload(parts)
        const [x0,y0,x1,y1] = bounds, margin = batch.winding ? 0 : 100
        let cover: Mesh
        try {
          cover = this.upload([x0-margin,y0-margin,0,0,x1+margin,y0-margin,0,0,x0-margin,y1+margin,0,0,x0-margin,y1+margin,0,0,x1+margin,y0-margin,0,0,x1+margin,y1+margin,0,0])
        } catch (error) { this.gl.deleteBuffer(mesh.buffer); throw error }
        const sources = batch.records.map(({ element, d, geometryKey }) => ({ element, d, geometryKey }))
        const fresh = { paint: batch.paint, winding: batch.winding, mesh, cover, sources }
        created.push(fresh); next.push(fresh)
      }
    } catch (error) {
      // Old batches remain owned until the replacement is complete.
      for (const batch of created) { this.gl.deleteBuffer(batch.mesh.buffer); this.gl.deleteBuffer(batch.cover.buffer) }
      throw error
    }
    for (const old of this.batches) {
      if (!reused.has(old)) { this.gl.deleteBuffer(old.mesh.buffer); this.gl.deleteBuffer(old.cover.buffer) }
    }
    this.batches = next
  }

  /** Runs on document/projection changes, never on pointer or wheel movement. */
  sync(t: Camera) {
    this.rememberCamera(t)
    if (this.lost) return
    try {
      if (this.camera.parentElement?.getAttribute('transform')) throw new Error('resize')
      const width = this.svg.width.baseVal.value, height = this.svg.height.baseVal.value
      const inverse = this.camera.getCTM()?.inverse()
      if (!inverse || !width || !height) throw new Error('viewport')
      const pending: Pending[] = [], signature: string[] = []
      const emit = (paint: Color | null, winding: boolean, record: GeometryRecord) => {
        if (!paint || paint[3] === 0 || (!winding && record.radius <= 0)) return
        let batch = pending.at(-1)
        // Only opaque adjacent paints can safely merge across independent SVG elements.
        if (!batch || paint[3] !== 1 || batch.winding !== winding || batch.paint.some((v, i) => v !== paint[i])) {
          batch = { paint, winding, records: [] }; pending.push(batch)
        }
        batch.records.push(record)
      }
      // Validate the entire scene before changing its visible renderer.
      const records: GeometryRecord[] = []
      const visit = (parent: Element) => {
        for (const e of parent.children) {
          if (['defs', 'clipPath', 'mask', 'title', 'desc'].includes(e.tagName)) continue
          const s = getComputedStyle(e)
          if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0) continue
          if (s.clipPath !== 'none' || s.maskImage !== 'none' || s.filter !== 'none' || s.mixBlendMode !== 'normal') throw new Error('effect')
          if (e.tagName === 'g') { if (Number(s.opacity) !== 1) throw new Error('group-opacity'); visit(e); continue }
          const fill = rgba(s.fill, Number(s.opacity) * Number(s.fillOpacity)), stroke = rgba(s.stroke, Number(s.opacity) * Number(s.strokeOpacity))
          if ((!fill || !fill[3]) && (!stroke || !stroke[3] || parseFloat(s.strokeWidth) === 0)) continue
          if (!(e instanceof SVGPathElement) || s.strokeDasharray !== 'none' || s.fillRule !== 'nonzero' || !['miter','bevel','round'].includes(s.strokeLinejoin)) throw new Error('shape')
          const d = e.getAttribute('d') ?? ''
          if (!d) continue
          if (!straightPath.test(d)) throw new Error('curves')
          const matrix = inverse.multiply(e.getCTM()!)
          const radius = parseFloat(s.strokeWidth) * t.k / 2
          // The application uses screen-constant widths. Other transformed strokes stay SVG.
          if (stroke && (Math.abs(matrix.a - 1) > 1e-6 || Math.abs(matrix.d - 1) > 1e-6 || Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6)) throw new Error('stroke-transform')
          const stableMatrix = [matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f].map((v) => Math.round(v * 1e9) / 1e9)
          signature.push(d, JSON.stringify([stableMatrix,fill,stroke,Math.round(radius*1e4)/1e4,s.strokeLinejoin,s.strokeLinecap,s.strokeMiterlimit,s.paintOrder]))
          const geometryKey = JSON.stringify([stableMatrix,!!fill,!!stroke,Math.round(radius*1e4)/1e4,s.strokeLinejoin,s.strokeLinecap,s.strokeMiterlimit])
          records.push({ element: e, d, geometryKey, matrix, style: s, fill, stroke, radius })
        }
      }
      visit(this.geography)
      if (!records.length) throw new Error('empty')
      const same = signature.length === this.signature.length && signature.every((v, i) => v === this.signature[i])
      if (!same) {
        const live = new Set(records.map((r) => r.element))
        for (const element of this.geometryCache.keys()) if (!live.has(element)) this.forgetGeometry(element)
        for (const record of records) {
          const { style, fill, stroke } = record
          const emitFill = () => emit(fill, true, record), emitStroke = () => emit(stroke, false, record)
          if (style.paintOrder.startsWith('stroke')) { emitStroke(); emitFill() } else { emitFill(); emitStroke() }
        }
        this.replaceBatches(pending)
        this.signature = signature
      }
      const ratio = (window.devicePixelRatio || 1) * 2 // Supersampled MSAA, never a scaled low-resolution map.
      if (this.canvas.width !== Math.ceil(width * ratio) || this.canvas.height !== Math.ceil(height * ratio)) {
        this.canvas.width = Math.ceil(width * ratio); this.canvas.height = Math.ceil(height * ratio)
      }
      this.width = width; this.height = height
      this.active = true; this.draw(t)
      if (this.gl.getError() !== this.gl.NO_ERROR) throw new Error('gpu-error')
      this.canvas.style.display = 'block'
      this.canvas.style.background = getComputedStyle(this.background).fill
      this.background.style.opacity = '0'; this.background.setAttribute('data-gpu-source', '')
      this.geography.style.opacity = '0'; this.geography.setAttribute('data-gpu-source', '')
      this.svg.dataset.renderer = 'gpu'
      this.svg.dataset.rendererVertices = String(this.batches.reduce((sum, b) => sum + b.mesh.count, 0))
    } catch (error) {
      this.release()
      this.fallback(error instanceof Error ? error.message : 'unsupported')
    }
  }

  /** One uniform update per camera frame. Geometry buffers remain untouched. */
  draw(t: Camera) {
    this.rememberCamera(t)
    if (!this.active || this.lost) return
    const gl = this.gl
    gl.useProgram(this.program); gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.enableVertexAttribArray(this.position); gl.enableVertexAttribArray(this.offset)
    gl.uniform2f(this.sizeUniform, this.width, this.height); gl.uniform3f(this.cameraUniform, t.x, t.y, t.k)
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.colorMask(true, true, true, true); gl.stencilMask(255); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    const draw = (mesh: Mesh) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer)
      gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(this.offset, 2, gl.FLOAT, false, 16, 8)
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count)
    }
    gl.enable(gl.STENCIL_TEST)
    for (const batch of this.batches) {
      gl.uniform4fv(this.colorUniform, batch.paint); gl.colorMask(false, false, false, false)
      gl.stencilFunc(gl.ALWAYS, 1, 255)
      if (batch.winding) {
        gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP); gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP)
      } else gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
      draw(batch.mesh)
      gl.colorMask(true, true, true, true); gl.stencilFunc(gl.NOTEQUAL, 0, 255); gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO)
      draw(batch.cover)
    }
    gl.disable(gl.STENCIL_TEST)
  }

  private rememberCamera(t: Camera) {
    Object.assign(this.lastCamera ??= { x: 0, y: 0, k: 1 }, t)
  }

  dispose() {
    this.geometryCache.clear(); this.geometryCacheBytes = 0
    this.fallback('disposed'); this.release(); this.gl.deleteProgram(this.program)
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    this.canvas.remove()
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
