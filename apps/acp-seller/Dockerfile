FROM node:18-slim
WORKDIR /app
RUN npm install -g pnpm
COPY package.json ./
RUN pnpm install
COPY . .
CMD ["pnpm", "start"]
