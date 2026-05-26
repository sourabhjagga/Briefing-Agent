# ─── STAGE 1: BUILDER ───────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install native build tools for compiling better-sqlite3 native bindings
RUN apk add --no-cache python3 make g++ gcc libc-dev

# Copy package descriptors
COPY package*.json ./

# Install dependencies including native build compilations
RUN npm install --omit=dev

# ─── STAGE 2: RUNTIME ───────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Create application user and runtime directories for data persistence
RUN addgroup -g 10011 -S agentsg && \
    adduser -u 10011 -S agentuser -G agentsg && \
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
