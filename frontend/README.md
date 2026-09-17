# Campaign Studio — frontend

Next.js 15 (App Router, `output: "export"`), React 19, TypeScript, TanStack Query, Supabase JS. No component library: the stylesheet is the
prototype's design system (`app/globals.css`, ported from `design/prototype/assets/app.css`) so the app looks exactly like the artifact.

```bash
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL
npm install && npm run dev   # :3000 (or ./run_web.sh for :3100 with a pidfile)
npm run build                # static export → out/ (served by FastAPI in Shape A, or by Vercel in Shape B)
```

- `lib/api.ts` — typed client; `generate()` consumes the SSE stage stream. `lib/session.tsx` — Supabase session + React Query providers;
  every mutating response writes the new credit balance into the `me` cache so the pill updates instantly.
- Pages take ids as query params (`/campaign/?id=…&tab=…`) because a static export cannot prerender unknown dynamic routes.
