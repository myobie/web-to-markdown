import { chromium, devices } from "playwright"
import { convertDocument, extractMetadata, stripChrome } from "./markdown.js"

/**
 * @typedef {object} FetchOptions
 * @property {number} [timeout=30]        Overall deadline in seconds (load + waits + extraction).
 * @property {boolean} [main=false]       Strip page chrome before conversion.
 * @property {number} [wait=0]            Fixed delay in seconds after load.
 * @property {string} [waitFor]           CSS selector to wait for.
 * @property {string} [waitForText]       Substring to wait for in the body's visible text.
 * @property {boolean} [mobile=false]     Emulate an iPhone (the Apple version asks WebKit for mobile content).
 * @property {boolean} [loadImages=false] Load images, media and fonts (blocked by default for speed).
 * @property {string} [cdp]               Connect to an already running Chrome over CDP, e.g. http://127.0.0.1:9222.
 * @property {string} [profile]           Persistent profile directory (cookies and logins survive between runs).
 * @property {string} [channel]           Browser channel, e.g. "chrome" to use the installed Google Chrome.
 * @property {string} [executablePath]    Explicit browser binary.
 * @property {boolean} [headed=false]     Show the browser window.
 * @property {(msg: string) => void} [log]
 */

/** Open a browser context according to the options. Returns {context, close}. */
export async function openContext(opts = {}) {
  const log = opts.log ?? (() => {})
  const launchOpts = {
    headless: !opts.headed,
    channel: opts.channel,
    executablePath: opts.executablePath,
  }
  const contextOpts = opts.mobile ? { ...devices["iPhone 15"] } : {}

  if (opts.cdp) {
    log(`Connecting to ${opts.cdp}`)
    const browser = await chromium.connectOverCDP(opts.cdp)
    const context = browser.contexts()[0] ?? await browser.newContext()
    // For a browser we connected to, close() only disconnects. It stays running.
    return { context, close: () => browser.close().catch(() => {}) }
  }

  if (opts.profile) {
    log(`Using profile ${opts.profile}`)
    const context = await chromium.launchPersistentContext(opts.profile, {
      ...launchOpts,
      ...contextOpts,
    })
    return { context, close: () => context.close() }
  }

  const browser = await chromium.launch(launchOpts)
  const context = await browser.newContext(contextOpts)
  return { context, close: () => browser.close() }
}

/** Headless Chromium says "HeadlessChrome" in its UA, which some sites block. */
async function hideHeadless(page) {
  const ua = await page.evaluate(() => navigator.userAgent)
  if (!ua.includes("HeadlessChrome")) return
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Network.setUserAgentOverride", {
    userAgent: ua.replace("HeadlessChrome", "Chrome"),
  })
}

/**
 * Load a URL and return {markdown, html, statusCode, finalURL, metadata}.
 * @param {string} url
 * @param {FetchOptions} [opts]
 */
export async function fetchPage(url, opts = {}) {
  const log = opts.log ?? (() => {})
  const timeoutMs = (opts.timeout ?? 30) * 1000
  const deadline = Date.now() + timeoutMs
  const remaining = () => Math.max(1, deadline - Date.now())

  const session = await openContext(opts)
  const page = await session.context.newPage()
  try {
    if (!opts.cdp) await hideHeadless(page)
    if (!opts.loadImages) {
      await page.route("**/*", (route) => {
        const type = route.request().resourceType()
        if (type === "image" || type === "media" || type === "font") return route.abort()
        return route.continue()
      })
    }

    log(`Loading ${url}`)
    const response = await page.goto(url, { waitUntil: "load", timeout: remaining() })
    const statusCode = response?.status() ?? null
    log(`Response status: ${statusCode}`)

    if (opts.wait > 0) await page.waitForTimeout(Math.min(opts.wait * 1000, remaining()))
    if (opts.waitFor) {
      log(`Waiting for selector ${opts.waitFor}`)
      await page.waitForSelector(opts.waitFor, { state: "attached", timeout: remaining() })
    }
    if (opts.waitForText) {
      log(`Waiting for text ${JSON.stringify(opts.waitForText)}`)
      await page.waitForFunction(
        (t) => (document.body?.innerText ?? "").includes(t),
        opts.waitForText,
        { polling: 100, timeout: remaining() },
      )
    }

    const finalURL = page.url()
    const metadata = await page.evaluate(extractMetadata)
    if (opts.main) await page.evaluate(stripChrome)
    const html = await page.evaluate(() => document.documentElement.outerHTML)
    const markdown = await page.evaluate(convertDocument, finalURL)
    log(`Extracted ${html.length} chars of HTML`)

    return { markdown, html, statusCode, finalURL, metadata }
  } finally {
    await page.close().catch(() => {})
    await session.close()
  }
}
