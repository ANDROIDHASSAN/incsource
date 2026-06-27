# syntax=docker/dockerfile:1

###############################################################################
# Stage 1: build
# Compile the Vite + React app into static assets (dist/).
###############################################################################
FROM node:22-alpine AS build

WORKDIR /app

# Cache deps unless the manifest/lockfile changes.
COPY package.json package-lock.json* ./
RUN npm ci

# Copy the rest of the source and produce the production build.
COPY . .
RUN npm run build

###############################################################################
# Stage 2: serve
# Serve the static build with nginx and proxy /api/ to the API service.
###############################################################################
FROM nginx:alpine AS serve

# Custom nginx config: SPA fallback + reverse proxy to the "server" service.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the compiled static assets from the build stage.
COPY --from=build /app/dist /usr/share/nginx/html

# nginx listens on port 80 inside the container.
EXPOSE 80

# nginx:alpine already defines a sensible CMD; keep it explicit for clarity.
CMD ["nginx", "-g", "daemon off;"]
