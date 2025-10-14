FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install dependencies (include dev to allow prisma generate). Use install instead of ci because lockfile is updated later.
RUN npm install

# Bundle app source
COPY . .

# Generate Prisma client
RUN npx prisma generate

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "./src/app/start.js"]


