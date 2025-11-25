# MongoDB Setup Instructions

## Option 1: Install MongoDB Locally (Recommended)

### Windows:
1. Download MongoDB Community Server from: https://www.mongodb.com/try/download/community
2. Install MongoDB
3. Start MongoDB service:
   ```bash
   net start MongoDB
   ```
4. The server will automatically connect to `mongodb://localhost:27017/live_news_map`

## Option 2: Use MongoDB Atlas (Cloud)

1. Go to https://www.mongodb.com/atlas
2. Create a free account
3. Create a new cluster
4. Get your connection string
5. Create a `.env` file with:
   ```env
   MONGODB_URI=your-mongodb-atlas-connection-string
   ```

## Option 3: Use the Fallback System

The server now has a fallback system that will try:
1. Your .env MONGODB_URI (if set)
2. Local MongoDB (localhost:27017)
3. Default Atlas cluster

## Quick Start

1. **For local MongoDB**: Install MongoDB and start the service
2. **For Atlas**: Create `.env` file with your Atlas connection string
3. Run: `npm run dev`

The server will automatically try different connection options until one works!
