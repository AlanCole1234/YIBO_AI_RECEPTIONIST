FROM node:22.5.1-bookworm-slim
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm typecheck && pnpm build
ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["pnpm", "exec", "tsx", "src/main.ts"]
