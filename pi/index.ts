// pi 扩展：把助手回复里闭合的 ```mermaid 代码块画成图。终端能显示图片就出图片，否则出字符图，都不行就留原代码块。
//
// 接入点是 pi 公开的 Markdown 转换器：pi 渲染一段 Markdown 前把原文和可用宽度交给我们，我们换成图再交回去。
// 字符图和图片都编码成「每行一个行内代码 + 硬换行」，pi 的 Markdown 会原样保留；图片行带 kitty / iTerm2 转义序列，
// pi 认得这种行，不折行不截断，fullscreen 模式滚动时按图片 id 复用已上传的图。
//
// 转换器必须同步返回，所以整条路径都是同步的：pele 出 SVG、rsvg-convert 转 PNG（每张图只转一次，按自然尺寸出图，
// 窄了交给终端按格子缩放）、字符图。改宽度、滚动时只查缓存，不重新转图。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

import { getAgentDir, type ExtensionAPI, type ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import { allocateImageId, getCapabilities, getCellDimensions, getPngDimensions, renderImage } from '@earendil-works/pi-tui'
import { render, renderAscii } from 'pele/ascii'

import { DEFAULTS, fitImage, flatten, hash, paletteOf, split, type Appearance, type Palette } from '../core/diagram.ts'

type Style = { palette: Palette; fontSize?: number; fontFamily?: string; id: string }
type Svg = { svg: string; width: number; height: number }
type Png = { key: string; base64: string; widthPx: number; heightPx: number; imageId: number }
type Settings = { showImages: boolean; outputPad: number; builtIn: boolean }

// 主题文件、pi 设置多久重新看一次
const RECHECK_MS = 2000
// rsvg-convert 偶发失败（超时、被杀）后多久再试
const RETRY_MS = 30000
// 内存里每种缓存最多留多少项（PNG 是整张图）
const KEEP = 64
// 终端图片协议里一张图最多占多少格，和 core 里的上限一致
const MAX_CELLS = 255

// Map 按插入顺序，超了就丢最早的
const remember = <V>(map: Map<string, V>, key: string, value: V) => {
  map.delete(key)
  map.set(key, value)
  if (map.size > KEEP) map.delete(map.keys().next().value!)
  return value
}

export default function mermaid(pi: ExtensionAPI) {
  // 只存每次都一样的结果。null 表示确定画不了（解析失败、太宽、rsvg-convert 报错）
  const arts = new Map<string, string[] | null>()
  const svgs = new Map<string, Svg | null>()
  const pngs = new Map<string, Png | null>()
  const failedAt = new Map<string, number>()
  // 每张图当前的显示尺寸和对应的行。一张图同一时间只用一种尺寸：pi 按图片 id 记尺寸，换尺寸就重登记
  const shown = new Map<string, { size: string; lines: string[] }>()

  let ui: ExtensionUIContext | undefined
  let cwd = process.cwd()
  let trusted = false
  let settings: { at: number; value: Settings } | undefined
  let style: { at: number; appearance: Appearance | undefined; value: Style } | undefined
  let warned = false
  const rsvg = findRsvg()

  pi.on('session_start', (_event, ctx) => {
    ui = ctx.hasUI ? ctx.ui : undefined
    cwd = ctx.cwd
    trusted = ctx.isProjectTrusted()
    settings = undefined
    // pi 自带的 Mermaid 字符图排在扩展前面，开着时我们拿不到原代码块
    if (ui && !warned && currentSettings().builtIn) {
      warned = true
      ui.notify('Turn off Mermaid diagrams in /settings to let mermaid-tui draw them', 'info')
    }
  })

  const currentSettings = (): Settings => {
    const now = Date.now()
    if (!settings || now - settings.at > RECHECK_MS) settings = { at: now, value: readSettings(cwd, trusted) }
    return settings.value
  }

  const currentStyle = (): Style => {
    const now = Date.now()
    const appearance = ui?.theme.appearance
    if (!style || style.appearance !== appearance || now - style.at > RECHECK_MS) {
      style = { at: now, appearance, value: resolveStyle(appearance) }
    }
    return style.value
  }

  const art = (source: string, columns: number): string[] | null => {
    const key = `${columns}\0${source}`
    const hit = arts.get(key)
    if (hit !== undefined) return remember(arts, key, hit)
    let lines: string[] | null
    try {
      lines = renderAscii(source, { maxWidth: columns }).lines
    } catch {
      // 解析失败或太宽画不下
      lines = null
    }
    return remember(arts, key, lines)
  }

  const svgOf = (source: string, look: Style): Svg | null => {
    const key = `${look.id}\0${source}`
    const hit = svgs.get(key)
    if (hit !== undefined) return remember(svgs, key, hit)
    let svg: Svg | null
    try {
      const r = render(source, { fontSize: look.fontSize, fontFamily: look.fontFamily })
      svg = { svg: flatten(r.svg, look.palette), width: r.width, height: r.height }
    } catch {
      svg = null
    }
    return remember(svgs, key, svg)
  }

  // 按图的自然尺寸转一次 PNG。返回 undefined 表示这次没转成，不进缓存，过一会儿再试
  const pngOf = (svg: Svg, fontSize: number | undefined): Png | null | undefined => {
    const key = hash(svg.svg)
    const hit = pngs.get(key)
    if (hit !== undefined) return remember(pngs, key, hit)
    if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_MS) return undefined
    const { columns, zoom } = fitImage(svg.width, svg.height, MAX_CELLS, fontSize)
    const dir = join(homedir(), '.cache', 'mermaid-tui')
    const base = join(dir, `${key}-${columns}-${zoom.toFixed(3)}`)
    try {
      if (!existsSync(`${base}.png`)) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(`${base}.svg`, svg.svg)
        // 先写临时文件再改名：转到一半被杀时不留下残缺的图
        const tmp = `${base}.${process.pid}.${Date.now().toString(36)}.png`
        try {
          execFileSync(rsvg!, ['-z', zoom.toFixed(3), '-o', tmp, `${base}.svg`], { timeout: 20000, stdio: 'ignore' })
        } catch (error) {
          rmSync(tmp, { force: true })
          const { status, signal } = error as { status?: number | null; signal?: string | null }
          // 正常退出但报错：这张图它就是转不了
          if (typeof status === 'number' && !signal) return remember(pngs, key, null)
          throw error
        }
        renameSync(tmp, `${base}.png`)
      }
      const base64 = readFileSync(`${base}.png`).toString('base64')
      const dims = getPngDimensions(base64)
      if (!dims) {
        rmSync(`${base}.png`, { force: true })
        throw new Error('bad png')
      }
      failedAt.delete(key)
      return remember(pngs, key, { key, base64, ...dims, imageId: allocateImageId() })
    } catch {
      failedAt.set(key, Date.now())
      return undefined
    }
  }

  const image = (source: string, columns: number, pad: number): string[] | undefined => {
    const look = currentStyle()
    const svg = svgOf(source, look)
    if (!svg) return undefined
    const png = pngOf(svg, look.fontSize)
    if (!png) return undefined
    const fit = fitImage(svg.width, svg.height, columns, look.fontSize)
    const cell = getCellDimensions()
    const protocol = getCapabilities().images
    const size = `${fit.columns}\0${cell.widthPx}x${cell.heightPx}\0${protocol}\0${pad}`
    const hit = shown.get(png.key)
    if (hit?.size === size) return remember(shown, png.key, hit).lines
    const r = renderImage(png.base64, png, { maxWidthCells: fit.columns, maxHeightCells: MAX_CELLS, imageId: png.imageId, moveCursor: false })
    if (!r) return undefined
    // 和 pi-tui 的 Image 组件一样占 rows 行：kitty 在第一行画，iTerm2 在最后一行往上挪了再画
    const margin = ' '.repeat(pad)
    const blank = Array.from({ length: r.rows - 1 }, () => '')
    const moveUp = r.rows > 1 ? `\x1b[${r.rows - 1}A` : ''
    const lines = protocol === 'kitty' ? [margin + r.sequence, ...blank] : [...blank, margin + moveUp + r.sequence]
    return remember(shown, png.key, { size, lines }).lines
  }

  pi.registerMarkdownTransformer(
    (markdown, { availableWidth }) => {
      if (!markdown.includes('mermaid')) return markdown
      const segments = split(markdown)
      if (!segments.some((s) => s.kind === 'mermaid')) return markdown
      const { showImages, outputPad } = currentSettings()
      const images = rsvg !== undefined && showImages && getCapabilities().images !== null
      return segments
        .map((s) => {
          if (s.kind === 'text') return s.text
          const picture = images ? image(s.source, availableWidth, outputPad) : undefined
          if (picture) return rows(picture)
          const lines = art(s.source, availableWidth)
          if (lines) return rows(lines.map((l) => (ui ? ui.theme.fg('text', l) : l)))
          // 画不了：显示原代码块
          return s.fence
        })
        .join('\n\n')
    },
    { messageTypes: ['assistant'] },
  )
}

// 每行一个行内代码，硬换行分隔：pi 的 Markdown 会保留行内的空格和框线字符。
// 行首行尾的空格换成不换行空格，免得行内代码吃掉两头各一个空格；空行也用它占住高度
function rows(lines: string[]): string {
  return lines
    .map((line) => {
      const content = line.replace(/^ +| +$/g, (m) => ' '.repeat(m.length)) || ' '
      const longest = Math.max(0, ...Array.from(content.matchAll(/`+/g), (m) => m[0].length))
      const fence = '`'.repeat(longest + 1)
      const space = content.startsWith('`') || content.endsWith('`') ? ' ' : ''
      return `${fence}${space}${content}${space}${fence}`
    })
    .join('  \n')
}

const readJson = (path: string): Record<string, unknown> => {
  try {
    const json = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
const section = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'object' && o[k] !== null ? (o[k] as Record<string, unknown>) : {})

// 只读 pi 的设置文件（全局 + 受信任项目的），用到的三项：显示图片、输出缩进、pi 自带的 Mermaid 渲染
function readSettings(cwd: string, trusted: boolean): Settings {
  const layers = [readJson(join(getAgentDir(), 'settings.json')), trusted ? readJson(join(cwd, '.pi', 'settings.json')) : {}]
  let showImages = true
  let outputPad = 1
  let builtIn = true
  for (const s of layers) {
    const showImagesValue = section(s, 'terminal').showImages
    if (typeof showImagesValue === 'boolean') showImages = showImagesValue
    if (s.outputPad === 0 || s.outputPad === 1) outputPad = s.outputPad
    const mode = section(s, 'markdown').mermaid
    if (typeof mode === 'string') builtIn = mode !== 'off'
  }
  return { showImages, outputPad, builtIn }
}

// 热重载后清空没关系
let themeFile: { mtimeMs: number; json: Record<string, unknown> } | undefined

// 主题文件 <pi 配置目录>/mermaid-tui-theme.json，格式和 Claude Code 版一样：改了就生效
function readThemeFile(): Record<string, unknown> {
  const path = join(getAgentDir(), 'mermaid-tui-theme.json')
  try {
    const { mtimeMs } = statSync(path)
    if (themeFile?.mtimeMs === mtimeMs) return themeFile.json
    const json = JSON.parse(readFileSync(path, 'utf8')) as unknown
    themeFile = { mtimeMs, json: typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {} }
    return themeFile.json
  } catch {
    return themeFile?.json ?? {}
  }
}

// 明暗跟 pi 当前主题走；主题文件里的 appearance 可以强制指定
function resolveStyle(appearance: Appearance | undefined): Style {
  const file = readThemeFile()
  const forced = file.appearance === 'light' || file.appearance === 'dark' ? file.appearance : undefined
  const look = forced ?? appearance ?? 'dark'
  const palette = { ...DEFAULTS[look], ...paletteOf(file), ...paletteOf(file[look]) }
  const fontSize = typeof file.fontSize === 'number' && file.fontSize > 0 ? file.fontSize : undefined
  const fontFamily = typeof file.font === 'string' ? file.font : undefined
  return { palette, fontSize, fontFamily, id: hash(JSON.stringify([palette, fontSize, fontFamily])) }
}

// 进程一次：rsvg-convert 在哪。只查文件，不起子进程
function findRsvg(): string | undefined {
  const dirs = [...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
  for (const dir of dirs) {
    const bin = join(dir, 'rsvg-convert')
    if (dir && existsSync(bin)) return bin
  }
  return undefined
}
