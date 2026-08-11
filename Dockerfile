# Lingua Franca — single-container Cloud Run image.
# The Express API serves the built client from dist/; all learner state is
# client-held, so the service is stateless and safe to scale to zero.

FROM node:22-slim AS build
WORKDIR /app

# The file: workspace dependency (packages/tools-world) must exist before npm ci.
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY api ./api
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages ./packages
# tsx runs the API from TypeScript source; keep the full install (it is a
# devDependency) rather than maintaining a separate server build step.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api ./api
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/dist ./dist

# Cloud Run injects PORT; server.ts reads it.
CMD ["npx", "tsx", "api/server.ts"]
