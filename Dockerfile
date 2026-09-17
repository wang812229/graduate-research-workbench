FROM node:24-alpine
WORKDIR /app
COPY . .
RUN npm install -g pnpm@11.19.0 && pnpm install --frozen-lockfile --prod && mkdir -p /app/data && chown -R node:node /app
ENV NODE_ENV=production PORT=4173 HOST=0.0.0.0 DATA_DIR=/app/data
USER node
EXPOSE 4173
CMD ["node", "server.mjs"]
