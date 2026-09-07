import WebSocket from "ws";
const endpoint = new URL(process.argv[2]);
if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1") throw new Error("Expected loopback CDP");
const targets = await (await fetch(new URL("/json/list", endpoint), { signal: AbortSignal.timeout(3000) })).json();
const wsUrl = new URL(targets[0].webSocketDebuggerUrl);
if (wsUrl.hostname !== endpoint.hostname || wsUrl.port !== endpoint.port) throw new Error("CDP host mismatch");
await new Promise((resolve, reject) => {
  const socket = new WebSocket(wsUrl);
  const timeout = setTimeout(() => { socket.terminate(); reject(new Error("Close timed out")); }, 5000);
  socket.on("open", () => socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "{ const electron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron'); for (const window of electron.BrowserWindow.getAllWindows()) window.removeAllListeners('close'); electron.app.quit(); }" } })));
  socket.on("message", raw => {
    const message = JSON.parse(raw);
    if (message.id !== 1) return;
    clearTimeout(timeout);
    socket.close();
    if (message.error || message.result?.exceptionDetails) reject(new Error("Electron quit failed"));
    else resolve();
  });
  socket.on("close", () => { clearTimeout(timeout); resolve(); });
  socket.on("error", (error) => { clearTimeout(timeout); reject(error); });
});
