# --- Build stage ---
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite bakes env vars in at BUILD time, not runtime, so this must be
# passed as a build-arg (Render: set it as a "Build Argument" or plain
# Environment Variable on the static/docker service -> it gets picked up
# by the build command automatically if using Render's native build,
# but for a pure Docker deploy you pass it explicitly like this):
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# --- Serve stage ---
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
