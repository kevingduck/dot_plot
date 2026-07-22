# DotChart — self-hosted image.
#
#   docker build -t dotchart .
#   docker run -p 5300:5300 -v dotchart-data:/root/.dotchart \
#     -e DOTCHART_HOSTED=1 -e DOTCHART_PASSWORD=changeme \
#     -e ANTHROPIC_API_KEY=sk-ant-... dotchart
#
# The volume keeps tracked events and saved projects across restarts.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY scanner ./scanner
COPY docs ./docs
COPY server.mjs ./
EXPOSE 5300
CMD ["node", "server.mjs"]
