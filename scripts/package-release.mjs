import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const release = resolve(root, "release");
const offline = resolve(release, "offline");
const staticSite = resolve(release, "static-site");

await stat(resolve(dist, "index.html"));
await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });
await Promise.all([
  cp(dist, offline, { recursive: true }),
  cp(dist, staticSite, { recursive: true })
]);
await writeFile(resolve(staticSite, ".nojekyll"), "", "utf8");
await writeFile(resolve(release, "README.txt"), [
  "Fourier Transform Lab final release",
  "",
  "offline/index.html  — double-click for offline use; no server required.",
  "static-site/        — upload this directory as the root of any static host.",
  "",
  "Both directories are generated from the same dist build and contain identical application code."
].join("\r\n"), "utf8");

console.log(`Packaged offline and static-site release: ${release}`);
