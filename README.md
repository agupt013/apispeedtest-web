Test

# apispeedtest-web

A static website and scheduled runner that publishes hourly API latency benchmarks for all supported models in `APISpeedTest`, and displays them with a configurable time display.

## What this repo contains
- docs/: Static site (served by GitHub Pages) that fetches JSON results from docs/data/ and renders a table.
- runner/run_benchmark.py: Python script that executes the benchmark via the apispeedtest library and writes docs/data/results.json and docs/data/meta.json.
- .github/workflows/benchmark-and-publish.yml: Hourly workflow to run the benchmark and commit updated JSON for Pages.

## Prerequisites
- A GitHub repository for this folder, with GitHub Pages enabled (build from main branch, /docs folder), or using the provided Pages deploy workflow.
- A GitHub repository for the source benchmark code APISpeedTest (this repo checks it out and installs it).
- API keys stored as GitHub Actions secrets in this repo:
  - OPENAI_API_KEY
  - AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT (if using Azure OpenAI)
  - ANTHROPIC_API_KEY
  - GOOGLE_API_KEY (Gemini)
  - GROQ_API_KEY (Groq/Llama)

## Setup
1. Create a new GitHub repo (e.g., apispeedtest-web) and push this folder to it.
2. In repository Settings → Pages:
   - Source: Deploy from a branch
   - Branch: main → /docs
3. In repository Settings → Secrets and variables → Actions → New repository secret, add any provider API keys you plan to benchmark.
4. Edit .github/workflows/benchmark-and-publish.yml:
   - Set env.APISPEEDTEST_REPO to point to your APISpeedTest repository (e.g., your-org/APISpeedTest).

The workflow runs hourly and on manual trigger. It writes updated JSON files to docs/data/ and commits them to main, automatically updating the site.

## Local run
```bash
# Create and activate a venv (recommended)
python -m venv .venv && source .venv/bin/activate

# Clone and install APISpeedTest next to this repo (or pip install from GitHub)
# Example using sibling folder:
#   ../APISpeedTest (this repo)
#   ./apispeedtest-web (current repo)

pip install -e ../APISpeedTest

# Set API keys in your environment
export OPENAI_API_KEY=...  # etc.

# Optional overrides
export MODELS=all           # or "openai:gpt-4o-mini,anthropic:claude-3-5-sonnet-latest"
export RUNS=3
export MODE=both            # both | nonstream | stream
export REQUEST_TIMEOUT=60

python runner/run_benchmark.py
# Outputs docs/data/results.json and docs/data/meta.json
```

Open docs/index.html in a browser (or serve docs/ with any static server) to view the dashboard.

## Time display configuration
Modify docs/config.js:
- TIME_DISPLAY_MODE: "relative" or "absolute"
- DISPLAY_TIMEZONE: "local" or "UTC"
- ABSOLUTE_FORMAT: e.g., "yyyy-MM-dd HH:mm:ss" (best effort)
- NUMBER_PRECISION: decimals for numeric metrics

You can also override via URL query params:
- ?time=relative|absolute
- &tz=local|UTC
- &precision=3

## Notes
- Results schema matches apispeedtest.write_json output augmented with meta.json containing generated_at in ISO-8601 (UTC) and selected models/config used.
- If a model fails during a run, it is skipped and the failure is logged in the Actions logs.
