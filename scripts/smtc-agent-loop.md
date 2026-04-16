# SMTC Feature Builder Agent Loop

This document describes the automated agent loop for processing feature requests submitted to the SMTC Corporate Tools portal.

## API Endpoints

- **GET** `https://spicemore-site.vercel.app/api/requests` — List all requests
- **POST** `https://spicemore-site.vercel.app/api/request-update` — Update request status/feedback
  - Body: `{ "id": "...", "status": "...", "note": "..." }`
- **POST** `https://spicemore-site.vercel.app/api/send-email` — Send notification email
  - Body: `{ "to": "...", "subject": "...", "html": "..." }`

## Valid Statuses
submitted → in_review → in_progress → ready_for_testing → live

## Loop Instructions

Every iteration of this loop:

1. **Check for work**: GET `/api/requests`, look for:
   - Requests with `status: "submitted"` (new requests to build)
   - Requests with new `feedback` entries where status is `ready_for_testing` (changes requested)

2. **If no work found**: Report "No pending requests" and exit this iteration.

3. **If new request found** (status: "submitted"):
   a. Update status to `in_progress` via POST `/api/request-update`
   b. Read the request details: `toolName`, `processDesc`, `additionalOptions`, `files`
   c. Build a self-contained HTML/JS tool in `tools/` following the patterns of existing tools
   d. Create a wrapper page (like `daily-sales-summary.html`) with auth gate and iframe
   e. Add to portal grid and dropdown nav in ALL HTML pages
   f. Git commit and push to deploy
   g. Update status to `ready_for_testing` via POST `/api/request-update`
   h. Notification email is sent automatically by the API

4. **If feedback found on ready_for_testing request**:
   a. Update status to `in_progress`
   b. Read the feedback, make the requested changes
   c. Git commit and push
   d. Update status back to `ready_for_testing`

## Tool Building Guidelines

- Tools are self-contained HTML files in `/tools/` directory
- Use XLSX.js for Excel file handling: `https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js`
- Match the visual style of existing tools (blue gradient header, clean cards, stat boxes)
- Include drag-drop file upload, data display, export functionality
- All processing happens client-side in JavaScript
- Wrapper pages use iframe with auth gate (check `sessionStorage.getItem('smtc_auth')`)

## Working Directory
`/Users/Shared/Claude Work/spicemore-site`
