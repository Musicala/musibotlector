import { onAuthChange, loginWithGoogle, logout, isAuthorized } from "./auth.js";
import { subscribeSessions, getSessionEvents, getAllSessions, getEventsSafe, getSessionsWithEvents } from "./sessions.js";
import { subscribeKnowledgeGaps, markGapReviewed, getAllKnowledgeGaps, createKnowledgeGap } from "./knowledgeGaps.js";
import { getLastAiExport, getLastImplementedAiExport, getAiExportsHistory, createAiExport, markAiExportImplemented } from "./aiExports.js";

// ─── State ────────────────────────────────────────────────────────────────────
let allSessions = [];
let allGaps = [];
let unsubSessions = null;
let unsubGaps = null;
let currentUserEmail = "";

let filters = {
  search: "", arte: "", modalidad: "", from: "", to: "",
  whatsapp: "", lead: "", activity: "", freetext: "", source: "",
  minEvents: "", pendingSince: ""   // pendingSince = ISO date para "pendientes IA"
};
let gapFilters = { status: "new", lang: "" };

let gapSubtab = "registered";

// Caches para vistas que requieren eventos
let sessionsWithEventsCache = null;
let candidateGaps = [];
let clientMessages = [];
let candidateConfidenceFilter = "";

// Exportaciones registradas (para "pendientes" y modal)
let lastExportCached = null;
let lastImplementedCached = null;

// Notificación: sesiones nuevas desde que se abrió el panel
let baselineCount = -1;
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
  currentUserEmail = "";
  sessionsWithEventsCache = null;
  candidateGaps = [];
  clientMessages = [];
}

function showDashboard(user) {
  hide("view-login");
  show("view-dashboard");
  currentUserEmail = user.email || "";
  $("user-email").textContent = user.email;
  hide("setup-notice");

  baselineCount = -1;
  newBadgeCount = 0;

  unsubSessions = subscribeSessions(
    (sessions) => {
      if (baselineCount === -1) {
        baselineCount = sessions.length;
      } else if (sessions.length > baselineCount) {
        newBadgeCount += sessions.length - baselineCount;
        baselineCount = sessions.length;
        updatePageTitle();
      }
      allSessions = sessions;
      sessionsWithEventsCache = null;   // datos cambiaron: invalidar caché de eventos
      renderStats();
      renderSessions();
      renderChart7d();
      populateArteFilter();
      populateSourceFilter();
    },
    (err) => {
      if (err.code === "permission-denied") showSetupNotice();
    }
  );

  unsubGaps = subscribeKnowledgeGaps(
    (gaps) => { allGaps = gaps; renderGaps(); },
    () => {}
  );

  // Precargar info de exportaciones para el botón "pendientes" y el modal
  refreshExportMeta();
}

function showSetupNotice() {
  show("setup-notice");
}

async function refreshExportMeta() {
  try {
    [lastExportCached, lastImplementedCached] = await Promise.all([
      getLastAiExport(),
      getLastImplementedAiExport()
    ]);
  } catch { /* sin permisos / sin colección aún */ }
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
$("btn-export-ai").addEventListener("click", openExportModal);

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    if (btn.dataset.tab === "sessions") {
      show("panel-sessions");
      hide("panel-gaps");
      newBadgeCount = 0;
      baselineCount = allSessions.length;
      updatePageTitle();
    } else {
      hide("panel-sessions");
      show("panel-gaps");
    }
  });
});

// ─── Sub-tabs Knowledge Gaps ───────────────────────────────────────────────────
document.querySelectorAll(".subtab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".subtab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    gapSubtab = btn.dataset.subtab;
    hide("subpanel-registered");
    hide("subpanel-candidates");
    hide("subpanel-messages");
    if (gapSubtab === "registered") show("subpanel-registered");
    else if (gapSubtab === "candidates") show("subpanel-candidates");
    else show("subpanel-messages");
  });
});

// ─── Session filters ──────────────────────────────────────────────────────────
function bindFilter(id, key, transform = (v) => v) {
  const el = $(id);
  if (!el) return;
  const evt = (el.tagName === "INPUT" && el.type !== "date" && el.type !== "number") ? "input" : "change";
  el.addEventListener(evt, (e) => {
    filters[key] = transform(e.target.value);
    renderStats();
    renderSessions();
  });
}
bindFilter("filter-search", "search", (v) => v.toLowerCase());
bindFilter("filter-arte", "arte");
bindFilter("filter-modalidad", "modalidad", (v) => v.toLowerCase());
bindFilter("filter-whatsapp", "whatsapp");
bindFilter("filter-lead", "lead");
bindFilter("filter-activity", "activity");
bindFilter("filter-freetext", "freetext");
bindFilter("filter-source", "source");
bindFilter("filter-min-events", "minEvents");
bindFilter("filter-from", "from");
bindFilter("filter-to", "to");

$("btn-clear-filters").addEventListener("click", clearAllFilters);

function clearAllFilters() {
  filters = {
    search: "", arte: "", modalidad: "", from: "", to: "",
    whatsapp: "", lead: "", activity: "", freetext: "", source: "",
    minEvents: "", pendingSince: ""
  };
  ["filter-search","filter-arte","filter-modalidad","filter-whatsapp","filter-lead",
   "filter-activity","filter-freetext","filter-source","filter-min-events",
   "filter-from","filter-to"].forEach((id) => { if ($(id)) $(id).value = ""; });
  renderStats();
  renderSessions();
}

$("btn-quick-wa").addEventListener("click", () => {
  filters.whatsapp = "yes";
  if ($("filter-whatsapp")) $("filter-whatsapp").value = "yes";
  renderStats();
  renderSessions();
});

$("btn-quick-pending").addEventListener("click", async () => {
  await refreshExportMeta();
  const ref = lastImplementedCached || lastExportCached;
  const d = ref ? toDate(ref.exported_at) : null;
  filters.pendingSince = d ? d.toISOString() : "";
  if (!d) alert("No hay exportaciones registradas todavía: se muestran todas las sesiones.");
  renderStats();
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

// ─── Active filter chips ───────────────────────────────────────────────────────
const FILTER_LABELS = {
  search: "Búsqueda", arte: "Arte", modalidad: "Modalidad",
  whatsapp: "WhatsApp", lead: "Lead", activity: "Actividad",
  freetext: "Texto libre", source: "Origen", minEvents: "Mín. eventos",
  from: "Desde", to: "Hasta", pendingSince: "Pendientes IA"
};
const VALUE_LABELS = {
  whatsapp: { yes: "Sí", no: "No" },
  lead: { complete: "Lead completo", phone: "Tiene teléfono", name: "Tiene nombre", empty: "Sin datos", interacted: "Solo interactuó" },
  activity: { low: "Baja", mid: "Media", high: "Alta" },
  freetext: { yes: "Con texto", no: "Sin texto" }
};

function getActiveFilterSummary() {
  const out = [];
  for (const [key, val] of Object.entries(filters)) {
    if (!val) continue;
    let display = val;
    if (VALUE_LABELS[key]?.[val]) display = VALUE_LABELS[key][val];
    else if (key === "pendingSince") { const d = toDate(val); display = d ? formatDate(d) : "sí"; }
    out.push({ key, label: FILTER_LABELS[key] || key, value: display });
  }
  return out;
}

function hasActiveFilters() {
  return getActiveFilterSummary().length > 0;
}

function renderActiveFilterChips() {
  const box = $("active-filter-chips");
  if (!box) return;
  const active = getActiveFilterSummary();
  if (!active.length) { box.innerHTML = ""; hide("active-filter-chips"); return; }
  show("active-filter-chips");
  box.innerHTML = active.map((f) =>
    `<span class="fchip">${esc(f.label)}: ${esc(String(f.value))}<button class="fchip-x" data-key="${esc(f.key)}" title="Quitar">✕</button></span>`
  ).join("") + `<button class="fchip-clear" id="chip-clear-all">Limpiar todo</button>`;

  box.querySelectorAll(".fchip-x").forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.dataset.key;
      filters[key] = "";
      const map = {
        search: "filter-search", arte: "filter-arte", modalidad: "filter-modalidad",
        whatsapp: "filter-whatsapp", lead: "filter-lead", activity: "filter-activity",
        freetext: "filter-freetext", source: "filter-source", minEvents: "filter-min-events",
        from: "filter-from", to: "filter-to"
      };
      if (map[key] && $(map[key])) $(map[key]).value = "";
      renderStats();
      renderSessions();
    });
  });
  $("chip-clear-all")?.addEventListener("click", clearAllFilters);
}

// ─── Lead / activity classification helpers ────────────────────────────────────
function leadType(s) {
  const hasName = !!s.nombre;
  const hasPhone = !!s.cel;
  const ec = Number(s.events_count || 0);
  if (hasName && hasPhone) return "complete";
  if (hasPhone) return "phone";
  if (hasName) return "name";
  if (!hasName && !hasPhone && !s.servicio) return "empty";
  return "other";
}
function activityLevel(ec) {
  const n = Number(ec || 0);
  if (n <= 2) return "low";
  if (n <= 8) return "mid";
  return "high";
}
function hasFreeText(s) {
  return !!(s.primer_texto_usuario || s.ultimo_texto_usuario || s.historial_usuario);
}
function sessionSource(s) {
  return s.primer_origen || s.source || "";
}

// ─── Stats & Funnel (reactivos a filtros) ──────────────────────────────────────
function renderStats() {
  const data = getFilteredSessions();
  const total = data.length;
  let withPhone = 0, interactive = 0, withName = 0, withService = 0;

  for (const s of data) {
    if (s.cel)      withPhone++;
    if (s.nombre)   withName++;
    if (s.servicio) withService++;
    if (Number(s.events_count || 0) > 2) interactive++;
  }
  const withWA = data.filter((s) => s.whatsapp_clicked).length;
  const pctConversion = total ? Math.round((withPhone / total) * 100) : 0;

  $("stat-total").textContent       = total;
  $("stat-interactive").textContent = interactive;
  $("stat-with-phone").textContent  = withPhone;
  $("stat-whatsapp").textContent    = withWA;
  $("stat-conversion").textContent  = pctConversion + "%";

  const note = $("stats-scope-note");
  if (note) note.textContent = hasActiveFilters() ? "Datos según filtros activos" : "Datos globales";

  renderFunnel({ total, interactive, withName, withPhone, withService });
}

function renderFunnel({ total, interactive, withName, withPhone, withService }) {
  const steps = $("funnel-steps");
  const hint  = $("funnel-hint");
  if (!steps) return;

  const pct = (n) => total ? Math.round((n / total) * 100) : 0;
  const stages = [
    { label: "Abrieron",      n: total,       icon: "👁" },
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
  hint.textContent = total ? `Solo miraron y se fueron: ${soloMiraron} (${pct(soloMiraron)}%)` : "";
}

// ─── Sessions filter & render ───────────────────────────────────────────────────
function getFilteredSessions() {
  return allSessions.filter((s) => {
    const ec = Number(s.events_count || 0);

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

    if (filters.whatsapp === "yes" && !s.whatsapp_clicked) return false;
    if (filters.whatsapp === "no" && s.whatsapp_clicked) return false;

    if (filters.lead) {
      const lt = leadType(s);
      if (filters.lead === "complete" && lt !== "complete") return false;
      if (filters.lead === "phone" && !s.cel) return false;
      if (filters.lead === "name" && !s.nombre) return false;
      if (filters.lead === "empty" && lt !== "empty") return false;
      if (filters.lead === "interacted" && !(ec > 2 && !s.cel)) return false;
    }

    if (filters.activity && activityLevel(ec) !== filters.activity) return false;

    if (filters.freetext === "yes" && !hasFreeText(s)) return false;
    if (filters.freetext === "no" && hasFreeText(s)) return false;

    if (filters.source && sessionSource(s) !== filters.source) return false;

    if (filters.minEvents !== "" && ec < Number(filters.minEvents)) return false;

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
    if (filters.pendingSince) {
      const since = new Date(filters.pendingSince);
      const d = toDate(s.updated_at) || toDate(s.created_at);
      if (!d || d <= since) return false;
    }
    return true;
  });
}

function renderSessions() {
  const tbody = $("sessions-tbody");
  const filtered = getFilteredSessions();

  const countEl = $("sessions-count");
  if (countEl) countEl.textContent = `Mostrando ${filtered.length} de ${allSessions.length} sesiones`;

  renderActiveFilterChips();

  if (!filtered.length) {
    tbody.innerHTML = "";
    show("sessions-empty");
    return;
  }
  hide("sessions-empty");

  tbody.innerHTML = filtered.map((s) => {
    const ec = Number(s.events_count || 0);
    const rowClass = (s.nombre || s.cel) ? "row-lead" : ec > 2 ? "row-active" : "row-cold";
    const waClass = s.whatsapp_clicked ? " row-wa" : "";
    return `
    <tr class="session-row ${rowClass}${waClass}" data-id="${esc(s.id)}">
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
      <td class="td-chips">${statusChips(s, ec)}</td>
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

function statusChips(s, ec) {
  const chips = [];
  if (s.whatsapp_clicked) chips.push(`<span class="schip schip-wa">WA ✅</span>`);
  if (s.cel) chips.push(`<span class="schip schip-phone">📞</span>`);
  if (!s.nombre && !s.cel && !s.servicio) chips.push(`<span class="schip schip-empty">Sin datos</span>`);
  if (ec > 2) chips.push(`<span class="schip schip-active">Activo</span>`);
  else chips.push(`<span class="schip schip-cold">Frío</span>`);
  return chips.join(" ");
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

function populateSourceFilter() {
  const select = $("filter-source");
  if (!select) return;
  const sources = [...new Set(allSessions.map(sessionSource).filter(Boolean))].sort();
  const current = select.value;
  select.innerHTML =
    `<option value="">Todos los orígenes</option>` +
    sources.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  select.value = sources.includes(current) ? current : "";
}

// ─── Session detail panel ───────────────────────────────────────────────────────
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
    `).join("");
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

// ─── Knowledge Gaps: registrados ────────────────────────────────────────────────
function renderGaps() {
  const container = $("gaps-list");
  if (!container) return;

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
      try { await markGapReviewed(btn.dataset.id); }
      catch { btn.textContent = "Error"; btn.disabled = false; }
    });
  });
}

// ─── Carga de eventos para análisis (caché) ─────────────────────────────────────
async function ensureSessionsWithEvents() {
  if (sessionsWithEventsCache) return sessionsWithEventsCache;
  sessionsWithEventsCache = await getSessionsWithEvents(allSessions);
  return sessionsWithEventsCache;
}

// ─── Detección de candidate gaps ────────────────────────────────────────────────
const QUESTION_KEYWORDS = [
  "qué","que","cómo","como","cuánto","cuanto","valor","precio","costo","costos",
  "horario","horarios","dónde","donde","ubicación","ubicacion","direccion","dirección",
  "edad","años","anos","academia","arte","clases","curso","vacacional","mensual",
  "sede","virtual","domicilio","hogar"
];
const PRICE_KEYWORDS = ["valor","precio","costo","costos","cuánto","cuanto","pago","mensualidad","cuota","tarifa"];
const SCHEDULE_KEYWORDS = ["horario","horarios","hora","días","dias","cuándo","cuando","disponibilidad"];
const BOT_CONFUSION = [
  "no entendí","no entendi","no tengo","no sé","no se","guarda como parte de la conversación",
  "dime tu nombre","elige no dejarlo","no pude","intenta de nuevo","no encontré","no encontre"
];

function isBotType(t) { return /bot/i.test(t || ""); }
function normalize(t) { return String(t || "").toLowerCase(); }

function textHasAny(text, words) {
  const t = normalize(text);
  return words.some((w) => t.includes(w));
}
function looksLikeQuestion(text) {
  const t = normalize(text);
  if (t.includes("?")) return true;
  return QUESTION_KEYWORDS.some((w) => new RegExp(`(^|\\W)${w}(\\W|$)`).test(t));
}

function detectCandidateGaps(sessionsWithEvents) {
  const result = [];
  let tmp = 0;

  for (const s of sessionsWithEvents) {
    const events = (s.events || []).slice().sort((a, b) => {
      const da = toDate(a.ts || a.client_ts)?.getTime() || 0;
      const db = toDate(b.ts || b.client_ts)?.getTime() || 0;
      return da - db;
    });

    const userMsgs = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type !== "user_message") continue;
      const text = String(e.text || "").trim();
      if (!text) continue;

      // siguiente evento de bot
      let nextBotText = "";
      for (let j = i + 1; j < events.length; j++) {
        if (isBotType(events[j].type)) { nextBotText = String(events[j].text || ""); break; }
      }

      const reasons = [];
      let confidence = "baja";

      if (looksLikeQuestion(text)) reasons.push("Parece una pregunta");
      if (nextBotText && textHasAny(nextBotText, BOT_CONFUSION)) {
        reasons.push("El bot respondió con confusión");
        confidence = "alta";
      }
      // repetición de pregunta parecida dentro de la sesión
      const norm = normalize(text).replace(/[^\w\sáéíóúñ]/g, "").trim();
      if (userMsgs.some((m) => similar(m, norm))) {
        reasons.push("El usuario repitió una pregunta parecida");
        confidence = confidence === "alta" ? "alta" : "media";
      }
      userMsgs.push(norm);

      // pregunta importante sin conversión
      if (looksLikeQuestion(text) && !s.cel && !s.whatsapp_clicked) {
        reasons.push("Preguntó pero no dejó teléfono ni fue a WhatsApp");
        if (confidence === "baja") confidence = "media";
      }
      // menciona precio/horario/edad pero sin servicio/arte/modalidad capturado
      if (textHasAny(text, [...PRICE_KEYWORDS, ...SCHEDULE_KEYWORDS, "edad","años","anos"]) &&
          !(s.servicio || s.arte || s.modalidad)) {
        reasons.push("Mencionó precio/horario/edad sin servicio/arte/modalidad capturado");
        if (confidence === "baja") confidence = "media";
      }

      if (!reasons.length) continue;

      result.push({
        id: `cand-${tmp++}`,
        session_id: s.id,
        ts: e.ts || e.client_ts || null,
        text,
        reason: reasons.join(" · "),
        confidence,
        next_bot_text: nextBotText,
        node_name: e.node_name || e.node_id || "",
        source: e.source || sessionSource(s),
        nombre: s.nombre || "",
        cel: s.cel || "",
        servicio: s.servicio || "",
        arte: s.arte || "",
        modalidad: s.modalidad || "",
        whatsapp_clicked: !!s.whatsapp_clicked
      });
    }
  }
  return result;
}

function similar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const wa = new Set(a.split(/\s+/).filter((w) => w.length > 3));
  const wb = new Set(b.split(/\s+/).filter((w) => w.length > 3));
  if (!wa.size || !wb.size) return false;
  let common = 0;
  wa.forEach((w) => { if (wb.has(w)) common++; });
  return common / Math.min(wa.size, wb.size) >= 0.6;
}

$("btn-load-candidates").addEventListener("click", loadCandidateGaps);
$("filter-candidate-confidence").addEventListener("change", (e) => {
  candidateConfidenceFilter = e.target.value;
  renderCandidateGaps();
});

async function loadCandidateGaps() {
  const btn = $("btn-load-candidates");
  btn.disabled = true; btn.textContent = "Analizando…";
  try {
    const swe = await ensureSessionsWithEvents();
    candidateGaps = detectCandidateGaps(swe);
    renderCandidateGaps();
  } catch (err) {
    console.error(err);
    alert("No se pudieron analizar los eventos.");
  } finally {
    btn.disabled = false; btn.textContent = "Detectar posibles gaps";
  }
}

function renderCandidateGaps() {
  const container = $("candidates-list");
  if (!container) return;
  let list = candidateGaps;
  if (candidateConfidenceFilter) list = list.filter((c) => c.confidence === candidateConfidenceFilter);

  $("candidates-count").textContent = candidateGaps.length ? `${list.length} de ${candidateGaps.length} posibles gaps` : "";

  if (!list.length) {
    container.innerHTML = "";
    show("candidates-empty");
    $("candidates-empty").textContent = candidateGaps.length
      ? "No hay posibles gaps con ese nivel de confianza."
      : "Pulsa “Detectar posibles gaps” para analizar los mensajes de los clientes.";
    return;
  }
  hide("candidates-empty");

  container.innerHTML = list.map((c) => {
    const leadParts = [c.nombre, c.arte, c.servicio, c.modalidad].filter(Boolean);
    return `
    <div class="gap-card cand-${esc(c.confidence)}">
      <div class="gap-head">
        <span class="conf-badge conf-${esc(c.confidence)}">${esc(c.confidence)}</span>
        <span class="gap-node">${esc(c.reason)}</span>
        <span class="gap-date">${formatDate(c.ts)}</span>
        ${c.whatsapp_clicked ? `<span class="schip schip-wa">WA ✅</span>` : `<span class="schip schip-cold">Sin WA</span>`}
      </div>
      <div class="gap-user-text">
        <span class="gap-user-label">El cliente escribió:</span>
        <span class="gap-user-msg">"${esc(c.text)}"</span>
      </div>
      ${c.next_bot_text ? `
      <div class="gap-bot-context">
        <span class="gap-bot-label">El bot respondió:</span>
        <span class="gap-bot-msg">${esc(String(c.next_bot_text).slice(0, 160))}${c.next_bot_text.length > 160 ? "…" : ""}</span>
      </div>` : ""}
      ${leadParts.length ? `<div class="gap-lead-info">${leadParts.map(p => `<span class="gap-lead-chip">${esc(p)}</span>`).join("")}</div>` : ""}
      <div class="card-actions">
        <button class="btn-mini" data-act="view" data-sid="${esc(c.session_id)}">Ver sesión</button>
        <button class="btn-mini" data-act="copy" data-id="${esc(c.id)}">Copiar texto</button>
        <button class="btn-mini btn-mini-primary" data-act="create" data-id="${esc(c.id)}">Crear gap registrado</button>
      </div>
    </div>`;
  }).join("");

  container.querySelectorAll(".btn-mini").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      if (act === "view") return openSessionById(btn.dataset.sid);
      const cand = candidateGaps.find((c) => c.id === btn.dataset.id);
      if (!cand) return;
      if (act === "copy") return copyText(cand.text, btn);
      if (act === "create") return createGapFromCandidate(cand, btn);
    });
  });
}

async function createGapFromCandidate(cand, btn) {
  btn.disabled = true; btn.textContent = "Creando…";
  try {
    await createKnowledgeGapFromCandidate(cand);
    btn.textContent = "✓ Creado";
  } catch (err) {
    console.error(err);
    btn.textContent = "Error"; btn.disabled = false;
  }
}

async function createKnowledgeGapFromCandidate(candidate) {
  return createKnowledgeGap({
    text: candidate.text,
    client_ts: candidate.ts ? (toDate(candidate.ts)?.toISOString() || null) : null,
    session_id: candidate.session_id,
    node_name: candidate.node_name,
    node_id: candidate.node_name,
    source: candidate.source,
    lang: "es",
    last_bot_text: candidate.next_bot_text,
    nombre: candidate.nombre,
    cel: candidate.cel,
    servicio: candidate.servicio,
    arte: candidate.arte,
    modalidad: candidate.modalidad
  });
}

// ─── Mensajes del cliente ───────────────────────────────────────────────────────
function extractUserMessages(sessionsWithEvents) {
  const out = [];
  for (const s of sessionsWithEvents) {
    const events = (s.events || []).slice().sort((a, b) => {
      const da = toDate(a.ts || a.client_ts)?.getTime() || 0;
      const db = toDate(b.ts || b.client_ts)?.getTime() || 0;
      return da - db;
    });
    let lastBot = "";
    for (const e of events) {
      if (isBotType(e.type)) { lastBot = String(e.text || lastBot); continue; }
      if (e.type !== "user_message") continue;
      const text = String(e.text || "").trim();
      if (!text) continue;
      out.push({
        session_id: s.id,
        ts: e.ts || e.client_ts || null,
        text,
        last_bot_text: lastBot,
        node_name: e.node_name || e.node_id || "",
        source: e.source || sessionSource(s),
        nombre: s.nombre || "", cel: s.cel || "",
        servicio: s.servicio || "", arte: s.arte || "", modalidad: s.modalidad || "",
        whatsapp_clicked: !!s.whatsapp_clicked
      });
    }
  }
  return out;
}

$("btn-load-messages").addEventListener("click", loadClientMessages);
["filter-msg-search","filter-msg-kind","filter-msg-from","filter-msg-to"].forEach((id) => {
  const el = $(id);
  if (!el) return;
  const evt = el.tagName === "INPUT" && el.type === "text" ? "input" : "change";
  el.addEventListener(evt, renderClientMessages);
});

async function loadClientMessages() {
  const btn = $("btn-load-messages");
  btn.disabled = true; btn.textContent = "Cargando…";
  try {
    const swe = await ensureSessionsWithEvents();
    clientMessages = extractUserMessages(swe);
    renderClientMessages();
  } catch (err) {
    console.error(err);
    alert("No se pudieron cargar los mensajes.");
  } finally {
    btn.disabled = false; btn.textContent = "Cargar mensajes";
  }
}

function renderClientMessages() {
  const container = $("messages-list");
  if (!container) return;

  const search = ($("filter-msg-search")?.value || "").toLowerCase();
  const kind = $("filter-msg-kind")?.value || "";
  const from = $("filter-msg-from")?.value || "";
  const to = $("filter-msg-to")?.value || "";

  let list = clientMessages.filter((m) => {
    if (search && !m.text.toLowerCase().includes(search)) return false;
    if (kind === "question" && !looksLikeQuestion(m.text)) return false;
    if (kind === "price" && !textHasAny(m.text, PRICE_KEYWORDS)) return false;
    if (kind === "schedule" && !textHasAny(m.text, SCHEDULE_KEYWORDS)) return false;
    if (kind === "whatsapp" && !m.whatsapp_clicked) return false;
    if (kind === "nophone" && m.cel) return false;
    if (from) { const d = toDate(m.ts); if (!d || d < new Date(from)) return false; }
    if (to) { const d = toDate(m.ts); const lim = new Date(to); lim.setDate(lim.getDate()+1); if (!d || d > lim) return false; }
    return true;
  });

  $("messages-count").textContent = clientMessages.length ? `${list.length} de ${clientMessages.length} mensajes` : "";

  if (!list.length) {
    container.innerHTML = "";
    show("messages-empty");
    $("messages-empty").textContent = clientMessages.length
      ? "No hay mensajes que coincidan con los filtros."
      : "Pulsa “Cargar mensajes” para ver todo lo que dijeron los clientes.";
    return;
  }
  hide("messages-empty");

  container.innerHTML = list.map((m, idx) => {
    const leadParts = [m.nombre, m.cel, m.servicio, m.arte, m.modalidad].filter(Boolean);
    return `
    <div class="msg-card">
      <div class="msg-head">
        <span class="gap-date">${formatDate(m.ts)}</span>
        ${m.whatsapp_clicked ? `<span class="schip schip-wa">WA ✅</span>` : ""}
        ${m.cel ? `<span class="schip schip-phone">📞</span>` : `<span class="schip schip-empty">Sin teléfono</span>`}
      </div>
      <div class="msg-text">${esc(m.text)}</div>
      ${leadParts.length ? `<div class="gap-lead-info">${leadParts.map(p => `<span class="gap-lead-chip">${esc(p)}</span>`).join("")}</div>` : ""}
      <div class="card-actions">
        <button class="btn-mini" data-act="view" data-sid="${esc(m.session_id)}">Ver sesión</button>
        <button class="btn-mini" data-act="copy" data-idx="${idx}">Copiar</button>
        <button class="btn-mini btn-mini-primary" data-act="cremsg" data-idx="${idx}">Crear gap</button>
      </div>
    </div>`;
  }).join("");

  container.querySelectorAll(".btn-mini").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      if (act === "view") return openSessionById(btn.dataset.sid);
      const m = list[Number(btn.dataset.idx)];
      if (!m) return;
      if (act === "copy") return copyText(m.text, btn);
      if (act === "cremsg") {
        btn.disabled = true; btn.textContent = "Creando…";
        try {
          await createKnowledgeGap({
            text: m.text,
            client_ts: m.ts ? (toDate(m.ts)?.toISOString() || null) : null,
            session_id: m.session_id, node_name: m.node_name, node_id: m.node_name,
            source: m.source, lang: "es", last_bot_text: m.last_bot_text,
            nombre: m.nombre, cel: m.cel, servicio: m.servicio, arte: m.arte, modalidad: m.modalidad
          });
          btn.textContent = "✓ Creado";
        } catch { btn.textContent = "Error"; btn.disabled = false; }
      }
    });
  });
}

function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = "✓ Copiado";
    setTimeout(() => { btn.textContent = orig; }, 1200);
  });
}

function openSessionById(sid) {
  const s = allSessions.find((x) => x.id === sid);
  if (s) openSessionDetail(s);
}

// ─── MODAL: Descargar conocimiento para IA ──────────────────────────────────────
$("btn-close-export-modal").addEventListener("click", closeExportModal);
$("btn-export-cancel").addEventListener("click", closeExportModal);
$("export-modal-backdrop").addEventListener("click", (e) => {
  if (e.target.id === "export-modal-backdrop") closeExportModal();
});
$("export-scope").addEventListener("change", (e) => {
  $("export-custom-range").classList.toggle("hidden", e.target.value !== "custom_range");
});
$("btn-toggle-history").addEventListener("click", toggleHistory);
$("btn-export-norecord").addEventListener("click", () => runExport(false));
$("btn-export-record").addEventListener("click", () => runExport(true));

async function openExportModal() {
  $("export-modal-backdrop").classList.remove("hidden");
  $("last-export-info").innerHTML = "Cargando…";
  $("since-last-info").textContent = "";
  $("export-history").classList.add("hidden");
  $("export-history").innerHTML = "";
  await refreshExportMeta();
  renderLastExportInfo();
  renderSinceLast();
}

function closeExportModal() {
  $("export-modal-backdrop").classList.add("hidden");
}

function renderLastExportInfo() {
  const box = $("last-export-info");
  const e = lastExportCached;
  if (!e) { box.innerHTML = "Todavía no hay descargas registradas."; return; }
  const status = e.status === "implemented" ? `<span class="tag-done">Implementado</span>` : `<span class="schip schip-cold">Pendiente</span>`;
  box.innerHTML = `
    <div class="le-row"><b>Fecha:</b> ${formatDate(e.exported_at)}</div>
    <div class="le-row"><b>Usuario:</b> ${esc(e.exported_by || "—")}</div>
    <div class="le-row"><b>Rango:</b> ${esc(rangeLabel(e.range_type))} ${e.from ? `(${formatDate(e.from)} → ${e.to ? formatDate(e.to) : "hoy"})` : ""}</div>
    <div class="le-row"><b>Sesiones:</b> ${e.sessions_count ?? 0} · <b>Gaps:</b> ${e.gaps_count ?? 0} · <b>Posibles:</b> ${e.candidate_gaps_count ?? 0}</div>
    <div class="le-row"><b>Estado:</b> ${status}</div>
    ${e.note ? `<div class="le-row"><b>Nota:</b> ${esc(e.note)}</div>` : ""}
  `;
}

function renderSinceLast() {
  const ref = lastImplementedCached || lastExportCached;
  const el = $("since-last-info");
  if (!ref) { el.textContent = ""; return; }
  const since = toDate(ref.exported_at);
  if (!since) { el.textContent = ""; return; }
  const newSessions = allSessions.filter((s) => {
    const d = toDate(s.updated_at) || toDate(s.created_at);
    return d && d > since;
  }).length;
  const implLabel = lastImplementedCached ? formatDate(lastImplementedCached.exported_at) : "ninguna";
  el.innerHTML = `Última descarga implementada: <b>${implLabel}</b><br>Información nueva desde entonces: <b>${newSessions}</b> sesiones`;
}

function rangeLabel(rt) {
  return ({
    since_last_export: "Desde la última descarga",
    current_filters: "Filtros actuales",
    custom_range: "Rango personalizado",
    all: "Todo el historial",
    whatsapp_only: "Solo WhatsApp",
    gaps_only: "Solo gaps sin revisar"
  })[rt] || rt || "—";
}

async function toggleHistory() {
  const box = $("export-history");
  if (!box.classList.contains("hidden")) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  box.innerHTML = `<p class="muted" style="font-size:12px">Cargando…</p>`;
  try {
    const history = await getAiExportsHistory(10);
    if (!history.length) { box.innerHTML = `<p class="muted" style="font-size:12px">Sin exportaciones registradas.</p>`; return; }
    box.innerHTML = history.map((h) => `
      <div class="hist-row">
        <div class="hist-main">
          <span class="hist-date">${formatDate(h.exported_at)}</span>
          <span class="hist-by">${esc(h.exported_by || "—")}</span>
          ${h.status === "implemented" ? `<span class="tag-done">Implementado</span>` : `<span class="schip schip-cold">Pendiente</span>`}
        </div>
        <div class="hist-meta">${esc(rangeLabel(h.range_type))} · ${h.sessions_count||0} ses · ${h.gaps_count||0} gaps · ${h.candidate_gaps_count||0} posibles</div>
        ${h.note ? `<div class="hist-note">${esc(h.note)}</div>` : ""}
        ${h.status !== "implemented" ? `<button class="btn-mini btn-mini-primary hist-impl" data-id="${esc(h.id)}">Marcar implementada</button>` : ""}
      </div>
    `).join("");
    box.querySelectorAll(".hist-impl").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "Guardando…";
        try {
          await markAiExportImplemented(btn.dataset.id, currentUserEmail);
          await refreshExportMeta();
          renderLastExportInfo();
          renderSinceLast();
          toggleHistory(); toggleHistory(); // recargar
        } catch { btn.textContent = "Error"; btn.disabled = false; }
      });
    });
  } catch (err) {
    box.innerHTML = `<p class="error-msg">No se pudo cargar el historial.</p>`;
  }
}

function resolveExportScope() {
  const scope = $("export-scope").value;
  let from = null, to = null;
  if (scope === "since_last_export") {
    const ref = lastImplementedCached || lastExportCached;
    const d = ref ? toDate(ref.exported_at) : null;
    from = d ? d.toISOString() : null;
  } else if (scope === "custom_range") {
    from = $("export-from").value ? new Date($("export-from").value).toISOString() : null;
    to = $("export-to").value ? new Date($("export-to").value).toISOString() : null;
  } else if (scope === "current_filters") {
    from = filters.from ? new Date(filters.from).toISOString() : null;
    to = filters.to ? new Date(filters.to).toISOString() : null;
  }
  return { scope, from, to };
}

function getSessionsForExport(scope, fromISO, toISO) {
  let base = allSessions;
  if (scope === "current_filters") base = getFilteredSessions();
  if (scope === "whatsapp_only") base = allSessions.filter((s) => s.whatsapp_clicked);

  if (fromISO) {
    const f = new Date(fromISO);
    base = base.filter((s) => { const d = toDate(s.updated_at) || toDate(s.created_at); return d && d > f; });
  }
  if (toISO) {
    const t = new Date(toISO); t.setDate(t.getDate() + 1);
    base = base.filter((s) => { const d = toDate(s.created_at) || toDate(s.updated_at); return d && d <= t; });
  }
  return base;
}

async function runExport(register) {
  const recordBtn = $("btn-export-record");
  const norecordBtn = $("btn-export-norecord");
  recordBtn.disabled = true; norecordBtn.disabled = true;
  const activeBtn = register ? recordBtn : norecordBtn;
  const origText = activeBtn.textContent;
  activeBtn.textContent = "Preparando…";

  try {
    const { scope, from, to } = resolveExportScope();
    const options = {
      sessions: $("opt-sessions").checked,
      events: $("opt-events").checked,
      messages: $("opt-messages").checked,
      gaps: $("opt-gaps").checked,
      candidates: $("opt-candidates").checked,
      realActivity: $("opt-real-activity").checked,
      rawJson: $("opt-raw-json").checked
    };
    const note = $("export-note").value || "";

    // Gaps
    let gaps = [];
    if (options.gaps || scope === "gaps_only") {
      try { gaps = await getAllKnowledgeGaps(); } catch { gaps = allGaps; }
      if (scope === "gaps_only") gaps = gaps.filter((g) => !g.reviewed && g.status !== "reviewed");
    }

    // Sesiones a incluir
    let sessions = [];
    if (scope !== "gaps_only" && options.sessions) {
      sessions = getSessionsForExport(scope, from, to);
      if (options.realActivity) sessions = sessions.filter((s) => Number(s.events_count || 0) > 2);
    }

    // Eventos / candidate gaps necesitan eventos
    let candGaps = [];
    if (sessions.length && (options.events || options.candidates || options.messages)) {
      const swe = await getSessionsWithEvents(sessions);
      sessions = swe;
      if (options.candidates) candGaps = detectCandidateGaps(swe);
    }

    const exportMeta = {
      exported_by: currentUserEmail,
      exported_at: new Date(),
      range_type: scope,
      from, to,
      note,
      filters_snapshot: scope === "current_filters" ? { ...filters } : {},
      last_implemented: lastImplementedCached ? toDate(lastImplementedCached.exported_at) : null
    };

    const md = buildAiTrainingMarkdown({ sessions, gaps, candidateGaps: candGaps, options, exportMeta });
    downloadTextFile(md, `musibot-entrenamiento-ia-${dateSlug()}.md`);

    if (register) {
      try {
        await createAiExport({
          exported_by: currentUserEmail,
          range_type: scope,
          from, to,
          filters_snapshot: exportMeta.filters_snapshot,
          sessions_count: sessions.length,
          gaps_count: gaps.length,
          candidate_gaps_count: candGaps.length,
          session_ids: sessions.map((s) => s.id),
          gap_ids: gaps.map((g) => g.id),
          note
        });
        await refreshExportMeta();
        renderLastExportInfo();
        renderSinceLast();
      } catch (err) {
        console.error(err);
        alert("Se descargó el archivo, pero no se pudo registrar en Firestore (revisa las reglas de ai_exports).");
      }
    }
    closeExportModal();
  } catch (err) {
    console.error(err);
    alert("No se pudo preparar la descarga. Revisa permisos de Firestore o la conexión.");
  } finally {
    recordBtn.disabled = false; norecordBtn.disabled = false;
    activeBtn.textContent = origText;
  }
}

// ─── Markdown para IA ────────────────────────────────────────────────────────────
function buildAiTrainingMarkdown({ sessions = [], gaps = [], candidateGaps = [], options = {}, exportMeta = {} }) {
  const lines = [];
  const since = exportMeta.last_implemented ? new Date(exportMeta.last_implemented) : null;

  lines.push("# MusiBot - Paquete de entrenamiento IA", "");

  // Metadatos
  lines.push("## Metadatos de exportación", "");
  lines.push(`- Exportado por: ${mdLine(exportMeta.exported_by || "—")}`);
  lines.push(`- Fecha: ${(exportMeta.exported_at || new Date()).toLocaleString("es-CO")}`);
  lines.push(`- Alcance: ${rangeLabel(exportMeta.range_type)}`);
  lines.push(`- Rango: ${exportMeta.from ? formatDate(exportMeta.from) : "inicio"} → ${exportMeta.to ? formatDate(exportMeta.to) : "hoy"}`);
  lines.push(`- Filtros usados: ${Object.keys(exportMeta.filters_snapshot || {}).length ? mdLine(JSON.stringify(exportMeta.filters_snapshot)) : "ninguno"}`);
  lines.push(`- Nota: ${mdLine(exportMeta.note || "—")}`);
  lines.push(`- Última exportación implementada: ${since ? since.toLocaleString("es-CO") : "ninguna"}`);
  lines.push("");

  // Resumen ejecutivo
  const withPhone = sessions.filter((s) => s.cel).length;
  const withWA = sessions.filter((s) => s.whatsapp_clicked).length;
  const noConv = sessions.filter((s) => !s.cel && !s.whatsapp_clicked).length;
  const newGaps = gaps.filter((g) => !g.reviewed && g.status !== "reviewed");
  const topQuestions = topValues(sessions.flatMap((s) => splitHistory(s.historial_usuario)), 20);

  lines.push("## Resumen ejecutivo", "");
  lines.push(`- Sesiones incluidas: ${sessions.length}`);
  lines.push(`- Sesiones con teléfono: ${withPhone}`);
  lines.push(`- Sesiones que fueron a WhatsApp: ${withWA}`);
  lines.push(`- Sesiones sin conversión: ${noConv}`);
  lines.push(`- Knowledge gaps registrados: ${gaps.length}`);
  lines.push(`- Posibles gaps detectados: ${candidateGaps.length}`);
  lines.push(`- Preguntas frecuentes detectadas: ${topQuestions.length}`);
  lines.push("");

  // Qué cambió desde la última implementación
  if (since) {
    const newSessions = sessions.filter((s) => { const d = toDate(s.updated_at) || toDate(s.created_at); return d && d > since; });
    const abandon = newSessions.filter((s) => !s.cel && !s.whatsapp_clicked).length;
    lines.push("## Qué cambió desde la última implementación", "");
    lines.push(`- Nuevas sesiones: ${newSessions.length}`);
    lines.push(`- Nuevos posibles gaps: ${candidateGaps.filter((c) => { const d = toDate(c.ts); return d && d > since; }).length}`);
    lines.push(`- Nuevos gaps registrados: ${newGaps.filter((g) => { const d = toDate(g.ts || g.client_ts); return d && d > since; }).length}`);
    lines.push(`- Nuevas señales de abandono: ${abandon}`);
    lines.push("");
  }

  // Leads que fueron a WhatsApp
  lines.push("## Leads que fueron a WhatsApp", "");
  const waSessions = sessions.filter((s) => s.whatsapp_clicked);
  if (!waSessions.length) lines.push("- Ninguna sesión incluida fue a WhatsApp.");
  else waSessions.forEach((s) => {
    lines.push(`- ${mdLine([s.nombre, s.cel].filter(Boolean).join(" / ") || "Sin datos")} | ${mdLine([s.servicio, s.arte, s.modalidad].filter(Boolean).join(" / ") || "Sin interés")} | Historial: ${mdLine(s.historial_usuario || "—")}`);
  });
  lines.push("");

  // Preguntas reales
  lines.push("## Preguntas reales de usuarios", "");
  const topTexts = topValues(sessions.map((s) => s.ultimo_texto_usuario || s.primer_texto_usuario).filter(Boolean), 20);
  const allTop = topQuestions.concat(topTexts);
  if (!allTop.length) lines.push("- No hay textos suficientes en las sesiones incluidas.");
  else allTop.slice(0, 30).forEach(([t, c]) => lines.push(`- (${c}) ${mdLine(t)}`));
  lines.push("");

  // Knowledge gaps registrados
  if (options.gaps !== false) {
    lines.push("## Knowledge gaps registrados", "");
    if (!gaps.length) lines.push("- No hay knowledge gaps registrados en este alcance.");
    else gaps.slice(0, 200).forEach((g) =>
      lines.push(`- ${formatDate(g.ts || g.client_ts)} | ${mdLine(g.node_name || g.node_id || "nodo")} | Cliente: "${mdLine(g.text || "")}" | Bot: "${mdLine(g.last_bot_text || "")}"`));
    lines.push("");
  }

  // Posibles gaps detectados
  if (options.candidates && candidateGaps.length) {
    lines.push("## Posibles knowledge gaps detectados automáticamente", "");
    candidateGaps.slice(0, 300).forEach((c) =>
      lines.push(`- [${c.confidence}] ${formatDate(c.ts)} | ${mdLine(c.reason)} | Cliente: "${mdLine(c.text)}" | Bot: "${mdLine(c.next_bot_text || "")}"`));
    lines.push("");
  }

  // Conversaciones completas
  if (options.events) {
    lines.push("## Conversaciones completas seleccionadas", "");
    sessions.forEach((s) => { lines.push(...formatSessionForAi(s)); });
    lines.push("");
  } else if (options.messages) {
    lines.push("## Mensajes de los usuarios", "");
    sessions.forEach((s) => {
      const msgs = (s.events || []).filter((e) => e.type === "user_message" && e.text);
      if (!msgs.length) return;
      lines.push(`### Sesión ${s.id}`);
      msgs.forEach((e) => lines.push(`- ${formatDate(e.ts || e.client_ts)}: ${mdLine(e.text)}`));
      lines.push("");
    });
  }

  // Datos crudos JSON
  if (options.rawJson) {
    lines.push("## Datos crudos JSON", "", "```json");
    lines.push(JSON.stringify({
      exported_at: (exportMeta.exported_at || new Date()).toISOString(),
      meta: { range_type: exportMeta.range_type, from: exportMeta.from, to: exportMeta.to, note: exportMeta.note },
      summary: { sessions: sessions.length, knowledge_gaps: gaps.length, candidate_gaps: candidateGaps.length },
      sessions: sessions.map(compactSession),
      knowledge_gaps: gaps.map(compactGap),
      candidate_gaps: candidateGaps
    }, jsonReplacer, 2));
    lines.push("```", "");
  }

  return lines.join("\n");
}

function formatSessionForAi(s) {
  return [
    `### Sesión ${s.id}`, "",
    `- Fecha: ${formatDate(s.created_at)} - ${formatDate(s.updated_at)}`,
    `- Lead: ${mdLine([s.nombre, s.cel].filter(Boolean).join(" / ") || "Sin datos")}`,
    `- Interés: ${mdLine([s.servicio, s.arte, s.modalidad, s.edad].filter(Boolean).join(" / ") || "Sin datos")}`,
    `- Idioma: ${mdLine(s.lang || "No registrado")}`,
    `- WhatsApp: ${s.whatsapp_clicked ? "Sí" : "No"}`,
    `- Primer texto libre: ${mdLine(s.primer_texto_usuario || "No registrado")}`,
    `- Último texto libre: ${mdLine(s.ultimo_texto_usuario || "No registrado")}`,
    `- Historial usuario: ${mdLine(s.historial_usuario || "No registrado")}`,
    "", "Eventos:",
    ...(s.events || []).map((e) => `- ${formatDate(e.ts || e.client_ts)} | ${mdLine(e.type || "event")} | ${mdLine(e.node_name || e.node_id || e.source || "")}${e.text ? ` | ${mdLine(e.text)}` : ""}`),
    ""
  ];
}

function compactSession(s) {
  return {
    id: s.id,
    created_at: serializeDate(s.created_at),
    updated_at: serializeDate(s.updated_at),
    nombre: s.nombre || "", cel: s.cel || "", servicio: s.servicio || "",
    arte: s.arte || "", modalidad: s.modalidad || "", edad: s.edad || "",
    lang: s.lang || "", whatsapp_clicked: Boolean(s.whatsapp_clicked),
    primer_texto_usuario: s.primer_texto_usuario || "",
    ultimo_texto_usuario: s.ultimo_texto_usuario || "",
    historial_usuario: s.historial_usuario || "",
    events: (s.events || []).map((e) => ({
      ts: serializeDate(e.ts || e.client_ts),
      type: e.type || "", text: e.text || "",
      node_id: e.node_id || "", node_name: e.node_name || "", source: e.source || ""
    }))
  };
}

function compactGap(g) {
  return {
    id: g.id, ts: serializeDate(g.ts || g.client_ts),
    status: g.status || (g.reviewed ? "reviewed" : "new"),
    lang: g.lang || "", text: g.text || "", last_bot_text: g.last_bot_text || "",
    node_id: g.node_id || "", node_name: g.node_name || "",
    servicio: g.servicio || "", arte: g.arte || "", modalidad: g.modalidad || ""
  };
}

function splitHistory(history) {
  return String(history || "").split(/\n| \| |; /).map((x) => x.trim()).filter((x) => x.length > 4);
}

function topValues(values, max) {
  const counts = new Map();
  values.forEach((value) => {
    const clean = String(value || "").trim();
    if (!clean) return;
    counts.set(clean, (counts.get(clean) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
}

function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dateSlug() { return new Date().toISOString().slice(0, 10); }

function serializeDate(val) {
  const d = toDate(val);
  return d && !isNaN(d) ? d.toISOString() : "";
}

function jsonReplacer(_key, value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (value && typeof value.seconds === "number") return new Date(value.seconds * 1000).toISOString();
  return value;
}

function mdLine(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }

// ─── Panel close ────────────────────────────────────────────────────────────────
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
  if (s.includes("hogar") || s.includes("domicilio")) return "hogar";
  if (s.includes("virtual") || s.includes("online")) return "virtual";
  return "other";
}
