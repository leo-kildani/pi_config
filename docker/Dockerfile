FROM node:24-bookworm-slim

RUN corepack enable

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git ripgrep vim fd-find tmux \
  && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
  case "$(uname -m)" in \
    x86_64) miniconda_arch=x86_64 ;; \
    aarch64) miniconda_arch=aarch64 ;; \
    *) echo >&2 "Unsupported architecture: $(uname -m)"; exit 1 ;; \
  esac; \
  curl -fsSL "https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-${miniconda_arch}.sh" -o /tmp/miniconda.sh; \
  bash /tmp/miniconda.sh -b -p /opt/conda; \
  rm /tmp/miniconda.sh
ENV PATH="/opt/conda/bin:${PATH}"
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

WORKDIR /root

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["entrypoint.sh"]

