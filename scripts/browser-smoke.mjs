import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const candidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];

async function firstExisting(paths) {
  for (const path of paths) {
    try { await access(path); return path; } catch { /* try next */ }
  }
  throw new Error("Chrome or Edge executable was not found");
}

const browserPath = await firstExisting(candidates);
const temporary = await mkdtemp(join(tmpdir(), "ctft-browser-test-"));
const downloads = join(temporary, "downloads");
const profile = join(temporary, "profile");
await import("node:fs/promises").then(({ mkdir }) => Promise.all([mkdir(downloads), mkdir(profile)]));

const browser = spawn(browserPath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profile}`,
  "--remote-debugging-port=0",
  "about:blank"
], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

let stderr = "";
const webSocketUrl = await new Promise((resolveUrl, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Browser DevTools endpoint timed out: ${stderr}`)), 15000);
  browser.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) { clearTimeout(timeout); resolveUrl(match[1]); }
  });
  browser.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Browser exited before startup (${code}): ${stderr}`)); });
});

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async open() {
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener("open", resolveOpen, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const handler = this.pending.get(message.id);
        if (!handler) return;
        this.pending.delete(message.id);
        if (message.error) handler.reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data ?? {})}`));
        else handler.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message);
    });
  }
  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolveSend, reject) => this.pending.set(id, { resolve: resolveSend, reject }));
  }
  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }
  close() { this.socket.close(); }
}

const cdp = new CdpClient(webSocketUrl);
const errors = [];
const networkRequests = [];

const waitFor = async (predicate, label, timeoutMs = 10000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

try {
  await cdp.open();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
  const pageUrl = pathToFileURL(resolve(root, "dist", "index.html")).href;
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  cdp.on("Runtime.exceptionThrown", (message) => { if (message.sessionId === sessionId) errors.push(message.params.exceptionDetails.text); });
  cdp.on("Log.entryAdded", (message) => { if (message.sessionId === sessionId && ["error", "warning"].includes(message.params.entry.level)) errors.push(message.params.entry.text); });
  cdp.on("Network.requestWillBeSent", (message) => { if (message.sessionId === sessionId) networkRequests.push(message.params.request.url); });
  await Promise.all([
    cdp.send("Page.enable", {}, sessionId),
    cdp.send("Runtime.enable", {}, sessionId),
    cdp.send("Log.enable", {}, sessionId),
    cdp.send("Network.enable", {}, sessionId)
  ]);
  await cdp.send("Network.setBlockedURLs", { urls: ["http://*", "https://*"] }, sessionId);
  await cdp.send("Page.navigate", { url: pageUrl }, sessionId);

  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };

  await waitFor(() => evaluate("document.body?.dataset.appReady === 'true'"), "application readiness");
  const initial = await evaluate(`({
    title: document.querySelector('#current-signal-title')?.textContent,
    canvases: document.querySelectorAll('canvas').length,
    quickReferences: document.querySelectorAll('#property-reference-grid .property-reference-item').length,
    removedTeachingExtras: !document.querySelector('#guided-experiments') && !document.querySelector('#lesson-panel') && !document.querySelector('#user-guide'),
    buttons: [...document.querySelectorAll('button')].every((button) => !button.disabled)
  })`);
  if (!initial.title?.includes("矩形脉冲") || initial.canvases < 3 || initial.quickReferences !== 12 || !initial.removedTeachingExtras || !initial.buttons) throw new Error(`Initial UI validation failed: ${JSON.stringify(initial)}`);

  const formulaRendering = await evaluate(`(() => {
    const visual = [...document.querySelectorAll('#property-reference-grid .katex-html')].map((node) => node.textContent).join(' | ');
    const conditions = [...document.querySelectorAll('#property-reference-grid p')].map((node) => node.textContent).join(' | ');
    return {
      katexCount: document.querySelectorAll('#property-reference-grid .katex').length,
      errors: document.querySelectorAll('#property-reference-grid .katex-error').length,
      hasArrow: /[↔⟷]/.test(visual),
      rawCommand: /longleftrightarrow|jomega|\\\\(?:frac|omega|theta|pi|ne|int)/.test(visual + ' | ' + conditions),
      conditions,
      visualSample: visual.slice(0, 300)
    };
  })()`);
  if (formulaRendering.katexCount !== 12 || formulaRendering.errors !== 0 || !formulaRendering.hasArrow || formulaRendering.rawCommand) throw new Error(`KaTeX reference rendering failed: ${JSON.stringify(formulaRendering)}`);

  const integration = await evaluate(`(() => {
    const signal = document.querySelector('#signal-select'); signal.value='one-sided-exponential'; signal.dispatchEvent(new Event('change',{bubbles:true}));
    const transform = document.querySelector('#transform-select'); transform.value='integrate'; transform.dispatchEvent(new Event('change',{bubbles:true}));
    return { title: document.querySelector('#current-signal-title').textContent, formula: document.querySelector('#transformed-frequency-formula').textContent, summary: document.querySelector('#component-summary').textContent };
  })()`);
  if (!integration.title.includes("单边指数") || !integration.title.includes("积分") || !integration.formula || !integration.summary.includes("主值")) throw new Error(`Integration UI failed: ${JSON.stringify(integration)}`);

  const differentiation = await evaluate(`(() => {
    const signal=document.querySelector('#signal-select'); signal.value='rectangular-pulse'; signal.dispatchEvent(new Event('change',{bubbles:true}));
    const transform=document.querySelector('#transform-select'); transform.value='differentiate'; transform.dispatchEvent(new Event('change',{bubbles:true}));
    return { signal: document.querySelector('#signal-select').value, transform: document.querySelector('#transform-select').value, title: document.querySelector('#current-signal-title').textContent };
  })()`);
  if (differentiation.signal !== "rectangular-pulse" || differentiation.transform !== "differentiate" || !differentiation.title.includes("微分")) throw new Error(`Differentiation control failed: ${JSON.stringify(differentiation)}`);

  const controls = await evaluate(`(() => {
    const range=document.querySelector('#frequency-range'); range.value='20'; range.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('[data-phase-unit="deg"]').click(); document.querySelector('[data-phase-mode="unwrapped"]').click();
    return { range: range.value, deg: document.querySelector('[data-phase-unit="deg"]').classList.contains('active'), unwrapped: document.querySelector('[data-phase-mode="unwrapped"]').classList.contains('active') };
  })()`);
  if (Number(controls.range) !== 20 || !controls.deg || !controls.unwrapped) throw new Error(`Display controls failed: ${JSON.stringify(controls)}`);

  const beforeDownloads = new Set(await readdir(downloads));
  await evaluate(`(() => {
    document.querySelector('#export-time-csv').click(); document.querySelector('#export-frequency-csv').click();
    document.querySelector('[data-export-png="time"]').click(); document.querySelector('[data-export-png="magnitude"]').click(); document.querySelector('[data-export-png="phase"]').click();
    document.querySelector('#export-config').click();
    const signal=document.querySelector('#signal-select'); signal.value='sine'; signal.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('#export-impulse-csv').click();
    return true;
  })()`);
  await waitFor(async () => {
    const current = (await readdir(downloads)).filter((name) => !beforeDownloads.has(name));
    return current.length >= 7 && current.every((name) => !name.endsWith(".crdownload"));
  }, "seven completed export downloads", 15000);
  const files = (await readdir(downloads)).filter((name) => !beforeDownloads.has(name));
  for (const name of files) if ((await stat(join(downloads, name))).size === 0) throw new Error(`Empty download: ${name}`);
  if (files.filter((name) => name.endsWith(".png")).length < 3 || files.filter((name) => name.endsWith(".csv")).length < 3 || !files.some((name) => name.endsWith(".json"))) throw new Error(`Missing export formats: ${files.join(", ")}`);

  const configPath = join(temporary, "import-config.json");
  await writeFile(configPath, JSON.stringify({
    schemaVersion: "1.0.0", convention: "angular-frequency-ctft", signalId: "cosine", parameters: { A: 2, omega0: 5 },
    transform: { type: "shift", parameter: 1 }, display: { mode: "both", phaseUnit: "rad", phaseMode: "principal", frequencyMax: 12 }
  }), "utf8");
  const { root: documentNode } = await cdp.send("DOM.getDocument", {}, sessionId);
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: documentNode.nodeId, selector: "#import-config-file" }, sessionId);
  await cdp.send("DOM.setFileInputFiles", { nodeId, files: [configPath] }, sessionId);
  await waitFor(() => evaluate("document.querySelector('#signal-select').value === 'cosine' && document.querySelector('#transform-select').value === 'shift'"), "configuration import");

  const remoteRequests = networkRequests.filter((url) => /^https?:/i.test(url));
  if (remoteRequests.length) throw new Error(`Offline page attempted remote requests: ${remoteRequests.join(", ")}`);
  if (errors.length) throw new Error(`Browser console/runtime errors: ${errors.join(" | ")}`);

  const timeCsvName = files.find((name) => name.startsWith("ctft-time-continuous") && name.endsWith(".csv"));
  const frequencyCsvName = files.find((name) => name.startsWith("ctft-frequency-continuous") && name.endsWith(".csv"));
  const impulseCsvName = files.find((name) => name.startsWith("ctft-frequency-impulses") && name.endsWith(".csv"));
  const timeHeader = (await readFile(join(downloads, timeCsvName), "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/)[0];
  const frequencyHeader = (await readFile(join(downloads, frequencyCsvName), "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/)[0];
  const impulseHeader = (await readFile(join(downloads, impulseCsvName), "utf8")).replace(/^\uFEFF/, "").split(/\r?\n/)[0];
  if (timeHeader !== "series,t,real,imag") throw new Error(`Unexpected time CSV header: ${timeHeader}`);
  if (frequencyHeader !== "series,omega,real,imag,magnitude,phase,phase_unit") throw new Error(`Unexpected frequency CSV header: ${frequencyHeader}`);
  if (impulseHeader !== "series,omega,coefficient_real,coefficient_imag,coefficient_magnitude,coefficient_phase,phase_unit,label") throw new Error(`Unexpected impulse CSV header: ${impulseHeader}`);

  console.log(JSON.stringify({ browser: browserPath, protocol: "file://", initial, formulaRendering, integration, differentiation, controls, downloads: files.sort(), remoteRequests: 0, errors: 0 }, null, 2));
  console.log("Browser interaction test: PASS");
} finally {
  try { cdp.close(); } catch { /* ignore */ }
  if (browser.exitCode === null) browser.kill();
  await Promise.race([
    new Promise((resolveExit) => browser.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 3000))
  ]);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { await rm(temporary, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 }); break; }
    catch (error) {
      if (attempt === 5) console.warn(`Temporary browser profile cleanup deferred: ${error.message}`);
      else await new Promise((resolveWait) => setTimeout(resolveWait, 300));
    }
  }
}
