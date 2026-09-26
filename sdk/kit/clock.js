// Reloj que se actualiza una vez por minuto (alineado), sin timers de alta frecuencia.

export function clock(el, { seconds = false, format } = {}) {
  let t = 0;
  const fmt =
    format ||
    ((d) => d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined }));
  function tick() {
    const d = new Date();
    el.textContent = fmt(d);
    const ms = seconds ? 1000 - d.getMilliseconds() : 60000 - (d.getSeconds() * 1000 + d.getMilliseconds());
    t = setTimeout(tick, ms + 5);
  }
  tick();
  return () => clearTimeout(t);
}
