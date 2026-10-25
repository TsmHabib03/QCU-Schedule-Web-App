# Project documentation

Start with the [project README](../README.md) for screenshots, local setup, and commands. For current publishing instructions, use [UI deployment](guides/UI_DEPLOYMENT.md).

Some architecture and feature documents describe planned behavior. Check their status and date before treating them as release instructions.

## System architecture

- [My-Schedule Dynamic QCU Academic Structure and Configuration](architecture/ACADEMIC_STRUCTURE.md)
- [My-Schedule Admin and Management CRUD Architecture](architecture/ADMIN_ARCHITECTURE.md)
- [My-Schedule Apps Script API and Backend Service Architecture](architecture/API_BACKEND.md)
- [My-Schedule Target Architecture](architecture/ARCHITECTURE.md)
- [My-Schedule Authentication and User Identity Architecture](architecture/AUTHENTICATION.md)
- [My-Schedule Database and Google Sheets Schema](architecture/DATABASE.md)
- [My-Schedule Frontend UI/UX and Design System Migration](architecture/FRONTEND_DESIGN_SYSTEM.md)
- [My-Schedule Security, Privacy, and Data Protection Architecture](architecture/SECURITY_PRIVACY.md)

## Setup and feature guides

- [Admin dashboard deployment](guides/ADMIN_DASHBOARD_SETUP.md)
- [Cache and dashboard performance](guides/CACHE_PERFORMANCE.md)
- [My-Schedule COR AI/OCR Extraction and Structured Data Pipeline](guides/COR_AI_PIPELINE.md)
- [My-Schedule Deployment, Infrastructure & Environment Architecture](guides/DEPLOYMENT_INFRASTRUCTURE.md)
- [Google Classroom integration](guides/GOOGLE_INTEGRATION.md)
- [My-Schedule Public Landing Page and Student Entry Experience](guides/LANDING_PAGE.md)
- [My-Schedule Campus, Building, Room and Map Architecture](guides/LOCATION_MAP.md)
- [My-Schedule Tasks, Notes, and Personal Productivity Architecture](guides/PRODUCTIVITY.md)
- [My-Schedule Student Registration and COR Upload Experience](guides/REGISTRATION_COR.md)
- [My-Schedule Schedule CRUD and Enrollment Management](guides/SCHEDULE_CRUD.md)
- [Deploying the monthly calendar and professor field](guides/SCHEDULE_PROFESSOR_DEPLOYMENT.md)
- [My-Schedule Student Dashboard and Personalized Application Architecture](guides/STUDENT_DASHBOARD.md)
- [My-Schedule Testing, Validation & Quality Assurance Architecture](guides/TESTING_QA.md)
- [Deploying the Settings Google connection and Route 4 UI](guides/UI_DEPLOYMENT.md)

## Verification reports

- [Main branch consolidation and validation](verification/PROJECT_CONSOLIDATION.md)
- [COR reliability implementation — 2026-09-12](verification/COR_RELIABILITY_VERIFICATION.md)
- [Loading-state verification](verification/LOADING_STATES_VERIFICATION.md)
- [Redesign verification](verification/REDESIGN_VERIFICATION.md)
- [Student UX improvements — September 13, 2026](verification/UX_RELIABILITY_VERIFICATION.md)

## Design assets

- [Brand guidelines](design/brand/logo/final/brand-guidelines.md) and [handover](design/brand/logo/final/handover.md).
- [Logo previews](design/brand/logo/final/preview.html), source vectors, and exports in `design/brand/`.
- Original UI mockups in `design/mockups/`; these are reference files.

## Historical plans and reviews

- [My-Schedule Codebase Audit](archive/AUDIT.md)
- [Code review — 2026-09-11](archive/BUG_REVIEW.md)
- [My-Schedule Final Architecture Review & Implementation Readiness Audit](archive/FINAL_ARCHITECTURE_REVIEW.md)
- [My-Schedule Implementation Log](archive/IMPLEMENTATION_LOG.md)
- [My-Schedule Migration Strategy & Implementation Roadmap](archive/IMPLEMENTATION_ROADMAP.md)
- [Dashboard Redesign — Plan Prompt (QCU-Schedule)](archive/REDESIGN_PLAN_PROMPT.md)
- [Logo Replacement — QC-App-logo.png](archive/TODO.md)

## Screenshots

The README uses real app captures with fictional student data from `screenshots/`. Regenerate them with `node scripts/capture-readme-screenshots.mjs` from the project root.
