/**
 * 把一段 Markdown 存成文件（浏览器端）。
 *
 * 单独抽出来是因为专题页与创作台都要用，且文件名需要做安全化处理
 * （用户输入的主题可能含斜杠、冒号等文件系统非法字符）。
 */

export function sanitizeFilename(input: string, fallback = "灵感仓"): string {
  const cleaned = (input || "")
    .replace(/[\\/:*?"<>|]/g, "-") // Windows 非法字符
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned || fallback;
}

export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 通用文本下载（JSON / Markdown / 纯文本） */
export function downloadText(
  filename: string,
  content: string,
  mime = "text/plain;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
