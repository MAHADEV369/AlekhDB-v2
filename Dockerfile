# Dockerfile for AlekhDB Core Express Node API Gateway
FROM node:18-alpine

WORKDIR /app

# Copy dependency configuration
COPY package*.json ./

# Install packages
RUN npm install

# Copy all source files
COPY . .

# Environment variable to inform engine it's inside Docker
ENV DOCKER_CONTAINER=true
ENV PORT=3000
ENV MULTIMODAL_URL=http://alekhdb-multimodal:8000

EXPOSE 3000

# Start API Gateway
CMD ["npm", "run", "api"]
