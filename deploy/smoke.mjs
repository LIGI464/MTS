const groups = ["critical", "coordinator", "high", "research"];
const timeoutMs = 5000;

function revisionOf(snapshot) {
  if (
    snapshot?.apiVersion !== 1 ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0 ||
    !groups.every((group) =>
      Array.isArray(snapshot.groups?.[group]) && snapshot.groups[group].every((id) => typeof id === "string"),
    )
  ) {
    throw new Error("invalid snapshot");
  }
  return snapshot.revision;
}

function dashboardFrame(frame) {
  let event;
  const data = [];
  for (const line of frame.split("\n")) {
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /u, "");
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  if (data.length === 0) return undefined;
  if (event !== "dashboard") throw new Error("unexpected first event");
  return revisionOf(JSON.parse(data.join("\n")));
}

async function readEvent(response) {
  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "text/event-stream" || !response.body) throw new Error("invalid event stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let skipLf = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error("missing dashboard event");
      let chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      if (skipLf && chunk.startsWith("\n")) chunk = chunk.slice(1);
      skipLf = chunk.endsWith("\r");
      pending += chunk.replace(/\r\n?/gu, "\n");

      let separator = pending.indexOf("\n\n");
      while (separator >= 0) {
        const revision = dashboardFrame(pending.slice(0, separator));
        if (revision !== undefined) return revision;
        pending = pending.slice(separator + 2);
        separator = pending.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function check(baseUrl, path, verify) {
  const signal = AbortSignal.timeout(timeoutMs);
  let httpStatus;
  try {
    const response = await fetch(new URL(path, baseUrl), { signal, redirect: "error" });
    httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("HTTP error");
    }
    const revision = await verify(response);
    console.log(`${path} OK${revision === undefined ? "" : ` revision=${revision}`}`);
    return { ok: true, revision };
  } catch {
    const status = signal.aborted ? "TIMEOUT" : httpStatus === undefined ? "ERROR" : `ERROR (HTTP ${httpStatus})`;
    console.error(`${path} ${status}`);
    return { ok: false };
  }
}

async function main() {
  const url = URL.parse(process.argv[2] ?? "");
  if (!url || !["http:", "https:"].includes(url.protocol)) {
    console.error("base URL ERROR");
    process.exitCode = 1;
    return;
  }

  const health = await check(url, "/healthz", async (response) => {
    const body = await response.json();
    if (body?.status !== "ok" || !["ok", "stale", "unavailable"].includes(body.source)) {
      throw new Error("invalid health status");
    }
  });
  const dashboard = await check(url, "/api/v1/dashboard", async (response) => revisionOf(await response.json()));
  const sse = await check(url, "/api/v1/events", async (response) => {
    const revision = await readEvent(response);
    if (dashboard.ok && revision < dashboard.revision) throw new Error("older event revision");
    return revision;
  });
  if (!health.ok || !dashboard.ok || !sse.ok) process.exitCode = 1;
}

await main();
