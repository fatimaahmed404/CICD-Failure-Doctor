# CI/CD Failure Doctor

An intelligent web application that automatically receives failed build logs from GitHub Actions or Jenkins, analyzes them using LLM technology, and presents developers with plain-English root-cause diagnoses and concrete suggested fixes.

## Features

- 🔍 **Automatic Log Analysis**: Webhook ingestion from GitHub Actions and Jenkins
- 🤖 **LLM-Powered Diagnosis**: AI-driven root cause analysis with confidence levels
- 📊 **Real-time Dashboard**: React-based UI showing recent diagnoses
- 🎯 **Simulate Mode**: Demo the full workflow without live CI integration
- 🔔 **Notifications** (Stretch): Slack and email alerts when diagnosis completes
- 👍 **Feedback System** (Stretch): Rate diagnosis helpfulness

## Architecture

- **Backend**: Node.js/Express with SQLite database
- **Frontend**: React with Vite
- **LLM Integration**: OpenAI-compatible API for log analysis
- **Deployment**: Optimized for free-tier platforms (Render, Railway, Vercel)

---

## Getting Started

### Prerequisites

- Node.js 20+ and npm
- An LLM API key (OpenAI or compatible provider)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd CICD-Failure-Doctor
   ```

2. **Install dependencies**
   ```bash
   # Install root dependencies
   npm install
   
   # Install backend dependencies
   cd backend
   npm install
   
   # Install frontend dependencies
   cd ../frontend
   npm install
   ```

3. **Configure environment variables**
   
   Create a `.env` file in the `backend` directory (use `.env.example` as a template):
   
   ```env
   # Required
   WEBHOOK_SECRET=your-secret-key-here
   LLM_API_KEY=sk-your-api-key-here
   
   # Optional
   LLM_MODEL=gpt-4o-mini
   DATABASE_PATH=./data/cicd-doctor.db
   PORT=3000
   
   # Stretch features (optional)
   SLACK_WEBHOOK_URL=
   NOTIFICATION_EMAIL=
   APP_BASE_URL=http://localhost:3000
   ```

4. **Build the application**
   ```bash
   # Build backend
   cd backend
   npm run build
   
   # Build frontend
   cd ../frontend
   npm run build
   ```

5. **Run the application**
   ```bash
   # Start backend (from backend directory)
   npm start
   
   # In a separate terminal, serve frontend (from frontend directory)
   npm run preview
   ```

The backend will be available at `http://localhost:3000` and the frontend at `http://localhost:4173`.

---

## Development

### Backend Development

```bash
cd backend
npm run dev  # Start with hot-reload using tsx
npm test     # Run tests
```

### Frontend Development

```bash
cd frontend
npm run dev  # Start Vite dev server (http://localhost:5173)
npm test     # Run tests
```

---

## Deployment

### Deploy to Render (Backend)

1. **Create a new Web Service** in the Render dashboard
2. **Connect your repository**
3. **Configure the service**:
   - **Build Command**: `cd backend && npm install && npm run build`
   - **Start Command**: `cd backend && npm start`
   - **Environment Variables**:
     - `WEBHOOK_SECRET`: Your webhook secret
     - `LLM_API_KEY`: Your LLM API key
     - `LLM_MODEL`: `gpt-4o-mini` (or your preferred model)
     - `DATABASE_PATH`: `./data/cicd-doctor.db`
     - `NODE_VERSION`: `20`

4. **Deploy** and note your service URL

### Deploy to Railway (Backend)

1. **Create a new project** from your GitHub repository
2. **Configure environment variables** in the Railway dashboard:
   - `WEBHOOK_SECRET`
   - `LLM_API_KEY`
   - `LLM_MODEL`
   - `DATABASE_PATH`

3. Railway will auto-detect the Node.js app and run:
   ```bash
   cd backend && npm install && npm run build && npm start
   ```

### Deploy to Vercel (Frontend)

1. **Create a new project** in Vercel dashboard
2. **Configure the project**:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   
3. **Environment Variables**:
   - `VITE_API_URL`: Your backend URL (e.g., `https://your-app.onrender.com`)

4. **Deploy** and note your frontend URL

5. **Update backend CORS**: Add your Vercel URL to the backend's CORS configuration in `src/server.ts`:
   ```typescript
   app.use(cors({
     origin: [
       'https://your-app.vercel.app',
       'http://localhost:5173'
     ]
   }));
   ```

### Docker Deployment (Backend)

A `Dockerfile` is provided in the `backend` directory for containerized deployment.

**Build the image**:
```bash
cd backend
docker build -t cicd-failure-doctor-backend .
```

**Run the container**:
```bash
docker run -d \
  -p 3000:3000 \
  -e WEBHOOK_SECRET=your-secret \
  -e LLM_API_KEY=your-api-key \
  -e LLM_MODEL=gpt-4o-mini \
  -v $(pwd)/data:/app/data \
  cicd-failure-doctor-backend
```

**Deploy to any container platform** (Google Cloud Run, AWS ECS, Azure Container Instances, etc.) using the built image.

---

## CI Integration

### GitHub Actions

Add this step to your workflow after your build/test steps:

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

**Required secrets**:
- `CICD_DOCTOR_URL`: Your backend URL
- `CICD_DOCTOR_SECRET`: Matches your backend's `WEBHOOK_SECRET`

### Jenkins

Add this to your Jenkinsfile in the `post` section:

```groovy
post {
  failure {
    script {
      def log = currentBuild.rawBuild.getLog(300).join('\n')
      httpRequest(
        httpMode:        'POST',
        url:             "${env.CICD_DOCTOR_URL}/webhook/ingest",
        contentType:     'APPLICATION_JSON',
        customHeaders:   [[name: 'X-Webhook-Secret', value: env.CICD_DOCTOR_SECRET]],
        requestBody:     groovy.json.JsonOutput.toJson([
          log:       log,
          repoName:  env.JOB_NAME,
          jobName:   env.JOB_NAME,
          commitSha: env.GIT_COMMIT,
          source:    'jenkins'
        ])
      )
    }
  }
}
```

---

## API Endpoints

### Webhook Ingestion

**POST** `/webhook/ingest`

Headers:
- `X-Webhook-Secret`: Your shared secret
- `Content-Type`: application/json

Body:
```json
{
  "log": "raw build log text...",
  "repoName": "org/repo",
  "jobName": "CI / build-and-test",
  "commitSha": "40-char-hex",
  "source": "github",
  "branch": "main"
}
```

Response: `202 Accepted`
```json
{
  "id": "uuid",
  "status": "pending"
}
```

### Simulate Failed Build

**POST** `/simulate`

Body:
```json
{
  "scenario": "test-failure"
}
```

Supported scenarios:
- `test-failure`
- `dependency-error`
- `docker-build-failure`
- `env-var-missing`
- `timeout`
- `lint-error`

Response: `202 Accepted`
```json
{
  "id": "uuid",
  "scenario": "test-failure",
  "status": "pending"
}
```

### List Diagnoses

**GET** `/diagnoses?page=1&limit=20&category=test-failure`

Response: `200 OK`
```json
{
  "data": [
    {
      "id": "uuid",
      "repoName": "org/repo",
      "jobName": "CI / build",
      "commitSha": "abc123...",
      "source": "github",
      "status": "complete",
      "category": "test-failure",
      "explanation": "Brief explanation...",
      "confidence": "high",
      "createdAt": "2024-01-15T10:23:45Z",
      "completedAt": "2024-01-15T10:23:52Z"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

### Get Diagnosis Detail

**GET** `/diagnoses/:id`

Response: `200 OK`
```json
{
  "id": "uuid",
  "repoName": "org/repo",
  "jobName": "CI / build",
  "commitSha": "abc123...",
  "source": "github",
  "status": "complete",
  "category": "test-failure",
  "explanation": "Full multi-sentence explanation...",
  "suggestedFix": "**Fix:** Update your test...\n```js\n// code\n```",
  "confidence": "high",
  "rawLog": "full raw log...",
  "truncated": true,
  "createdAt": "2024-01-15T10:23:45Z",
  "completedAt": "2024-01-15T10:23:52Z"
}
```

---

## Testing

### Backend Tests

```bash
cd backend
npm test              # Run all tests
npm test -- --watch   # Watch mode
```

Test coverage includes:
- Unit tests for log processing, LLM client, webhook validation
- Property-based tests with fast-check
- Integration tests with supertest

### Frontend Tests

```bash
cd frontend
npm test              # Run all tests
npm test -- --watch   # Watch mode
```

---

## Security Considerations

- **Webhook Secret**: Use a strong random string and keep it secure
- **Rate Limiting**: Configured by default on `/webhook/ingest` and `/simulate`
- **CORS**: Configure allowed origins in `backend/src/server.ts`
- **Log Content**: Raw logs may contain secrets; consider scrubbing in production
- **Environment Variables**: Never commit `.env` files to version control

---

## Project Structure

```
CICD-Failure-Doctor/
├── backend/
│   ├── src/
│   │   ├── auth/          # Webhook authentication
│   │   ├── db/            # Database initialization and records
│   │   ├── routes/        # Express route handlers
│   │   ├── services/      # Business logic (ingest, notifications)
│   │   ├── jobQueue.ts    # Async job processing
│   │   ├── llmClient.ts   # LLM API integration
│   │   ├── logProcessor.ts # Log cleaning and truncation
│   │   ├── server.ts      # Express app entry point
│   │   └── types.ts       # TypeScript type definitions
│   ├── tests/             # Backend tests
│   ├── fixtures/          # Sample logs for simulate mode
│   ├── data/              # SQLite database (gitignored)
│   ├── Dockerfile         # Docker configuration
│   └── package.json
├── frontend/
│   ├── src/               # React application
│   ├── public/            # Static assets
│   └── package.json
└── README.md
```

---

## Troubleshooting

### Backend won't start

**Error**: `Missing required environment variable`
- **Solution**: Ensure `WEBHOOK_SECRET` and `LLM_API_KEY` are set in your `.env` file

### LLM diagnosis fails

**Error**: BuildRecords stuck in `pending` status
- **Solution**: Check `LLM_API_KEY` is valid and your LLM provider is reachable
- **Solution**: Verify `LLM_MODEL` matches your provider's available models

### Database locked errors

**Error**: `SQLITE_BUSY` or `database is locked`
- **Solution**: Ensure only one backend instance is running
- **Solution**: Check that `DATABASE_PATH` points to a writable directory

### Cold starts on free tier

**Issue**: First request takes 30+ seconds
- **Solution**: Set up a health check ping (UptimeRobot, cron-job.org) to keep the service warm
- **Solution**: Use the provided `/health` endpoint for monitoring

---

## License

[Your License Here]

## Contributing

[Your Contributing Guidelines Here]

## Support

For issues and questions, please open a GitHub issue or contact [your contact info].
