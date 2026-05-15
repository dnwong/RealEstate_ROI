# Playwright OS deps + browser path; tag MUST match package.json "playwright" version.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Browsers ship in the base image under /ms-playwright; npm package must match the tag above.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev \
  && node -e "const v=require('playwright/package.json').version; if(v!=='1.60.0'){console.error('playwright',v,'!= 1.60.0'); process.exit(1)}" \
  && npx playwright install chromium

COPY . .

LABEL org.opencontainers.image.title="realestate-roi" \
  org.opencontainers.image.playwright="1.60.0"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
