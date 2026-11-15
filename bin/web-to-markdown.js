#!/usr/bin/env node
import { parseArgs } from "node:util"
import { fetchPage, openContext } from "../src/fetch.js"
import { formatFrontmatter } from "../src/frontmatter.js"

const USAGE = `Usage: web-to-markdown <url> [options]
       web-to-markdown --login [url] --profile <dir>

Fetch a web page with Chromium and convert it to Markdown.

Output:
  --head                 Print only the frontmatter block
  --skip-frontmatter     Print only the body markdown
  --main                 Strip page chrome (nav, header, footer, cookies, sidebars)

Waiting (all bounded by --timeout):
  -t, --timeout <s>      Overall timeout in seconds (default 30)
  --wait <s>             Fixed delay after load (decimal allowed)
  --wait-for <css>       Wait until an element matches the selector
  --wait-for-text <str>  Wait until the body's visible text contains the string

Browser:
  --profile <dir>        Persistent profile, keeps cookies and logins   [$WEB_TO_MARKDOWN_PROFILE]
  --cdp <url>            Use an already running Chrome (remote debugging) [$WEB_TO_MARKDOWN_CDP]
  --channel <name>       Browser channel, e.g. "chrome" for installed Google Chrome
  --executable-path <p>  Explicit browser binary                       [$WEB_TO_MARKDOWN_BROWSER]
  --mobile               Emulate an iPhone
  --load-images          Load images, media and fonts (blocked by default)
  --headed               Show the browser window
  --login                Open a visible window with --profile so you can sign in, exit when closed

  -v, --verbose          Log progress to stderr
  -h, --help             Show this help`

function fail(msg, code = 1) {
  process.stderr.write(`web-to-markdown: ${msg}\n`)
  process.exit(code)
}

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      timeout: { type: "string", short: "t", default: "30" },
      verbose: { type: "boolean", short: "v", default: false },
      main: { type: "boolean", default: false },
      head: { type: "boolean", default: false },
      "skip-frontmatter": { type: "boolean", default: false },
      wait: { type: "string", default: "0" },
      "wait-for": { type: "string" },
      "wait-for-text": { type: "string" },
      profile: { type: "string" },
      cdp: { type: "string" },
      channel: { type: "string" },
      "executable-path": { type: "string" },
      mobile: { type: "boolean", default: false },
      "load-images": { type: "boolean", default: false },
      headed: { type: "boolean", default: false },
      login: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })
} catch (e) {
  fail(`${e.message}\n\n${USAGE}`, 2)
}

const { values: v, positionals } = parsed
if (v.help) {
  process.stdout.write(USAGE + "\n")
  process.exit(0)
}

const env = process.env
const opts = {
  timeout: Number(v.timeout),
  wait: Number(v.wait),
  waitFor: v["wait-for"],
  waitForText: v["wait-for-text"],
  main: v.main,
  mobile: v.mobile,
  loadImages: v["load-images"],
  headed: v.headed,
  profile: v.profile ?? env.WEB_TO_MARKDOWN_PROFILE,
  cdp: v.cdp ?? env.WEB_TO_MARKDOWN_CDP,
  channel: v.channel,
  executablePath: v["executable-path"] ?? env.WEB_TO_MARKDOWN_BROWSER,
  log: v.verbose ? (m) => process.stderr.write(m + "\n") : undefined,
}

if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) fail("--timeout must be a positive number", 2)
if (!Number.isFinite(opts.wait) || opts.wait < 0) fail("--wait must be zero or more", 2)
if (v.head && v["skip-frontmatter"]) {
  fail("--head and --skip-frontmatter are mutually exclusive: --head prints only the frontmatter, --skip-frontmatter prints only the body. Pick one.", 2)
}

if (v.login) {
  if (!opts.profile) fail("--login needs --profile <dir> (or $WEB_TO_MARKDOWN_PROFILE)", 2)
  const { context } = await openContext({ ...opts, headed: true })
  const page = context.pages()[0] ?? await context.newPage()
  if (positionals[0]) await page.goto(positionals[0]).catch(() => {})
  process.stderr.write("Sign in to whatever you need, then close the browser window.\n")
  await new Promise((resolve) => context.on("close", resolve))
  process.exit(0)
}

const url = positionals[0]
if (!url) fail(`missing <url>\n\n${USAGE}`, 2)
try {
  new URL(url)
} catch {
  fail(`Invalid URL: ${url}`, 2)
}

try {
  const page = await fetchPage(url, opts)
  if (!v["skip-frontmatter"]) {
    process.stdout.write(formatFrontmatter(page, page.metadata) + "\n")
    if (!v.head) process.stdout.write("\n")
  }
  if (!v.head) process.stdout.write(page.markdown + "\n")
} catch (e) {
  const msg = e?.name === "TimeoutError" ? `timed out after ${opts.timeout}s` : (e?.message ?? String(e))
  fail(msg.split("\n")[0])
}
