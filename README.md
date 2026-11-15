# web-to-markdown

Fetch a web page with a real Chromium (via Playwright) and convert it to
Markdown. Works on Linux and macOS.

A port of [shareup/web-to-markdown-apple](https://github.com/shareup/web-to-markdown-apple),
which uses WKWebView. Same flags, same output.

## Install

```bash
npm install -g .
npx playwright install chromium   # or use --channel chrome to drive an installed Google Chrome
```

## Usage

```bash
web-to-markdown https://example.com
web-to-markdown https://example.com --main --timeout 20 --verbose
```

Output is a YAML frontmatter block followed by the body markdown:

```
---
status: 200
final-url: "https://example.com/"
title: Example Domain
fetched-at: "2026-11-15T12:00:00Z"
---

# Example Domain
…
```

### Flags

- `--main` strips page chrome (nav, header, footer, cookie banners, sidebars, recommendations)
- `--head` prints only the frontmatter, `--skip-frontmatter` only the body
- `--wait <s>` fixed delay after load
- `--wait-for <css>` wait until an element matches
- `--wait-for-text <str>` wait until the visible text contains a string
- `-t, --timeout <s>` overall deadline, default 30, bounds every wait
- `--mobile` emulate an iPhone (the Apple version asks WebKit for mobile content)
- `--load-images` images, media and fonts are blocked by default for speed

JS-heavy pages work the same way as with the Apple version:

```bash
web-to-markdown 'https://www.youtube.com/watch?v=...' --wait-for '#subscribe-button' --timeout 20
```

## Fetching as yourself

The point of using a real browser is to make the request the way you would.
There are two ways to carry your logins along.

**A dedicated profile (recommended).** Sign in once in a visible window, then
every headless run reuses those cookies:

```bash
export WEB_TO_MARKDOWN_PROFILE=~/.local/share/web-to-markdown/profile
web-to-markdown --login https://www.youtube.com    # sign in, close the window
web-to-markdown https://www.youtube.com/feed/subscriptions
```

Add `--channel chrome` to use your installed Google Chrome binary instead of
Playwright's Chromium.

**An already running Chrome over CDP.** Start Chrome with remote debugging and
point the tool at it:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-debug"
web-to-markdown https://example.com --cdp http://127.0.0.1:9222
```

Since Chrome 136, `--remote-debugging-port` is ignored for your *default*
Chrome profile, so it has to be a separate `--user-data-dir`
([Chrome blog](https://developer.chrome.com/blog/remote-debugging-port)).

## Environment variables

- `WEB_TO_MARKDOWN_PROFILE` default for `--profile`
- `WEB_TO_MARKDOWN_CDP` default for `--cdp`
- `WEB_TO_MARKDOWN_BROWSER` default for `--executable-path`

## Library

```js
import { fetchPage, formatFrontmatter } from "web-to-markdown"

const page = await fetchPage("https://example.com", { main: true, waitFor: "article" })
console.log(formatFrontmatter(page, page.metadata))
console.log(page.markdown)
```

The converter runs inside the page against the live DOM, so there is no HTML
parser dependency. Playwright is the only dependency.

## Differences from the Apple version

- Nested lists are indented under their parent item instead of flattened and repeated.
- `|` inside table cells is escaped.
- The user agent drops `HeadlessChrome` so sites see a normal Chrome.
- Images, media and fonts are blocked rather than hidden.

## Tests

```bash
npm test
```

Runs against a local HTTP server, no internet needed. Set
`WEB_TO_MARKDOWN_BROWSER` to use a specific Chromium binary.
