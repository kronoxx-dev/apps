FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node android/app/src/main/assets ./android/app/src/main/assets
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node", "server/server.mjs"]
