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
COPY lib ./lib

# Static PWA
COPY index.html manifest.json style.css ./
COPY api.js app.js firebase-init.js firebase-messaging-sw.js learning-data.js \
     learning-tools.js live-bank-loader.js mcq-cloud-sync.js mcq-progress-share.js \
     mentor-host.js service-worker.js web-tests.js ./
COPY practice-vendor ./practice-vendor
COPY practice-client.js receipt-voice.js receipt-audio-vault.js workbook.html workbook-core.js workbook.js ./
COPY assets ./assets
COPY icon ./icon

# `gcloud run deploy --source` preserves local source permissions. A restrictive
# shell umask can otherwise copy root-owned 0600 JavaScript files into the
# image, where the unprivileged Node user cannot read them (EACCES at startup).
RUN chmod -R a+rX /app

USER node

EXPOSE 8080

CMD ["node", "server.js"]
