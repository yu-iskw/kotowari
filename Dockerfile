# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages packages
COPY apps apps
COPY plugins plugins
COPY testdata testdata
COPY dev dev
RUN pnpm install --frozen-lockfile && pnpm --recursive build
ENV KOTOWARI_PROFILE=compose
ENV PORT=8080
EXPOSE 8080
RUN chown -R node:node /app
USER node
# App images set PORT (HTTP /v1/health). Worker images omit PORT so this check is a no-op.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.PORT; if(!p) process.exit(0); fetch('http://127.0.0.1:'+p+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/server.js"]
