import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(projectRoot, "dist");
const assets = resolve(dist, "assets");

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

await build({
  entryPoints: [resolve(projectRoot, "src/web/app.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  sourcemap: false,
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
  assetNames: "fonts/[name]-[hash]",
  outfile: resolve(assets, "app.js"),
  legalComments: "none"
});

await Promise.all([
  copyFile(resolve(projectRoot, "src/web/index.html"), resolve(dist, "index.html")),
  copyFile(resolve(projectRoot, "src/web/styles.css"), resolve(assets, "styles.css"))
]);

console.log(`Built file:// compatible web app: ${resolve(dist, "index.html")}`);
