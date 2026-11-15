// HTML to Markdown, ported from shareup/web-to-markdown-apple (HTMLToMarkdown.swift).
//
// Every function here runs *inside the browser page* (passed to
// page.evaluate), so it must stay self-contained: no imports, no closures
// over module scope. It walks the live DOM, which means we never need an HTML
// parser on the Node side.

/**
 * Remove common page chrome (nav, cookie banners, sidebars, …). Mirrors the
 * `--main` selector list from the Swift version.
 */
export function stripChrome() {
  const selectors = [
    "nav", "header", "footer", "aside",
    '[role="banner"]', '[role="contentinfo"]', '[role="navigation"]',
    '[role="complementary"]',
    '[id*="cookie" i]', '[class*="cookie" i]',
    '[id*="consent" i]', '[class*="consent" i]',
    '[id*="newsletter" i]', '[class*="newsletter" i]',
    '[id*="subscribe" i]', '[class*="subscribe" i]',
    '[class*="related" i]', '[class*="recommend" i]',
    '[class*="sidebar" i]', '[id*="sidebar" i]',
    '[id*="banner" i]', '[class*="promo" i]',
    "noscript", "script[src]", "style",
  ]
  for (const sel of selectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => el.remove())
    } catch {
      // invalid selector in this engine, skip
    }
  }
}

/** Page `<title>` and meta description, with Open Graph fallbacks. */
export function extractMetadata() {
  const pick = (...candidates) => {
    for (const fn of candidates) {
      const v = (fn() || "").trim()
      if (v) return v
    }
    return null
  }
  const attr = (sel) => document.querySelector(sel)?.getAttribute("content")
  return {
    title: pick(
      () => document.querySelector("title")?.textContent?.replace(/\s+/g, " "),
      () => attr('meta[property="og:title"]'),
    ),
    description: pick(
      () => attr('meta[name="description"]'),
      () => attr('meta[property="og:description"]'),
    ),
  }
}

/** Convert `document.body` to Markdown. `baseURL` resolves relative links. */
export function convertDocument(baseURL) {
  const ws = (s) => s.replace(/\s+/g, " ")
  const text = (el) => ws(el.textContent || "").trim()

  const resolve = (href) => {
    if (!baseURL) return href
    if (/^https?:\/\//i.test(href)) return href
    if (href.startsWith("//")) return "https:" + href
    try {
      return new URL(href, baseURL).href
    } catch {
      return href
    }
  }

  const children = (el, depth) => {
    let out = ""
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent || ""
        if (t.trim()) out += ws(t)
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        out += tag(node, depth)
      }
    }
    return out
  }

  const list = (el, depth) => {
    const ordered = el.tagName.toLowerCase() === "ol"
    const indent = "  ".repeat(depth)
    let n = 1
    let out = "\n"
    for (const li of el.children) {
      if (li.tagName.toLowerCase() !== "li") continue
      const prefix = ordered ? `${n++}. ` : "- "
      // Nested lists render on their own indented lines under the item.
      let body = ""
      let nested = ""
      for (const node of li.childNodes) {
        const isList = node.nodeType === Node.ELEMENT_NODE &&
          ["ul", "ol"].includes(node.tagName.toLowerCase())
        if (isList) {
          nested += list(node, depth + 1)
        } else if (node.nodeType === Node.TEXT_NODE) {
          const t = node.textContent || ""
          if (t.trim()) body += ws(t)
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          body += tag(node, depth)
        }
      }
      out += `${indent}${prefix}${body.trim().replace(/\n+/g, " ")}\n`
      if (nested.trim()) out += nested.replace(/^\n/, "").replace(/\n+$/, "") + "\n"
    }
    return out + "\n"
  }

  const table = (el, depth) => {
    const rows = [...el.querySelectorAll("tr")]
    if (!rows.length) return ""
    const cellsOf = (tr) => [...tr.querySelectorAll("th, td")]
    const cols = Math.max(0, ...rows.map((r) => cellsOf(r).length))
    if (!cols) return ""
    let out = "\n\n"
    rows.forEach((tr, i) => {
      const cells = cellsOf(tr).map((c) =>
        children(c, depth).trim().replace(/\n/g, " ").replace(/\|/g, "\\|")
      )
      while (cells.length < cols) cells.push("")
      out += `| ${cells.join(" | ")} |\n`
      if (i === 0) out += `| ${Array(cols).fill("---").join(" | ")} |\n`
    })
    return out + "\n"
  }

  const tag = (el, depth) => {
    const name = el.tagName.toLowerCase()
    switch (name) {
      case "script": case "style": case "nav": case "footer": case "aside":
      case "iframe": case "noscript": case "template": case "svg":
        return ""
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
        return `\n\n${"#".repeat(Number(name[1]))} ${text(el)}\n\n`
      case "p":
        return `\n\n${children(el, depth)}\n\n`
      case "br":
        return "\n"
      case "hr":
        return "\n\n---\n\n"
      case "strong": case "b": {
        const inner = children(el, depth)
        return inner.trim() ? `**${inner}**` : inner
      }
      case "em": case "i": {
        const inner = children(el, depth)
        return inner.trim() ? `*${inner}*` : inner
      }
      case "code":
        if (el.parentElement?.tagName.toLowerCase() === "pre") return el.textContent || ""
        return "`" + text(el) + "`"
      case "pre":
        // Keep whitespace exactly as written inside code blocks.
        return "\n\n```\n" + (el.textContent || "").replace(/\n+$/, "") + "\n```\n\n"
      case "a": {
        const label = text(el)
        const href = el.getAttribute("href")
        if (href && !href.startsWith("javascript:")) return `[${label}](${resolve(href)})`
        return label
      }
      case "img": {
        const alt = el.getAttribute("alt")
        const src = el.getAttribute("src")
        return alt && src ? `![${alt}](${resolve(src)})` : ""
      }
      case "ul": case "ol":
        return list(el, depth)
      case "blockquote": {
        const inner = children(el, depth).trim().replace(/\n{3,}/g, "\n\n")
        const lines = inner.split("\n").map((l) => {
          const t = l.trim()
          return t ? `> ${t}` : ">"
        })
        return `\n\n${lines.join("\n")}\n\n`
      }
      case "table":
        return table(el, depth)
      default:
        return children(el, depth)
    }
  }

  if (!document.body) throw new Error("No body element found")

  let md = children(document.body, 0).trim()
  // Trim trailing spaces on lines and collapse runs of blank lines.
  md = md.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
  return md
}
