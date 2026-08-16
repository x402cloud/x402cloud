import type { ProbeReport, ProbeResult, ProbeStatus, SettlementSummary } from "@x402cloud/probes";

const STATUS_COLORS: Record<ProbeStatus, string> = {
  pass: "#22c55e",
  fail: "#ef4444",
  warn: "#f59e0b",
  skip: "#6b7280",
};

// These two probe results are pulled out of the generic list and rendered
// as dedicated wallet tiles instead (still counted in the pass/fail/warn/skip
// summary — this is a presentation choice, the JSON `results` array is
// unchanged).
const WALLET_PROBE_NAMES = new Set(["gas-estimate", "usdc-balance"]);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateValue(value: unknown): string {
  const str = String(value);
  if (str.startsWith("0x") && str.length > 14) {
    return `${str.slice(0, 6)}...${str.slice(-4)}`;
  }
  if (str.length > 60) {
    return `${str.slice(0, 57)}...`;
  }
  return str;
}

function renderMeta(meta: Record<string, unknown>): string {
  const entries = Object.entries(meta);
  if (entries.length === 0) return "";

  const items = entries
    .map(([key, value]) => {
      const displayValue = escapeHtml(truncateValue(value));
      const displayKey = escapeHtml(key);
      return `<span class="meta-item"><span class="meta-key">${displayKey}:</span> ${displayValue}</span>`;
    })
    .join("");

  return `<div class="meta">${items}</div>`;
}

function renderProbeRow(result: ProbeResult): string {
  const color = STATUS_COLORS[result.status];
  const errorHtml = result.error
    ? `<div class="error">${escapeHtml(result.error)}</div>`
    : "";
  const metaHtml = result.meta ? renderMeta(result.meta) : "";

  return `
    <div class="probe-row">
      <div class="probe-header">
        <div class="probe-name">
          <span class="status-dot" style="background: ${color}"></span>
          ${escapeHtml(result.name)}
        </div>
        <div class="probe-right">
          <span class="status-badge" style="color: ${color}">${result.status}</span>
          <span class="latency">${result.latencyMs}ms</span>
        </div>
      </div>
      ${errorHtml}
      ${metaHtml}
    </div>`;
}

/** One large-digit stat tile for a wallet balance probe (ETH gas or USDC revenue). */
function renderWalletTile(
  label: string,
  result: ProbeResult | undefined,
  unit: string,
  balanceKey: string,
): string {
  if (!result) {
    return `
    <div class="wallet-tile">
      <div class="wallet-label">${escapeHtml(label)}</div>
      <div class="wallet-value wallet-unavailable">not available</div>
    </div>`;
  }

  const color = STATUS_COLORS[result.status];
  const balance = result.meta?.[balanceKey];
  const network = result.meta?.network as string | undefined;
  const address = result.meta?.address as string | undefined;
  const valueText =
    balance !== undefined ? `${escapeHtml(String(balance))} ${unit}` : (result.error ?? "unknown");

  return `
    <div class="wallet-tile" style="border-left-color: ${color}">
      <div class="wallet-label">
        <span class="status-dot" style="background: ${color}"></span>
        ${escapeHtml(label)}
      </div>
      <div class="wallet-value">${valueText}</div>
      <div class="wallet-sub">${network ? escapeHtml(network) : ""}${address ? ` &middot; ${escapeHtml(truncateValue(address))}` : ""}</div>
      ${result.error ? `<div class="error">${escapeHtml(result.error)}</div>` : ""}
    </div>`;
}

function renderSettlementTile(settlements: SettlementSummary): string {
  if (!settlements.available) {
    return `
    <div class="settlement-tile">
      <div class="wallet-label">Settlement health</div>
      <div class="wallet-value wallet-unavailable">not available</div>
      <div class="wallet-sub">SETTLEMENTS KV not bound yet</div>
    </div>`;
  }

  const hasFailures = settlements.failed > 0;
  const color = hasFailures ? STATUS_COLORS.fail : STATUS_COLORS.pass;
  const truncatedNote = settlements.truncated
    ? `<div class="wallet-sub">showing a partial scan (hit the scan cap)</div>`
    : "";

  return `
    <div class="settlement-tile" style="border-left-color: ${color}">
      <div class="wallet-label">Settlement health (last ${settlements.windowHours}h)</div>
      <div class="settlement-counts">
        <span class="settlement-count" style="color: ${STATUS_COLORS.pass}">${settlements.settled} settled</span>
        <span class="separator">&middot;</span>
        <span class="settlement-count" style="color: ${hasFailures ? STATUS_COLORS.fail : "inherit"}">${settlements.failed} failed</span>
        <span class="separator">&middot;</span>
        <span class="settlement-count">${settlements.pending} pending</span>
      </div>
      ${truncatedNote}
    </div>`;
}

function renderTargetSelector(
  activeTarget: string,
  availableTargets: string[],
): string {
  return availableTargets
    .map((name) => {
      if (name === activeTarget) {
        return `<span class="target-link active">${escapeHtml(name)}</span>`;
      }
      return `<a class="target-link" href="/?target=${encodeURIComponent(name)}">${escapeHtml(name)}</a>`;
    })
    .join("");
}

function renderSummary(summary: ProbeReport["summary"]): string {
  const parts: string[] = [];
  if (summary.pass > 0) parts.push(`<span style="color: ${STATUS_COLORS.pass}">${summary.pass} pass</span>`);
  if (summary.fail > 0) parts.push(`<span style="color: ${STATUS_COLORS.fail}">${summary.fail} fail</span>`);
  if (summary.warn > 0) parts.push(`<span style="color: ${STATUS_COLORS.warn}">${summary.warn} warn</span>`);
  if (summary.skip > 0) parts.push(`<span style="color: ${STATUS_COLORS.skip}">${summary.skip} skip</span>`);
  return parts.join(` <span class="separator">&middot;</span> `);
}

export function renderDashboard(
  report: ProbeReport,
  availableTargets: string[],
  settlements: SettlementSummary,
): string {
  const hasFail = report.summary.fail > 0;
  const titlePrefix = hasFail ? "✗" : "✓";
  const overallColor = hasFail ? STATUS_COLORS.fail : STATUS_COLORS.pass;
  const faviconColor = hasFail ? "%23ef4444" : "%2322c55e";
  const faviconSvg = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='${faviconColor}'/></svg>`;

  const gasResult = report.results.find((r) => r.name === "gas-estimate");
  const usdcResult = report.results.find((r) => r.name === "usdc-balance");
  const walletTiles = `${renderWalletTile("Facilitator gas (ETH)", gasResult, "ETH", "balanceEth")}${renderWalletTile("Operator revenue (USDC)", usdcResult, "USDC", "balanceUsdc")}${renderSettlementTile(settlements)}`;

  const probeRows = report.results
    .filter((r) => !WALLET_PROBE_NAMES.has(r.name))
    .map(renderProbeRow)
    .join("");
  const targetSelector = renderTargetSelector(report.target, availableTargets);
  const summaryHtml = renderSummary(report.summary);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="x402cloud infrastructure status dashboard">
  <title>${titlePrefix} x402cloud status</title>
  <link rel="icon" href="${faviconSvg}">
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: #0a0a0a;
      color: #e5e5e5;
      font-family: -apple-system, system-ui, 'Segoe UI', sans-serif;
      line-height: 1.5;
      min-height: 100vh;
      padding: 1rem;
      padding-top: 4rem;
    }

    nav {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      background: rgba(10, 10, 10, 0.9);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid #222;
    }

    nav .inner {
      max-width: 1080px;
      margin: 0 auto;
      padding: 0 1rem;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .wordmark {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: #fafafa;
      text-decoration: none;
    }

    .nav-links {
      display: flex;
      gap: 16px;
    }

    .nav-links a {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 12px;
      color: #737373;
      letter-spacing: 0.02em;
      transition: color 0.15s;
      text-decoration: none;
    }

    .nav-links a:hover {
      color: #fafafa;
    }

    /* Mobile-first: everything is a single column by default. */
    .container {
      max-width: 520px;
      margin: 0 auto;
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      color: #fafafa;
      margin-bottom: 1rem;
    }

    .header-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }

    .header-label {
      font-size: 0.75rem;
      color: #737373;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .target-selector {
      display: flex;
      gap: 0.25rem;
      flex-wrap: wrap;
    }

    .target-link {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.8125rem;
      padding: 0.375rem 0.625rem;
      border-radius: 4px;
      text-decoration: none;
      color: #a3a3a3;
      background: #1a1a1a;
      border: 1px solid #262626;
      transition: all 0.15s ease;
    }

    a.target-link:hover {
      color: #e5e5e5;
      border-color: #404040;
    }

    .target-link.active {
      color: #fafafa;
      background: #262626;
      border-color: #404040;
    }

    .timestamp {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.6875rem;
      color: #525252;
      margin-bottom: 1rem;
    }

    .summary {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.875rem;
      margin-bottom: 1rem;
      padding: 0.75rem 1rem;
      background: #141414;
      border: 1px solid #222;
      border-radius: 8px;
      border-left: 3px solid ${overallColor};
    }

    .separator {
      color: #404040;
      margin: 0 0.125rem;
    }

    /* Wallet + settlement tiles: single column, stacked, largest thing on
       the page — the mobile-first "glance at the phone" surface. */
    .wallet-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.625rem;
      margin-bottom: 1rem;
    }

    @media (min-width: 640px) {
      .wallet-grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    .wallet-tile, .settlement-tile {
      background: #141414;
      border: 1px solid #222;
      border-left: 3px solid #404040;
      border-radius: 8px;
      padding: 0.875rem 1rem;
    }

    .wallet-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.75rem;
      color: #a3a3a3;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 0.375rem;
    }

    .wallet-value {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 1.375rem;
      font-weight: 600;
      color: #fafafa;
      word-break: break-word;
    }

    .wallet-unavailable {
      font-size: 1rem;
      font-weight: 500;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .wallet-sub {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.6875rem;
      color: #525252;
      margin-top: 0.375rem;
    }

    .settlement-counts {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 1rem;
      font-weight: 600;
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }

    .probes {
      background: #141414;
      border: 1px solid #222;
      border-radius: 8px;
      overflow: hidden;
    }

    .probe-row {
      padding: 0.875rem 1rem;
      border-bottom: 1px solid #1e1e1e;
    }

    .probe-row:last-child {
      border-bottom: none;
    }

    .probe-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .probe-name {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.8125rem;
      font-weight: 500;
      color: #e5e5e5;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .probe-right {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      flex-shrink: 0;
      padding-left: 1.25rem;
    }

    .status-badge {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .latency {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.6875rem;
      color: #525252;
      min-width: 44px;
      text-align: right;
    }

    .error {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.75rem;
      color: ${STATUS_COLORS.fail};
      margin-top: 0.375rem;
      padding-left: 1.25rem;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 1rem;
      margin-top: 0.375rem;
      padding-left: 1.25rem;
    }

    .meta-item {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.6875rem;
      color: #525252;
    }

    .meta-key {
      color: #404040;
    }

    .footer {
      margin-top: 1.25rem;
      font-size: 0.75rem;
      color: #404040;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .footer a {
      color: #525252;
      text-decoration: none;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      word-break: break-all;
    }

    .footer a:hover {
      color: #737373;
    }

    @media (min-width: 640px) {
      body { padding: 2rem 1rem; padding-top: 4.5rem; }
      h1 { font-size: 1.5rem; }
      .container { max-width: 680px; }
      .footer { flex-direction: row; justify-content: space-between; align-items: center; }
    }
  </style>
</head>
<body>
  <nav><div class="inner"><a href="https://x402cloud.ai" class="wordmark">x402cloud.ai</a><div class="nav-links"><a href="https://x402cloud.ai/#services">Services</a><a href="/">Status</a><a href="https://github.com/x402cloud/x402cloud">GitHub</a></div></div></nav>
  <div class="container">
    <h1>x402cloud status</h1>

    <div class="header-row">
      <span class="header-label">Target:</span>
      <div class="target-selector">${targetSelector}</div>
    </div>

    <div class="timestamp">Last checked: ${escapeHtml(report.timestamp)}</div>

    <div class="summary">Summary: ${summaryHtml}</div>

    <div class="wallet-grid">
      ${walletTiles}
    </div>

    <div class="probes">
      ${probeRows}
    </div>

    <div class="footer">
      <span>Auto-refreshes every 30 seconds</span>
      <a href="/status?target=${encodeURIComponent(report.target)}">JSON: /status?target=${escapeHtml(report.target)}</a>
    </div>
  </div>
  <script>setTimeout(function() { window.location.reload(); }, 30000);</script>
</body>
</html>`;
}
