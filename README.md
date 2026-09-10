# CI/CD Failure Doctor 🩺

An AI-powered tool that automatically diagnoses CI/CD build failures. When a build fails, it captures the logs, runs them through an LLM, and delivers a plain-English explanation of the root cause plus a suggested fix — directly to your dashboard and email inbox.

**Live demo:** [cicd-failure-doctor-frontend.vercel.app](https://cicd-failure-doctor-frontend.vercel.app)

---

## How It Works

1. A build fails in GitHub Actions
2. A workflow sends the logs to the CI/CD Doctor webhook
3. The backend processes the logs with an LLM
4. The diagnosis appears in your private dashboard
5. You receive an email with the failure category and summary

No more manually digging through 500-line build logs.

---

## Features

- **AI diagnosis** — categorizes failures: test failure, dependency error, Docker build failure, missing env var, timeout, lint error
- **Private dashboards** — each user only sees their own build history
- **Email notifications** — get notified the moment a diagnosis completes
- **GitHub OAuth** — connect repos and auto-configure the workflow file with one click
- **Per-user webhook secrets** — each account gets a unique secret for attribution
- **Simulate mode** — try the full AI pipeline with 6 bundled failure scenarios, no CI setup needed
- **Demo mode** — unauthenticated visitors can run simulations at `/demo`

---

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Node.js, Express, TypeScript, SQLite |
| Frontend | React, Vite, React Router |
| Auth | JWT (httpOnly cookies), bcrypt |
| LLM | Any OpenAI-compatible API (Groq, OpenAI, etc.) |
| Email | Nodemailer via Resend SMTP |
| Deployment | Render (backend) + Vercel (frontend) |

---

## Quick Start

**Prerequisites:** Node.js 20+, an LLM API key (Groq is free at [console.groq.com](https://console.groq.com))

```bash
git clone https://github.com/fatimaahmed404/CICD-Failure-Doctor
cd CICD-Failure-Doctor
cd backend && npm install
cd ../frontend && npm install
```

Create `backend/.env`:

```env
WEBHOOK_SECRET=any-random-secret
LLM_API_KEY=your-groq-or-openai-key
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.1-8b-instant
SESSION_SECRET=any-random-string-32-chars
TOKEN_ENCRYPTION_KEY=any-64-char-hex-string
APP_BASE_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173
```

Run:

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

Open `http://localhost:5173`, sign up, and click **Simulate Failed Build** to see a diagnosis.

---

## Connecting Your CI Pipeline

After signing up, your personal webhook secret is shown in the top header.

**1. Add two secrets to your GitHub repo** (Settings → Secrets → Actions):

| Secret | Value |
|---|---|
| `CICD_DOCTOR_SECRET` | Your webhook secret from the dashboard header |
| `CICD_DOCTOR_URL` | `https://cicd-failure-doctor-1.onrender.com` |

**2. Create `.github/workflows/ci.yml`** (your existing CI — must fail to trigger Doctor):

```yaml
name: CI Tests
on:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install && npm test
```

**3. Create `.github/workflows/cicd-failure-doctor.yml`** (listens for failures and sends logs):

```yaml
name: Notify CI/CD Failure Doctor on Failure
on:
  workflow_run:
    workflows: ["CI Tests"]
    types: [completed]
jobs:
  notify:
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest
    permissions:
      actions: read
    steps:
      - name: Send logs to CI/CD Failure Doctor
        run: |
          curl -s -H "Authorization: Bearer ${{ github.token }}" \
            -H "Accept: application/vnd.github+json" \
            "https://api.github.com/repos/${{ github.repository }}/actions/runs/${{ github.event.workflow_run.id }}/logs" \
            -L -o /tmp/logs.zip || true
          LOGS=$(unzip -p /tmp/logs.zip 2>/dev/null | tail -c 15000 || echo "Log unavailable")
          PAYLOAD=$(jq -nc \
            --arg log    "$LOGS" \
            --arg repo   "${{ github.repository }}" \
            --arg job    "${{ github.event.workflow_run.name }}" \
            --arg sha    "${{ github.event.workflow_run.head_sha }}" \
            --arg branch "${{ github.event.workflow_run.head_branch }}" \
            '{log:$log,repoName:$repo,jobName:$job,commitSha:$sha,source:"github",branch:$branch}')
          curl -sf -X POST "${{ secrets.CICD_DOCTOR_URL }}/webhook/ingest" \
            -H "Content-Type: application/json" \
            -H "X-Webhook-Secret: ${{ secrets.CICD_DOCTOR_SECRET }}" \
            -d "$PAYLOAD"
```

Or use the **Connect GitHub** button in the dashboard to set this up automatically.

---

## Deployment

**Backend → Render**

- Build command: `cd backend && npm install && npm run build`
- Start command: `cd backend && npm start`
- Required env vars: `WEBHOOK_SECRET`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `APP_BASE_URL`, `FRONTEND_URL`, `NODE_ENV=production`, `RESEND_API_KEY`

**Frontend → Vercel**

- Root directory: `frontend`
- Framework: Vite
- Env var: `VITE_API_BASE_URL=https://your-backend.onrender.com`

---

## Project Structure

```
CICD-Failure-Doctor/
├── backend/
│   ├── src/
│   │   ├── auth/           # JWT middleware, bcrypt, webhook validation
│   │   ├── db/             # SQLite schema, users, build records, tokens
│   │   ├── routes/         # auth, diagnoses, feedback, github, webhook, simulate
│   │   ├── services/       # GitHub connection, ingest, notifications
│   │   ├── jobQueue.ts     # Async LLM job processing with retry + SLA timeout
│   │   ├── llmClient.ts    # OpenAI-compatible LLM integration
│   │   └── logProcessor.ts # Log truncation and ANSI cleaning
│   ├── tests/              # Unit + integration + property-based tests
│   └── fixtures/           # Pre-built failure logs for simulate mode
└── frontend/
    └── src/
        ├── contexts/       # AuthContext (JWT session)
        ├── pages/          # Login, Signup, Demo
        └── components/     # DiagnosisList, DiagnosisDetail, GitHubConnect
```

---

## License

MIT
