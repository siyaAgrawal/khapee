# One Node process serving the API and the built app — the whole point, since
# one process means one database and a code generated at the counter reaches the
# customer's phone. Works on Koyeb, Fly, Cloud Run, Northflank, or any container
# host; nothing in here is vendor-specific.

FROM node:22-slim AS build
WORKDIR /app

# better-sqlite3 is a native module. Prebuilt binaries cover this image, but the
# toolchain is here so a version without one still compiles rather than failing
# the deploy.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app

ENV NODE_ENV=production
# A container's filesystem starts empty, so seed the catalogue and its photos
# from the committed snapshot on boot. Without this the app comes up blank.
ENV KHAPEE_SEED=snapshot

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/data/snapshot.db ./data/snapshot.db
COPY --from=build /app/data/snapshot-uploads ./data/snapshot-uploads
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json /app/tsconfig.server.json ./

# The host injects PORT; server/index.ts honours it in production.
EXPOSE 8000
CMD ["npm", "start"]
