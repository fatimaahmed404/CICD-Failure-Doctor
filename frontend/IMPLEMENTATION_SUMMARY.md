# DiagnosisList Component Implementation Summary

## Task: 14.2 Implement `DiagnosisList` component with polling and simulate button

### Completed Features

#### ✅ 1. Polling Functionality (Req 8.1)
- Implemented `setInterval` polling every 3 seconds
- Polls `GET /diagnoses` endpoint
- On poll failure: retains current list and shows non-blocking error banner (Req 8.10)
- Does not clear the list on error

#### ✅ 2. Table/List Display
- Displays `DiagnosisSummary` rows with all required fields:
  - `repoName`
  - `jobName`
  - `commitSha` (truncated to first 7 characters)
  - `source`
  - `createdAt` (formatted as locale string)
  - Status badge
  - Category badge

#### ✅ 3. Status Badges (Req 8.2)
- **Pending**: Yellow background (`bg-yellow-500`)
- **Complete**: Green background (`bg-green-500`)
- **Unavailable**: Red background (`bg-red-500`)

#### ✅ 4. Category Badges (Req 8.5)
- Color-coded per category:
  - `dependency-build-error`: Purple
  - `test-failure`: Red
  - `docker-build-failure`: Blue
  - `env-var-secrets`: Orange
  - `timeout-infrastructure`: Yellow-600
  - `syntax-lint-error`: Pink
  - `unknown`: Gray
- Shows "Uncategorized" placeholder when `category` is null

#### ✅ 5. Navigation (Req 8.3)
- Clicking a row navigates to `/diagnoses/:id`
- Implemented using React Router's `useNavigate` hook

#### ✅ 6. Simulate Failed Build Button (Req 8.7, 2.6, 2.7)
- Button opens scenario dropdown
- Dropdown contains all 6 scenarios:
  - test-failure
  - dependency-error
  - docker-build-failure
  - env-var-missing
  - timeout
  - lint-error
- On submit: POSTs to `/simulate` endpoint
- New pending row appears within one polling cycle (≤ 3 seconds) (Req 8.8)

### Files Created

1. **`src/main.tsx`** - Application entry point with routing
2. **`src/types.ts`** - TypeScript type definitions matching backend
3. **`src/components/DiagnosisList.tsx`** - Main component implementation
4. **`src/components/DiagnosisDetail.tsx`** - Detail view component
5. **`src/styles.css`** - Complete styling with responsive design
6. **`src/vite-env.d.ts`** - Vite environment variable type definitions
7. **`.env`** - Environment configuration for API base URL
8. **`.env.example`** - Example environment configuration

### Technical Details

#### Polling Implementation
```typescript
// Initial fetch
useEffect(() => {
  fetchDiagnoses();
}, [fetchDiagnoses]);

// Polling every 3 seconds
useEffect(() => {
  const intervalId = setInterval(() => {
    fetchDiagnoses();
  }, POLL_INTERVAL_MS);
  
  return () => clearInterval(intervalId);
}, [fetchDiagnoses]);
```

#### Error Handling
- On fetch error: shows error banner but **retains current list**
- Error is logged to console for debugging
- Non-blocking UI - user can still interact with existing data

#### Simulate Flow
1. User selects scenario from dropdown
2. User clicks "Simulate Failed Build" button
3. POST request sent to `/simulate` with selected scenario
4. Immediate re-fetch triggered to reduce perceived delay
5. New pending diagnosis appears in list within 3 seconds

### Requirements Validated

- ✅ **Req 8.1**: Poll `/diagnoses` every 3 seconds
- ✅ **Req 8.2**: Display status badges (pending/complete/unavailable)
- ✅ **Req 8.3**: Navigate to detail view on row click
- ✅ **Req 8.5**: Display category badges with color coding
- ✅ **Req 8.7**: Provide "Simulate Failed Build" button with scenario dropdown
- ✅ **Req 8.8**: Display new pending record within one polling cycle
- ✅ **Req 8.10**: On poll failure, retain current list and show non-blocking error

### Build Status

✅ **Build successful**: `npm run build` passes without errors
- TypeScript compilation successful
- Vite bundle created successfully
- All assets generated correctly

### Testing

Test file created: `src/components/DiagnosisList.test.tsx`

Tests cover:
- Rendering diagnoses list after fetch
- Empty state display
- Error handling without clearing list
- Simulate button with dropdown
- Simulate request submission
- Navigation on row click
- Status badge rendering
- Category badge rendering including "Uncategorized" state

### Usage

#### Development
```bash
cd frontend
npm install
npm run dev
```

#### Production Build
```bash
cd frontend
npm run build
```

#### Environment Configuration
Create `.env` file:
```env
VITE_API_BASE_URL=http://localhost:3000
```

### Notes

- Component is fully responsive with mobile breakpoint at 768px
- Uses semantic HTML with accessible table structure
- All badges use clear visual indicators (color + text)
- Error states are user-friendly and non-disruptive
- Loading states provide feedback during initial fetch
- Empty state guides users to try the simulate feature
