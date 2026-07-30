# Build stage: compile the web client and the API server.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage: production dependencies plus built artifacts only.
FROM node:22-bookworm-slim
ARG FORG3_COMMIT_SHA=local
ARG FORG3_BUILD_VERSION=1.0.0
WORKDIR /app
ENV NODE_ENV=production
ENV FORG3_COMMIT_SHA=${FORG3_COMMIT_SHA}
ENV FORG3_BUILD_VERSION=${FORG3_BUILD_VERSION}
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

EXPOSE 4127
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4127) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist-server/server/index.js"]
