// Herramienta de pruebas: habla con la app por Chrome DevTools Protocol.
// Arranca la app con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//
//   node scripts/cdp.mjs list
//   node scripts/cdp.mjs eval host|theme|overlay "<js>"
//   node scripts/cdp.mjs shot captura.png [host|overlay]
//   node scripts/cdp.mjs key host|theme ArrowRight [veces]
//   node scripts/cdp.mjs isolation      ← comprueba que el tema no puede salir de su caja
import { writeFileSync } from "node:fs";

const [, , cmd, a, b, c] = process.argv;
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
if (cmd === "list") {
  console.log(list.map((t) => `${t.type}\t${t.url}`).join("\n"));
  process.exit(0);
}
const pick = (which) =>
  which === "theme"
    ? list.find((t) => /^http:\/\/ejg-(theme|safe)\.localhost/.test(t.url))
    : which === "overlay"
      ? list.find((t) => t.type === "page" && t.url.endsWith("#overlay"))
      : list.find((t) => t.type === "page" && !/^http:\/\/ejg-/.test(t.url) && !t.url.endsWith("#overlay"));

async function session(target) {
  if (!target) throw new Error("No se encuentra el objetivo. ¿Está la app abierta con depuración remota?");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { send, close: () => ws.close() };
}

async function evaluate(which, expression) {
  const s = await session(pick(which));
  const r = await s.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  s.close();
  return r.result?.result?.value ?? r.result?.exceptionDetails ?? r;
}

if (cmd === "eval") {
  console.log(JSON.stringify(await evaluate(a, b), null, 2));
} else if (cmd === "shot") {
  const s = await session(pick(b || "host"));
  const r = await s.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(a, Buffer.from(r.result.data, "base64"));
  console.log("ok", a);
  s.close();
} else if (cmd === "key") {
  const s = await session(pick(a));
  const codes = { ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40, Enter: 13, Escape: 27, Tab: 9, Backspace: 8 };
  for (let i = 0; i < Number(c || 1); i++) {
    for (const type of ["rawKeyDown", "keyUp"]) {
      await s.send("Input.dispatchKeyEvent", { type, key: b, code: b, windowsVirtualKeyCode: codes[b] ?? 0 });
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log("ok");
  s.close();
} else if (cmd === "isolation") {
  // Desde dentro del tema: nada de esto debe funcionar.
  const res = await evaluate(
    "theme",
    `(async () => {
      const t = (p, ms = 3000) => Promise.race([p, new Promise((_, j) => setTimeout(() => j("sin respuesta"), ms))]);
      const out = { origen: self.origin };
      const id = window.ejg?.library.all[0]?.id;
      const before = window.ejg?.library.byId(id)?.hidden;
      try { await t(window.__TAURI_INTERNALS__.invoke("set_hidden", { id, value: !before })); out.invoke = "FALLO: invoke respondió"; }
      catch (e) { out.invoke = "ok (bloqueado: " + String(e).slice(0, 60) + ")"; }
      try { await t(fetch("https://example.com")); out.internet = "FALLO: fetch a internet funcionó"; } catch { out.internet = "ok (bloqueado)"; }
      try { await t(fetch("http://ipc.localhost/ping", { method: "POST" })); out.ipc = "FALLO: fetch a ipc.localhost funcionó"; } catch { out.ipc = "ok (bloqueado)"; }
      try { localStorage.setItem("x", "1"); out.localStorage = "FALLO: disponible"; } catch { out.localStorage = "ok (bloqueado)"; }
      await new Promise((r) => setTimeout(r, 1000));
      out.sinEfectos = window.ejg?.library.byId(id)?.hidden === before ? "ok" : "FALLO: el invoke tuvo efecto";
      return out;
    })()`,
  );
  console.log(res);
  const bad = Object.values(res).some((v) => String(v).startsWith("FALLO")) || res.origen !== "null";
  console.log(bad ? "\n✗ AISLAMIENTO ROTO" : "\n✓ El tema está aislado");
  process.exit(bad ? 1 : 0);
}
