FROM node:24-bookworm-slim

RUN corepack enable

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep vim fd-find tmux \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

WORKDIR /root

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["entrypoint.sh"]

