const form = document.querySelector("#search-form");
const input = document.querySelector("#company");
const demoPasswordInput = document.querySelector("#demo-password");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const companySkillsEl = document.querySelector("#company-skills");
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

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "The lookup failed.");
    }

    renderResults(payload);
    setStatus(`Found ${payload.jobs.length} roles for ${payload.company}.`, false);
  } catch (error) {
    companySkillsEl.innerHTML = "";
    rolesEl.innerHTML = "";
    sourcesEl.innerHTML = "";
    notesEl.innerHTML = "";
    roleCountEl.textContent = "";
    resultsEl.classList.add("hidden");
    setStatus(error.message, true);
  }
});

function renderResults(payload) {
  companySkillsEl.innerHTML = payload.companySkills
    .map(
      (item) =>
        `<span class="skill-pill">${escapeHtml(item.skill)} <strong>${item.count}</strong></span>`
    )
    .join("");

  rolesEl.innerHTML = payload.jobs
    .map((job) => {
      const skills = (job.skills || [])
        .map((skill) => `<span class="skill-pill">${escapeHtml(skill)}</span>`)
        .join("");

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
          <div class="skills-cloud">${skills || '<span class="muted">No skills extracted.</span>'}</div>
        </article>
      `;
    })
    .join("");

  sourcesEl.innerHTML = payload.sources
    .map((source) => `<div>${escapeHtml(source.provider)}:${escapeHtml(source.slug)} • ${source.count} roles</div>`)
    .join("");

  notesEl.innerHTML = (payload.notes || []).map((note) => `<div>${escapeHtml(note)}</div>`).join("");
  roleCountEl.textContent = `${payload.jobs.length} roles`;
  resultsEl.classList.remove("hidden");
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
