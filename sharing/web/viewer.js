/* No third-party assets, analytics, innerHTML, localStorage, or desktop IPC. */
(() => {
  const byId = (id) => document.getElementById(id);
  const text = (id, value) => { byId(id).textContent = value; };
  const duration = (seconds) => `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}m ${String(seconds % 60).padStart(2, "0")}s`;
  const date = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { month:"short", day:"numeric", timeZone:"UTC" });
  const element = (tag, value) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = value; return node; };
  const row = (values, tag = "td") => { const tr = element("tr"); for (const value of values) tr.append(element(tag, value)); return tr; };
  let lastReport = null;
  let stopped = false;
  let fetching = false;

  function status(label, state, message = "") {
    text("connection-label", label);
    byId("connection-dot").className = `dot ${state}`;
    text("notice", message);
    byId("notice").hidden = !message;
  }

  function selectView(view) {
    const timesheet = view === "timesheet";
    byId("report-view").hidden = timesheet;
    byId("timesheet-view").hidden = !timesheet;
    byId("report-tab").setAttribute("aria-pressed", String(!timesheet));
    byId("timesheet-tab").setAttribute("aria-pressed", String(timesheet));
  }

  function clearReport() {
    byId("content").hidden = true;
    for (const id of ["chart", "entries", "week-head", "week-body", "week-foot"]) byId(id).replaceChildren();
    for (const id of ["total", "sessions", "updated", "billable", "expiry", "timezone"]) text(id, "—");
    lastReport = null;
  }

  function endSharing(message) {
    stopped = true;
    clearReport();
    text("title", "Share unavailable");
    text("range", "Request a new link from the report owner.");
    status("Stopped", "offline", message);
  }

  function render(report) {
    byId("demo-banner").hidden = report.demo !== true;
    text("title", report.title);
    text("range", `${date(report.dateFrom)} – ${date(report.dateTo)} · ${report.timezone}`);
    text("total", duration(report.totalSeconds));
    text("sessions", String(report.entryCount));
    text("updated", new Date(report.generatedAtUtc).toLocaleTimeString());
    text("timezone", `Report timezone: ${report.timezone}`);
    text("expiry", `Link expires ${new Date(report.expiresAtUtc).toLocaleString()}`);
    byId("billable-card").hidden = report.billableSeconds === undefined;
    if (report.billableSeconds !== undefined) text("billable", duration(report.billableSeconds));
    const chart = byId("chart");
    chart.replaceChildren();
    const maximum = Math.max(1, ...report.days.map((day) => day.seconds));
    for (const day of report.days) {
      const wrapper = element("div"); wrapper.className = "chart-row";
      const bar = element("meter"); bar.min = 0; bar.max = maximum; bar.value = day.seconds; bar.setAttribute("aria-label", `${date(day.date)}: ${duration(day.seconds)}`);
      wrapper.append(element("span", date(day.date)), bar, element("span", duration(day.seconds)));
      chart.append(wrapper);
    }
    byId("entries").replaceChildren();
    for (const entry of report.entries) {
      const tr = row([entry.project, entry.description ?? "Work session", new Date(entry.startAtUtc).toLocaleString(undefined, {timeZone:report.timezone}), duration(entry.seconds)]);
      if (entry.running) { const badge = element("span", "Running"); badge.className = "running"; tr.lastChild.append(badge); }
      byId("entries").append(tr);
    }
    byId("week-head").replaceChildren(row(["Project / work", ...report.days.map((day) => date(day.date)), "Total"], "th"));
    byId("week-body").replaceChildren();
    for (const item of report.rows) byId("week-body").append(row([item.description ? `${item.project} · ${item.description}` : item.project, ...item.daySeconds.map((seconds) => seconds ? duration(seconds) : "—"), duration(item.totalSeconds)]));
    byId("week-foot").replaceChildren(row(["Total", ...report.days.map((day) => duration(day.seconds)), duration(report.totalSeconds)]));
    byId("content").hidden = false;
  }

  async function refresh() {
    if (fetching || stopped || document.hidden) return;
    if (lastReport && Date.now() >= lastReport.expiresAtUtc) {
      endSharing("This share link has expired.");
      return;
    }
    fetching = true;
    try {
      const response = await fetch(new URL("data.json", window.location.href), {
        cache:"no-store", credentials:"omit", redirect:"error", signal:AbortSignal.timeout(8000),
      });
      if (response.status === 404 || response.status === 410) {
        const problem = await response.json();
        endSharing(problem.message);
        return;
      }
      if (!response.ok) throw new Error("Source unavailable");
      lastReport = await response.json();
      if (Date.now() >= lastReport.expiresAtUtc) {endSharing("This share link has expired.");return;}
      render(lastReport);
      status("Live", "live");
    } catch {
      status("Offline · retrying", "offline", lastReport ? "The source is unavailable. Showing the last received report; reconnecting automatically." : "The source is unavailable. Reconnecting automatically.");
    } finally { fetching = false; }
  }

  byId("report-tab").addEventListener("click", () => { window.location.hash = "report"; selectView("report"); });
  byId("timesheet-tab").addEventListener("click", () => { window.location.hash = "timesheet"; selectView("timesheet"); });
  window.addEventListener("hashchange", () => selectView(window.location.hash.slice(1)));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  selectView(window.location.hash.slice(1));
  void refresh();
  setInterval(() => void refresh(), 5000);
})();
