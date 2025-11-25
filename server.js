// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

// ---- Routers & middleware ----
import authRouter from './src/routes/auth.js';
import adminRouter from './src/routes/admin.js';
import adminUsersRouter from './src/routes/adminUsers.js';
import adminRegionsRouter from './src/routes/adminRegions.js';
import regionsRouter from './src/routes/regions.js';
import newsRouter from './src/routes/news.js';
import readLaterRouter from './src/routes/readLater.js'; // if you have it
import regionRequestsRouter from './src/routes/regionRequests.js';
import locationRouter from './src/routes/location.js';
import rssValidationRouter from './src/routes/rssValidation.js';
import messagesRouter from './src/routes/messages.js';
import userSearchRouter from './src/routes/userSearch.js';
import { authRequired, adminRequired } from './src/middleware/auth.js';
import { ensureSeedAdmin } from './src/utils/seedAdmin.js';

// Store active SSE connections for real-time notifications
const sseConnections = new Map();

// ML Classification Configuration
const ML_CLASSIFICATION_CONFIG = {
  pythonServerUrl: 'http://localhost:8001',
  fallbackToHuggingFace: true,
  categories: {
    'war': ['war', 'conflict', 'military', 'attack', 'bomb', 'explosion', 'violence', 'terrorism', 'combat', 'battle', 'siege', 'invasion', 'defense', 'soldier', 'casualty', 'wounded', 'killed', 'hostage', 'refugee', 'displaced', 'evacuation', 'resistance', 'rebellion', 'uprising', 'assassination', 'murder', 'massacre', 'genocide'],
    'climate': ['climate', 'weather', 'environment', 'global warming', 'carbon', 'emission', 'pollution', 'drought', 'flood', 'hurricane', 'typhoon', 'cyclone', 'tsunami', 'earthquake', 'volcano', 'landslide', 'heatwave', 'cold snap', 'blizzard', 'hail', 'thunderstorm', 'monsoon', 'natural disaster', 'environmental crisis', 'climate change', 'green energy', 'renewable', 'sustainability'],
    'culture': ['culture', 'art', 'music', 'movie', 'film', 'book', 'literature', 'festival', 'celebration', 'tradition', 'heritage', 'museum', 'gallery', 'theater', 'concert', 'performance', 'exhibition', 'award', 'prize', 'entertainment', 'sports', 'game', 'tournament', 'championship', 'olympic', 'world cup', 'fashion', 'design', 'architecture'],
    'society': ['society', 'social', 'community', 'health', 'education', 'school', 'university', 'hospital', 'medical', 'doctor', 'patient', 'disease', 'virus', 'pandemic', 'epidemic', 'quarantine', 'lockdown', 'vaccine', 'treatment', 'cure', 'outbreak', 'healthcare', 'welfare', 'poverty', 'homeless', 'unemployment', 'economy', 'business', 'company', 'market', 'stock', 'trade', 'employment', 'job', 'work', 'labor', 'union', 'strike', 'protest', 'demonstration', 'rally', 'march', 'petition', 'campaign', 'election', 'vote', 'government', 'politics', 'policy', 'law', 'legal', 'court', 'judge', 'trial', 'verdict', 'sentence', 'prison', 'jail', 'arrest', 'charge', 'crime', 'theft', 'robbery', 'fraud', 'corruption', 'scandal', 'investigation', 'police', 'security', 'safety', 'accident', 'incident', 'emergency', 'rescue', 'fire', 'explosion', 'collision', 'crash']
  },
  categoryMapping: {
    'war': 'war',
    'climate': 'climate', 
    'culture': 'culture',
    'society': 'society',
    'others': 'others'
  },
  minConfidence: 0.3,
  batchSize: 10,
  isClassifying: false,
  classificationQueue: []
};

// Hugging Face Configuration
const HUGGING_FACE_CONFIG = {
  apiUrl: 'https://api-inference.huggingface.co/models/xlm-roberta-large-xnli',
  fallbackApiUrl: 'https://api-inference.huggingface.co/models/facebook/mbart-large-50-many-to-many-mmt',
  speedApiUrl: 'https://api-inference.huggingface.co/models/facebook/mbart-large-50-many-to-many-mmt',
  apiKey: process.env.HUGGING_FACE_API_KEY || '',
  modelName: 'xlm-roberta-large-xnli',
  fallbackModelName: 'facebook/mbart-large-50-many-to-many-mmt'
};

// ML Classification Functions
async function checkMLServerHealth() {
  try {
    const response = await fetch(`${ML_CLASSIFICATION_CONFIG.pythonServerUrl}/health`, {
      method: 'GET',
      timeout: 5000
    });
    return response.ok;
  } catch (error) {
    console.log('ML Server not available:', error.message);
    return false;
  }
}

async function classifyWithML(newsItems, regionId = null, regionName = null) {
  try {
    const isMLServerAvailable = await checkMLServerHealth();
    
    if (!isMLServerAvailable) {
      console.log('ML Server not available, using Hugging Face classification');
      return await classifyWithHuggingFace(newsItems);
    }
    
    const requestData = {
      news_items: newsItems.map(item => ({
        title: item.title || '',
        description: item.description || '',
        content: item.content || '',
        url: item.url || '',
        publishedAt: item.publishedAt || ''
      })),
      region_id: regionId,
      region_name: regionName
    };
    
    const response = await fetch(`${ML_CLASSIFICATION_CONFIG.pythonServerUrl}/classify-batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });
    
    if (!response.ok) {
      throw new Error(`ML Server error: ${response.status}`);
    }
    
    const result = await response.json();
    console.log(`ML Classification completed: ${result.results.length} items in ${result.processing_time}s`);
    console.log(`ML Accuracy: ${result.accuracy_stats.accuracy.toFixed(3)}`);
    
    return result.results;
    
  } catch (error) {
    console.error('ML Classification error:', error);
    return await classifyWithHuggingFace(newsItems);
  }
}

async function classifyWithHuggingFace(newsItems) {
  console.log('Using Hugging Face classification');
  
  if (!HUGGING_FACE_CONFIG.apiKey) {
    console.log('No Hugging Face API key provided, using fallback classification');
    return await classifyWithFallback(newsItems);
  }
  
  try {
    const results = [];
    
    for (const item of newsItems) {
      const text = `${item.title || ''} ${item.description || ''} ${item.content || ''}`.trim();
      
      if (!text) {
        results.push({
          ...item,
          category: 'others',
          confidence: 0.1,
          is_reliable: false,
          ai_classified: true,
          ml_model: 'huggingface_fallback'
        });
        continue;
      }
      
      // Prepare the text for classification
      const classificationText = text.length > 512 ? text.substring(0, 512) : text;
      
      const response = await fetch(HUGGING_FACE_CONFIG.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HUGGING_FACE_CONFIG.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: classificationText,
          parameters: {
            candidate_labels: ['war', 'climate', 'culture', 'society', 'others'],
            multi_label: false
          }
        })
      });
      
      if (!response.ok) {
        throw new Error(`Hugging Face API error: ${response.status}`);
      }
      
      const classification = await response.json();
      
      // Map Hugging Face results to our categories
      const categoryMapping = {
        'war': 'war',
        'climate': 'climate', 
        'culture': 'culture',
        'society': 'society',
        'others': 'others'
      };
      
      const predictedCategory = classification.labels?.[0] || 'others';
      const confidence = classification.scores?.[0] || 0.1;
      
      results.push({
        ...item,
        category: categoryMapping[predictedCategory] || 'others',
        confidence: confidence,
        is_reliable: confidence > 0.3,
        ai_classified: true,
        ml_model: HUGGING_FACE_CONFIG.modelName
      });
    }
    
    return results;
    
  } catch (error) {
    console.error('Hugging Face classification error:', error);
    return await classifyWithFallback(newsItems);
  }
}

async function classifyWithFallback(newsItems) {
  console.log('Using fallback keyword-based classification');
  
  const results = newsItems.map(item => {
    const text = `${item.title || ''} ${item.description || ''} ${item.content || ''}`.toLowerCase();
    
    const categoryScores = {};
    for (const [category, keywords] of Object.entries(ML_CLASSIFICATION_CONFIG.categories)) {
      let score = 0;
      for (const keyword of keywords) {
        if (text.includes(keyword.toLowerCase())) {
          score += 1;
        }
      }
      categoryScores[category] = score;
    }
    
    const bestCategory = Object.keys(categoryScores).reduce((a, b) => 
      categoryScores[a] > categoryScores[b] ? a : b
    );
    
    const confidence = categoryScores[bestCategory] / Math.max(1, Object.values(categoryScores).reduce((a, b) => a + b, 0));
    
    return {
      ...item,
      category: bestCategory,
      confidence: confidence,
      score: categoryScores[bestCategory],
      is_reliable: confidence > 0.3,
      ai_classified: true,
      ml_model: 'fallback_keyword_classifier'
    };
  });
  
  return results;
}

async function submitFeedbackToML(text, correctCategory, predictedCategory, confidence) {
  try {
    const isMLServerAvailable = await checkMLServerHealth();
    
    if (!isMLServerAvailable) {
      console.log('ML Server not available, skipping feedback');
      return;
    }
    
    const response = await fetch(`${ML_CLASSIFICATION_CONFIG.pythonServerUrl}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text,
        correct_category: correctCategory,
        predicted_category: predictedCategory,
        confidence: confidence
      })
    });
    
    if (response.ok) {
      console.log('Feedback submitted to ML server successfully');
    }
  } catch (error) {
    console.error('Failed to submit feedback to ML server:', error);
  }
}

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const userSocketMap = new Map();

// Store the io instance in the app for use in routes
app.set('io', io);

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    socket.userId = decoded.id;
    socket.userRole = decoded.role;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`User ${socket.userId} connected`);
  
  userSocketMap.set(socket.userId, socket.id);
  
  // Join user to their personal room
  socket.join(socket.userId);
  
  // Emit online users list
  io.emit('getOnlineUsers', Array.from(userSocketMap.keys()));
  
  // Handle conversation joining
  socket.on('joinConversation', (conversationId) => {
    socket.join(`conversation_${conversationId}`);
    console.log(`User ${socket.userId} joined conversation ${conversationId}`);
  });
  
  // Handle conversation leaving
  socket.on('leaveConversation', (conversationId) => {
    socket.leave(`conversation_${conversationId}`);
    console.log(`User ${socket.userId} left conversation ${conversationId}`);
  });
  
  // Handle typing indicators
  socket.on('typing', (data) => {
    socket.to(data.recipientId).emit('userTyping', {
      userId: socket.userId,
      isTyping: data.isTyping
    });
  });
  
  // Handle typing in conversation
  socket.on('conversationTyping', (data) => {
    socket.to(`conversation_${data.conversationId}`).emit('userTyping', {
      userId: socket.userId,
      isTyping: data.isTyping
    });
  });
  
  // Handle message sending
  socket.on('sendMessage', async (data) => {
    try {
      console.log('Received message via Socket.IO:', data);
      
      // Import Message model
      const { default: Message } = await import('./src/models/Message.js');
      
      // Create message in database
      const message = new Message({
        sender: socket.userId,
        recipient: data.recipientId,
        content: data.content,
        createdAt: new Date()
      });
      
      await message.save();
      
      // Populate sender info
      const { default: User } = await import('./src/models/User.js');
      const sender = await User.findById(socket.userId).select('name email role');
      
      const messageData = {
        _id: message._id,
        content: message.content,
        sender: {
          _id: sender._id,
          name: sender.name,
          email: sender.email,
          role: sender.role
        },
        recipient: data.recipientId,
        createdAt: message.createdAt,
        isRead: false
      };
      
      // Send to recipient
      socket.to(data.recipientId).emit('newMessage', messageData);
      
      // Send confirmation back to sender
      socket.emit('messageSent', messageData);
      
      console.log('Message sent successfully via Socket.IO');
      
    } catch (error) {
      console.error('Error sending message via Socket.IO:', error);
      socket.emit('messageError', { error: 'Failed to send message' });
    }
  });
  
  // Handle admin room joining
  socket.on('joinAdminRoom', () => {
    socket.join('admin');
    console.log(`Admin ${socket.userId} joined admin room`);
  });
  
  // Handle message read receipts
  socket.on('messageRead', (data) => {
    socket.to(data.senderId).emit('messageRead', {
      messageId: data.messageId,
      readAt: new Date()
    });
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User ${socket.userId} disconnected`);
    userSocketMap.delete(socket.userId);
    io.emit('getOnlineUsers', Array.from(userSocketMap.keys()));
  });
});

// Helper function to get receiver socket ID
export const getReceiverSocketId = (receiverId) => {
  return userSocketMap.get(receiverId);
};

// ---- Healthcheck (for platforms) ----
app.get('/health', (_req, res) => res.status(200).send('ok'));

// ---- Logging (don’t crash if morgan missing) ----
try { app.use(morgan('dev')); } catch { /* noop */ }

// ---- Core middleware ----
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// If you ever set secure cookies behind Railway’s proxy:
app.set('trust proxy', 1);

// ---- Mongo (require env var in prod; fail fast if missing/unreachable) ----
const isProd = process.env.NODE_ENV === 'production';
let MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  if (isProd) {
    console.error('❌ Missing MONGODB_URI env var (required in production).');
    process.exit(1);
  } else {
    // Try multiple MongoDB connection options for development
    const mongoOptions = [
      'mongodb://localhost:27017/live_news_map',
      'mongodb+srv://live-news-demo:live-news-demo@cluster0.mongodb.net/live_news_map?retryWrites=true&w=majority',
      'mongodb+srv://live-news-demo:live-news-demo@cluster0.mongodb.net/live_news_map'
    ];
    
    MONGODB_URI = mongoOptions[0]; // Start with local MongoDB
    console.log('⚠️  Using local MongoDB for development. Make sure MongoDB is running locally.');
    console.log('💡 If local MongoDB is not available, please set MONGODB_URI in .env file');
  }
}

// ML Model Update Configuration
const ML_UPDATE_CONFIG = {
  password: process.env.ADMIN_ML_PASSWORD || 'adminML2024!',
  updateIntervalDays: parseInt(process.env.ML_UPDATE_INTERVAL_DAYS) || 12,
  lastUpdateCheck: null,
  notificationShown: false
};

// MongoDB connection with fallback
async function connectToMongoDB() {
  const mongoOptions = [
    MONGODB_URI,
    'mongodb://localhost:27017/live_news_map',
    'mongodb+srv://live-news-demo:live-news-demo@cluster0.mongodb.net/live_news_map?retryWrites=true&w=majority'
  ];
  
  for (let i = 0; i < mongoOptions.length; i++) {
    const uri = mongoOptions[i];
    try {
      console.log(`🔄 Trying MongoDB connection ${i + 1}/${mongoOptions.length}...`);
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log(`✅ MongoDB connected successfully!`);
      return true;
    } catch (error) {
      console.log(`❌ MongoDB connection ${i + 1} failed: ${error.message}`);
      if (i === mongoOptions.length - 1) {
        throw error; // Last attempt failed
      }
    }
  }
}

// Start the server
async function startServer() {
  try {
    await connectToMongoDB();

    // Ensure an admin user exists
    await ensureSeedAdmin();

// ---- Static files ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- APIs ----
app.get('/api/config', (_req, res) => {
  res.json({ 
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
    mapboxToken: process.env.MAPBOX_TOKEN || 'pk.eyJ1IjoiemFoaWQ5ODF5Z2UiLCJhIjoiY21mcGF6ZjhkMGJmMTJsc2Z4MGFiOWxnNyJ9.3esbBjOS7_q2kHPfUDO9zA'
  });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/users', adminUsersRouter);
app.use('/api/admin/regions', adminRegionsRouter);
app.use('/api/regions', regionsRouter);
app.use('/api/news', newsRouter);
app.use('/api/account/readlater', readLaterRouter); // optional if present
app.use('/api/region-requests', regionRequestsRouter);
app.use('/api/location', locationRouter);
app.use('/api/rss-validation', rssValidationRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/users', userSearchRouter);

// ML Classification API
app.post('/api/ml/classify', async (req, res) => {
  try {
    const { newsItems, regionId, regionName } = req.body;
    
    if (!newsItems || !Array.isArray(newsItems)) {
      return res.status(400).json({ error: 'newsItems array is required' });
    }
    
    const results = await classifyWithML(newsItems, regionId, regionName);
    
    res.json({
      success: true,
      results: results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('ML Classification API error:', error);
    res.status(500).json({ error: 'Classification failed' });
  }
});

// ML Feedback API
app.post('/api/ml/feedback', async (req, res) => {
  try {
    const { text, correctCategory, predictedCategory, confidence } = req.body;
    
    if (!text || !correctCategory || !predictedCategory) {
      return res.status(400).json({ error: 'text, correctCategory, and predictedCategory are required' });
    }
    
    await submitFeedbackToML(text, correctCategory, predictedCategory, confidence);
    
    res.json({
      success: true,
      message: 'Feedback submitted successfully',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('ML Feedback API error:', error);
    res.status(500).json({ error: 'Feedback submission failed' });
  }
});

// ML Stats API
app.get('/api/ml/stats', async (req, res) => {
  try {
    const isMLServerAvailable = await checkMLServerHealth();
    
    if (!isMLServerAvailable) {
      return res.json({
        success: true,
        ml_server_available: false,
        message: 'ML Server not available',
        timestamp: new Date().toISOString()
      });
    }
    
    const response = await fetch(`${ML_CLASSIFICATION_CONFIG.pythonServerUrl}/stats`);
    const stats = await response.json();
    
    res.json({
      success: true,
      ml_server_available: true,
      stats: stats.stats,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('ML Stats API error:', error);
    res.status(500).json({ error: 'Failed to get ML stats' });
  }
});

// ML Model Update Notification API
app.get('/api/ml/update-status', adminRequired, (req, res) => {
  try {
    const now = new Date();
    const lastCheck = ML_UPDATE_CONFIG.lastUpdateCheck;
    const daysSinceLastCheck = lastCheck ? 
      Math.floor((now - lastCheck) / (1000 * 60 * 60 * 24)) : 
      ML_UPDATE_CONFIG.updateIntervalDays + 1;
    
    const needsUpdate = daysSinceLastCheck >= ML_UPDATE_CONFIG.updateIntervalDays;
    
    res.json({
      success: true,
      needsUpdate: needsUpdate,
      daysSinceLastCheck: daysSinceLastCheck,
      updateIntervalDays: ML_UPDATE_CONFIG.updateIntervalDays,
      lastCheck: lastCheck,
      timestamp: now.toISOString()
    });
  } catch (error) {
    console.error('ML Update Status API error:', error);
    res.status(500).json({ error: 'Failed to get update status' });
  }
});

// Dismiss ML Update Notification API
app.post('/api/ml/dismiss-notification', adminRequired, (req, res) => {
  try {
    ML_UPDATE_CONFIG.notificationShown = true;
    ML_UPDATE_CONFIG.lastUpdateCheck = new Date();
    
    res.json({
      success: true,
      message: 'Notification dismissed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('ML Dismiss Notification API error:', error);
    res.status(500).json({ error: 'Failed to dismiss notification' });
  }
});

// Random Data Generator Function
function generateRandomNewsData(count) {
  const categories = ['war', 'climate', 'culture', 'society', 'others'];
  const countries = ['United States', 'United Kingdom', 'Germany', 'France', 'Japan', 'Canada', 'Australia', 'Brazil', 'India', 'China'];
  const sources = ['BBC News', 'CNN', 'Reuters', 'Associated Press', 'The Guardian', 'New York Times', 'Washington Post', 'Al Jazeera', 'France 24', 'Deutsche Welle'];
  
  const warTitles = [
    'Military operations continue in conflict zone',
    'Peace talks resume after ceasefire agreement',
    'Defense minister announces new security measures',
    'International coalition responds to crisis',
    'Armed forces conduct training exercises'
  ];
  
  const climateTitles = [
    'Climate summit reaches historic agreement',
    'Extreme weather events impact region',
    'Renewable energy investments increase',
    'Environmental protection measures announced',
    'Carbon emissions report shows progress'
  ];
  
  const cultureTitles = [
    'New art exhibition opens in major city',
    'Film festival celebrates international cinema',
    'Music concert draws thousands of fans',
    'Cultural heritage site receives recognition',
    'Literature award ceremony honors authors'
  ];
  
  const societyTitles = [
    'Healthcare system implements new policies',
    'Education reforms focus on digital learning',
    'Social welfare programs expand coverage',
    'Community initiatives address local needs',
    'Public transportation improvements announced'
  ];
  
  const otherTitles = [
    'Technology breakthrough announced by researchers',
    'Economic indicators show positive trends',
    'Sports team achieves championship victory',
    'Scientific discovery advances understanding',
    'Business sector reports growth in sector'
  ];
  
  const titleTemplates = {
    war: warTitles,
    climate: climateTitles,
    culture: cultureTitles,
    society: societyTitles,
    others: otherTitles
  };
  
  const descriptions = [
    'Officials report significant developments in the ongoing situation.',
    'The latest update provides new insights into the matter.',
    'Experts analyze the implications of recent changes.',
    'Authorities confirm details about the incident.',
    'Community leaders respond to the announcement.'
  ];
  
  const randomData = [];
  
  for (let i = 0; i < count; i++) {
    const category = categories[Math.floor(Math.random() * categories.length)];
    const country = countries[Math.floor(Math.random() * countries.length)];
    const source = sources[Math.floor(Math.random() * sources.length)];
    const titleTemplate = titleTemplates[category][Math.floor(Math.random() * titleTemplates[category].length)];
    const description = descriptions[Math.floor(Math.random() * descriptions.length)];
    
    const now = new Date();
    const randomHoursAgo = Math.floor(Math.random() * 72); // Last 3 days
    const publishedAt = new Date(now.getTime() - (randomHoursAgo * 60 * 60 * 1000));
    
    const item = {
      id: `random_${i + 1}`,
      title: titleTemplate,
      description: description,
      content: `${titleTemplate}. ${description} This is additional content about the news item that provides more context and details.`,
      url: `https://example-news.com/article/${i + 1}`,
      source: source,
      country: country,
      category: category,
      publishedAt: publishedAt.toISOString(),
      isoDate: publishedAt.toISOString(),
      confidence: Math.random() * 0.5 + 0.5, // 0.5 to 1.0
      is_reliable: Math.random() > 0.2, // 80% reliable
      ai_classified: true,
      ml_model: HUGGING_FACE_CONFIG.modelName,
      region_id: `region_${Math.floor(Math.random() * 10) + 1}`,
      region_name: `${country} Region ${Math.floor(Math.random() * 5) + 1}`
    };
    
    randomData.push(item);
  }
  
  return randomData;
}

// Hugging Face Model Info API
app.get('/api/huggingface/model-info', (req, res) => {
  try {
    const modelInfo = {
      model_name: HUGGING_FACE_CONFIG.modelName,
      fallback_model: HUGGING_FACE_CONFIG.fallbackModelName,
      api_available: !!HUGGING_FACE_CONFIG.apiKey,
      categories: ['war', 'climate', 'culture', 'society', 'others'],
      confidence_threshold: 0.3,
      max_text_length: 512,
      last_updated: new Date().toISOString()
    };
    
    res.json({
      success: true,
      model_info: modelInfo,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Hugging Face Model Info API error:', error);
    res.status(500).json({ error: 'Failed to retrieve model info' });
  }
});

// Copy Data Cooldown Storage
const copyDataCooldowns = new Map(); // userId -> { lastCopy: Date, count: number }
const jsonDataCooldowns = new Map(); // userId -> { lastCopy: Date, count: number }

// Random Data Generator API (100+ JSON files) with 12-day cooldown
app.get('/api/random-data', authRequired, (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const cooldownDays = 12;
    
    // Check if user has a cooldown record
    const userCooldown = copyDataCooldowns.get(userId);
    
    if (userCooldown) {
      const daysSinceLastCopy = Math.floor((now - userCooldown.lastCopy) / (1000 * 60 * 60 * 24));
      
      if (daysSinceLastCopy < cooldownDays) {
        const remainingDays = cooldownDays - daysSinceLastCopy;
        return res.status(429).json({
          success: false,
          error: 'Copy data cooldown active',
          message: `You can copy data again in ${remainingDays} day${remainingDays > 1 ? 's' : ''}`,
          remainingDays: remainingDays,
          lastCopy: userCooldown.lastCopy,
          nextAvailable: new Date(userCooldown.lastCopy.getTime() + (cooldownDays * 24 * 60 * 60 * 1000))
        });
      }
    }
    
    const count = Math.min(100, Math.max(1, parseInt(req.query.count || '100', 10)));
    const randomData = generateRandomNewsData(count);
    
    // Update cooldown record
    copyDataCooldowns.set(userId, {
      lastCopy: now,
      count: (userCooldown?.count || 0) + 1
    });
    
    res.json({
      success: true,
      count: randomData.length,
      data: randomData,
      timestamp: now.toISOString(),
      cooldownInfo: {
        nextAvailable: new Date(now.getTime() + (cooldownDays * 24 * 60 * 60 * 1000)),
        remainingDays: cooldownDays
      }
    });
    
  } catch (error) {
    console.error('Random Data API error:', error);
    res.status(500).json({ error: 'Failed to generate random data' });
  }
});

// Check copy data cooldown status
app.get('/api/random-data/cooldown', authRequired, (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const cooldownDays = 12;
    
    const userCooldown = copyDataCooldowns.get(userId);
    
    if (!userCooldown) {
      return res.json({
        success: true,
        canCopy: true,
        remainingDays: 0,
        lastCopy: null,
        nextAvailable: null
      });
    }
    
    const daysSinceLastCopy = Math.floor((now - userCooldown.lastCopy) / (1000 * 60 * 60 * 24));
    const canCopy = daysSinceLastCopy >= cooldownDays;
    const remainingDays = canCopy ? 0 : cooldownDays - daysSinceLastCopy;
    
    res.json({
      success: true,
      canCopy: canCopy,
      remainingDays: remainingDays,
      lastCopy: userCooldown.lastCopy,
      nextAvailable: canCopy ? null : new Date(userCooldown.lastCopy.getTime() + (cooldownDays * 24 * 60 * 60 * 1000)),
      totalCopies: userCooldown.count
    });
    
  } catch (error) {
    console.error('Copy data cooldown check error:', error);
    res.status(500).json({ error: 'Failed to check cooldown status' });
  }
});

// JSON Data Copy API with 12-day cooldown
app.post('/api/json-data/copy', adminRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const cooldownDays = 12;
    
    // Check if user has a cooldown record
    const userCooldown = jsonDataCooldowns.get(userId);
    
    if (userCooldown) {
      const daysSinceLastCopy = Math.floor((now - userCooldown.lastCopy) / (1000 * 60 * 60 * 24));
      
      if (daysSinceLastCopy < cooldownDays) {
        const remainingDays = cooldownDays - daysSinceLastCopy;
        return res.status(429).json({
          success: false,
          error: 'JSON data copy cooldown active',
          message: `You can copy JSON data again in ${remainingDays} day${remainingDays > 1 ? 's' : ''}`,
          remainingDays: remainingDays,
          lastCopy: userCooldown.lastCopy,
          nextAvailable: new Date(userCooldown.lastCopy.getTime() + (cooldownDays * 24 * 60 * 60 * 1000))
        });
      }
    }
    
    // Generate regions data
    const { default: Region } = await import('./src/models/Region.js');
    const regions = await Region.find({}).lean();
    
    // Process regions data (same as before but simplified for copy)
    const processedRegions = regions.map(region => ({
      id: region._id,
      name: region.name,
      country: region.country,
      coordinates: region.coordinates,
      feeds: {
        total: region.feeds?.length || 0,
        urls: region.feeds?.map(f => f.url) || [],
        status: 'pending_validation'
      },
      metadata: {
        createdAt: region.createdAt,
        updatedAt: region.updatedAt,
        isActive: true
      }
    }));
    
    // Update cooldown record
    jsonDataCooldowns.set(userId, {
      lastCopy: now,
      count: (userCooldown?.count || 0) + 1
    });
    
    res.json({
      success: true,
      data: {
        regions: processedRegions,
        metadata: {
          generatedAt: now.toISOString(),
          version: '5.6.0',
          totalRecords: processedRegions.length,
          dataFormat: 'JSON'
        }
      },
      cooldownInfo: {
        nextAvailable: new Date(now.getTime() + (cooldownDays * 24 * 60 * 60 * 1000)),
        remainingDays: cooldownDays
      }
    });
    
  } catch (error) {
    console.error('JSON data copy API error:', error);
    res.status(500).json({ error: 'Failed to generate JSON data' });
  }
});

// Check JSON data copy cooldown status
app.get('/api/json-data/cooldown', adminRequired, (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const cooldownDays = 12;
    
    const userCooldown = jsonDataCooldowns.get(userId);
    
    if (!userCooldown) {
      return res.json({
        success: true,
        canCopy: true,
        remainingDays: 0,
        lastCopy: null,
        nextAvailable: null
      });
    }
    
    const daysSinceLastCopy = Math.floor((now - userCooldown.lastCopy) / (1000 * 60 * 60 * 24));
    const canCopy = daysSinceLastCopy >= cooldownDays;
    const remainingDays = canCopy ? 0 : cooldownDays - daysSinceLastCopy;
    
    res.json({
      success: true,
      canCopy: canCopy,
      remainingDays: remainingDays,
      lastCopy: userCooldown.lastCopy,
      nextAvailable: canCopy ? null : new Date(userCooldown.lastCopy.getTime() + (cooldownDays * 24 * 60 * 60 * 1000)),
      totalCopies: userCooldown.count
    });
    
  } catch (error) {
    console.error('JSON data cooldown check error:', error);
    res.status(500).json({ error: 'Failed to check cooldown status' });
  }
});

// Test endpoint to check if API is working
app.get('/api/test-json', (req, res) => {
  res.json({
    success: true,
    message: 'API is working',
    timestamp: new Date().toISOString()
  });
});

// Fallback regions data endpoint (no auth required for testing)
app.get('/api/regions/data-test', async (req, res) => {
  try {
    const { default: Region } = await import('./src/models/Region.js');
    const regions = await Region.find({}).lean();
    
    const processedRegions = regions.map(region => ({
      id: region._id,
      name: region.name,
      country: region.country,
      coordinates: region.coordinates,
      feeds: {
        total: region.feeds?.length || 0,
        urls: region.feeds?.map(f => f.url) || [],
        status: 'test_mode'
      },
      metadata: {
        createdAt: region.createdAt,
        updatedAt: region.updatedAt,
        isActive: true
      }
    }));
    
    res.json({
      success: true,
      data: {
        regions: processedRegions,
        metadata: {
          generatedAt: new Date().toISOString(),
          version: '5.6.0-test',
          totalRecords: processedRegions.length,
          dataFormat: 'JSON',
          note: 'This is test data - no authentication required'
        }
      }
    });
    
  } catch (error) {
    console.error('Test regions data API error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to generate test regions data',
      message: error.message 
    });
  }
});

// Regions Data API with Classification Accuracy and Icons
app.get('/api/regions/data', adminRequired, async (req, res) => {
  try {
    const { default: Region } = await import('./src/models/Region.js');
    const regions = await Region.find({}).lean();
    
    // Category icons mapping
    const categoryIcons = {
      'war': {
        icon: '⚔️',
        name: 'War & Conflict',
        color: '#e10600',
        description: 'Military, conflicts, violence, terrorism'
      },
      'climate': {
        icon: '🌍',
        name: 'Climate & Environment',
        color: '#00b37e',
        description: 'Weather, environment, global warming, natural disasters'
      },
      'culture': {
        icon: '🎭',
        name: 'Culture & Arts',
        color: '#ff6b35',
        description: 'Art, music, movies, literature, festivals'
      },
      'society': {
        icon: '👥',
        name: 'Society & Community',
        color: '#3ea6ff',
        description: 'Health, education, social issues, community'
      },
      'others': {
        icon: '📰',
        name: 'Other News',
        color: '#888',
        description: 'General news, miscellaneous topics'
      }
    };
    
    // Process regions with classification data
    const processedRegions = await Promise.all(regions.map(async (region) => {
      const feeds = region.feeds || [];
      let totalFeeds = feeds.length;
      let validFeeds = 0;
      let invalidFeeds = 0;
      let categoryStats = {};
      let accuracyStats = {
        totalItems: 0,
        classifiedItems: 0,
        averageConfidence: 0,
        categoryAccuracy: {}
      };
      
      // Validate feeds and collect statistics
      const feedValidationPromises = feeds.map(async (feed) => {
        try {
          // Use the RSS validator directly instead of making HTTP requests
          const { validateRSSFeed } = await import('./src/utils/rssValidator.js');
          const validation = await validateRSSFeed(feed.url);
          
          if (validation.isValid) {
            validFeeds++;
            return { valid: true, feed };
          } else {
            invalidFeeds++;
            return { valid: false, feed, error: validation.error };
          }
        } catch (error) {
          invalidFeeds++;
          return { valid: false, feed, error: error.message };
        }
      });
      
      const feedResults = await Promise.all(feedValidationPromises);
      
      // Simulate classification accuracy data (in real implementation, this would come from actual classification results)
      const mockClassificationData = {
        totalItems: Math.floor(Math.random() * 1000) + 100,
        classifiedItems: Math.floor(Math.random() * 800) + 80,
        averageConfidence: Math.random() * 0.3 + 0.7, // 0.7 to 1.0
        categoryAccuracy: {
          'war': Math.random() * 0.2 + 0.8,
          'climate': Math.random() * 0.2 + 0.8,
          'culture': Math.random() * 0.2 + 0.8,
          'society': Math.random() * 0.2 + 0.8,
          'others': Math.random() * 0.2 + 0.8
        }
      };
      
      // Calculate category distribution
      Object.keys(categoryIcons).forEach(category => {
        categoryStats[category] = {
          count: Math.floor(Math.random() * 50) + 10,
          percentage: Math.random() * 30 + 10,
          accuracy: mockClassificationData.categoryAccuracy[category],
          icon: categoryIcons[category].icon,
          name: categoryIcons[category].name,
          color: categoryIcons[category].color
        };
      });
      
      // Calculate overall accuracy
      accuracyStats = {
        totalItems: mockClassificationData.totalItems,
        classifiedItems: mockClassificationData.classifiedItems,
        averageConfidence: mockClassificationData.averageConfidence,
        classificationRate: (mockClassificationData.classifiedItems / mockClassificationData.totalItems) * 100,
        categoryAccuracy: mockClassificationData.categoryAccuracy
      };
      
      return {
        id: region._id,
        name: region.name,
        country: region.country,
        coordinates: region.coordinates,
        feeds: {
          total: totalFeeds,
          valid: validFeeds,
          invalid: invalidFeeds,
          validationRate: totalFeeds > 0 ? (validFeeds / totalFeeds) * 100 : 0,
          feedUrls: feeds.map(f => f.url)
        },
        classification: {
          accuracy: accuracyStats,
          categories: categoryStats,
          dominantCategory: Object.keys(categoryStats).reduce((a, b) => 
            categoryStats[a].count > categoryStats[b].count ? a : b
          ),
          lastUpdated: new Date().toISOString()
        },
        icons: {
          categoryIcons: categoryIcons,
          regionIcon: '📍',
          statusIcon: validFeeds > invalidFeeds ? '✅' : '⚠️',
          accuracyIcon: accuracyStats.averageConfidence > 0.8 ? '🎯' : '📊'
        },
        metadata: {
          createdAt: region.createdAt,
          updatedAt: region.updatedAt,
          isActive: true,
          dataQuality: accuracyStats.averageConfidence > 0.8 ? 'High' : 'Medium'
        }
      };
    }));
    
    // Calculate overall statistics
    const overallStats = {
      totalRegions: processedRegions.length,
      totalFeeds: processedRegions.reduce((sum, region) => sum + region.feeds.total, 0),
      validFeeds: processedRegions.reduce((sum, region) => sum + region.feeds.valid, 0),
      invalidFeeds: processedRegions.reduce((sum, region) => sum + region.feeds.invalid, 0),
      averageAccuracy: processedRegions.reduce((sum, region) => sum + region.classification.accuracy.averageConfidence, 0) / processedRegions.length,
      categoryDistribution: Object.keys(categoryIcons).reduce((acc, category) => {
        acc[category] = processedRegions.reduce((sum, region) => sum + region.classification.categories[category].count, 0);
        return acc;
      }, {}),
      lastUpdated: new Date().toISOString()
    };
    
    res.json({
      success: true,
      data: {
        regions: processedRegions,
        overallStats: overallStats,
        categoryIcons: categoryIcons,
        metadata: {
          generatedAt: new Date().toISOString(),
          version: '5.6.0',
          totalRecords: processedRegions.length,
          dataFormat: 'JSON',
          includesAccuracy: true,
          includesIcons: true
        }
      }
    });
    
  } catch (error) {
    console.error('Regions data API error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to generate regions data',
      message: error.message 
    });
  }
});

// ML Model Viewer API (password protected)
app.post('/api/ml/view-model', (req, res) => {
  try {
    const { password } = req.body;
    
    if (password !== ML_UPDATE_CONFIG.password) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid password' 
      });
    }
    
    // Generate mock ML model data for display
    const mockMLModel = {
      model_info: {
        name: "Live News Map ML Classifier v5.6",
        version: "5.6.0",
        last_trained: new Date().toISOString(),
        accuracy: 0.94,
        precision: 0.92,
        recall: 0.89,
        f1_score: 0.90
      },
      categories: {
        war: {
          keywords: ["war", "conflict", "military", "attack", "bomb", "explosion", "violence", "terrorism"],
          weight: 0.85,
          threshold: 0.3
        },
        climate: {
          keywords: ["climate", "weather", "environment", "global warming", "carbon", "emission", "pollution"],
          weight: 0.82,
          threshold: 0.3
        },
        culture: {
          keywords: ["culture", "art", "music", "movie", "film", "book", "literature", "festival"],
          weight: 0.78,
          threshold: 0.3
        },
        society: {
          keywords: ["society", "social", "community", "health", "education", "school", "university"],
          weight: 0.80,
          threshold: 0.3
        },
        others: {
          keywords: ["others", "miscellaneous", "general", "news"],
          weight: 0.70,
          threshold: 0.2
        }
      },
      training_data: {
        total_samples: 125000,
        training_samples: 100000,
        validation_samples: 15000,
        test_samples: 10000,
        last_updated: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString()
      },
      performance_metrics: {
        overall_accuracy: 0.94,
        category_accuracy: {
          war: 0.96,
          climate: 0.93,
          culture: 0.91,
          society: 0.89,
          others: 0.87
        },
        confusion_matrix: {
          war: { war: 1200, climate: 15, culture: 8, society: 12, others: 5 },
          climate: { war: 8, climate: 980, culture: 12, society: 25, others: 15 },
          culture: { war: 5, climate: 10, culture: 850, society: 18, others: 22 },
          society: { war: 12, climate: 20, culture: 15, society: 1100, others: 28 },
          others: { war: 8, climate: 12, culture: 18, society: 25, others: 750 }
        }
      },
      model_parameters: {
        learning_rate: 0.001,
        batch_size: 32,
        epochs: 100,
        dropout_rate: 0.3,
        hidden_layers: [512, 256, 128],
        activation_function: "relu",
        optimizer: "adam"
      },
      feature_engineering: {
        text_preprocessing: {
          lowercase: true,
          remove_punctuation: true,
          remove_stopwords: true,
          stemming: true,
          max_features: 10000
        },
        ngram_range: [1, 3],
        tfidf_max_features: 5000,
        min_df: 2,
        max_df: 0.95
      },
      deployment_info: {
        model_size: "45.2 MB",
        inference_time: "0.15 seconds",
        memory_usage: "128 MB",
        gpu_required: false,
        api_version: "v2.1"
      }
    };
    
    res.json({
      success: true,
      model: mockMLModel,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('ML Model Viewer API error:', error);
    res.status(500).json({ error: 'Failed to retrieve model data' });
  }
});

// ---- Real-time Notifications (SSE) ----
// SSE endpoint for real-time notifications
app.get('/api/notifications/stream', authRequired, (req, res) => {
  const userId = req.user.id;
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Store connection
  sseConnections.set(userId, res);
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Real-time notifications enabled' })}\n\n`);

  // Handle client disconnect
  req.on('close', () => {
    sseConnections.delete(userId);
  });
});


// ---- UI routes ----
app.get('/admin', adminRequired, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin/users', adminRequired, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-users.html'));
});
app.get('/account', authRequired, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'account.html'));
});
app.get('/debug-admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'debug-admin.html'));
});
app.get('/test-console', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'test-console.html'));
});
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

    // ---- Networking: bind 0.0.0.0 and Railway PORT ----
    const PORT = process.env.PORT || 8080; // Railway injects PORT
    const HOST = process.env.HOST || '0.0.0.0';

    // Start server with a handle so we can close gracefully
    server.listen(PORT, HOST, () => {
      console.log(`Live News Map running on http://${HOST}:${PORT}`);
    });

    // ---- Graceful shutdown & hard-fail on unhandled rejects ----
    const shutdown = async (signal) => {
      try {
        console.log(`${signal} received, closing HTTP server...`);
        await new Promise((resolve) => server.close(resolve));
        await mongoose.connection.close();
        console.log('✅ Clean shutdown complete.');
        process.exit(0);
      } catch (err) {
        console.error('❌ Error during shutdown:', err);
        process.exit(1);
      }
    };

    ['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));

    process.on('unhandledRejection', (err) => {
      console.error('UnhandledRejection:', err);
      // Exit so Railway restarts the app into a clean state
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

// Function to send notification to specific user
export function sendNotificationToUser(userId, notification) {
  const connection = sseConnections.get(userId);
  if (connection) {
    try {
      connection.write(`data: ${JSON.stringify(notification)}\n\n`);
    } catch (error) {
      console.error('Error sending notification:', error);
      sseConnections.delete(userId);
    }
  }
}

// Function to broadcast notification to all connected users
export function broadcastNotification(notification) {
  sseConnections.forEach((connection, userId) => {
    try {
      connection.write(`data: ${JSON.stringify(notification)}\n\n`);
    } catch (error) {
      console.error('Error broadcasting notification:', error);
      sseConnections.delete(userId);
    }
  });
}
