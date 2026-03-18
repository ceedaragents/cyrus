FROM node:20-bookworm-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		bash \
		ca-certificates \
		git \
		ripgrep \
	&& rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex

WORKDIR /workspace

CMD ["bash", "-lc", "trap 'exit 0' TERM INT; while :; do sleep 5; done"]
