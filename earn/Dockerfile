FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV BOOKS_DIR=/data/books
CMD ["node", "server.js"]
