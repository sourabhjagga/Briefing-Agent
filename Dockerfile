# ─── STAGE 1: BUILDER ───────────────────────────────────────────────────
# Use the full official Node.js Debian image that contains pre-configured compilers (g++, python, make)
FROM node:20 AS builder

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install dependencies and force compilation scripts to run as root (foreground-scripts)
# This completely bypasses the NPM privilege-downgrade write permission bug
RUN npm install --omit=dev --foreground-scripts

# ─── STAGE 2: RUNTIME ───────────────────────────────────────────────────
# Use the ultra-slim Debian-slim image for production
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
