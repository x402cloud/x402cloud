/**
 * Browser-rendering handlers. Pure-ish: take (binding, body, deps), return data.
 *
 * Two operations, both backed by Cloudflare Browser Rendering through
 * `@cloudflare/puppeteer` (the only Workers-compatible puppeteer fork):
 *
 *   renderMarkdown   → navigate, grab HTML, convert to markdown
 *   renderScreenshot → navigate, screenshot, return PNG bytes
 *
 * Markdown conversion is intentionally tiny (~50 lines of regex). For agents
 * that need fidelity, the screenshot endpoint exists. A full HTML-to-markdown
 * library would add hundreds of KB to the Worker bundle for marginal gain.
 *
 * Known limits of the converter:
 *  - Does not preserve table layout (renders cells with single spaces).
 *  - Lists are flattened to "- " bullets regardless of nesting depth.
 *  - <pre>/<code> is preserved as ``` fences but inline `code` is not detected.
 *  - Inline styling (bold/italic) is stripped — paid scrape returns content,
 *    not typography.
 */

import { MAX_DURATION_MS } from "./pricing.js";

export type WaitUntil = "load" | "domcontentloaded" | "networkidle";

export type PageRequest = {
  url: string;
  waitFor?: WaitUntil;
  waitMs?: number;
};

export type PageResponse = {
  markdown: string;
  title: string;
  url: string;
  durationMs: number;
};

export type ScreenshotRequest = {
  url: string;
  fullPage?: boolean;
  waitFor?: WaitUntil;
  waitMs?: number;
};

export type ScreenshotResponse = {
  png: Uint8Array;
  durationMs: number;
};

/** Minimal viem-of-puppeteer surface we depend on. Lets us test without spinning a real browser. */
export type BrowserLike = {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
};

export type PageLike = {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  content(): Promise<string>;
  screenshot(opts?: { fullPage?: boolean; type?: "png" | "jpeg" }): Promise<Uint8Array>;
  close(): Promise<void>;
};

export type RenderDeps = {
  launch: (binding: unknown) => Promise<BrowserLike>;
  now: () => number;
};

export class ScrapeTimeoutError extends Error {
  constructor(public readonly durationMs: number) {
    super("scrape-timeout");
  }
}

export class FetchFailedError extends Error {
  constructor(public readonly reason: string) {
    super("fetch-failed");
  }
}

const WAIT_UNTIL_MAP: Record<WaitUntil, string> = {
  load: "load",
  domcontentloaded: "domcontentloaded",
  // Puppeteer accepts networkidle0/networkidle2; networkidle0 is the stricter
  // "no requests for 500ms" variant.
  networkidle: "networkidle0",
};

function clampWaitMs(input: number | undefined): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) return 0;
  return input > MAX_DURATION_MS ? MAX_DURATION_MS : input;
}

export async function renderMarkdown(
  binding: unknown,
  body: PageRequest,
  deps: RenderDeps,
): Promise<PageResponse> {
  if (typeof body?.url !== "string" || body.url.length === 0) {
    throw new FetchFailedError("missing-url");
  }
  const waitUntil = WAIT_UNTIL_MAP[body.waitFor ?? "load"];
  const waitMs = clampWaitMs(body.waitMs);

  const start = deps.now();
  const browser = await deps.launch(binding);
  try {
    const page = await browser.newPage();
    try {
      await navigate(page, body.url, waitUntil, deps.now() - start);
      if (waitMs > 0) await sleep(waitMs);
      const [html, title, finalUrl] = await Promise.all([
        page.content(),
        page.title(),
        Promise.resolve(page.url()),
      ]);
      const durationMs = deps.now() - start;
      return { markdown: htmlToMarkdown(html), title, url: finalUrl, durationMs };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function renderScreenshot(
  binding: unknown,
  body: ScreenshotRequest,
  deps: RenderDeps,
): Promise<ScreenshotResponse> {
  if (typeof body?.url !== "string" || body.url.length === 0) {
    throw new FetchFailedError("missing-url");
  }
  const waitUntil = WAIT_UNTIL_MAP[body.waitFor ?? "load"];
  const waitMs = clampWaitMs(body.waitMs);

  const start = deps.now();
  const browser = await deps.launch(binding);
  try {
    const page = await browser.newPage();
    try {
      await navigate(page, body.url, waitUntil, deps.now() - start);
      if (waitMs > 0) await sleep(waitMs);
      const png = await page.screenshot({ fullPage: body.fullPage ?? false, type: "png" });
      const durationMs = deps.now() - start;
      return { png, durationMs };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

async function navigate(page: PageLike, url: string, waitUntil: string, elapsedMs: number): Promise<void> {
  const remaining = Math.max(1000, MAX_DURATION_MS - elapsedMs);
  try {
    await page.goto(url, { waitUntil, timeout: remaining });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout|timed out/i.test(msg)) throw new ScrapeTimeoutError(remaining);
    throw new FetchFailedError(msg);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tiny HTML → markdown converter. Intentionally regex-based; see file header
 * comment for the limits. Order matters: structural blocks first, then inline,
 * then whitespace cleanup.
 */
export function htmlToMarkdown(html: string): string {
  let s = html;

  // Drop non-content sections entirely.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, "");

  // Headings.
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
    const hashes = "#".repeat(Number(level));
    return `\n\n${hashes} ${stripTags(inner).trim()}\n\n`;
  });

  // Links: <a href="...">text</a> → [text](href)
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const text = stripTags(inner).trim();
    return text ? `[${text}](${href})` : href;
  });

  // Images: <img alt="..." src="..."> → ![alt](src)
  s = s.replace(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi, (match, src) => {
    const altMatch = /alt=["']([^"']*)["']/i.exec(match);
    return `![${altMatch?.[1] ?? ""}](${src})`;
  });

  // Code blocks.
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
    return `\n\n\`\`\`\n${stripTags(inner)}\n\`\`\`\n\n`;
  });

  // List items.
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${stripTags(inner).trim()}`);

  // Paragraph/break spacing.
  s = s.replace(/<\/(p|div|section|article|header|footer|main)>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>(\s*)/gi, "\n");

  // Strip everything that's left.
  s = stripTags(s);

  // Decode the handful of entities that survive.
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Collapse whitespace: 3+ newlines → 2, trim trailing space per line.
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/[ \t]{2,}/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

/**
 * Build a production `RenderDeps` whose `launch` lazily imports the
 * `@cloudflare/puppeteer` SDK on first use and memoises the loader inside a
 * closure — no module-level mutable state.
 *
 * Call this once per isolate inside `createApp(env)`.
 */
export function createDefaultRenderDeps(): RenderDeps {
  let launchFn: ((binding: unknown) => Promise<BrowserLike>) | null = null;
  let loadPromise: Promise<(binding: unknown) => Promise<BrowserLike>> | null = null;

  async function load(): Promise<(binding: unknown) => Promise<BrowserLike>> {
    if (launchFn) return launchFn;
    if (!loadPromise) {
      loadPromise = (async () => {
        const mod = (await import("@cloudflare/puppeteer")) as {
          default: { launch: (binding: unknown, opts?: unknown) => Promise<unknown> };
        };
        const fn = async (binding: unknown) =>
          (await mod.default.launch(binding)) as BrowserLike;
        launchFn = fn;
        return fn;
      })();
    }
    return loadPromise;
  }

  return {
    launch: async (binding) => {
      if (!launchFn) {
        throw new Error(
          "Browser SDK not initialised — await initRenderDeps(deps) before renderMarkdown()",
        );
      }
      return launchFn(binding);
    },
    now: () => Date.now(),
    ...({ __load: load } as object),
  } as RenderDeps;
}

/**
 * Eagerly resolve the lazy SDK loader for a `RenderDeps` produced by
 * `createDefaultRenderDeps`. No-op for test deps that don't carry a loader.
 */
export async function initRenderDeps(deps: RenderDeps): Promise<void> {
  const load = (deps as unknown as { __load?: () => Promise<unknown> }).__load;
  if (typeof load === "function") {
    await load();
  }
}
