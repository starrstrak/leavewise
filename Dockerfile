FROM node:22-slim
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci
COPY app ./app
COPY demo ./demo
COPY site ./site
COPY tsconfig.json ./
ENV NODE_ENV=production PORT=10000
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "app/src/server.ts"]
