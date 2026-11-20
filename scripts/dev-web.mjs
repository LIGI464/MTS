import { spawn } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("npm_execpath is missing. Start this script with npm run dev:web.");
  process.exit(1);
}

const child = spawn(process.execPath, [npmCli, "run", "dev", "-w", "@mts/web"], {
  stdio: "inherit",
  env: { ...process.env, VITE_DATA_MODE: "mock" },
  windowsHide: true,
});

function stop() {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGTERM");
}

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
