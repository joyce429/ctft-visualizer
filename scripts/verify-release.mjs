import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const offline = resolve(root, "release", "offline");
const staticSite = resolve(root, "release", "static-site");

async function filesIn(directory, base = directory) {
  const output = [];
  for (const name of await readdir(directory)) {
    const path = resolve(directory, name);
    const info = await stat(path);
    if (info.isDirectory()) output.push(...await filesIn(path, base));
    else output.push(relative(base, path).replaceAll("\\", "/"));
  }
  return output.sort();
}

const offlineFiles = await filesIn(offline);
const staticFiles = (await filesIn(staticSite)).filter((name) => name !== ".nojekyll");
if (JSON.stringify(offlineFiles) !== JSON.stringify(staticFiles)) throw new Error("Offline and static-site file lists differ");
for (const name of offlineFiles) {
  const [a, b] = await Promise.all([readFile(resolve(offline, name)), readFile(resolve(staticSite, name))]);
  const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
  if (hash(a) !== hash(b)) throw new Error(`Release file mismatch: ${name}`);
}
const html = await readFile(resolve(offline, "index.html"), "utf8");
if (/https?:\/\//i.test(html)) throw new Error("Offline HTML contains a remote URL");
if (!/assets\/app\.js/.test(html) || !/assets\/styles\.css/.test(html)) throw new Error("Offline entry references are incomplete");
console.log(`Release verification: PASS (${offlineFiles.length} identical application files)`);
