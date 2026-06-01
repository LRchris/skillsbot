import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

await loadEnvFile();

const port = Number(process.env.PORT || 3000);
const anthropicKey = process.env.ANTHROPIC_API_KEY || "";
const anthropicModelOverride = process.env.ANTHROPIC_MODEL || "";
const demoPassword = process.env.DEMO_PASSWORD || "";

const knownCompanies = {
  anthropic: [{ provider: "greenhouse", slug: "anthropic" }],
  ashby: [{ provider: "ashby", slug: "Ashby" }],
  cursor: [{ provider: "ashby", slug: "Cursor" }],
  figma: [{ provider: "greenhouse", slug: "figma" }],
  linear: [{ provider: "ashby", slug: "Linear" }],
  notion: [{ provider: "greenhouse", slug: "notion" }],
  openai: [{ provider: "ashby", slug: "OpenAI" }],
  ramp: [{ provider: "ashby", slug: "Ramp" }],
  stripe: [{ provider: "greenhouse", slug: "stripe" }],
  vercel: [{ provider: "lever", slug: "vercel" }]
};

const skillDictionary = [
  "AWS",
  "Azure",
  "BigQuery",
  "C",
  "C#",
  "C++",
  "CI/CD",
  "CSS",
  "Datadog",
  "Docker",
  "Elasticsearch",
  "Figma",
  "Firebase",
  "GCP",
  "Git",
  "Go",
  "GraphQL",
  "Heroku",
  "HTML",
  "Java",
  "JavaScript",
  "Jenkins",
  "Kafka",
  "Kotlin",
  "Kubernetes",
  "LangChain",
  "LLM",
  "Machine Learning",
  "MongoDB",
  "MySQL",
  "Next.js",
  "Node.js",
  "OpenAI",
  "Postgres",
  "Prompt Engineering",
  "Python",
  "PyTorch",
  "React",
  "Redis",
  "REST APIs",
  "Ruby",
  "Rust",
  "Scala",
  "Snowflake",
  "SQL",
  "Swift",
  "Tailwind",
  "TensorFlow",
  "Terraform",
  "TypeScript",
  "Vue",
  "Workday"
];

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      return handleAnalyze(req, res);
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Unexpected server error." });
  }
});

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  server.listen(port, () => {
    console.log(`Skills Bot POC running at http://localhost:${port}`);
  });
}

async function handleAnalyze(req, res) {
  if (demoPassword) {
    const providedPassword = req.headers["x-demo-password"];
    if (providedPassword !== demoPassword) {
      return sendJson(res, 401, {
        error: "This demo is password protected. Enter the demo password and try again."
      });
    }
  }

  const body = await readJsonBody(req);
  const companyInput = typeof body?.company === "string" ? body.company.trim() : "";

  if (!companyInput) {
    return sendJson(res, 400, { error: "Enter a company name first." });
  }

  const targets = buildTargets(companyInput);
  const fetchResults = await Promise.allSettled(
    targets.map((target) => fetchJobsForTarget(target))
  );

  const successful = fetchResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((result) => result.jobs.length > 0);

  const jobs = dedupeJobs(successful.flatMap((result) => result.jobs)).slice(0, 15);

  if (jobs.length === 0) {
    return sendJson(res, 404, {
      error:
        "No public jobs found from the built-in sources. Try a company on Greenhouse, Lever, or Ashby, or use provider syntax like greenhouse:notion.",
      debug: targets
    });
  }

  const enrichment = await extractSkills(companyInput, jobs);

  sendJson(res, 200, {
    company: companyInput,
    generatedAt: new Date().toISOString(),
    jobs: jobs.map((job) => ({
      id: job.id,
      title: job.title,
      location: job.location,
      department: job.department,
      team: job.team,
      skills: enrichment.roles[job.id] || [],
      provider: job.provider,
      sourceLabel: job.sourceLabel,
      url: job.url
    })),
    companySkills: enrichment.companySkills,
    sources: successful.map((result) => ({
      provider: result.provider,
      slug: result.slug,
      count: result.jobs.length
    })),
    notes: enrichment.notes
  });
}

async function serveStatic(requestPath, res) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.resolve(publicDir, `.${safePath}`);

  if (!filePath.startsWith(publicDir)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": mimeTypes[ext] || "text/plain; charset=utf-8" });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function buildTargets(companyInput) {
  const explicit = parseExplicitProvider(companyInput);
  if (explicit) {
    return [explicit];
  }

  const normalized = normalizeCompany(companyInput);
  const known = knownCompanies[normalized] || [];
  const variants = slugVariants(companyInput);
  const guessed = variants.flatMap((slug) => [
    { provider: "greenhouse", slug },
    { provider: "lever", slug },
    { provider: "ashby", slug },
    { provider: "ashby", slug: toPascalCase(slug) }
  ]);

  return dedupeTargets([...known, ...guessed]).slice(0, 12);
}

function parseExplicitProvider(input) {
  const match = input.match(/^(greenhouse|lever|ashby)\s*:\s*(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    provider: match[1].toLowerCase(),
    slug: match[2].trim()
  };
}

function slugVariants(companyInput) {
  const normalized = normalizeCompany(companyInput);
  const withoutSuffix = normalized.replace(
    /\b(inc|corp|corporation|company|co|labs|ai|technologies|technology|systems|group)\b/g,
    ""
  ).trim();
  const compact = withoutSuffix.replace(/-/g, "");
  const parts = withoutSuffix.split("-").filter(Boolean);
  const firstTwo = parts.slice(0, 2).join("-");

  return [...new Set([normalized, compact, firstTwo].filter(Boolean))];
}

function normalizeCompany(value) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toPascalCase(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function dedupeTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    const key = `${target.provider}:${target.slug}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function fetchJobsForTarget(target) {
  if (target.provider === "greenhouse") {
    return fetchGreenhouseJobs(target.slug);
  }

  if (target.provider === "lever") {
    return fetchLeverJobs(target.slug);
  }

  if (target.provider === "ashby") {
    return fetchAshbyJobs(target.slug);
  }

  return { provider: target.provider, slug: target.slug, jobs: [] };
}

async function fetchGreenhouseJobs(slug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
  const response = await safeFetchJson(url);
  const jobs = Array.isArray(response?.jobs)
    ? response.jobs.map((job) => ({
        id: `greenhouse:${slug}:${job.id}`,
        title: job.title,
        location: job.location?.name || "Unknown",
        department: job.departments?.map((item) => item.name).join(", ") || "",
        team: "",
        description: htmlToText(job.content || ""),
        provider: "greenhouse",
        sourceLabel: slug,
        url: job.absolute_url
      }))
    : [];

  return { provider: "greenhouse", slug, jobs };
}

async function fetchLeverJobs(slug) {
  const base = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  const list = await safeFetchJson(base);
  const jobs = Array.isArray(list)
    ? list.map((job) => ({
        id: `lever:${slug}:${job.id}`,
        title: job.text,
        location: job.categories?.location || "Unknown",
        department: job.categories?.department || "",
        team: job.categories?.team || "",
        description: extractLeverDescription(job),
        provider: "lever",
        sourceLabel: slug,
        url: job.hostedUrl || `https://jobs.lever.co/${slug}/${job.id}`
      }))
    : [];

  return { provider: "lever", slug, jobs };
}

async function fetchAshbyJobs(slug) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
  const response = await safeFetchJson(url);
  const jobs = Array.isArray(response?.jobs)
    ? response.jobs
        .filter((job) => job.isListed !== false)
        .map((job, index) => ({
          id: `ashby:${slug}:${index}:${job.jobUrl || job.applyUrl || job.title}`,
          title: job.title,
          location: job.location || (job.isRemote ? "Remote" : "Unknown"),
          department: job.department || "",
          team: job.team || "",
          description: job.descriptionPlain || htmlToText(job.descriptionHtml || ""),
          provider: "ashby",
          sourceLabel: slug,
          url: job.jobUrl || job.applyUrl
        }))
    : [];

  return { provider: "ashby", slug, jobs };
}

function extractLeverDescription(job) {
  const parts = [];

  if (job.descriptionPlain) {
    parts.push(job.descriptionPlain);
  }
  if (job.openingPlain) {
    parts.push(job.openingPlain);
  }
  if (Array.isArray(job.lists)) {
    for (const list of job.lists) {
      if (list?.text) {
        parts.push(list.text);
      }
      if (Array.isArray(list?.content)) {
        parts.push(list.content.join("\n"));
      }
    }
  }

  return parts.filter(Boolean).join("\n\n");
}

function dedupeJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = `${job.provider}:${job.url || job.title}:${job.location}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function extractSkills(company, jobs) {
  if (anthropicKey) {
    try {
      return await extractSkillsWithClaude(company, jobs);
    } catch (error) {
      console.error("Claude extraction failed, using fallback:", error.message);
    }
  }

  return extractSkillsWithHeuristics(jobs, anthropicKey ? "Claude failed; heuristic fallback used." : "No Anthropic key found; heuristic fallback used.");
}

async function extractSkillsWithClaude(company, jobs) {
  const candidateModels = await buildAnthropicModelCandidates();
  const errors = [];

  for (const model of candidateModels) {
    try {
      return await requestClaudeSkills(company, jobs, model);
    } catch (error) {
      errors.push(`${model}: ${error.message}`);
    }
  }

  throw new Error(errors.join(" | "));
}

async function requestClaudeSkills(company, jobs, model) {
  const payload = {
    model,
    max_tokens: 1800,
    temperature: 0.2,
    system:
      "You analyze job descriptions and return JSON only. Extract concise professional skills, tools, and technologies. No commentary outside JSON.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          task: "For each role, extract 5 to 10 skills from the description, then produce a company-wide top skills list with counts.",
          company,
          jobs: jobs.slice(0, 12).map((job) => ({
            id: job.id,
            title: job.title,
            location: job.location,
            description: job.description.slice(0, 5000)
          })),
          outputShape: {
            roles: [{ id: "job-id", skills: ["TypeScript", "React"] }],
            companySkills: [{ skill: "TypeScript", count: 4 }]
          }
        })
      }
    ]
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const details = await safeReadErrorDetails(response);
    throw new Error(`Anthropic request failed with ${response.status}${details ? ` (${details})` : ""}`);
  }

  const data = await response.json();
  const text = data?.content?.map((item) => item.text || "").join("\n") || "";
  const parsed = parseJsonFromText(text);

  if (!parsed?.roles || !parsed?.companySkills) {
    throw new Error("Anthropic response did not include expected JSON.");
  }

  const roleMap = Object.fromEntries(
    parsed.roles
      .filter((role) => role?.id && Array.isArray(role.skills))
      .map((role) => [role.id, uniqueSkills(role.skills)])
  );

  return {
    roles: roleMap,
    companySkills: parsed.companySkills
      .filter((item) => item?.skill)
      .map((item) => ({
        skill: item.skill,
        count: Number(item.count) || 1
      }))
      .slice(0, 20),
    notes: [`Claude extraction enabled with ${model}.`]
  };
}

async function buildAnthropicModelCandidates() {
  if (anthropicModelOverride) {
    return [anthropicModelOverride];
  }

  const discoveredModels = await fetchAnthropicModelIds();
  const preferredDiscovered = rankAnthropicModels(discoveredModels);

  if (preferredDiscovered.length > 0) {
    return preferredDiscovered;
  }

  return [
    "claude-sonnet-4-6",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-6",
    "claude-opus-4-5-20251101"
  ];
}

function extractSkillsWithHeuristics(jobs, note) {
  const roles = {};
  const companyCount = new Map();

  for (const job of jobs) {
    const matches = findSkills(job.description);
    roles[job.id] = matches;
    for (const skill of matches) {
      companyCount.set(skill, (companyCount.get(skill) || 0) + 1);
    }
  }

  const companySkills = [...companyCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([skill, count]) => ({ skill, count }))
    .slice(0, 20);

  return {
    roles,
    companySkills,
    notes: [note]
  };
}

function findSkills(text) {
  const haystack = ` ${text.toLowerCase()} `;
  const matches = [];

  for (const skill of skillDictionary) {
    const token = skill.toLowerCase();
    const escaped = escapeRegex(token).replace(/\\\+/g, "\\+").replace(/\./g, "\\.");
    const pattern =
      token.length <= 2
        ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i")
        : new RegExp(`\\b${escaped}\\b`, "i");

    if (pattern.test(haystack)) {
      matches.push(skill);
    }
  }

  return matches.slice(0, 10);
}

function uniqueSkills(skills) {
  return [...new Set(skills.map((skill) => String(skill).trim()).filter(Boolean))].slice(0, 10);
}

function htmlToText(html) {
  return decodeHtml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseJsonFromText(text) {
  const candidates = [];
  const fencedMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];

  for (const match of fencedMatches) {
    if (match[1]) {
      candidates.push(match[1].trim());
    }
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(cleanJsonCandidate(candidate));
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function cleanJsonCandidate(value) {
  return value
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/,\s*([}\]])/g, "$1");
}

async function safeFetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "skills-bot-poc/0.1"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function safeReadErrorDetails(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.error?.type || "";
  } catch {
    return "";
  }
}

async function fetchAnthropicModelIds() {
  try {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      }
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data?.data)) {
      return [];
    }

    return data.data
      .map((model) => model?.id)
      .filter((id) => typeof id === "string");
  } catch {
    return [];
  }
}

function rankAnthropicModels(modelIds) {
  const ranked = [...new Set(modelIds)].sort((left, right) => {
    const scoreDiff = getAnthropicModelScore(right) - getAnthropicModelScore(left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return right.localeCompare(left, undefined, { numeric: true });
  });

  return ranked.slice(0, 5);
}

function getAnthropicModelScore(modelId) {
  if (modelId.startsWith("claude-sonnet")) {
    return 300;
  }
  if (modelId.startsWith("claude-haiku")) {
    return 200;
  }
  if (modelId.startsWith("claude-opus")) {
    return 100;
  }
  return 0;
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

async function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, ".env");
    const raw = await fs.readFile(envPath, "utf8");

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separator = trimmed.indexOf("=");
      if (separator === -1) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore missing .env files for this dependency-free POC.
  }
}

export {
  buildTargets,
  extractSkillsWithHeuristics,
  fetchAshbyJobs,
  fetchGreenhouseJobs,
  fetchLeverJobs,
  findSkills,
  normalizeCompany,
  server,
  slugVariants
};
