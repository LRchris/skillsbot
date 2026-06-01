# Skills Bot POC

Ultra-light proof of concept for:

- entering a company name
- pulling public job listings from Greenhouse, Lever, and Ashby when possible
- extracting role-level and company-level skills
- optionally using Claude through the Anthropic Messages API

## Why this version

This is optimized for "working before end of day," not for broad scraping coverage.

- No framework
- No database
- No build step
- No npm dependencies

## Run it

1. Copy `.env.example` to `.env` if you want Claude-enabled extraction.
2. Export your key:

```bash
export ANTHROPIC_API_KEY=your_key_here
```

3. Start the app:

```bash
npm start
```

4. Open `http://localhost:3000`

## Input tips

Try company names with public job boards first:

- `Notion`
- `Figma`
- `Stripe`
- `OpenAI`
- `Ramp`
- `Vercel`

You can also force a provider lookup:

- `greenhouse:notion`
- `lever:vercel`
- `ashby:OpenAI`

## Caveat

This proof of concept intentionally targets public ATS job feeds rather than scraping LinkedIn or Indeed directly.

## GitHub + Render demo deploy

This repo includes:

- `.gitignore` so your local `.env` will not be committed
- `.node-version` and `package.json` Node engine settings
- `render.yaml` for quick Render setup

Recommended demo environment variables on Render:

```bash
ANTHROPIC_API_KEY=your_real_key
ANTHROPIC_MODEL=claude-sonnet-4-6
DEMO_PASSWORD=pick_a_simple_password
```

If `DEMO_PASSWORD` is set, the deployed app requires that password for analysis requests.

Render quick setup:

1. Push this project to GitHub.
2. In Render, create a new Blueprint or Web Service from the repo.
3. Set the missing secret env vars in the Render dashboard.
4. Deploy and share the Render URL.
