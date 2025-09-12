# Wedding Outreach Tracking Server

A Node.js/Express server for tracking email opens and link clicks in wedding outreach campaigns.

## Features

- Track email opens via pixel tracking
- Track link clicks
- Mark emails as replied
- Campaign statistics API
- Supabase integration for data storage

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file with your credentials:
```env
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_key

# Server
PORT=3000

# Optional: Reply monitoring
ENABLE_REPLY_MONITOR=false
```

3. Run the server:
```bash
npm start
```

## API Endpoints

- `GET /health` - Health check
- `GET /track/open/:emailId` - Track email open
- `GET /track/click/:emailId?url=` - Track link click
- `POST /api/mark-replied` - Mark email as replied
- `POST /api/mark-replied-batch` - Batch mark emails as replied
- `GET /api/stats/:email` - Get stats for specific email
- `GET /api/campaign-stats` - Get overall campaign statistics

## Deployment

For email tracking to work with Gmail and other providers, deploy to a proper domain (not ngrok/localhost).

Recommended platforms:
- Render.com
- Railway.app
- Vercel
- Fly.io

## Important Notes

- Google and other email providers proxy images, so tracking may not be 100% accurate
- Link click tracking is more reliable than open tracking
- Some email clients block tracking pixels entirely
