FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4200 DATA_DIR=/app/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts ./scripts
# The database, uploads (photos, signatures, receipts) and backups live here: mount a persistent volume on /app/data
VOLUME /app/data
EXPOSE 4200
CMD ["node", "server/index.js"]
