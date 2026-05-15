# Node + `playwright install --with-deps` (no Playwright base image — avoids /ms-playwright version mismatch).
FROM node:22-bookworm

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV PLAYWRIGHT_IN_DOCKER=1

COPY package.json package-lock.json ./
COPY scripts/verify-playwright.mjs scripts/verify-playwright.mjs

ARG GITHUB_SHA=dev
ENV BUILD_ID=${GITHUB_SHA}
RUN npm ci --omit=dev \
  && npx playwright install --with-deps chromium \
  && node scripts/verify-playwright.mjs

COPY . .

LABEL org.opencontainers.image.title="realestate-roi" \
  org.opencontainers.image.playwright="1.60.0" \
  org.opencontainers.image.revision="${GITHUB_SHA}"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>process.exit(r.statusCode===200&&d.includes('ok')?0:1))}).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
