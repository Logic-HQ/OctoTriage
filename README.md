# OctoTriage
GitHub integrated Multi-Repo Aggregation with lightweight Footprint that allow you clearing your review backlog quickly.

## 🚀 The Unified Inbox for Overwhelmed Maintainers
to use GitHub triage board for maintainers to review open issues and pull requests across repositories.

### OctoTriage Product
OctoTriage aggregates open issues and pull requests from selected repositories into incoming, needs-review, stale, and blocked groups. Maintainers can search, filter by item type and first-time contributor, sort, and close, merge, request changes, or update labels.
OctoTriage is an ultra-lightweight, 100% client-side dashboard that aggregates open Issues and Pull Requests across multiple GitHub repositories into a single, high-priority inbox. Built explicitly for solo open-source maintainers, it cuts through the noise of the standard GitHub notifications feed to show you exactly what needs your attention right now.

## 📋 Board Columns & Mechanics

OctoTriage automatically organizes your open workload into four functional views:
- 📥 Unassigned / Incoming: Fresh issues and PRs missing reviewers, assignees, or triage labels.
- 👀 Needs Review: External PRs awaiting your explicit review or status feedback.
- ⏳ Stale Alert: Active items left without responses or comments for over 7 consecutive days.
- 🧱 Action Blocked: Items manually flagged with blocker labels (e.g., status: blocked).

## 🎯 Why OctoTriage?

### advantages
- 🚫 Zero Infrastructure: Runs completely in your browser. No databases, no tracking, and no servers to maintain. Your data stays in your browser. 
- 🎯 Context-Aware Triage: Automatically sorts items into clear, action-oriented tracks like Needs Review, Stale Alerts, and First-Time Contributors.
- 🏎️ Rate-Limit Safe: Leverages bulk GraphQL queries and client-side caching to load in under 200ms while respecting GitHub's API limits.
-  ⌨️ Mouse-Free Workflow: Apply labels, request modifications, or merge pull requests instantly using fast keyboard hotkeys.

## 🛠️ Tech Stack

- Frontend: React 19 + TypeScript + Vite
- Styling: TailwindCSS + Shadcn/ui
- State & Caching: Zustand + TanStack Query (React Query)
- Local Storage: LocalForage (IndexedDB) [1]
- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (VIP)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## 🏗️ Quick Start

[Quick Start WikiPage](https://github.com/Logic-HQ/OctoTriage/wiki/Quick-Start)

## Architecture decisions
- This is Monorepo
- OAuth exchanges happen server-side; repository API requests go directly from the browser to GitHub.
- GitHub tokens stay in app memory and are cleared on disconnect or reload.
- Repository data is held in memory only; local storage contains repository selections and board preferences.

## Where things live

- `artifacts/octotriage/src/App.tsx` — GitHub sign-in, repository selection, triage board, and actions
- `artifacts/octotriage/src/index.css` — app theme and visual system
- `artifacts/api-server/src/routes/github-auth.ts` — OAuth code exchange; the client secret stays server-side
- `lib/api-spec/openapi.yaml` — source of truth for the shared API contract
  
## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas
- Use code of this repository with caution.
- The GitHub OAuth App callback URL must match the app origin exactly, including the trailing `/`.
- Never expose `GITHUB_CLIENT_SECRET` to frontend code or logs.


## 🤝 Contributing

We love open-source contributions! Check out our directory structure inside src/features/ to dive into specific application modules.
1. Fork the project.
2. Create your feature branch (git checkout -b feature/AmazingFeature).
3. Commit your changes (git commit -m 'Add some AmazingFeature').
4. Push to the branch (git push origin feature/AmazingFeature).
5. Open a Pull Request.

## 📄 License

Distributed under the Apache License Version 2.0 License. See LICENSE for more details.
Would you like me to help you draft the GitHub Actions deployment workflow (deploy.yml) or create the serverless token exchange function (api/auth.ts) next to get your live environment running?

