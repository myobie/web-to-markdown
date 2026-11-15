// YAML frontmatter, same keys and escaping rules as the Swift version.

const LEADING_INDICATORS = "-?:,[]{}#&*!|>'\"%@`"

export function yamlEscape(value) {
  const flat = String(value).replace(/\r\n|\n|\r/g, " ")
  const needsQuoting = flat.includes(":") ||
    flat.includes('"') ||
    flat.includes("\\") ||
    flat.includes("#") ||
    (flat.length > 0 && LEADING_INDICATORS.includes(flat[0])) ||
    flat.startsWith(" ") ||
    flat.endsWith(" ") ||
    flat.length === 0
  if (!needsQuoting) return flat
  return `"${flat.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function truncate(s, max) {
  const chars = [...s]
  return chars.length <= max ? s : chars.slice(0, max).join("") + "…"
}

/**
 * @param {{statusCode?: number|null, finalURL: string}} page
 * @param {{title?: string|null, description?: string|null}} metadata
 */
export function formatFrontmatter(page, metadata, {
  fetchedAt = new Date(),
  descriptionMaxLength = 200,
} = {}) {
  const lines = ["---"]
  if (page.statusCode != null) lines.push(`status: ${page.statusCode}`)
  lines.push(`final-url: ${yamlEscape(page.finalURL)}`)
  if (metadata.title) lines.push(`title: ${yamlEscape(metadata.title)}`)
  if (metadata.description) {
    lines.push(`description: ${yamlEscape(truncate(metadata.description, descriptionMaxLength))}`)
  }
  const iso = fetchedAt.toISOString().replace(/\.\d{3}Z$/, "Z")
  lines.push(`fetched-at: ${yamlEscape(iso)}`)
  lines.push("---")
  return lines.join("\n")
}
