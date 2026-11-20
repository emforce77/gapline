// Run from an extracted presentation kit with Node.js. Serve the packaged Next application and
// saved public sample on loopback. Only reads reach the app, including the player's Range requests.
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const { join } = require("node:path");

const host = "127.0.0.1";
const port = Number(process.argv[2] ?? 21969);
const target = require("./build-target.json");
if (process.platform !== target.platform || process.arch !== target.arch) {
  console.info(
    `Built on ${target.platform}/${target.arch}. On this device, open and play a saved sample before the presentation.`,
  );
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Invalid local port");

// Keep the standalone server's generated entry point intact. Give it a private local port and
// a fresh environment, without the presenter's API keys, cloud credentials or data directory.
async function start() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, host, resolve));
  const backendPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const front = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "forbidden",
          message:
            "The offline kit plays saved results. Uploading, generation and saving edits require the online service.",
        }),
      );
      return;
    }
    const upstream = http.request(
      {
        hostname: host,
        port: backendPort,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.on("error", () => res.destroy());
        reply.pipe(res);
      },
    );
    res.on("close", () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("The local app is starting. Reload this page.");
    });
    upstream.end();
  });
  await new Promise((resolve, reject) => front.once("error", reject).listen(port, host, resolve));
  const child = spawn(process.execPath, [join(__dirname, "app", "server.js")], {
    env: {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: host,
      PORT: String(backendPort),
      DATA_DIR: join(__dirname, "runtime"),
      PATH: "",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  process.once("exit", () => child.kill());
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill());
  child.once("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  child.once("exit", (code) => process.exit(code ?? 0));
  console.log(
    `Gapline · offline\nScreening: http://${host}:${port}/screening\nWorkspace: http://${host}:${port}/p/tos-opening\nPress Ctrl+C to close.`,
  );
}

start().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
