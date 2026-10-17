# Official multi-architecture Node image, resolved from Docker Hub on 2026-10-17.
FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
# tsx remains a runtime requirement; do not omit the locked dev dependencies.
RUN npm ci --no-audit --no-fund
COPY . .
RUN node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync(':memory:'); if(db.prepare('SELECT 1 AS ok').get().ok!==1)process.exit(1); db.close()" \
    && npm run build

FROM node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS runtime
ENV NODE_ENV=production PORT=4173 STUDIO_HOST=0.0.0.0 STUDIO_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.json ./
COPY --from=build /app/server ./server
# Export generation reads these sources and the lockfile at runtime.
COPY --from=build /app/src ./src
COPY --from=build /app/dist ./dist
COPY --from=build /app/docs/screenshots ./docs/screenshots
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4173
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "--input-type=module", "-e", "const r=await fetch('http://127.0.0.1:4173/api/health',{signal:AbortSignal.timeout(3000)});if(!r.ok||(await r.json()).ok!==true)process.exit(1)"]
CMD ["node", "--import", "tsx", "server/index.ts", "--production"]
