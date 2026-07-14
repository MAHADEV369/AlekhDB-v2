FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages for benchmark servers
RUN pip3 install --no-cache-dir --break-system-packages \
    requests

# Set working directory
WORKDIR /app

# Install Node dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Make benchmark scripts executable
RUN chmod +x paper/scripts/*.js paper/scripts/*.py paper/agent-task/*.js

# Default command: run the full benchmark suite
CMD ["bash", "-c", "echo 'AlekhDB paper reproducibility image ready. See paper/README.md for instructions.'"]
