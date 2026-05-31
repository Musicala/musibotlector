import { onAuthChange, loginWithGoogle, logout, isAuthorized } from "./auth.js";
import { subscribeSessions, getSessionEvents } from "./sessions.js";
import { subscribeKnowledgeGaps, markGapReviewed } from "./knowledgeGaps.js";

// ─── State ────────────────────────────────────────────────────────────────────
let allSessions = [];
let allGaps = [];
let unsubSessions = null;
let unsubGaps = null;

let filters = { search: "", arte: "", modalidad: "", from: "", to: "" };
let gapFilters = { status: "new", lang: "" };

// Notificación: sesiones nuevas desde que se abrió el panel
let baselineCount = -1;   // -1 = aún no inicializado
let newBadgeCount = 0;

// ─── DOM helpers ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (id) => $(id)?.classList.remove("hidden");
const hide = (id) => $(id)?.classList.add("hidden");

// ─── Auth ─────────────────────────────────────────────────────────────────────
onAuthChange((user) => {
  if (user && isAuthorized(user.email)) showDashboard(user);
  else showLogin();
});

function showLogin() {
  show("view-login");
  hide("view-dashboard");
  closePanel();
  if (unsubSessions) { unsubSessions(); unsubSessions = null; }
  if (unsubGaps) { unsubGaps(); unsubGaps = null; }
  allSessions = [];
  allGaps = [];
}

function showDashboard(user) {
  hide("view-login");
  show("view-dashboard");
  $("user-email").textContent = user.email;
  hide("setup-notice");

  baselineCount = -1;
  newBadgeCount = 0;

  unsubSessions = subscribeSessions(
    (sessions) => {
      // Notificación de nuevos leads
      if (baselineCount === -1) {
        baselineCount = sessions.length;
      } else if (sessions.length > baselineCount) {
        newBadgeCount += sessions.length - baselineCount;
        baselineCount = sessions.length;
        updatePageTitle();
      }

      allSessions = sessions;
      renderStats();
      renderSessions();
      renderChart7d();
      populateArteFilter();
    },
    (err) => {
      if (err.code === "permission-denied") showSetupNotice();
    }
  );

  unsubGaps = subscribeKnowledgeGaps(
    (gaps) => { allGaps = gaps; renderGaps(); },
    () => {}
  );
}

function showSetupNotice() {
  show("setup-notice");
}

// ─── Login con Google ─────────────────────────────────────────────────────────
$("btn-google-login").addEventListener("click", async () => {
  const btn = $("btn-google-login");
  const errEl = $("login-error");
  errEl.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "Conectando…";

  try {
    await loginWithGoogle();
  } catch (err) {
    const msgs = {
      "auth/popup-closed-by-user": "Cerraste la ventana antes de completar el login.",
      "auth/popup-blocked": "El navegador bloqueó el popup. Permite popups para este sitio.",
      "auth/unauthorized-email": "Este correo no tiene acceso al panel.",
      "auth/cancelled-popup-request": "",
    };
    const msg = msgs[err.code];
    if (msg) {
      errEl.textContent = msg;
      errEl.classList.remove("hidden");
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = googleBtnContent();
  }
});

$("btn-logout").addEventListener("click", () => logout());

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    if (btn.dataset.tab === "sessions") {
      show("panel-sessions");
      hide("panel-gaps");
      // Limpiar badge de nuevas sesiones
      newBadgeCount = 0;
      baselineCount = allSessions.length;
      updatePageTitle();
    } else {
      hide("panel-sessions");
      show("panel-gaps");
    }
  });
});

// ─── Session filters ──────────────────────────────────────────────────────────
$("filter-search").addEventListener("input", (e) => {
  filters.search = e.target.value.toLowerCase();
  renderSessions();
});
$("filter-arte").addEventListener("change", (e) => {
  filters.arte = e.target.value;
  renderSessions();
});
$("filter-modalidad").addEventListener("change", (e) => {
  filters.modalidad = e.target.value.toLowerCase();
  renderSessions();
});
$("filter-from").addEventListener("change", (e) => {
  filters.from = e.target.value;
  renderSessions();
});
$("filter-to").addEventListener("change", (e) => {
  filters.to = e.target.value;
  renderSessions();
});
$("btn-clear-filters").addEventListener("click", () => {
  filters = { search: "", arte: "", modalidad: "", from: "", to: "" };
  ["filter-search", "filter-arte", "filter-modalidad", "filter-from", "filter-to"]
    .forEach((id) => { $(id).value = ""; });
  renderSessions();
});

// ─── Gap filters ──────────────────────────────────────────────────────────────
$("filter-gap-status").addEventListener("change", (e) => {
  gapFilters.status = e.target.value;
  renderGaps();
});
$("filter-gap-lang").addEventListener("change", (e) => {
  gapFilters.lang = e.target.value;
  renderGaps();
});

// ─── Stats & Funnel ───────────────────────────────────────────────────────────
function renderStats() {
  const total = allSessions.length;
  let withPhone = 0, interactive = 0, withName = 0, withService = 0;

  for (const s of allSessions) {
    if (s.cel)     withPhone++;
    if (s.nombre)  withName++;
    if (s.servicio) withService++;
    if (Number(s.events_count || 0) > 2) interactive++;
  }

  const withWA       = allSessions.filter((s) => s.whatsapp_clicked).length;
  const pctConversion = total ? Math.round((withPhone / total) * 100) : 0;

  $("stat-total").textContent       = total;
  $("stat-interactive").textContent = interactive;
  $("stat-with-phone").textContent  = withPhone;
  $("stat-whatsapp").textContent    = withWA;
  $("stat-conversion").textContent  = pctConversion + "%";

  renderFunnel({ total, interactive, withName, withPhone, withService });
}

function renderFunnel({ total, interactive, withName, withPhone, withService }) {
  const steps = $("funnel-steps");
  const hint  = $("funnel-hint");
  if (!steps) return;

  const pct = (n) => total ? Math.round((n / total) * 100) : 0;

  const stages = [
    { label: "Abrieron",     n: total,       icon: "👁" },
    { label: "Interactuaron", n: interactive, icon: "💬" },
    { label: "Nombre",        n: withName,    icon: "👤" },
    { label: "Teléfono",      n: withPhone,   icon: "📞" },
    { label: "Servicio",      n: withService, icon: "🎵" },
  ];

  steps.innerHTML = stages.map((s, i) => `
    <div class="funnel-step">
      <span class="funnel-n">${s.n}</span>
      <span class="funnel-lbl">${s.label}</span>
      <div class="funnel-bar-fill" style="width:${pct(s.n)}%"></div>
      ${i < stages.length - 1 ? '<span class="funnel-arrow">›</span>' : ""}
    </div>
  `).join("");

  const soloMiraron = total - interactive;
  hint.textContent = total
    ? `Solo miraron y se fueron: ${soloMiraron} (${pct(soloMiraron)}%)`
    : "";
}

// ─── Sessions render ──────────────────────────────────────────────────────────
function getFilteredSessions() {
  return allSessions.filter((s) => {
    if (filters.search) {
      const q = filters.search;
      if (
        !(s.nombre || "").toLowerCase().includes(q) &&
        !(s.cel || "").toLowerCase().includes(q) &&
        !(s.servicio || "").toLowerCase().includes(q)
      ) return false;
    }
    if (filters.arte && (s.arte || "").toLowerCase() !== filters.arte.toLowerCase()) return false;
    if (filters.modalidad && !(s.modalidad || "").toLowerCase().includes(filters.modalidad)) return false;
    if (filters.from) {
      const d = toDate(s.created_at);
      if (!d || d < new Date(filters.from)) return false;
    }
    if (filters.to) {
      const d = toDate(s.created_at);
      const limit = new Date(filters.to);
      limit.setDate(limit.getDate() + 1);
      if (!d || d > limit) return false;
    }
    return true;
  });
}

function renderSessions() {
  const tbody = $("sessions-tbody");
  const filtered = getFilteredSessions();

  if (!filtered.length) {
    tbody.innerHTML = "";
    show("sessions-empty");
    return;
  }

  hide("sessions-empty");
  tbody.innerHTML = filtered.map((s) => {
    const ec  = Number(s.events_count || 0);
    const rowClass = (s.nombre || s.cel) ? "row-lead"
                   : ec > 2              ? "row-active"
                   :                       "row-cold";
    return `
    <tr class="session-row ${rowClass}" data-id="${esc(s.id)}">
      <td class="td-nombre">${s.nombre ? esc(s.nombre) : '<span class="muted">—</span>'}</td>
      <td class="td-cel">${s.cel
        ? `<a href="https://wa.me/${cleanPhone(s.cel)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(s.cel)}</a>`
        : '<span class="muted">—</span>'
      }</td>
      <td>${esc(s.servicio || "—")}</td>
      <td>${esc(s.arte || "—")}</td>
      <td>${s.modalidad
        ? `<span class="badge-m badge-${slugModalidad(s.modalidad)}">${esc(s.modalidad)}</span>`
        : '<span class="muted">—</span>'
      }</td>
      <td>${esc(s.edad || "—")}</td>
      <td class="td-events">${activityBadge(ec)}</td>
      <td class="td-date">${formatDate(s.updated_at)}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".session-row").forEach((row) => {
    row.addEventListener("click", () => {
      const session = allSessions.find((s) => s.id === row.dataset.id);
      if (session) openSessionDetail(session);
    });
  });
}

function populateArteFilter() {
  const artes = [...new Set(allSessions.map((s) => s.arte).filter(Boolean))].sort();
  const select = $("filter-arte");
  const current = select.value;
  select.innerHTML =
    `<option value="">Todas las artes</option>` +
    artes.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  select.value = artes.includes(current) ? current : "";
}

// ─── Session detail panel ─────────────────────────────────────────────────────
async function openSessionDetail(session) {
  const panel = $("side-panel");
  const content = $("side-panel-content");

  $("side-panel-title").textContent = session.nombre || "Sin nombre";
  content.innerHTML =
    renderSessionFields(session) +
    `<div id="events-section"><div class="loading-msg">Cargando eventos…</div></div>`;

  panel.classList.remove("hidden");
  $("overlay").classList.remove("hidden");

  try {
    const events = await getSessionEvents(session.id);
    const evSection = $("events-section");
    if (evSection) evSection.innerHTML = renderEventsTimeline(events);
  } catch (e) {
    const evSection = $("events-section");
    if (evSection) evSection.innerHTML = `<p class="error-msg">No se pudieron cargar los eventos (puede que las reglas de Firestore no incluyan la subcolección).</p>`;
  }
}

function sessionDuration(s) {
  const start = toDate(s.created_at);
  const end   = toDate(s.updated_at);
  if (!start || !end) return null;
  const secs = Math.round((end - start) / 1000);
  if (secs < 10) return null;
  if (secs < 60)  return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)} min`;
  return `${(secs / 3600).toFixed(1)} h`;
}

function renderSessionFields(s) {
  const lead = [
    ["Nombre", s.nombre],
    ["Celular", s.cel
      ? `<a href="https://wa.me/${cleanPhone(s.cel)}" target="_blank" rel="noopener">${esc(s.cel)}</a>
         <button class="btn-copy" onclick="navigator.clipboard.writeText('${esc(s.cel)}')" title="Copiar">⎘</button>`
      : null],
    ["Servicio", s.servicio],
    ["Arte / Disciplina", s.arte],
    ["Modalidad", s.modalidad],
    ["Edad", s.edad],
    ["Idioma", s.lang],
    ["Nº eventos", s.events_count],
    ["Mensajes del usuario", s.conteo_mensajes_usuario],
    ["Fue a WhatsApp", s.whatsapp_clicked ? "✅ Sí" : null],
    ["Duración sesión", sessionDuration(s)],
    ["Creado", formatDate(s.created_at)],
    ["Última actividad", formatDate(s.updated_at)],
  ];

  const first = [
    ["Primer texto libre", s.primer_texto_usuario],
    ["Primer servicio", s.primer_servicio],
    ["Primera edad", s.primer_edad],
    ["Primer arte", s.primer_arte],
    ["Primera modalidad", s.primera_modalidad],
    ["Primer nodo", s.primer_node_name || s.primer_node_id],
    ["Origen", s.primer_origen],
  ];

  const training = [
    ["Último texto libre", s.ultimo_texto_usuario],
    ["Historial de preguntas", s.historial_usuario],
  ];

  return `
    <section class="detail-sec">
      <h3 class="sec-title">Lead</h3>
      ${fieldList(lead)}
    </section>
    <section class="detail-sec">
      <h3 class="sec-title">Primera impresión</h3>
      ${fieldList(first)}
    </section>
    <section class="detail-sec">
      <h3 class="sec-title">Historial de preguntas</h3>
      ${fieldList(training)}
    </section>
    <section class="detail-sec">
      <h3 class="sec-title" id="events-label">Eventos</h3>
    </section>
  `;
}

function fieldList(pairs) {
  const rows = pairs
    .filter(([, v]) => v != null && v !== "")
    .map(([label, value]) => `
      <div class="field-row">
        <span class="field-label">${esc(label)}</span>
        <span class="field-value">${String(value)}</span>
      </div>
    `)
    .join("");
  return rows || `<p class="muted" style="font-size:12px">Sin datos</p>`;
}

function renderEventsTimeline(events) {
  const label = $("events-label");
  if (label) label.textContent = `Eventos (${events.length})`;

  if (!events.length) return `<p class="muted" style="padding:8px 0;font-size:13px">Sin eventos registrados.</p>`;

  return `<div class="ev-list">${events.map((e) => `
    <div class="ev-item">
      <div class="ev-head">
        <span class="ev-type">${esc(e.type || "event")}</span>
        <span class="ev-time">${formatDate(e.ts || e.client_ts)}</span>
      </div>
      ${e.text ? `<div class="ev-text">${esc(String(e.text).slice(0, 300))}</div>` : ""}
      ${e.node_name ? `<div class="ev-meta">nodo: ${esc(e.node_name)}</div>` : ""}
      ${e.lang ? `<div class="ev-meta">lang: ${esc(e.lang)}</div>` : ""}
      ${e.source ? `<div class="ev-meta">source: ${esc(e.source)}</div>` : ""}
    </div>
  `).join("")}</div>`;
}

// ─── Knowledge Gaps ───────────────────────────────────────────────────────────
function renderGaps() {
  const container = $("gaps-list");

  let filtered = allGaps;
  if (gapFilters.status === "new")
    filtered = filtered.filter((g) => !g.reviewed && g.status !== "reviewed");
  else if (gapFilters.status === "reviewed")
    filtered = filtered.filter((g) => g.reviewed || g.status === "reviewed");
  if (gapFilters.lang)
    filtered = filtered.filter((g) => g.lang === gapFilters.lang);

  if (!filtered.length) {
    container.innerHTML = "";
    show("gaps-empty");
    return;
  }

  hide("gaps-empty");
  container.innerHTML = filtered.map((g) => {
    const leadParts = [g.nombre, g.arte, g.servicio, g.modalidad].filter(Boolean);
    return `
    <div class="gap-card ${g.reviewed ? "gap-done" : "gap-new"}">
      <div class="gap-head">
        <span class="tag-lang">${(g.lang || "es").toUpperCase()}</span>
        <span class="gap-node">${esc(g.node_name || g.node_id || "nodo desconocido")}</span>
        <span class="gap-date">${formatDate(g.ts || g.client_ts)}</span>
        ${!g.reviewed
          ? `<button class="btn-review" data-id="${esc(g.id)}">Marcar revisada</button>`
          : `<span class="tag-done">Revisada</span>`
        }
      </div>

      <div class="gap-user-text">
        <span class="gap-user-label">El cliente escribió:</span>
        <span class="gap-user-msg">"${esc(g.text || "(sin texto)")}"</span>
      </div>

      ${g.last_bot_text ? `
      <div class="gap-bot-context">
        <span class="gap-bot-label">El bot preguntaba:</span>
        <span class="gap-bot-msg">${esc(String(g.last_bot_text).slice(0, 160))}${g.last_bot_text.length > 160 ? "…" : ""}</span>
      </div>` : ""}

      ${leadParts.length ? `
      <div class="gap-lead-info">
        ${leadParts.map(p => `<span class="gap-lead-chip">${esc(p)}</span>`).join("")}
      </div>` : ""}
    </div>`;
  }).join("");

  container.querySelectorAll(".btn-review").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Guardando…";
      try {
        await markGapReviewed(btn.dataset.id);
      } catch {
        btn.textContent = "Error";
        btn.disabled = false;
      }
    });
  });
}

// ─── Panel close ──────────────────────────────────────────────────────────────
$("btn-close-panel").addEventListener("click", closePanel);
$("overlay").addEventListener("click", closePanel);

function closePanel() {
  $("side-panel").classList.add("hidden");
  $("overlay").classList.add("hidden");
}

// ─── Gráfica 7 días ───────────────────────────────────────────────────────────
function renderChart7d() {
  const container = $("chart-7d");
  if (!container) return;

  // Construir los 7 días (hoy incluido)
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    days.push({ date: d, count: 0 });
  }

  for (const s of allSessions) {
    const d = toDate(s.created_at);
    if (!d) continue;
    const dayStart = new Date(d);
    dayStart.setHours(0, 0, 0, 0);
    const slot = days.find((x) => x.date.getTime() === dayStart.getTime());
    if (slot) slot.count++;
  }

  const maxCount = Math.max(...days.map((d) => d.count), 1);
  const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  container.innerHTML = days.map((d) => {
    const pct = Math.round((d.count / maxCount) * 100);
    const label = DAYS_ES[d.date.getDay()];
    const isToday = d.date.toDateString() === new Date().toDateString();
    return `
      <div class="chart-col${isToday ? " chart-today" : ""}">
        <span class="chart-val">${d.count || ""}</span>
        <div class="chart-bar-wrap">
          <div class="chart-bar" style="height:${pct}%"></div>
        </div>
        <span class="chart-day">${label}</span>
      </div>`;
  }).join("");
}

// ─── Notificación nuevas sesiones ─────────────────────────────────────────────
function updatePageTitle() {
  document.title = newBadgeCount > 0
    ? `(${newBadgeCount}) MusiBot Lector — Musicala`
    : "MusiBot Lector — Musicala";
}

// ─── Google button label ──────────────────────────────────────────────────────
function googleBtnContent() {
  return `<svg width="18" height="18" viewBox="0 0 48 48" style="vertical-align:middle;margin-right:8px"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>Continuar con Google`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function toDate(val) {
  if (!val) return null;
  if (typeof val?.toDate === "function") return val.toDate();
  if (val instanceof Date) return val;
  if (typeof val === "string") return new Date(val);
  if (typeof val?.seconds === "number") return new Date(val.seconds * 1000);
  return null;
}

function formatDate(val) {
  const d = toDate(val);
  if (!d || isNaN(d)) return "—";
  return d.toLocaleString("es-CO", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanPhone(raw) {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  if (digits.length === 10 && digits.startsWith("3")) return "57" + digits;
  return digits;
}

function activityBadge(ec) {
  const n = Number(ec || 0);
  if (n === 0) return `<span class="ev-badge ev-none" title="Sin eventos">—</span>`;
  if (n <= 2)  return `<span class="ev-badge ev-low"  title="Solo abrió">${n}</span>`;
  if (n <= 8)  return `<span class="ev-badge ev-mid"  title="Navegó un poco">${n}</span>`;
  return              `<span class="ev-badge ev-high" title="Conversación activa">${n}</span>`;
}

function slugModalidad(m) {
  const s = (m || "").toLowerCase();
  if (s.includes("sede") || s.includes("presencial")) return "sede";
  if (s.includes("hogar") || s.includes("domicilio") || s.includes("hogar")) return "hogar";
  if (s.includes("virtual") || s.includes("online")) return "virtual";
  return "other";
}
