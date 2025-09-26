# Build client
FROM node:latest AS build
WORKDIR /app
COPY client/package.json client/package-lock.json* ./client/
COPY client ./client
WORKDIR /app/client
RUN npm install
RUN npm run build

# Runtime image
FROM node:latest
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server.js ./
COPY --from=build /app/client/dist ./client/dist
RUN npm install --production
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
