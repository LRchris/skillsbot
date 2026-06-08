const form = document.querySelector("#search-form");
const input = document.querySelector("#company");
const demoPasswordInput = document.querySelector("#demo-password");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const companySkillsEl = document.querySelector("#company-skills");
const companyTasksEl = document.querySelector("#company-tasks");
const companyDecisionsEl = document.querySelector("#company-decisions");
const graphEl = document.querySelector("#graph");
const graphLegendEl = document.querySelector("#graph-legend");
const rolesEl = document.querySelector("#roles");
const sourcesEl = document.querySelector("#sources");
const notesEl = document.querySelector("#notes");
const roleCountEl = document.querySelector("#role-count");

demoPasswordInput.value = window.localStorage.getItem("skills-bot-demo-password") || "";

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const company = input.value.trim();
  const demoPassword = demoPasswordInput.value.trim();

  if (!company) {
    return;
  }

  if (demoPassword) {
    window.localStorage.setItem("skills-bot-demo-password", demoPassword);
  } else {
    window.localStorage.removeItem("skills-bot-demo-password");
  }

  setStatus(`Analyzing ${company}...`, false);
  resultsEl.classList.add("hidden");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-password": demoPassword
      },
      body: JSON.stringify({ company })
    });

    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.error || "The lookup failed.");
    }

    renderResults(payload);
    setStatus(`Found ${payload.jobs.length} roles for ${payload.company}.`, false);
  } catch (error) {
    companySkillsEl.innerHTML = "";
    companyTasksEl.innerHTML = "";
    companyDecisionsEl.innerHTML = "";
    graphEl.innerHTML = "";
    graphLegendEl.innerHTML = "";
    rolesEl.innerHTML = "";
    sourcesEl.innerHTML = "";
    notesEl.innerHTML = "";
    roleCountEl.textContent = "";
    resultsEl.classList.add("hidden");
    setStatus(error.message, true);
  }
});

async function readJsonResponse(response) {
  const raw = await response.text();

  try {
    return JSON.parse(raw);
  } catch {
    if (raw.trim().startsWith("<")) {
      throw new Error(
        "The server returned an HTML error page instead of app data. This usually means the service was restarting or the deployment hit a platform error. Refresh and try again in a few seconds."
      );
    }

    throw new Error("The server returned a response the app could not read.");
  }
}

function renderResults(payload) {
  renderFacetCloud(companySkillsEl, payload.companySkills || [], "skills");
  renderFacetCloud(companyTasksEl, payload.companyTasks || [], "tasks");
  renderFacetCloud(companyDecisionsEl, payload.companyDecisions || [], "decisions");
  renderGraph(payload.graph || { nodes: [], edges: [] });

  rolesEl.innerHTML = payload.jobs
    .map((job) => {
      return `
        <article class="role-card">
          <div class="role-top">
            <div>
              <h3 class="role-title">${escapeHtml(job.title)}</h3>
              <p class="role-meta">
                ${escapeHtml(job.location || "Unknown")}
                ${job.department ? ` • ${escapeHtml(job.department)}` : ""}
                ${job.team ? ` • ${escapeHtml(job.team)}` : ""}
                • ${escapeHtml(job.provider)}:${escapeHtml(job.sourceLabel)}
              </p>
            </div>
            ${job.url ? `<a class="role-link" href="${job.url}" target="_blank" rel="noreferrer">View job</a>` : ""}
          </div>
          ${renderRoleFacet("Skills", job.skills || [], "skills")}
          ${renderRoleFacet("Tasks", job.tasks || [], "tasks")}
          ${renderRoleFacet("Decisions", job.decisions || [], "decisions")}
        </article>
      `;
    })
    .join("");

  sourcesEl.innerHTML = payload.sources
    .map((source) => `<div>${escapeHtml(source.provider)}:${escapeHtml(source.slug)} • ${source.count} roles</div>`)
    .join("");

  const metaNotes = payload.meta
    ? [
        `Analyzed ${payload.meta.analyzedJobs} roles`,
        `Batch size ${payload.meta.claudeBatchSize}`,
        `Description depth ${payload.meta.jobDescriptionCharLimit.toLocaleString()} chars`
      ]
    : [];

  notesEl.innerHTML = [...metaNotes, ...(payload.notes || [])]
    .map((note) => `<div>${escapeHtml(note)}</div>`)
    .join("");
  roleCountEl.textContent = `${payload.jobs.length} roles`;
  resultsEl.classList.remove("hidden");
}

function renderFacetCloud(element, items, facet) {
  element.innerHTML = items
    .map(
      (item) =>
        `<span class="skill-pill facet-${facet}">${escapeHtml(item.label)} <strong>${item.count}</strong></span>`
    )
    .join("");
}

function renderRoleFacet(label, items, facet) {
  const body = items.length
    ? items.map((item) => `<span class="skill-pill facet-${facet}">${escapeHtml(item)}</span>`).join("")
    : '<span class="muted">None extracted.</span>';

  return `
    <section class="role-facet">
      <p class="facet-label">${escapeHtml(label)}</p>
      <div class="skills-cloud compact-cloud">${body}</div>
    </section>
  `;
}

function renderGraph(graph) {
  const width = 960;
  const roleNodes = (graph.nodes || []).filter((node) => node.group === "role");
  const skillNodes = (graph.nodes || []).filter((node) => node.group === "skills");
  const taskNodes = (graph.nodes || []).filter((node) => node.group === "tasks");
  const decisionNodes = (graph.nodes || []).filter((node) => node.group === "decisions");
  const rows = Math.max(roleNodes.length, skillNodes.length, taskNodes.length, decisionNodes.length, 1);
  const height = 120 + rows * 46;
  const positions = new Map();

  layoutColumn(roleNodes, 120, height, positions);
  layoutColumn(skillNodes, 370, height, positions);
  layoutColumn(taskNodes, 610, height, positions);
  layoutColumn(decisionNodes, 840, height, positions);

  const edges = (graph.edges || [])
    .map((edge) => {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      if (!from || !to) {
        return "";
      }

      return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="graph-edge edge-${edge.group}" />`;
    })
    .join("");

  const nodes = (graph.nodes || [])
    .map((node) => {
      const point = positions.get(node.id);
      if (!point) {
        return "";
      }

      const radius = node.group === "role" ? 8 : 6;
      return `
        <g>
          <circle cx="${point.x}" cy="${point.y}" r="${radius}" class="graph-node node-${node.group}" />
          <text x="${point.x + 14}" y="${point.y + 4}" class="graph-label">${escapeHtml(node.label)}</text>
        </g>
      `;
    })
    .join("");

  graphLegendEl.innerHTML = [
    ["role", "Roles"],
    ["skills", "Skills"],
    ["tasks", "Tasks"],
    ["decisions", "Decisions"]
  ]
    .map(
      ([facet, label]) =>
        `<span class="legend-item"><span class="legend-dot dot-${facet}"></span>${escapeHtml(label)}</span>`
    )
    .join("");

  graphEl.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Capability graph">
      <text x="88" y="34" class="graph-heading">Roles</text>
      <text x="338" y="34" class="graph-heading">Skills</text>
      <text x="585" y="34" class="graph-heading">Tasks</text>
      <text x="800" y="34" class="graph-heading">Decisions</text>
      ${edges}
      ${nodes}
    </svg>
  `;
}

function layoutColumn(nodes, x, height, positions) {
  const gap = height / (nodes.length + 1);
  nodes.forEach((node, index) => {
    positions.set(node.id, {
      x,
      y: 48 + gap * (index + 1)
    });
  });
}

function setStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden");
  statusEl.style.borderColor = isError ? "rgba(140, 38, 20, 0.25)" : "";
  statusEl.style.color = isError ? "#7d2c18" : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
