# syntax=docker/dockerfile:1

###############################################################################
# Stage 1: dependencies
# Install production-only dependencies in a reproducible way using the lockfile.
###############################################################################
FROM node:22-alpine AS deps

WORKDIR /app

# Copy only the manifest + lockfile so this layer is cached unless deps change.
COPY package.json package-lock.json* ./

# Install exactly what's in the lockfile, excluding devDependencies.
RUN npm ci --omit=dev

###############################################################################
# Stage 2: runtime
# Minimal image containing only the app source and production node_modules.
###############################################################################
FROM node:22-alpine AS runtime

# Run as production so libraries (e.g. Express) skip dev behaviour.
ENV NODE_ENV=production

WORKDIR /app

# Bring in the pre-installed production dependencies.
COPY --from=deps /app/node_modules ./node_modules

# Copy application source. (.dockerignore keeps secrets/tests/etc. out.)
COPY . .

# The server listens on PORT (default 4000).
EXPOSE 4000

# Drop root privileges: the official node image ships a non-root "node" user.
USER node

# Liveness/readiness probe hitting the app's health endpoint.
# Uses Node's built-in http client so no extra tools (curl/wget) are required.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.PORT||4000;require('http').get('http://127.0.0.1:'+p+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Start the API.
CMD ["node", "src/index.js"]
