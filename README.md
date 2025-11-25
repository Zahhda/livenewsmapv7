# live-news-map-v5

## New Features in v5

### 🤗 Hugging Face AI Integration
- **AI-Powered News Classification**: Uses Hugging Face's `xlm-roberta-large-xnli` model for intelligent news categorization
- **Fallback Support**: Automatic fallback to keyword-based classification if Hugging Face API is unavailable
- **Model Viewer**: Real-time model information and status display
- **Categories**: War, Climate, Culture, Society, and Others with confidence scoring

### 📋 Random Data Generator
- **100+ JSON Files**: Generate realistic news data with all categories
- **Copy to Clipboard**: One-click data copying with preview
- **12-Day Cooldown**: Prevents abuse with automatic cooldown mechanism
- **Realistic Metadata**: Includes timestamps, sources, countries, and confidence scores

### 🔍 Enhanced RSS Validation
- **Comprehensive Scanning**: Accurately validates all RSS feeds with detailed error reporting
- **Real-time Status**: Live validation progress with visual indicators
- **Detailed Error Messages**: Specific error descriptions for troubleshooting
- **Performance Metrics**: Response time and content quality analysis

### 🎨 Improved User Interface
- **AI Tools Panel**: Dedicated section for AI features
- **Modal System**: Non-dismissible modals for critical operations
- **Progress Indicators**: Visual feedback for all operations
- **Responsive Design**: Optimized for both desktop and mobile

## Security

This project includes multiple security controls across authentication, authorization, validation, transport, storage, and operations. Below are the implemented controls and recommended hardening steps for production.

### Authentication and Session Security
- JSON Web Tokens (JWT) via `jsonwebtoken` with 7-day expiration.
- Token transport: `Authorization: Bearer <token>` header or `httpOnly` cookie named `token`.
- Cookies configured with `httpOnly`, `sameSite=lax`, and `secure` in production.
- Central auth middleware `authRequired` verifies signature and ensures the user still exists.

### Authorization and Access Control
- Role-based access control with `adminRequired` for admin APIs and admin UI routes.
- Server-side checks on routes like `/api/admin`, `/admin`, `/admin/users`.

### Password Security
- Password hashing with `bcryptjs` (salted hashes) before persistence.
- Minimum password length enforced during signup; secure verification on login.

### Input Validation and Data Hygiene
- Normalization/validation on auth and profile routes (email regex, phone digits, non-empty name/email/phone).
- Body size limit: `express.json({ limit: '1mb' })` to mitigate large-body DoS.
- RSS URL/content validation with network timeouts and structural checks.

### API and Transport Controls
- Socket.IO handshake requires a valid JWT; user id/role attached to the socket.
- SSE notifications endpoint protected by `authRequired` and scoped per-user.
- Health endpoint exposes minimal information for uptime probes.

### Secrets and Configuration
- Environment variables managed via `dotenv` (`JWT_SECRET`, `MONGODB_URI`, `GOOGLE_MAPS_API_KEY`, `MAPBOX_TOKEN`, `HUGGING_FACE_API_KEY`, etc.).
- In production, process exits if `MONGODB_URI` is missing to prevent unsafe defaults.
- `app.set('trust proxy', 1)` enables correct `secure` cookie behavior behind proxies.
- `HUGGING_FACE_API_KEY` enables AI-powered news classification using Hugging Face models.

### Database Safety
- MongoDB connection with `serverSelectionTimeoutMS` to fail fast when unreachable.
- Admin user seeding via `ensureSeedAdmin()` to bootstrap privileged account deliberately.

### Observability and Operational Safety
- HTTP request logging with `morgan` (non-fatal if unavailable).
- Graceful shutdown on `SIGTERM`/`SIGINT` closes HTTP and DB cleanly.
- Hard-fail on unhandled rejections to avoid undefined runtime states.

### Real-time Channels Security
- Authenticated Socket.IO connections; per-user rooms; separate admin room.
- Limited presence emission; errors do not leak sensitive details.

### Recommended Production Hardening
- Set a strong, rotated `JWT_SECRET` (never use dev defaults).
- Enforce HTTPS; terminate TLS at the load balancer or reverse proxy.
- Add security headers middleware (e.g., `helmet`) including a tuned Content Security Policy (CSP).
- Apply rate limiting (e.g., `express-rate-limit`) on login and sensitive endpoints.
- Add login throttling/lockout and 2FA for admin accounts.
- Restrict CORS origins for Socket.IO and REST if accessed cross-origin.
- Store secrets in a managed secret store; keep `.env` files out of VCS.
- Strengthen password policies and rotate seeded admin credentials on deploy.
- Set cookies `secure=true` in production and consider `sameSite=strict` if compatible.
- Implement audit logs for admin and authentication events.
- Restrict MongoDB network access (VPC, IP allowlists) and schedule backups.

### Key Security Modules and Files
- `server.js`: core middleware, Socket.IO auth, SSE guard, route wiring, shutdown.
- `src/middleware/auth.js`: `authRequired`, `adminRequired`, JWT verification, cookie/header token parsing.
- `src/routes/auth.js`: signup/login/logout, cookie options, profile validation.
- `src/routes/adminUsers.js`: admin-only user management.
- `src/utils/rssValidator.js`: URL/feed validation with timeouts and checks.

For a stricter posture, implement the recommended hardening steps and add dependency and security scanning to CI. 
"# luvenewsmapv6" 
"# livenewsmapv7" 
