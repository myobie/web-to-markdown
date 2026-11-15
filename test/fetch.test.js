// End-to-end tests against a local HTTP server (no internet needed).
import { after, before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { fetchPage } from "../src/fetch.js"

const run = promisify(execFile)
const CLI = new URL("../bin/web-to-markdown.js", import.meta.url).pathname
const browserOpt = { executablePath: process.env.WEB_TO_MARKDOWN_BROWSER }

const pages = {
  "/": `<title>Home</title><meta name="description" content="Test: home"><h1>Hello</h1><p>World <a href="/about">about</a></p>`,
  "/late": `<title>Late</title><body><p>shell</p><script>
    setTimeout(() => { const d = document.createElement('div'); d.id = 'ready'; d.textContent = 'Hydrated content'; document.body.append(d) }, 400)
  </script></body>`,
  "/ua": `<body><script>document.write('<p>' + navigator.userAgent + '</p>')</script></body>`,
  "/whoami": null, // dynamic, echoes cookie
  "/chrome": `<header><h1>Site</h1></header><div id="cookie-consent">Accept cookies</div><main><p>Body text</p></main>`,
}

let server, base
before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://x")
    if (url.pathname === "/redirect") {
      res.writeHead(302, { location: "/" }).end()
      return
    }
    if (url.pathname === "/whoami") {
      res.writeHead(200, { "content-type": "text/html" })
      res.end(`<p>cookie=${req.headers.cookie ?? "none"}</p>`)
      return
    }
    if (url.pathname === "/set-cookie") {
      res.writeHead(200, { "content-type": "text/html", "set-cookie": "session=nathan; Max-Age=3600; Path=/" })
      res.end("<p>set</p>")
      return
    }
    const body = pages[url.pathname]
    res.writeHead(body ? 200 : 404, { "content-type": "text/html" })
    res.end(body ?? "<title>Not Found</title><h1>Nope</h1>")
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server?.close())

describe("fetchPage", () => {
  test("status, final url, metadata, markdown", async () => {
    const p = await fetchPage(`${base}/redirect`, browserOpt)
    assert.equal(p.statusCode, 200)
    assert.equal(p.finalURL, `${base}/`)
    assert.equal(p.metadata.title, "Home")
    assert.equal(p.metadata.description, "Test: home")
    assert.ok(p.markdown.includes("# Hello"))
    assert.ok(p.markdown.includes(`[about](${base}/about)`))
  })
  test("404 is reported, not thrown", async () => {
    const p = await fetchPage(`${base}/missing`, browserOpt)
    assert.equal(p.statusCode, 404)
    assert.ok(p.markdown.includes("# Nope"))
  })
  test("--wait-for waits for a late element", async () => {
    const p = await fetchPage(`${base}/late`, { ...browserOpt, waitFor: "#ready" })
    assert.ok(p.markdown.includes("Hydrated content"))
  })
  test("--wait-for-text waits for late text", async () => {
    const p = await fetchPage(`${base}/late`, { ...browserOpt, waitForText: "Hydrated" })
    assert.ok(p.markdown.includes("Hydrated content"))
  })
  test("--wait-for a missing selector times out", async () => {
    await assert.rejects(
      fetchPage(`${base}/`, { ...browserOpt, waitFor: "#never", timeout: 1 }),
      (e) => e.name === "TimeoutError",
    )
  })
  test("user agent does not say Headless", async () => {
    const p = await fetchPage(`${base}/ua`, browserOpt)
    assert.ok(!p.markdown.includes("Headless"), p.markdown)
    assert.ok(p.markdown.includes("Chrome/"), p.markdown)
  })
  test("--main strips chrome", async () => {
    const p = await fetchPage(`${base}/chrome`, { ...browserOpt, main: true })
    assert.equal(p.markdown, "Body text")
  })
  test("--profile keeps cookies between runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "w2m-profile-"))
    try {
      await fetchPage(`${base}/set-cookie`, { ...browserOpt, profile: dir })
      const p = await fetchPage(`${base}/whoami`, { ...browserOpt, profile: dir })
      assert.ok(p.markdown.includes("cookie=session=nathan"), p.markdown)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("cli", () => {
  const env = { ...process.env }
  test("frontmatter + body", async () => {
    const { stdout } = await run("node", [CLI, `${base}/`], { env })
    assert.match(stdout, /^---\nstatus: 200\nfinal-url: "http:\/\/127\.0\.0\.1:\d+\/"\ntitle: Home\ndescription: "Test: home"\nfetched-at: "[^"]+"\n---\n\n# Hello\n\nWorld \[about\]\(http:\/\/127\.0\.0\.1:\d+\/about\)\n$/)
  })
  test("--head", async () => {
    const { stdout } = await run("node", [CLI, `${base}/`, "--head"], { env })
    assert.ok(stdout.endsWith("---\n") && !stdout.includes("# Hello"))
  })
  test("--skip-frontmatter", async () => {
    const { stdout } = await run("node", [CLI, `${base}/`, "--skip-frontmatter"], { env })
    assert.ok(stdout.startsWith("# Hello"))
  })
  test("--head with --skip-frontmatter is an error", async () => {
    await assert.rejects(run("node", [CLI, `${base}/`, "--head", "--skip-frontmatter"], { env }), (e) => e.code === 2)
  })
  test("timeout exits 1 with a message", async () => {
    await assert.rejects(
      run("node", [CLI, `${base}/`, "--wait-for", "#never", "-t", "1"], { env }),
      (e) => e.code === 1 && e.stderr.includes("timed out after 1s"),
    )
  })
})
