# Сервер комнат «Своя игра · Брейн-ринг» для игры через интернет.
#   docker build -t quiz .
#   docker run -d -p 3000:3000 -v quiz-data:/data quiz
# С доменом и HTTPS удобнее docker-compose.yml (рядом лежит пример с Caddy).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client ./client
COPY vite.config.ts ./
RUN npx vue-tsc --noEmit -p client/tsconfig.json && npx vite build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    ROOMS=1 \
    NO_OPEN=1 \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/info >/dev/null || exit 1
CMD ["node", "server/index.js"]
