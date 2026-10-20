FROM node:24-bookworm-slim

RUN corepack enable

# Install baseline dependencies
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     bash ca-certificates git ripgrep vim fd-find tmux \
  && rm -rf /var/lib/apt/lists/*

# Install pi coding agent globally
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# Set up non-root directories and permissions
RUN mkdir -p /home/node/.pi/agent /workspace \
  && chown -R node:node /home/node /workspace

# Switch execution context to the unprivileged user
USER node
WORKDIR /workspace

COPY --chown=node:node entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["entrypoint.sh"]
