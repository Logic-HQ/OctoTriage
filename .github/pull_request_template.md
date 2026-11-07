## 📝 Description

### 🛠️ Type of Change
- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that causes existing functionality to not work as expected)
- [ ] 📖 Documentation update (README, CONTRIBUTING guides, inline code docs)
- [ ] 🎨 Style / UI polish (Tailwind tweaks, Shadcn component upgrades)

---

## 🧪 How Has This Been Tested?

- [ ] **TypeScript Check:** Run `npm run build` locally to verify zero compiler errors.
- [ ] **Lint Check:** Run `npm run lint` to verify styling and code patterns.
- [ ] **Manual Verification:** Verified locally on Chrome / Firefox / Safari (circle applicable).

### 📸 Visual Evidence (Mandatory for UI changes)

---

## 🏗️ Architectural Checklist

- [ ] My code follows the **modular domain structure** (placed inside the correct `src/features/` directory).
- [ ] I have used **Zustand** *only* for persistent global configurations and **TanStack Query** for all server-side GitHub API states.
- [ ] I have checked `src/components/ui/` and reused existing **Shadcn/ui** components where possible.
- [ ] My commits follow the **Conventional Commits** standard (e.g., `feat(triage-board): ...`).
- [ ] My code requires changes to the documentation, and I have updated it accordingly.
