FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/analysis/package.json packages/analysis/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci

COPY . .
# B00 has no data/demo directory. T23 supplies the fixture at integration.
RUN npm run build && npm prune --omit=dev && mkdir -p data/demo \
    && chmod -R a+rX /app

FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ARG MTS_IMAGE_TAG=local
LABEL org.opencontainers.image.revision="${MTS_IMAGE_TAG}"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 MTS_DATA_DIR=/app/data/runtime

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist/ apps/api/dist/
COPY --from=build /app/apps/web/package.json apps/web/
COPY --from=build /app/apps/web/dist/ apps/web/dist/
COPY --from=build /app/packages/analysis/package.json packages/analysis/
COPY --from=build /app/packages/analysis/dist/ packages/analysis/dist/
COPY --from=build /app/packages/contracts/package.json packages/contracts/
COPY --from=build /app/packages/contracts/dist/ packages/contracts/dist/
COPY --from=build /app/data/demo/ data/demo/
COPY --from=build /app/deploy/smoke.mjs deploy/

RUN install -d -o node -g node /app/data/runtime
USER node
EXPOSE 8787
CMD ["npm", "start"]
