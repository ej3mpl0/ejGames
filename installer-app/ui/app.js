// Instalador de ejGames: instalar (o actualizar), progreso, listo.

const T = window.__TAURI__;
const invoke = T.core.invoke;
const win = T.window.getCurrentWindow();
const $ = (s) => document.querySelector(s);

const state = { info: null, dir: "", busy: false };

const bytes = (n) => {
  if (n == null) return "—";
  const gb = n / 1024 ** 3;
  return gb >= 1 ? `${gb.toLocaleString("es", { maximumFractionDigits: 1 })} GB` : `${Math.round(n / 1024 ** 2)} MB`;
};

function cmp(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function view(id) {
  document.body.dataset.view = id;
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== id;
  $("#crumb").textContent = { welcome: $("#crumb").dataset.welcome || "Instalación", installing: "Instalando", done: "Terminado", error: "Error" }[id];
}

function fill(p) {
  document.body.style.setProperty("--fill", `${Math.round(34 + p * 66)}%`);
}

async function updateSpace() {
  const free = await invoke("free_space", { path: state.dir }).catch(() => null);
  const need = state.info.requiredBytes;
  const short = free != null && free < need;
  const el = $("#space");
  el.innerHTML = `<span>${bytes(need)}</span><span class="${short ? "bad" : ""}" style="color:${short ? "" : "var(--ink-2)"}">${free == null ? "" : `· ${bytes(free)} libres`}</span>`;
  $("#btn-install").disabled = short || !state.info.hasPayload;
}

function render() {
  const i = state.info;
  $("#v-ver").textContent = i.version;
  $("#path").textContent = state.dir;
  let title = "Instalar";
  let sub = `ejGames <b>${i.version}</b> · tu biblioteca de juegos, con la cara de tu consola favorita.`;
  let crumb = "Instalación";
  if (i.installedVersion) {
    const c = cmp(i.version, i.installedVersion);
    if (c > 0) {
      title = "Actualizar";
      sub = `De la <b>${i.installedVersion}</b> a la <b>${i.version}</b>. Tu biblioteca, horas y ajustes se quedan como están.`;
      crumb = "Actualización";
    } else if (c === 0) {
      title = "Reinstalar";
      sub = `Ya tienes la <b>${i.version}</b>. Reinstálala si algo no va bien: no se pierde nada.`;
      crumb = "Reinstalación";
    } else {
      title = "Instalar";
      sub = `Tienes la <b>${i.installedVersion}</b>, más nueva que esta <b>${i.version}</b>. Si sigues, la sustituye.`;
    }
  }
  const h = $("#w-title");
  h.textContent = title;
  h.classList.toggle("long", title.length > 8);
  $("#w-sub").innerHTML = sub;
  $("#cta-label").textContent = title;
  $("#crumb").dataset.welcome = crumb;
  view("welcome");
  if (!i.hasPayload) {
    $("#btn-install").disabled = true;
    $("#space").textContent = "Compilación de desarrollo: sin paquete";
  } else updateSpace();
}

// ─── instalar ───
let unlisten = null;
function progress(p) {
  const v = Math.max(0, Math.min(1, p));
  $("#pct").textContent = String(Math.floor(v * 100));
  $("#meter").style.width = `${v * 100}%`;
  fill(v);
  const step = v < 0.08 ? 0 : v < 0.86 ? 1 : v < 0.96 ? 2 : v < 1 ? 3 : 4;
  document.querySelectorAll("#steps li").forEach((li, k) => {
    li.classList.toggle("done", k < step);
    li.classList.toggle("active", k === step);
  });
}

async function install() {
  if (state.busy) return;
  state.busy = true;
  view("installing");
  progress(0);
  unlisten = await T.event.listen("progress", (e) => progress(e.payload));
  try {
    await invoke("install", { dir: state.dir, desktop: $("#opt-desktop").checked });
    progress(1);
    await new Promise((r) => setTimeout(r, 500));
    finished();
  } catch (e) {
    $("#e-msg").textContent = String(e?.message || e);
    fill(0);
    view("error");
  } finally {
    unlisten?.();
    state.busy = false;
  }
}

let countdown = 0;
function finished() {
  const d = new Date();
  const dd = (n) => String(n).padStart(2, "0");
  $("#stamp-meta").textContent = `${state.info.version} · ${dd(d.getDate())}.${dd(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
  $("#d-sub").innerHTML = `ejGames <b>${state.info.version}</b> ya está en el menú Inicio${$("#opt-desktop").checked ? " y en el escritorio" : ""}.`;
  fill(1);
  view("done");
  $("#btn-launch").focus();
  if ($("#opt-launch").checked) {
    let n = 5;
    const tick = () => {
      $("#countdown").textContent = `Se abre solo en ${n} s`;
      if (n-- <= 0) launch();
    };
    tick();
    countdown = setInterval(tick, 1000);
  }
}

function launch() {
  clearInterval(countdown);
  invoke("launch", { dir: state.dir }).catch((e) => ($("#countdown").textContent = String(e?.message || e)));
}

// ─── eventos ───
$("#btn-min").onclick = () => win.minimize();
$("#btn-close").onclick = () => !state.busy && invoke("quit");
$("#btn-exit").onclick = () => invoke("quit");
$("#btn-finish").onclick = () => invoke("quit");
$("#btn-install").onclick = install;
$("#btn-retry").onclick = install;
$("#btn-launch").onclick = launch;
$("#btn-change").onclick = async () => {
  const picked = await T.dialog.open({ directory: true, multiple: false, title: "Carpeta de instalación", defaultPath: state.dir });
  if (typeof picked !== "string") return;
  // Siempre en una carpeta propia.
  state.dir = /[\\/]ejGames$/i.test(picked) ? picked : `${picked.replace(/[\\/]+$/, "")}\\ejGames`;
  $("#path").textContent = state.dir;
  updateSpace();
};
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !state.busy) invoke("quit");
  if (e.key === "Enter" && document.activeElement === document.body) {
    if (document.body.dataset.view === "welcome") install();
    else if (document.body.dataset.view === "done") launch();
  }
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

(async () => {
  state.info = await invoke("info");
  state.dir = state.info.installDir;
  render();
  await win.show();
})();
