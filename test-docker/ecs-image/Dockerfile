FROM public.ecr.aws/docker/library/node:20-slim

ARG BUILD_ARG_TOKEN
ENV BUILD_ARG_TOKEN=${BUILD_ARG_TOKEN}

WORKDIR /app
COPY entry.js /app/entry.js

CMD ["node", "/app/entry.js"]
