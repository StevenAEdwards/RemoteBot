# Use Node.js with Alpine as the base image
FROM node:alpine

# Create the working directory
WORKDIR /app/remotebot

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies from package.json
RUN npm install

# Copy app files
COPY . .

# Expose the port
EXPOSE 3234

# Run app
CMD ["node", "index.js"]