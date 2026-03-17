# CLAUDE.md — Frontend (React + TypeScript)

## Running

```bash
npm install              # Install dependencies
npm run dev              # Dev server on http://localhost:8080
npm run build            # Production build to dist/
npm run lint             # ESLint
npm test                 # Vitest (run once)
npm run test:watch       # Vitest (watch mode)
npm run test:coverage    # Vitest with coverage
npm run typecheck        # TypeScript type checking
```

## Architecture

### Routing (`src/App.tsx`)
React Router v6 with these main routes:
- `/` — Home/landing
- `/login` — Authentication (only when `ENABLE_LOGIN=true`)
- `/app` — Main application layout with sidebar
- `/app/agent/:id` — Workspace/agent view (Q&A interface)
- `/app/dashboard/:id` — Dashboard view
- `/app/settings` — User and platform settings

### State Management
- **Server state**: React Query (TanStack Query v5) — all API data fetching and caching.
- **Auth state**: `useAuth()` hook backed by `AuthContext`.
- **Language**: `useLanguage()` hook backed by `LanguageContext` (PT/EN/ES).
- **Theme**: `next-themes` for dark/light mode.
- **Local UI state**: Standard React `useState`/`useReducer`.

### API Communication
All backend calls go through `src/services/apiClient.ts`:
```typescript
import { api } from "@/services/apiClient";
const data = await api("/api/sources", { method: "GET" });
```
The `api()` function automatically:
- Prepends `VITE_API_URL` (or defaults to same origin)
- Attaches the JWT `Authorization` header from localStorage
- Handles JSON serialization

### Component Patterns

**Page components** (`src/pages/`):
- One file per route, responsible for layout and data orchestration.
- Use React Query hooks for data fetching.

**Reusable components** (`src/components/`):
- Domain-specific components (e.g., `SourcesPanel`, `ChatMessage`, `ChartRenderer`).
- Accept props, avoid internal data fetching when possible.

**UI primitives** (`src/components/ui/`):
- shadcn/ui components built on Radix UI.
- **Do NOT edit these files directly.** Add new ones with `npx shadcn-ui@latest add <component>`.

**Hooks** (`src/hooks/`):
- Custom hooks for shared logic (auth, language, data fetching patterns).

**Services** (`src/services/`):
- API client and service-layer functions.
- Organize by domain (sources, agents, dashboards).

### Styling
- **Tailwind CSS** for all styling. Do not use CSS modules or inline styles.
- Theme colors defined as CSS variables in `tailwind.config.ts`.
- Dark mode supported via `class` strategy (toggle via `next-themes`).
- Use `cn()` utility from `src/lib/utils.ts` for conditional class merging.

### Forms
- **React Hook Form** + **Zod** for form validation.
- Define Zod schemas, pass to `useForm({ resolver: zodResolver(schema) })`.

### Internationalization (i18n)
- Translations managed in `LanguageContext`.
- Use `useLanguage()` hook to get `t()` function.
- Supported languages: Portuguese (pt), English (en), Spanish (es).
- All UI-facing strings should use `t("key")`, not hardcoded text.

## File Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Page component | `PascalCase.tsx` | `Settings.tsx` |
| Reusable component | `PascalCase.tsx` | `SourcesPanel.tsx` |
| Hook | `camelCase.ts` | `useAuth.ts` |
| Service | `camelCase.ts` | `apiClient.ts` |
| Utility | `camelCase.ts` | `utils.ts` |
| Test | `*.test.ts(x)` | `utils.test.ts` |

## Path Aliases

`@/` resolves to `src/`. Always use it for imports:
```typescript
// Good
import { Button } from "@/components/ui/button";
// Bad
import { Button } from "../../components/ui/button";
```

## Testing

- Framework: Vitest (compatible with Jest API).
- Tests in `src/__tests__/`.
- Use `@testing-library/react` for component tests.
- Run: `npm test` (once) or `npm run test:watch` (watch mode).

## Common Pitfalls

- Dev server is on port **8080** (not 3000 or 5173). Configured in `vite.config.ts`.
- `VITE_API_URL` must point to the backend (default: `http://localhost:8000`).
- Charts are server-rendered images — the frontend just displays `<img>` tags, not chart libraries.
- The `dist/` folder is what FastAPI serves in production; do not rely on Vite in prod.
- TypeScript config has `noImplicitAny: false` and `strictNullChecks: false` — the codebase is not fully strict-typed.
