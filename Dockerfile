# ─── STAGE 1: BUILDER ───────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install standard compiler tools for compiling better-sqlite3 from source on ARM64
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ gcc libc6-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy package descriptors
COPY package*.json ./

# Install dependencies (will successfully compile better-sqlite3 from source on ARM64)
RUN npm install --omit=dev

# ─── STAGE 2: RUNTIME ───────────────────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Create application user and runtime directories for data persistence
# Debian standard groupadd and useradd used for container security
RUN groupadd -r agentsg && \
    useradd -r -g agentsg agentuser && \
    mkdir -p data logs && \
    chown -R agentuser:agentsg /app

# Copy built node_modules and dependencies from builder stage
COPY --from=builder --chown=agentuser:agentsg /app/node_modules ./node_modules
COPY --from=builder --chown=agentuser:agentsg /app/package.json ./package.json

# Copy clean-slate source files and static assets
COPY --chown=agentuser:agentsg src/ ./src
COPY --chown=agentuser:agentsg public/ ./public

# Switch to the non-root application user for execution
USER agentuser

# Expose HTTP dashboard port
EXPOSE 3000

# Define start command
CMD ["npm", "start"]
