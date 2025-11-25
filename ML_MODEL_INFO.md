# ML Model Information

## Password
The ML model viewer password is: `adminML2024!`

## Features Implemented

### 1. MongoDB Connection Fix
- Changed from hardcoded MongoDB Atlas connection to local MongoDB
- Added fallback to localhost:27017 for development
- Added proper error handling and logging

### 2. ML Update Notification System
- **Notification appears every 12 days** (configurable via environment variable)
- Shows at the top of admin page when new data is available
- Displays how many days since last update
- Can be dismissed or closed
- **Password-protected ML model viewer** accessible via "View Model" button

### 3. ML Model Viewer
- **Password**: `adminML2024!`
- Displays comprehensive ML model data in JSON format
- Includes model info, categories, training data, performance metrics
- Shows model parameters, feature engineering details, and deployment info
- Styled with terminal-like appearance for cool factor

### 4. API Endpoints Added
- `GET /api/ml/update-status` - Check if ML model needs update
- `POST /api/ml/dismiss-notification` - Dismiss update notification
- `POST /api/ml/view-model` - View ML model data (password protected)

## Environment Variables
You can customize the following in your `.env` file:
- `MONGODB_URI` - MongoDB connection string
- `ADMIN_ML_PASSWORD` - Password for ML model viewer (default: adminML2024!)
- `ML_UPDATE_INTERVAL_DAYS` - Days between update notifications (default: 12)

## Usage
1. Start the server: `npm run dev`
2. Go to `/admin` page
3. Enter admin token to access admin panel
4. If ML update is needed, notification will appear at top
5. Click "View Model" to see ML model data
6. Enter password: `adminML2024!`
7. View comprehensive ML model information in JSON format
