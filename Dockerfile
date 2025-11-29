# Use the official lightweight Node.js 20 image
FROM node:20-slim

# Create and change to the application directory
WORKDIR /usr/src/app

# Copy application dependency manifests
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy the rest of the application source code
COPY . .

# Cloud Run expects the container to listen on the port defined by the PORT environment variable
ENV PORT 8080
EXPOSE 8080

# Run the server when the container starts
CMD [ "npm", "start" ]