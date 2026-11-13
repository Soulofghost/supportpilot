FROM node:22-alpine

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

COPY backend/ ./backend/
COPY frontend/ ./frontend/

EXPOSE 8001

ENV PORT=8001 \
    NODE_ENV=production

CMD ["node", "backend/src/server.js"]
