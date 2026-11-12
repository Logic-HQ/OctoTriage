# 🗺️ Contributing to OctoTriage

# First off, thank you for taking the time to contribute! 🎉

OctoTriage is built to solve maintainer burnout, and we want the experience of building it to be just as smooth, fast, and stress-free. 
Whether you are fixing a small bug, refining the UI, or optimizing GraphQL payloads, your help is incredibly valuable.

## 🚦 Quick Code of Conduct

- Be Excellent to Each Other: Treat all contributors with respect, empathy, and patience.
- Keep it Clean: Write self-documenting code, use clear naming conventions, and follow our TypeScript strict guidelines.
- Respect the Architecture: We rely heavily on localized feature folders to keep this application modular.

## 🏗️ Architecture & Folder Conventions

We organize code by domain-driven feature folders inside src/features/ rather than generic components/ or hooks/ directories. 


## Key Technical Guardrails

• 🏪 State Management: Use Zustand only for persistent global UI configurations (e.g., sidebar toggles, theme adjustments).
• 🔄 Server State: All GitHub API actions, query states, mutations, and caching logic must use TanStack Query (React Query).
• 🎨 UI Elements: Check if a component exists in src/components/ui/ (Shadcn/ui) before creating a custom styled element from scratch.

## 🛠️ Step-by-Step Contribution Workflow

1. Fork the repository on GitHub.
2. Clone your fork locally and configure your upstream remotes.
3. To setup environment and Install dependencies please read:
[Quick Start WikiPage](https://github.com/Logic-HQ/OctoTriage/wiki/Quick-Start)

## Branching Strategy

Create a feature or bugfix branch branch off main. Use a clear descriptive prefix:
```bash
git checkout -b feature/keyboard-shortcut-navigation
# OR
git checkout -b fix/graphql-cache-invalidation
```

## Development & Commit Standards

- Keep changes minimal and isolated to a single issue goal.
- Ensure all TypeScript code compiles without errors (npm run build).
- Write conventional commits to keep our changelogs structured:
> feat(triage-board): add instant column sorting shortcuts
> fix(auth): resolve local storage token expiration loop
> docs(readme): update environment variable setup guidelines

## Opening a Pull Request

1. Push your local branch changes up to your repository fork.
2. Open a Pull Request against our primary main branch.
3. Fill out the provided Pull Request Template detailing:
> What change was made (and why).
> How you tested it (provide screenshots or video captures for visual changes).

## Local Verification Checklists

Before smashing the submit button on your Pull Request, verify that your changes pass our local sanity suite:

```bash
# Verify there are no TypeScript diagnostic compiler warnings
npm run build
```

Make sure Tailwind code formats beautifully and cleanly
```
npm run lint
```

Use code with caution.

Thank you again for helping us make open-source triage faster and less chaotic for maintainers worldwide! 🚀
