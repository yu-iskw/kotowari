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

CMD ["node", "apps/server/dist/server.js"]
