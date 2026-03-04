FROM node:20-alpine

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files first (Docker layer caching)
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --production && apk del python3 make g++

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY Tools/ ./Tools/
COPY System/ ./System/

# NanoClaw runs TypeScript connectors directly via ts-node
ENTRYPOINT ["npx", "ts-node"]
