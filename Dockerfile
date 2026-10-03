# Student dashboard on Cloud Run: static PWA + /api/proxy + /api/mentor gateway.
#
# The server (server.js) uses only the Node standard library, so there is no
# npm install and no build step — the image is just Node plus the app files.
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

WORKDIR /app

# Server + the Vercel function it wraps
COPY package.json server.js ./
COPY api ./api

# Static PWA
COPY index.html manifest.json style.css ./
COPY api.js app.js firebase-init.js firebase-messaging-sw.js learning-data.js \
     learning-tools.js live-bank-loader.js mcq-cloud-sync.js mcq-progress-share.js \
     mentor-host.js service-worker.js web-tests.js ./
COPY assets ./assets
COPY icon ./icon

USER node

EXPOSE 8080

CMD ["node", "server.js"]
