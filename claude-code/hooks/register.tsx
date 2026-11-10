import type { Register, RenderChildren } from 'claude-code'

import { DEFAULTS, fitImage, flatten, hash, paletteOf, split, type Appearance, type Palette, type Segment } from './core/diagram'
import { render, renderAscii } from './vendor/pele.mjs'

type $ = Parameters<Parameters<Parameters<Register>[0]>[2]>[0]
type Mode = 'auto' | 'image' | 'text' | 'off'
type Picture = { png: string; columns: number; rows: number }
type Drawn = { kind: 'image'; picture: Picture } | { kind: 'art'; lines: string } | { kind: 'svg'; svg: string; width: number; height: number } | { kind: 'fence' }
type Style = { palette: Palette; fontSize?: number; fontFamily?: string; id: string }
type Env = { home: string; images: boolean; rsvg: string | undefined }

// 回复正文在终端里缩进两格
const INDENT = 2
// 主题文件、外观多久重新看一次
const RECHECK_MS = 2000
// 被引擎放弃的渲染
const ABANDONED = new Error('abandoned')
// 内存里最多留多少张图（存的是整张 PNG）
const KEEP = 64

// Map 按插入顺序，超了就丢最早的
const remember = <V,>(map: Map<string, V>, key: string, value: V) => {
  map.delete(key)
  map.set(key, value)
  if (map.size > KEEP) map.delete(map.keys().next().value!)
}

export const register: Register = (on, options) => {
  const mode = ((options as { mode?: string }).mode ?? 'auto') as Mode

  // 模块级缓存，热重载后清空没关系
  // 只存每次都一样的结果：画成的图，以及 pele 解析失败这种
  const drawn = new Map<string, Drawn>()
  // 同一张图同时只画一次
  const pending = new Map<string, Promise<Drawn>>()
  // 每张图最近一次画成的图片：偶发失败时先用它，不退回字符图
  const lastImage = new Map<string, Drawn>()
  let env: Env | undefined
  let style: { at: number; value: Style } | undefined

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (mode === 'off' || !e.props.text.includes('mermaid')) return next(e)
    const segments = split(e.props.text)
    if (!segments.some((s) => s.kind === 'mermaid')) return next(e)

    // 滚动、改宽度时引擎会重跑这个 hook，并放弃上一次（next.signal 中止）。
    // 被放弃的那次里 $ 调用会失败、子进程会被杀，它得到的结果一概不进缓存。
    const abandoned = () => next.signal.aborted

    const found = env ?? (await probe($))
    if (abandoned()) return next(e)
    env = found
    const { home, images, rsvg } = found
    const columns = Math.max(20, (e.viewport?.columns ?? 80) - INDENT - 1)
    const terminal = e.surface === 'terminal'
    const useImage = terminal && rsvg !== undefined && (mode === 'image' || (mode === 'auto' && images))

    let look: Style | undefined
    if (!terminal || useImage) {
      const now = await $.clock.now()
      if (!style || now - style.at > RECHECK_MS) {
        const value = await resolveStyle($, home)
        if (abandoned()) return next(e)
        style = { at: now, value }
      }
      look = style.value
    }

    const how = !terminal ? 'svg' : useImage ? 'image' : 'text'
    const art = (source: string): Drawn => {
      try {
        return { kind: 'art', lines: renderAscii(source, { maxWidth: columns }).text }
      } catch {
        // 解析失败或太宽画不下：显示原代码块
        return { kind: 'fence' }
      }
    }

    // 画一张图。throw 表示这次没画成、下次再试，不进缓存
    const attempt = async (source: string): Promise<Drawn> => {
      if (how === 'text' || !look) return art(source)
      let r: ReturnType<typeof render>
      try {
        r = render(source, { fontSize: look.fontSize, fontFamily: look.fontFamily })
      } catch {
        return art(source)
      }
      const svg = flatten(r.svg, look.palette)
      if (how === 'svg') return { kind: 'svg', svg, width: r.width, height: r.height }
      const picture = await rasterize($, rsvg!, home, svg, r.width, r.height, columns, look.fontSize)
      if (abandoned()) throw ABANDONED
      if (!picture) return art(source)
      return { kind: 'image', picture }
    }

    const draw = async (s: Extract<Segment, { kind: 'mermaid' }>): Promise<Drawn> => {
      const key = `${how}\0${how === 'svg' ? 0 : columns}\0${look?.id ?? ''}\0${s.source}`
      const hit = drawn.get(key)
      if (hit) {
        remember(drawn, key, hit)
        return hit
      }
      // 别的渲染正在画同一张图就等它；它要是被放弃了，用这次的 $ 重画
      for (let tries = 0; tries < 2; tries++) {
        let job = pending.get(key)
        if (!job) {
          job = attempt(s.source)
          pending.set(key, job)
        }
        try {
          const d = await job
          remember(drawn, key, d)
          if (d.kind === 'image') remember(lastImage, s.source, d)
          return d
        } catch {
          if (abandoned()) return { kind: 'fence' }
        } finally {
          if (pending.get(key) === job) pending.delete(key)
        }
      }
      return (how === 'image' && lastImage.get(s.source)) || art(s.source)
    }

    const results = await Promise.all(segments.map((s) => (s.kind === 'mermaid' ? draw(s) : undefined)))
    if (abandoned()) return next(e)

    // 画不了的图并回文字段，原样当代码块显示
    const parts: ({ kind: 'text'; text: string } | Exclude<Drawn, { kind: 'fence' }>)[] = []
    segments.forEach((s, i) => {
      const r = results[i]
      const text = s.kind === 'text' ? s.text : r?.kind === 'fence' ? s.fence : undefined
      if (text !== undefined) {
        const last = parts[parts.length - 1]
        if (last?.kind === 'text') last.text += '\n' + text
        else parts.push({ kind: 'text', text })
      } else if (r && r.kind !== 'fence') parts.push(r)
    })
    if (parts.length === 1 && parts[0]?.kind === 'text') return next(e)

    const { Box, Markdown, Text } = $.ui.resolve(e)
    const children: RenderChildren[] = []
    for (const [i, p] of parts.entries()) {
      if (p.kind === 'text') {
        // 第一段交给引擎画，保留回复开头的圆点
        if (i === 0) children.push(await next({ ...e, props: { ...e.props, text: p.text } }))
        else children.push(<Box key={`t${i}`} paddingLeft={INDENT}><Markdown text={p.text} /></Box>)
      } else if (p.kind === 'image' && e.surface === 'terminal') {
        const { Image } = $.ui.resolve(e)
        children.push(
          <Box key={`d${i}`} paddingLeft={INDENT}>
            <Image source={{ png: p.picture.png }} columns={p.picture.columns} rows={p.picture.rows} alt="Mermaid diagram" />
          </Box>,
        )
      } else if (p.kind === 'svg' && e.surface !== 'terminal') {
        const { Svg } = $.ui.resolve(e)
        children.push(<Box key={`d${i}`}><Svg source={p.svg} width={p.width} height={p.height} alt="Mermaid diagram" /></Box>)
      } else if (p.kind === 'art') {
        children.push(<Box key={`d${i}`} paddingLeft={INDENT}><Text>{p.lines}</Text></Box>)
      }
    }
    return <Box flexDirection="column" gap={1}>{children}</Box>
  })
}

// 热重载后清空没关系
let themeFile: { mtimeMs: number; json: Record<string, unknown> } | undefined

// 主题文件 ~/.claude/ls-mermaid-theme.json：改了就生效
async function readThemeFile($: $, home: string): Promise<Record<string, unknown>> {
  const path = `${home}/.claude/ls-mermaid-theme.json`
  try {
    const { mtimeMs } = await $.fs.stat(path)
    if (themeFile?.mtimeMs === mtimeMs) return themeFile.json
    const raw = await $.fs.read(path)
    const json = JSON.parse(typeof raw === 'string' ? raw : '{}') as unknown
    themeFile = { mtimeMs, json: typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {} }
    return themeFile.json
  } catch (error) {
    if (themeFile !== undefined || !(error instanceof SyntaxError)) return themeFile?.json ?? {}
    $.ui.toast('ls-mermaid-theme.json is not valid JSON')
    return {}
  }
}

async function resolveStyle($: $, home: string): Promise<Style> {
  const file = await readThemeFile($, home)
  const appearance = await resolveAppearance($, file.appearance)
  const palette = { ...DEFAULTS[appearance], ...paletteOf(file), ...paletteOf(file[appearance]) }
  const fontSize = typeof file.fontSize === 'number' && file.fontSize > 0 ? file.fontSize : undefined
  const fontFamily = typeof file.font === 'string' ? file.font : undefined
  return { palette, fontSize, fontFamily, id: hash(JSON.stringify([palette, fontSize, fontFamily])) }
}

// 以 Claude Code 的主题为准；它设成 auto 时跟系统外观走（Claude Code 的 auto 也是看终端底色，终端多半跟系统）
async function resolveAppearance($: $, forced: unknown): Promise<Appearance> {
  if (forced === 'light' || forced === 'dark') return forced
  try {
    const row = (await $.config.list()).find((r) => r.key === 'theme')
    const theme = typeof row?.value === 'string' ? row.value : 'auto'
    if (theme.startsWith('light')) return 'light'
    if (theme.startsWith('dark')) return 'dark'
  } catch {}
  try {
    const r = await $.process.run(['defaults', 'read', '-g', 'AppleInterfaceStyle'], { timeoutMs: 3000 })
    return r.exitCode === 0 && r.stdout.trim() === 'Dark' ? 'dark' : 'light'
  } catch {
    return 'dark'
  }
}

// 进程一次：终端能不能显示图、rsvg-convert 在哪
async function probe($: $): Promise<Env> {
  const [home, force, term, program, tmux] = await Promise.all([
    $.env.get('HOME'),
    $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES'),
    $.env.get('TERM'),
    $.env.get('TERM_PROGRAM'),
    $.env.get('TMUX'),
  ])
  // Claude Code 只在这些情况下真的把图发给终端，其余显示替代文字
  const images = !!force || (!tmux && ((term ?? '').includes('kitty') || term === 'xterm-ghostty' || program === 'ghostty'))

  let rsvg: string | undefined
  for (const bin of ['rsvg-convert', '/opt/homebrew/bin/rsvg-convert', '/usr/local/bin/rsvg-convert', '/usr/bin/rsvg-convert']) {
    try {
      if ((await $.process.run([bin, '--version'], { timeoutMs: 5000 })).exitCode === 0) {
        rsvg = bin
        break
      }
    } catch {}
  }
  return { home: home ?? '/tmp', images, rsvg }
}

async function rasterize($: $, rsvg: string, home: string, svg: string, width: number, height: number, maxColumns: number, fontSize = 14): Promise<Picture | undefined> {
  const { columns, rows, zoom } = fitImage(width, height, maxColumns, fontSize)
  const dir = `${home}/.cache/ls-mermaid`
  const base = `${dir}/${hash(svg)}-${columns}`
  if (!(await $.fs.exists(`${base}.png`))) {
    await $.process.run(['mkdir', '-p', dir])
    await $.fs.write(`${base}.svg`, svg)
    // 先写临时文件再改名：转到一半被杀时不留下残缺的图
    const tmp = `${base}.${(await $.clock.now()).toString(36)}.png`
    const r = await $.process.run([rsvg, '-z', zoom.toFixed(3), '-o', tmp, `${base}.svg`], { timeoutMs: 20000 })
    if (r.exitCode !== 0) {
      await $.process.run(['rm', '-f', tmp])
      return undefined
    }
    if ((await $.process.run(['mv', '-f', tmp, `${base}.png`])).exitCode !== 0) throw new Error('mv failed')
  }
  const bytes = await $.fs.read(`${base}.png`, { as: 'bytes' })
  return { png: (bytes as { base64: string }).base64, columns, rows }
}
