import "dotenv/config";
import { spawn, execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const address = `http://${host}:${port}`;
const healthAddress = `${address}/api/health`;

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function isHealthy() {
  try {
    const response = await fetch(healthAddress, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

function openBrowser() {
  if (process.platform !== "win32") return;
  execFile("cmd.exe", ["/c", "start", "", address], { windowsHide: true }, () => {});
}

if (await isHealthy()) {
  console.log(`Attendance system is already running at ${address}`);
  openBrowser();
  process.exit(0);
}

const server = spawn(process.execPath, ["src/server.js"], {
  cwd: projectDirectory,
  stdio: "inherit",
  windowsHide: false,
});
let serverExited = false;
let exitCode = null;
server.once("exit", (code) => {
  serverExited = true;
  exitCode = code;
});

for (let attempt = 0; attempt < 30; attempt += 1) {
  await pause(350);
  if (await isHealthy()) {
    console.log(`\nAttendance system is ready at ${address}`);
    console.log("Keep this window open while you use the local website. Press Ctrl+C to stop it.");
    openBrowser();
    break;
  }
  if (serverExited) {
    console.error(`The attendance server stopped before it became ready (exit code ${exitCode ?? "unknown"}).`);
    process.exit(exitCode || 1);
  }
  if (attempt === 29) {
    console.error(`The server did not become ready at ${healthAddress}. Check the startup message above.`);
    server.kill();
    process.exit(1);
  }
}

function stopServer(signal) {
  if (!serverExited) server.kill(signal);
}

process.on("SIGINT", () => stopServer("SIGINT"));
process.on("SIGTERM", () => stopServer("SIGTERM"));
