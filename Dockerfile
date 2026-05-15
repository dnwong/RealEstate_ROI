# OS libraries from Playwright image; browsers live in /app/browsers (not base /ms-playwright).
ARG PLAYWRIGHT_VERSION=1.60.0
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV PLAYWRIGHT_BROWSERS_PATH=/app/browsers

COPY package.json package-lock.json* ./
COPY scripts/verify-playwright.mjs scripts/verify-playwright.mjs

ARG GITHUB_SHA=dev
RUN npm ci --omit=dev \
  && node -e "const v=require('playwright/package.json').version; if(v!=='1.60.0') throw new Error('playwright '+v+' != 1.60.0')" \
  && mkdir -p /app/browsers \
  && npx playwright install chromium \
  && node scripts/verify-playwright.mjs

COPY . .

LABEL org.opencontainers.image.title="realestate-roi" \
  org.opencontainers.image.playwright="${PLAYWRIGHT_VERSION}" \
  org.opencontainers.image.revision="${GITHUB_SHA}"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
