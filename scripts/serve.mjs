import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, get } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const requestedPort = Number(process.env.CTFT_PORT ?? 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = resolve(root, relative);
    if (!file.startsWith(root)) throw new Error("Invalid path");
    const info = await stat(file);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`Fourier Transform Lab: ${url}`);
  if (process.argv.includes("--smoke")) {
    get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        const passed = response.statusCode === 200 && body.includes("Fourier Transform Lab");
        console.log(`HTTP smoke test: ${passed ? "PASS" : "FAIL"} (${response.statusCode}, ${body.length} chars)`);
        server.close(() => process.exitCode = passed ? 0 : 1);
      });
    }).on("error", (error) => {
      console.error(`HTTP smoke test: FAIL (${error.message})`);
      server.close(() => process.exitCode = 1);
    });
  }
});
