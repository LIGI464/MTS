import { spawn } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("npm_execpath is missing. Start this script with npm run dev.");
  process.exit(1);
}

const children = [];
let stopping = false;

function run(args, env) {
  const child = spawn(process.execPath, [npmCli, ...args], {
    stdio: "inherit",
    env: { ...process.env, ...env },
    windowsHide: true,
  });
  children.push(child);
  child.on("exit", (code) => {
    if (!stopping) shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 400);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run(["run", "dev", "-w", "@mts/api"]);
run(["run", "dev", "-w", "@mts/web"], { VITE_DATA_MODE: "api" });
