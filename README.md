# CI/CD Failure Doctor

Automatically receives failed build logs from GitHub Actions or Jenkins, diagnoses the root cause using an LLM, and shows a plain-English explanation and suggested fix on a dashboard.

## Features

- Webhook ingestion from GitHub Actions / Jenkins
- LLM-powered diagnosis with category + confidence level
- React dashboard with live polling
- Simulate mode (6 bundled failure scenarios) — demo without a real CI connection
- Stretch: Slack/email notifications, helpfulness feedback

## Stack

- **Backend**: Node.js/Express, SQLite, TypeScript
- **Frontend**: React + Vite
- **LLM**: Any OpenAI-compatible API (OpenAI, Groq, etc.)

---

## Setup

**Prerequisites**: Node.js 20+, an LLM API key (OpenAI or an OpenAI-compatible provider like Groq)

```bash
git clone <repository-url>
cd CICD-Failure-Doctor
npm install
cd backend && npm install
cd ../frontend && npm install
```

Create `backend/.env`:

```env
# Required
WEBHOOK_SECRET=your-secret-key-here
LLM_API_KEY=your-llm-api-key-here

# Required if using a non-OpenAI provider (e.g. Groq) — omit entirely to use OpenAI's default endpoint
LLM_BASE_URL=https://api.groq.com/openai/v1

# Must match a model your provider actually serves
# OpenAI example: gpt-4o-mini
# Groq example: openai/gpt-oss-120b
LLM_MODEL=openai/gpt-oss-120b

# Optional
DATABASE_PATH=./data/cicd-doctor.db
PORT=3000
SLACK_WEBHOOK_URL=
NOTIFICATION_EMAIL=
APP_BASE_URL=http://localhost:3000
```

> **Note:** `.env` files use `#` for comments — make sure the lines you actually want active don't have a leading `#`.

Build and run:

```bash
cd backend && npm run build && npm start
cd ../frontend && npm run build && npm run preview
```

Backend: `http://localhost:3000` · Frontend: `http://localhost:4173`

### Development mode (hot reload)

```bash
cd backend && npm run dev
cd frontend && npm run dev   # http://localhost:5173
```

---

## Deployment

**Backend → Render or Railway**
- Build command: `cd backend && npm install && npm run build`
- Start command: `cd backend && npm start`
- Set env vars: `WEBHOOK_SECRET`, `LLM_API_KEY`, `LLM_BASE_URL` (if applicable), `LLM_MODEL`, `DATABASE_PATH`, `NODE_VERSION=20`

**Frontend → Vercel**
- Root directory: `frontend`
- Framework preset: Vite
- Env var: `VITE_API_URL` = your deployed backend URL

After deploying, update the backend's CORS origin (`backend/src/server.ts`) to include your Vercel URL, and update `APP_BASE_URL` to your deployed backend URL.

**Docker (backend)**
```bash
cd backend
docker build -t cicd-failure-doctor-backend .
docker run -d -p 3000:3000 \
  -e WEBHOOK_SECRET=your-secret \
  -e LLM_API_KEY=your-api-key \
  -e LLM_BASE_URL=https://api.groq.com/openai/v1 \
  -e LLM_MODEL=openai/gpt-oss-120b \
  -v $(pwd)/data:/app/data \
  cicd-failure-doctor-backend
```

---

## Connecting a real CI system

Requires the backend to be publicly reachable (deployed, or tunneled via `ngrok http 3000` for local testing).

**GitHub Actions** — add repo secrets `CICD_DOCTOR_URL` and `CICD_DOCTOR_SECRET` (matching `WEBHOOK_SECRET`), then add to a workflow:
```yaml
- name: Notify CI/CD Failure Doctor
  if: failure()
  run: |
    curl -s -X POST "${{ secrets.CICD_DOCTOR_URL }}/webhook/ingest" \
      -H "Content-Type: application/json" \
      -H "X-Webhook-Secret: ${{ secrets.CICD_DOCTOR_SECRET }}" \
      -d '{
        "log":       "'"$(cat build.log | tail -300)"'",
        "repoName":  "${{ github.repository }}",
        "jobName":   "${{ github.workflow }} / ${{ github.job }}",
        "commitSha": "${{ github.sha }}",
        "source":    "github",
        "branch":    "${{ github.ref_name }}"
      }'
```

**Jenkins** — add to a declarative `Jenkinsfile`'s `post` block (requires the HTTP Request plugin):
```groovy
post {
  failure {
    script {
      def log = currentBuild.rawBuild.getLog(300).join('\n')
      httpRequest(
        httpMode:      'POST',
        url:           "${env.CICD_DOCTOR_URL}/webhook/ingest",
        contentType:   'APPLICATION_JSON',
        customHeaders: [[name: 'X-Webhook-Secret', value: env.CICD_DOCTOR_SECRET]],
        requestBody:   groovy.json.JsonOutput.toJson([
          log: log, repoName: env.JOB_NAME, jobName: env.JOB_NAME,
          commitSha: env.GIT_COMMIT, source: 'jenkins'
        ])
      )
    }
  }
}
```

---

## API Reference (short)

| Endpoint | Purpose |
|---|---|
| `POST /webhook/ingest` | Real CI failure ingestion (needs `X-Webhook-Secret` header) |
| `POST /simulate` | Demo mode — `{ "scenario": "test-failure" \| "dependency-error" \| "docker-build-failure" \| "env-var-missing" \| "timeout" \| "lint-error" }` |
| `GET /diagnoses?page=&limit=&category=` | Paginated list |
| `GET /diagnoses/:id` | Full detail incl. raw log and suggested fix |
| `GET /health` | Health check (for uptime pings on free-tier hosts) |

---

## Testing

```bash
cd backend && npm test
cd frontend && npm test
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required environment variable` on start | Set `WEBHOOK_SECRET` and `LLM_API_KEY` in `backend/.env`, restart the server (env changes need a restart) |
| Diagnoses stuck `unavailable` / model 404 error | `LLM_MODEL` doesn't match your provider — Groq needs `LLM_BASE_URL=https://api.groq.com/openai/v1` and a Groq model name (e.g. `openai/gpt-oss-120b`), not `gpt-4o-mini` |
| `.env` values not taking effect | Check for a leading `#` (comments the line out) and confirm you restarted after editing |
| `Failed to fetch diagnoses: Too Many Requests` | Rate limiter is applied too broadly — it should only cover `/webhook/ingest` and `/simulate`, not `/diagnoses` polling |
| First request after idle takes 30+ seconds | Free-tier host cold start — ping `/health` periodically via UptimeRobot or cron-job.org |

---

## Project Structure

```
CICD-Failure-Doctor/
├── backend/
│   ├── src/
│   │   ├── auth/            # Webhook authentication
│   │   ├── db/               # Database init and records
│   │   ├── routes/           # Express route handlers
│   │   ├── services/         # Ingest, notifications
│   │   ├── jobQueue.ts       # Async job processing
│   │   ├── llmClient.ts      # LLM integration
│   │   ├── logProcessor.ts   # Log cleaning/truncation
│   │   └── server.ts
│   ├── tests/
│   ├── fixtures/             # Sample logs for simulate mode
│   └── Dockerfile
├── frontend/
│   └── src/
└── README.md
```
