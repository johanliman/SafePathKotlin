FROM node:20-alpine

WORKDIR /app

# Copy project files
COPY . .

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Start SafePath server
CMD ["node", "web/server.js"]
