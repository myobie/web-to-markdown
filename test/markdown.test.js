// Ported from shareup/web-to-markdown-apple Tests/WebToMarkdownTests/HTMLToMarkdownTests.swift
import { after, before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { chromium } from "playwright"
import { convertDocument, extractMetadata, stripChrome } from "../src/markdown.js"
import { formatFrontmatter, yamlEscape } from "../src/frontmatter.js"

let browser, page
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.WEB_TO_MARKDOWN_BROWSER })
  page = await browser.newPage()
})
after(() => browser?.close())

async function md(html, baseURL = null, { main = false } = {}) {
  // JS disabled-ish: setContent runs inline scripts, which is fine for these fixtures.
  await page.setContent(html)
  if (main) await page.evaluate(stripChrome)
  return page.evaluate(convertDocument, baseURL)
}
async function meta(html) {
  await page.setContent(html)
  return page.evaluate(extractMetadata)
}
const has = (s, sub) => assert.ok(s.includes(sub), `expected to find ${JSON.stringify(sub)} in:\n${s}`)
const hasNot = (s, sub) => assert.ok(!s.includes(sub), `did not expect ${JSON.stringify(sub)} in:\n${s}`)

describe("frontmatter", () => {
  const page = { statusCode: 200, finalURL: "https://example.com/" }
  const at = new Date(1_700_000_000_000)

  test("full block", () => {
    const out = formatFrontmatter(page, { title: "Hello", description: "A description." }, { fetchedAt: at })
    assert.ok(out.startsWith("---\n") && out.endsWith("\n---"))
    has(out, "status: 200")
    has(out, 'final-url: "https://example.com/"')
    has(out, "title: Hello")
    has(out, "description: A description.")
    has(out, 'fetched-at: "2023-11-14T22:13:20Z"')
  })
  test("omits missing title, description, status", () => {
    const out = formatFrontmatter({ finalURL: "https://example.com/" }, {}, { fetchedAt: at })
    hasNot(out, "title:")
    hasNot(out, "description:")
    hasNot(out, "status:")
  })
  test("truncates long descriptions", () => {
    const out = formatFrontmatter(page, { description: "a".repeat(300) }, { fetchedAt: at })
    has(out, "description: " + "a".repeat(200) + "…")
  })
  test("yamlEscape", () => {
    assert.equal(yamlEscape("Foo: Bar"), '"Foo: Bar"')
    assert.equal(yamlEscape('She said "hi"'), '"She said \\"hi\\""')
    assert.equal(yamlEscape("path\\to"), '"path\\\\to"')
    assert.equal(yamlEscape("foo #bar"), '"foo #bar"')
    assert.equal(yamlEscape("[Draft]"), '"[Draft]"')
    assert.equal(yamlEscape("*alias"), '"*alias"')
    assert.equal(yamlEscape("> block"), '"> block"')
    assert.equal(yamlEscape(""), '""')
    assert.equal(yamlEscape(" leading"), '" leading"')
    assert.equal(yamlEscape("trailing "), '"trailing "')
    assert.equal(yamlEscape("line one\nline two"), "line one line two")
    assert.equal(yamlEscape("Hello world"), "Hello world")
    assert.equal(yamlEscape("plain-value-123"), "plain-value-123")
  })
})

describe("metadata", () => {
  test("title and description", async () => {
    const m = await meta('<title>My Page</title><meta name="description" content="A nice description.">')
    assert.equal(m.title, "My Page")
    assert.equal(m.description, "A nice description.")
  })
  test("og fallbacks", async () => {
    const m = await meta('<meta property="og:title" content="OG Title Here"><meta property="og:description" content="OG description fallback.">')
    assert.equal(m.title, "OG Title Here")
    assert.equal(m.description, "OG description fallback.")
  })
  test("real title wins over og", async () => {
    const m = await meta('<title>Real Title</title><meta property="og:title" content="OG">')
    assert.equal(m.title, "Real Title")
  })
  test("blank title falls back to og", async () => {
    const m = await meta('<title>   </title><meta property="og:title" content="OG Backup">')
    assert.equal(m.title, "OG Backup")
  })
  test("trims whitespace", async () => {
    const m = await meta('<title>  Spaced Title  </title><meta name="description" content="  spaced description ">')
    assert.equal(m.title, "Spaced Title")
    assert.equal(m.description, "spaced description")
  })
  test("missing", async () => {
    const m = await meta("<p>nothing</p>")
    assert.equal(m.title, null)
    assert.equal(m.description, null)
  })
})

describe("convert", () => {
  test("headings", async () => {
    const out = await md("<h1>Level 1</h1><h2>Level 2</h2><h3>Level 3</h3><h4>Level 4</h4><h5>Level 5</h5><h6>Level 6</h6>")
    for (let i = 1; i <= 6; i++) has(out, `${"#".repeat(i)} Level ${i}`)
  })
  test("bold and italic", async () => {
    const out = await md("<p><b>Bold with b</b> <strong>bold with strong</strong> <i>Italic with i</i> <em>italic with em</em> <strong><em>Bold and italic</em></strong></p>")
    has(out, "**Bold with b**")
    has(out, "**bold with strong**")
    has(out, "*Italic with i*")
    has(out, "*italic with em*")
    has(out, "***Bold and italic***")
  })
  test("links", async () => {
    const base = "https://example.com/path/"
    has(await md('<a href="https://example.com">Example</a>'), "[Example](https://example.com)")
    has(await md('<a href="to/page">Page</a>', base), "[Page](https://example.com/path/to/page)")
    has(await md('<a href="/api/endpoint">API</a>', "https://example.com:8080/x"), "[API](https://example.com:8080/api/endpoint)")
    const none = await md("<a>No href</a>")
    has(none, "No href")
    hasNot(none, "[")
  })
  test("protocol relative", async () => {
    has(await md('<a href="//example.com/path">Link</a>'), "[Link](//example.com/path)")
    has(await md('<a href="//example.com/path">Link</a>', "http://mysite.test"), "[Link](https://example.com/path)")
  })
  test("images", async () => {
    has(await md('<img alt="An image" src="image.jpg">'), "![An image](image.jpg)")
    has(await md('<img alt="Photo" src="/images/photo.png">', "https://cdn.example.com/"), "![Photo](https://cdn.example.com/images/photo.png)")
    hasNot(await md('<img src="x.jpg">'), "!")
  })
  test("lists", async () => {
    const ul = await md("<ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>")
    has(ul, "- Item 1\n- Item 2\n- Item 3")
    const ol = await md("<ol><li>First</li><li>Second</li><li>Third</li></ol>")
    has(ol, "1. First\n2. Second\n3. Third")
  })
  test("nested lists are indented, not duplicated", async () => {
    const out = await md(`<ul><li>Parent 1<ul><li>Child 1.1</li><li>Child 1.2</li></ul></li><li>Parent 2</li></ul>`)
    assert.equal(out, "- Parent 1\n  - Child 1.1\n  - Child 1.2\n- Parent 2")
    const mixed = await md(`<ol><li>Ordered 1<ul><li>Unordered nested</li></ul></li><li>Ordered 2</li></ol>`)
    assert.equal(mixed, "1. Ordered 1\n  - Unordered nested\n2. Ordered 2")
  })
  test("code", async () => {
    has(await md("<p>Use <code>print()</code> function</p>"), "`print()`")
    const block = await md('<pre><code>func hello() {\n    print("Hello")\n}</code></pre>')
    has(block, '```\nfunc hello() {\n    print("Hello")\n}\n```')
    const two = await md("<pre><code>let x = 1</code></pre><p>Some text</p><pre><code>let y = 2</code></pre>")
    assert.equal(two.split("```").length - 1, 4)
  })
  test("blockquote", async () => {
    has(await md("<blockquote>This is a quote</blockquote>"), "> This is a quote")
    has(await md("<blockquote><p>Line one</p><p>Line two</p></blockquote>"), "> Line one\n>\n> Line two")
  })
  test("tables", async () => {
    const out = await md("<table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr><tr><td>Bob</td><td>25</td></tr></table>")
    has(out, "| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |")
    const uneven = await md("<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>1</td><td>2</td></tr></table>")
    has(uneven, "| A | B | C |")
    has(uneven, "| 1 | 2 |  |")
  })
  test("hr and br", async () => {
    has(await md("<p>Before</p><hr><p>After</p>"), "Before\n\n---\n\nAfter")
    has(await md("<p>Line 1<br>Line 2<br>Line 3</p>"), "Line 1\nLine 2\nLine 3")
  })
  test("filters script, style, nav, footer, aside", async () => {
    const out = await md(`<style>body { color: red; }</style><script>void 'alert'</script>
      <nav><a href="/home">Home</a></nav><header><h1>Site Title</h1></header>
      <main><p>Main content</p></main><footer>Copyright 2025</footer><aside>Sidebar</aside>`)
    hasNot(out, "alert")
    hasNot(out, "color: red")
    hasNot(out, "Home")
    has(out, "Site Title")
    has(out, "Main content")
    hasNot(out, "Copyright")
    hasNot(out, "Sidebar")
  })
  test("--main strips header and cookie banners", async () => {
    const out = await md(`<header><h1>Site Title</h1></header><div class="cookie-banner">We use cookies</div>
      <main><p>Main content</p></main>`, null, { main: true })
    hasNot(out, "Site Title")
    hasNot(out, "cookies")
    has(out, "Main content")
  })
  test("nested inline whitespace", async () => {
    has(await md("<div><section><article><p>Nested <strong>content</strong></p></article></section></div>"), "Nested **content**")
  })
  test("empty body", async () => {
    assert.equal(await md("<html><body>"), "")
  })
  test("real world blog post", async () => {
    const out = await md(`<article>
      <h1>How to Build Great Software</h1>
      <p>By <strong>Jane Developer</strong></p>
      <p>Building software is both an <em>art</em> and a <em>science</em>.</p>
      <ol><li>Write clean, readable code</li><li>Test thoroughly</li></ol>
      <h2>Best Practices</h2>
      <ul><li>Use version control</li></ul>
      <blockquote>
        Code is read more often than it is written.
      </blockquote>
      <p>For more information, visit <a href="https://example.com">our website</a>.</p>
    </article>`)
    has(out, "# How to Build Great Software")
    has(out, "**Jane Developer**")
    has(out, "*art*")
    has(out, "1. Write clean, readable code")
    has(out, "## Best Practices")
    has(out, "- Use version control")
    has(out, "> Code is read more often")
    has(out, "[our website](https://example.com)")
  })
})
