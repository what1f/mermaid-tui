<h1 align="center">mermaid-tui</h1>

<p align="center">在编程 Agent 的终端里，直接看到 Mermaid 图。</p>

<p align="center"><a href="README.md">English</a> | <b>简体中文</b></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/demo-claude-code-dark.gif">
    <img alt="Claude Code 回复了一个 Mermaid 流程图，显示成了图片" src="docs/demo-claude-code-light.gif" width="880">
  </picture>
</p>

Agent 回复里出现 ```` ```mermaid ```` 代码块时，你看到的是图，而不是源码。能显示图片的终端里，是一张跟随主题配色的清晰图片；其他终端里，是按宽度排好的字符图。

支持 [Claude Code](#claude-code) 和 [pi](#pi)。

## 安装

### Claude Code

```
/plugin install mermaid --marketplace what1f/mermaid-tui
```

显示图片需要 `rsvg-convert`：

```
brew install librsvg
```

| 在哪里 | 显示成什么 |
| --- | --- |
| kitty、Ghostty | 图片 |
| 其他支持 kitty 图形协议的终端（WezTerm、Rex…） | 设置 `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` 后显示图片 |
| 其他终端 | 字符图 |
| 桌面版、编辑器插件 | SVG |

想固定一种画法，在 `/config` 里设置 **Drawing**：`auto`（默认）、`image`、`text` 或 `off`。

### pi

```
pi install git:github.com/what1f/mermaid-tui
```

然后在 `/settings` 里关掉 **Mermaid diagrams**，让 pi 自带的字符图把代码块交给 mermaid-tui 来画。这里显示图片同样需要 `rsvg-convert`，pi 能显示图片的终端里就会出图。

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/demo-pi-dark.gif">
    <img alt="pi 回复了一个 Mermaid 时序图，显示成了图片" src="docs/demo-pi-light.gif" width="880">
  </picture>
</p>

## 字符图

终端不支持图片时，同一张图会画成字符图，宽度自动适配终端。

<p align="center">
  <img alt="Claude Code 里用字符画出的时序图" src="docs/text-art.png" width="880">
</p>

## 图库

<table>
  <tr>
    <th>图片</th>
    <th>字符图</th>
  </tr>
  <tr>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/gallery/flowchart-dark.png">
        <img alt="流程图，画成图片" src="docs/gallery/flowchart-light.png" width="194">
      </picture>
    </td>
    <td align="center"><img alt="同一张流程图，画成字符图" src="docs/gallery/flowchart-text.png" width="218"></td>
  </tr>
  <tr>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/gallery/sequence-dark.png">
        <img alt="时序图，画成图片" src="docs/gallery/sequence-light.png" width="326">
      </picture>
    </td>
    <td align="center"><img alt="同一张时序图，画成字符图" src="docs/gallery/sequence-text.png" width="386"></td>
  </tr>
  <tr>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/gallery/state-dark.png">
        <img alt="状态图，画成图片" src="docs/gallery/state-light.png" width="230">
      </picture>
    </td>
    <td align="center"><img alt="同一张状态图，画成字符图" src="docs/gallery/state-text.png" width="201"></td>
  </tr>
  <tr>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/gallery/class-dark.png">
        <img alt="类图，画成图片" src="docs/gallery/class-light.png" width="238">
      </picture>
    </td>
    <td align="center"><img alt="同一张类图，画成字符图" src="docs/gallery/class-text.png" width="268"></td>
  </tr>
  <tr>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/gallery/er-dark.png">
        <img alt="实体关系图，画成图片" src="docs/gallery/er-light.png" width="276">
      </picture>
    </td>
    <td align="center"><img alt="同一张实体关系图，画成字符图" src="docs/gallery/er-text.png" width="302"></td>
  </tr>
  <tr>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/gallery/pie-dark.png">
        <img alt="饼图，画成图片" src="docs/gallery/pie-light.png" width="280">
      </picture>
    </td>
    <td align="center"><img alt="同一张饼图，画成字符图" src="docs/gallery/pie-text.png" width="411"></td>
  </tr>
</table>

所有 Mermaid 图表类型都能画成这两种：甘特图、思维导图、时间线、Git 图、C4、架构图、看板等等。全部类型的字符图效果见 [pele/ascii 图库](https://github.com/what1f/pele/blob/ascii/GALLERY.md)。

还在流式输出的代码块，闭合之前保持代码块的样子；解析不了的代码块也一样。改变的只是显示，Agent 读到的仍然是 Mermaid 源码。

## 主题

图片跟随 Agent 的主题：亮色主题画亮色，暗色主题画暗色，`auto` 跟随系统。

<details>
<summary>修改颜色和字体</summary>

Claude Code 在 `~/.claude/`、pi 在 `~/.pi/agent/` 下新建 `mermaid-tui-theme.json`。所有字段都可以不填，改完后画下一张图时生效。

```json
{
  "appearance": "auto",
  "fontSize": 14,
  "font": "PingFang SC",
  "radius": 6,
  "light": { "fg": "#1f2328", "line": "#424a53", "surface": "#f3f5f8", "border": "#6e7781", "accent": "#0969da" },
  "dark": { "fg": "#e8eaed", "line": "#c2c8d1", "surface": "#262a31", "border": "#8b939e", "accent": "#6ea8fe" }
}
```

| 字段 | 作用 |
| --- | --- |
| `appearance` | `auto`（跟随 Agent）、`light` 或 `dark` |
| `fontSize`、`font`、`fontMono` | 文字大小（px）和字体 |
| `radius` | 圆角（px） |
| `bg` | 压在连线上的标签背后的颜色 |
| `fg`、`muted` | 文字、次要文字 |
| `line`、`border` | 连线、节点边框 |
| `surface`、`surfaceAlt` | 节点填充色 |
| `accent`、`critical` | 强调、关键项 |
| `series` | 饼图扇区和图表系列的颜色列表 |

写在顶层的颜色对亮色和暗色都生效；写在 `light` 或 `dark` 下的只对那一种生效。

</details>

## 致谢

图由 [pele](https://github.com/obsidianmd/pele) 绘制，用的是加了字符图的 [fork](https://github.com/what1f/pele)。

## 开发

| 目录 | 内容 |
| --- | --- |
| `core/` | 各个 Agent 共用的部分：找出 Mermaid 代码块、配色、图片尺寸 |
| `claude-code/` | Claude Code 插件 |
| `pi/` | pi 扩展 |
| `scripts/` | 构建脚本，以及生成上面图库的脚本 |

pi 安装的是整个仓库，所以 `pi/` 直接引用 `core/`。Claude Code 安装插件时只复制插件目录，所以 `pnpm build` 会把 `core/` 和 pele 复制到 `claude-code/hooks/`，复制出来的文件也提交到仓库。改代码请改 `core/`，不要改复制品。升级 pele 时，修改 `package.json` 里它的 release 地址，然后：

```
pnpm install
pnpm build
```

CI 会检查提交的复制品是否最新。`node scripts/gallery.mjs` 会重新生成图库。

## 许可证

MIT
