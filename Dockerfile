# Sentinel server - no npm dependencies, just Node.
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DB_PATH=/data/sentinel.db \
    TRUST_PROXY=1

WORKDIR /app
COPY brand.json package.json ./
COPY server ./server
COPY web ./web

# Run as an unprivileged user; only /data is writable.
RUN addgroup -S sentinel && adduser -S sentinel -G sentinel \
 && mkdir -p /data && chown sentinel:sentinel /data
USER sentinel

VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/api/v1/plans >/dev/null || exit 1
CMD ["node", "server/index.js"]
