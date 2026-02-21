# AGENTS.md

## Purpose
This repository uses docs-first execution. Every coding agent must read `/docs` before making changes.

## Mandatory First Reads (in order)
1. `docs/06-ai-agent-master-runbook.md`
2. `docs/07-ai-agent-task-contracts.md`
3. `docs/08-service-implementation-spec.md`
4. `docs/09-testing-and-quality-gates.md`
5. `docs/10-execution-checklists-and-handoffs.md`
6. `docs/11-current-implementation-status.md`
7. `docs/05-local-dev-quickstart.md`

## Required Workflow
- Identify task scope and acceptance criteria in docs before coding.
- Keep API behavior under `/api/v1` unless docs/contracts are updated together.
- Implement changes following service specs and architecture constraints in docs.
- Add/update unit and integration tests for non-trivial changes.
- Run quality gates from `docs/09-testing-and-quality-gates.md`.
- Provide a final handoff report matching the template in `docs/06-ai-agent-master-runbook.md`.

## Pact Test Isolation Policy
- All Pact provider/message verification tests must run with embedded service apps and in-memory mocks.
- Pact verification tests must not depend on external runtime services (PostgreSQL, Redis, BullMQ, or other live service endpoints).
- `PACT_BROKER_BASE_URL` is mandatory for Pact publish/verification flows; Pact Broker is the only allowed external dependency for Pact verification.
- New or modified Pact tests that require external runtime dependencies violate repository policy and must be refactored to mock-based verification.

## Docs-First Policy
- If a request is ambiguous, resolve it using `/docs` first.
- If code and docs conflict, call out the conflict explicitly and propose the smallest safe fix.
- Do not mark work complete without matching docs/tests/gates updates when required by docs.

## Security and Reliability Baseline
- Never introduce hardcoded secrets.
- Preserve health/metrics and OpenAPI/Swagger endpoints for services.
- Avoid breaking changes without contract and test updates.

## Operational Notes
- Prefer repository-local conventions over generic defaults.
- Keep changes scoped, auditable, and test-backed.
## Implemented Changes
- Added GIN Trigram index to `media.relative_path` in Library Service to optimize substring searches.
- Added EXIF-based capture date extraction for images.
- Created `scripts/full-build.sh` to automate build and test.
- Refactored Pact tests across all services (Auth, Ingest, Library, Worker) to use more descriptive interaction names and provider states, following Pact best practices for readability and maintainability.
- Integrated Google Material Symbols in the Web App to modernize the UI and provide a premium aesthetic. Optimized icon loading for slow mobile networks by switching to subsetted Google Fonts API, reducing page weight by ~2MB.
- Refactored the UI of the Timeline page to match a modern design, including a sticky header with search, a rail-style sidebar with hover expansion, and a masonry grid for media display using theme colors and tokens.
- Refactored the Upload page to match the new modern design with improved drag-and-drop feedback, modern upload items with progress bars, and a sticky footer, while preserving all upload logic.
- Refactored the Admin Console to match a premium dashboard design, including updated metrics cards, a redesigned user management table with status toggles, and live worker telemetry integration.
- Refactored the Timeline page to modularize it. Split the monolithic page.js into separate components (Spinner, TimelineThumbnail, TimelineModalMedia, FilmstripThumb) and a utility file to improve code maintainability and readability. Added a centralized full-screen Spinner for the initial session validation loading state.
- Implemented album integration (P+1): album-sharing-service upgraded from scaffold to fully implemented with `GET/POST /albums`, `GET /albums/:albumId`, `POST /albums/:albumId/items`, `GET /albums/:albumId/items`, and `DELETE /albums/:albumId/items/:mediaId` endpoints. Timeline page now supports multi-select mode with a "Select" toggle, per-section "Select all", and a floating action bar to add selected photos to an album via `AssignToAlbumModal`. Albums page (`/albums`) displays real user albums with media counts and a "Create Album" modal. Album detail page (`/albums/[id]`) shows album photos in a masonry grid with a remove-from-album hover button and full-screen modal viewer.
- Fixed photo grid sorting: Replaced CSS `column-count` with a flexbox-based responsive grid in `globals.css` to ensure photos are sorted horizontally (left-to-right) instead of vertically, maintaining chronological order in the timeline and album views.
- Modified App Sidebar and Top Bar: removed the mobile menu button and made the sidebar always visible across all device viewports. The sidebar remains at a fixed 45px width (icons only) on mobile, 72px on tablet, and expands to 240px with labels on desktop.
- Fixed icon rendering in Global Upload Progress notification by adding the missing `expand_more` icon to the subsetted Material Symbols font request.
- Implemented album collage thumbnails: updated the `album-sharing` service to return up to 4 sample media IDs for each album, and created a new `AlbumThumbnail` responsive collage component in the web app to display a visual preview of album contents.
- Redesigned the Timeline Media Modal: transformed the lightbox into a premium viewing experience matching a high-fidelity design. Added a toggleable "Details" sidebar showing full EXIF metadata and location data, a redesigned header with file information, and refined media navigation and filmstrip components. Implemented as a frontend-only change using existing API endpoints.
