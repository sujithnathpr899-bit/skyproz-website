FROM node:24-alpine
WORKDIR /app
COPY . .
RUN mkdir -p /app/data
ENV HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/app/data/contract-finder.db
EXPOSE 8787
CMD ["sh", "-c", "node scripts/migrate.mjs && node src/server.mjs"]
