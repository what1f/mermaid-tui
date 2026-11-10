// 只声明插件用到的部分，完整 API 见 pele 仓库。
export interface RenderResult {
  svg: string;
  width: number;
  height: number;
}
export function render(source: string, options?: { maxWidth?: number; fontSize?: number; fontFamily?: string }): RenderResult;

export interface AsciiResult {
  text: string;
  lines: string[];
  width: number;
  height: number;
}
export function renderAscii(source: string, options?: { maxWidth?: number; charset?: 'unicode' | 'ascii' }): AsciiResult;
