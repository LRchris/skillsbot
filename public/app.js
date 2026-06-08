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
const rolePickerEl = document.querySelector("#role-picker");
const sourcesEl = document.querySelector("#sources");
const notesEl = document.querySelector("#notes");
const roleCountEl = document.querySelector("#role-count");
const selectionCountEl = document.querySelector("#selection-count");
const selectAllButton = document.querySelector("#select-all");
const clearSelectionButton = document.querySelector("#clear-selection");
const analyzeSkillsButton = document.querySelector("#analyze-skills");
const analyzeTasksButton = document.querySelector("#analyze-tasks");
const analyzeDecisionsButton = document.querySelector("#analyze-decisions");

const facetElements = {
  skills: companySkillsEl,
  tasks: companyTasksEl,
  decisions: companyDecisionsEl
};

const state = {
  company: "",
  jobs: [],
  selectedIds: new Set(),
  facetData: {
    skills: null,
    tasks: null,
    decisions: null
  },
  sources: [],
  notes: [],
  meta: null
};

demoPasswordInput.value = window.localStorage.getItem("skills-bot-demo-password") || "";

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const company = input.value.trim();
  const demoPassword = demoPasswordInput.value.trim();

  if (!company) {
    return;
  }

  persistDemoPassword(demoPassword);
  setStatus(`Looking up roles for ${company}...`, false);
  resultsEl.classList.add("hidden");

  try {
    const response = await fetch("/api/lookup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-password": demoPassword
      },
      body: JSON.stringify({ company })
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.error || "The role lookup failed.");
    }

    state.company = payload.company;
    state.jobs = payload.jobs.map((job) => ({
      ...job,
      analyses: {
        skills: [],
        tasks: [],
        decisions: []
      }
    }));
    state.selectedIds = new Set(state.jobs.map((job) => job.id));
    state.facetData = { skills: null, tasks: null, decisions: null };
    state.sources = payload.sources || [];
    state.notes = [];
    state.meta = payload.meta || null;

    render();
    setStatus(`Found ${state.jobs.length} roles. Select the ones you want to analyze.`, false);
  } catch (error) {
    resetResults();
    setStatus(error.message, true);
  }
});

selectAllButton.addEventListener("click", () => {
  state.selectedIds = new Set(state.jobs.map((job) => job.id));
  renderSelection();
  renderGraph();
});

clearSelectionButton.addEventListener("click", () => {
  state.selectedIds = new Set();
  renderSelection();
  renderGraph();
});

analyzeSkillsButton.addEventListener("click", () => runFacetAnalysis("skills"));
analyzeTasksButton.addEventListener("click", () => runFacetAnalysis("tasks"));
analyzeDecisionsButton.addEventListener("click", () => runFacetAnalysis("decisions"));

rolePickerEl.addEventListener("change", (event) => {
  const checkbox = event.target.closest("input[data-role-id]");
  if (!checkbox) {
    return;
  }

  const roleId = checkbox.dataset.roleId;
  if (checkbox.checked) {
    state.selectedIds.add(roleId);
  } else {
    state.selectedIds.delete(roleId);
  }

  renderSelection();
  renderGraph();
});

async function runFacetAnalysis(facet) {
  const selectedJobs = state.jobs.filter((job) => state.selectedIds.has(job.id));
  if (selectedJobs.length === 0) {
    setStatus("Select at least one role before starting an analysis.", true);
    return;
  }

  const demoPassword = demoPasswordInput.value.trim();
  persistDemoPassword(demoPassword);
  setStatus(`Running ${facet} analysis for ${selectedJobs.length} selected roles...`, false);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-password": demoPassword
      },
      body: JSON.stringify({
        company: state.company,
        facet,
        jobs: selectedJobs
      })
    });
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.error || `The ${facet} analysis failed.`);
    }

    state.facetData[facet] = {
      companyItems: payload.companyItems || [],
      notes: payload.notes || [],
      meta: payload.meta || null
    };

    for (const job of state.jobs) {
      if (payload.roles && payload.roles[job.id]) {
        job.analyses[facet] = payload.roles[job.id];
      }
    }

    render();
    setStatus(`${capitalize(facet)} analysis complete for ${selectedJobs.length} roles.`, false);
  } catch (error) {
    setStatus(error.message, true);
  }
}

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

function render() {
  renderSelection();
  renderSummaries();
  renderRoles();
  renderSourcesAndNotes();
  renderGraph();
  roleCountEl.textContent = `${state.jobs.length} roles`;
  resultsEl.classList.remove("hidden");
}

function renderSelection() {
  selectionCountEl.textContent = `${state.selectedIds.size} selected`;

  rolePickerEl.innerHTML = state.jobs
    .map(
      (job) => `
        <label class="picker-card">
          <input type="checkbox" data-role-id="${escapeHtml(job.id)}" ${state.selectedIds.has(job.id) ? "checked" : ""} />
          <div>
            <p class="picker-title">${escapeHtml(job.title)}</p>
            <p class="picker-meta">
              ${escapeHtml(job.location || "Unknown")}
              ${job.department ? ` • ${escapeHtml(job.department)}` : ""}
              ${job.team ? ` • ${escapeHtml(job.team)}` : ""}
            </p>
          </div>
        </label>
      `
    )
    .join("");

  const disabled = state.selectedIds.size === 0;
  analyzeSkillsButton.disabled = disabled;
  analyzeTasksButton.disabled = disabled;
  analyzeDecisionsButton.disabled = disabled;
}

function renderSummaries() {
  renderFacetCloud(companySkillsEl, state.facetData.skills?.companyItems || [], "skills");
  renderFacetCloud(companyTasksEl, state.facetData.tasks?.companyItems || [], "tasks");
  renderFacetCloud(companyDecisionsEl, state.facetData.decisions?.companyItems || [], "decisions");
}

function renderRoles() {
  rolesEl.innerHTML = state.jobs
    .filter((job) => state.selectedIds.has(job.id) || hasAnalysis(job))
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
          ${renderRoleFacet("Skills", job.analyses.skills || [], "skills")}
          ${renderRoleFacet("Tasks", job.analyses.tasks || [], "tasks")}
          ${renderRoleFacet("Decisions", job.analyses.decisions || [], "decisions")}
        </article>
      `;
    })
    .join("");
}

function renderSourcesAndNotes() {
  sourcesEl.innerHTML = state.sources
    .map((source) => `<div>${escapeHtml(source.provider)}:${escapeHtml(source.slug)} • ${source.count} roles</div>`)
    .join("");

  const metaNotes = state.meta
    ? [
        `Found ${state.meta.foundJobs || state.jobs.length} roles`,
        `Lookup cap ${state.meta.maxJobsToAnalyze}`,
        `Claude batch size ${state.meta.claudeBatchSize}`
      ]
    : [];

  const facetNotes = ["skills", "tasks", "decisions"]
    .flatMap((facet) => state.facetData[facet]?.notes || []);

  notesEl.innerHTML = [...metaNotes, ...facetNotes].map((note) => `<div>${escapeHtml(note)}</div>`).join("");
}

function renderFacetCloud(element, items, facet) {
  element.innerHTML = items.length
    ? items
        .map(
          (item) =>
            `<span class="skill-pill facet-${facet}">${escapeHtml(item.label)} <strong>${item.count}</strong></span>`
        )
        .join("")
    : '<span class="muted">Run analysis to populate this map.</span>';
}

function renderRoleFacet(label, items, facet) {
  const body = items.length
    ? items.map((item) => `<span class="skill-pill facet-${facet}">${escapeHtml(item)}</span>`).join("")
    : '<span class="muted">Not analyzed yet.</span>';

  return `
    <section class="role-facet">
      <p class="facet-label">${escapeHtml(label)}</p>
      <div class="skills-cloud compact-cloud">${body}</div>
    </section>
  `;
}

function renderGraph() {
  const graph = buildJobNetwork();
  const width = 960;
  const nodes = graph.nodes;
  const edges = graph.edges;

  if (nodes.length === 0) {
    graphLegendEl.innerHTML = "";
    graphEl.innerHTML = '<div class="muted">Look up roles and run at least one analysis to see the graph.</div>';
    return;
  }

  const height = 760;
  const positions = new Map();
  layoutRoleNetwork(nodes, width, height, positions);

  const edgeMarkup = edges
    .map((edge) => {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      if (!from || !to) {
        return "";
      }

      return `
        <g>
          <title>${escapeHtml(`${edge.group}: ${edge.shared.join(", ")}`)}</title>
          <line
            x1="${from.x}"
            y1="${from.y}"
            x2="${to.x}"
            y2="${to.y}"
            class="graph-edge edge-${edge.group}"
            style="stroke-width:${1 + Math.min(edge.weight, 4) * 0.7}"
          />
        </g>
      `;
    })
    .join("");

  const nodeMarkup = nodes
    .map((node) => {
      const point = positions.get(node.id);
      if (!point) {
        return "";
      }

      return `
        <g>
          <title>${escapeHtml([node.label, node.department, node.location].filter(Boolean).join(" • "))}</title>
          <circle cx="${point.x}" cy="${point.y}" r="9" class="graph-node node-role" />
          <text x="${point.x + 14}" y="${point.y + 4}" class="graph-label">${escapeHtml(shortenLabel(node.label, 28))}</text>
        </g>
      `;
    })
    .join("");

  graphLegendEl.innerHTML = [
    ["skills", "Shared skills"],
    ["tasks", "Shared tasks"],
    ["decisions", "Shared decisions"]
  ]
    .map(([facet, label]) => `<span class="legend-item"><span class="legend-dot dot-${facet}"></span>${escapeHtml(label)}</span>`)
    .join("");

  graphEl.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Capability graph">
      <text x="38" y="40" class="graph-heading">Jobs network</text>
      <text x="38" y="62" class="graph-subheading">Roles connect after separate skills, tasks, or decisions analyses.</text>
      ${edgeMarkup}
      ${nodeMarkup}
    </svg>
  `;
}

function buildJobNetwork() {
  const nodes = state.jobs.filter((job) => hasAnalysis(job)).map((job) => ({
    id: job.id,
    label: job.title,
    location: job.location,
    department: job.department
  }));
  const edges = [];

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const leftJob = state.jobs.find((job) => job.id === nodes[leftIndex].id);
      const rightJob = state.jobs.find((job) => job.id === nodes[rightIndex].id);

      for (const facet of ["skills", "tasks", "decisions"]) {
        const shared = intersectLabels(leftJob.analyses[facet], rightJob.analyses[facet]);
        if (shared.length === 0) {
          continue;
        }

        edges.push({
          source: leftJob.id,
          target: rightJob.id,
          group: facet,
          weight: shared.length,
          shared
        });
      }
    }
  }

  return { nodes, edges };
}

function layoutRoleNetwork(nodes, width, height, positions) {
  const centerX = width / 2;
  const centerY = height / 2 + 24;
  const radius = Math.max(180, Math.min(300, 120 + nodes.length * 8));

  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2;
    positions.set(node.id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    });
  });
}

function hasAnalysis(job) {
  return ["skills", "tasks", "decisions"].some((facet) => (job.analyses[facet] || []).length > 0);
}

function intersectLabels(left = [], right = []) {
  const rightSet = new Set(right);
  return [...new Set(left.filter((item) => rightSet.has(item)))];
}

function shortenLabel(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function setStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.classList.remove("hidden");
  statusEl.style.borderColor = isError ? "rgba(140, 38, 20, 0.25)" : "";
  statusEl.style.color = isError ? "#7d2c18" : "";
}

function resetResults() {
  state.company = "";
  state.jobs = [];
  state.selectedIds = new Set();
  state.facetData = { skills: null, tasks: null, decisions: null };
  state.sources = [];
  state.notes = [];
  state.meta = null;
  companySkillsEl.innerHTML = "";
  companyTasksEl.innerHTML = "";
  companyDecisionsEl.innerHTML = "";
  graphEl.innerHTML = "";
  graphLegendEl.innerHTML = "";
  rolesEl.innerHTML = "";
  rolePickerEl.innerHTML = "";
  sourcesEl.innerHTML = "";
  notesEl.innerHTML = "";
  roleCountEl.textContent = "";
  selectionCountEl.textContent = "";
  resultsEl.classList.add("hidden");
}

function persistDemoPassword(demoPassword) {
  if (demoPassword) {
    window.localStorage.setItem("skills-bot-demo-password", demoPassword);
  } else {
    window.localStorage.removeItem("skills-bot-demo-password");
  }
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
