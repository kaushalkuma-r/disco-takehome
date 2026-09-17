# Shape A: one container serving the Next.js static export and the FastAPI API.
# Works on Render / Koyeb / Hugging Face Spaces free tiers (answers /healthz in <2 s on a cold start).

# ---- stage 1: build the frontend
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Same-origin API: leave NEXT_PUBLIC_API_URL empty. Supabase public keys are baked in at build time.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_API_URL=""
RUN npm run build

# ---- stage 2: python runtime
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 SERVE_STATIC=1 STATIC_DIR=/app/frontend/out DATA_DIR=/app/data PROMPTS_DIR=/app/prompts
COPY backend/pyproject.toml backend/
COPY backend/app backend/app
RUN pip install --no-cache-dir ./backend
COPY data ./data
COPY prompts ./prompts
COPY backend/migrations ./backend/migrations
COPY --from=web /web/out ./frontend/out
EXPOSE 8000
# $PORT is injected by Render/Koyeb/HF Spaces; default 8000 locally.
CMD ["sh", "-c", "uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --timeout-keep-alive 30"]
