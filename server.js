import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
// import webhookRouter from './webhook-handler.js';

dotenv.config();

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase with same credentials as main pipeline
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Middleware
app.use(cors());
app.use(express.json());

// Mount webhook routes
// app.use('/', webhookRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString()
  });
});

// Track email open - increments seen count
app.get('/track/open/:emailId', async (req, res) => {
  try {
    const emailId = decodeURIComponent(req.params.emailId);
    console.log(`📧 Email opened: ${emailId}`);
    
    // Get current record from database
    const { data: contact, error: fetchError } = await supabase
      .from('contacts_simplified')
      .select('*')
      .eq('email', emailId)
      .single();
    
    if (fetchError || !contact) {
      console.error(`Contact not found: ${emailId}`);
      return sendTrackingPixel(res);
    }
    
    // Update seen count (increment by 1)
    const currentSeenCount = contact.seen_count || 0;
    const { error: updateError } = await supabase
      .from('contacts_simplified')
      .update({
        seen_count: currentSeenCount + 1,
        last_seen_at: new Date().toISOString(),
        has_opened: true
      })
      .eq('email', emailId);
    
    if (updateError) {
      console.error(`Failed to update seen count: ${updateError.message}`);
    } else {
      console.log(`✅ Updated seen count for ${emailId}: ${currentSeenCount + 1}`);
    }
    
    // Return 1x1 transparent pixel
    sendTrackingPixel(res);
  } catch (error) {
    console.error(`Error in open tracking: ${error.message}`);
    sendTrackingPixel(res);
  }
});

// Track link click
app.get('/track/click/:emailId', async (req, res) => {
  try {
    const emailId = decodeURIComponent(req.params.emailId);
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).send('Missing URL parameter');
    }
    
    console.log(`🔗 Link clicked by: ${emailId}`);
    
    // Get current record
    const { data: contact, error: fetchError } = await supabase
      .from('contacts_simplified')
      .select('*')
      .eq('email', emailId)
      .single();
    
    if (!fetchError && contact) {
      // Update click count
      const currentClickCount = contact.click_count || 0;
      await supabase
        .from('contacts_simplified')
        .update({
          click_count: currentClickCount + 1,
          last_click_at: new Date().toISOString(),
          has_clicked: true
        })
        .eq('email', emailId);
      
      console.log(`✅ Updated click count for ${emailId}: ${currentClickCount + 1}`);
    }
    
    // Redirect to original URL
    res.redirect(decodeURIComponent(url));
  } catch (error) {
    console.error(`Error in click tracking: ${error.message}`);
    const url = req.query.url;
    if (url) {
      res.redirect(decodeURIComponent(url));
    } else {
      res.status(400).send('Invalid request');
    }
  }
});

// Mark email as replied (manual update)
app.post('/api/mark-replied', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }
    
    console.log(`📮 Marking ${email} as replied`);
    
    // Get current record
    const { data: contact, error: fetchError } = await supabase
      .from('contacts_simplified')
      .select('*')
      .eq('email', email)
      .single();
    
    if (fetchError || !contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    // Update replied status
    const { data, error } = await supabase
      .from('contacts_simplified')
      .update({
        has_replied: true,
        reply_date: new Date().toISOString()
      })
      .eq('email', email)
      .select();
    
    if (error) {
      console.error(`Failed to mark replied: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }
    
    console.log(`✅ Marked ${email} as replied`);
    res.json({ 
      success: true, 
      email: email,
      data: data[0]
    });
  } catch (error) {
    console.error(`Error marking replied: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Batch mark emails as replied
app.post('/api/mark-replied-batch', async (req, res) => {
  try {
    const { emails } = req.body;
    
    if (!emails || !Array.isArray(emails)) {
      return res.status(400).json({ error: 'Emails array required' });
    }
    
    console.log(`📮 Marking ${emails.length} emails as replied`);
    
    // Update all emails
    const { data, error } = await supabase
      .from('contacts_simplified')
      .update({
        has_replied: true,
        reply_date: new Date().toISOString()
      })
      .in('email', emails)
      .select();
    
    if (error) {
      console.error(`Failed to mark replied: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }
    
    console.log(`✅ Marked ${data.length} emails as replied`);
    res.json({ 
      success: true, 
      updated: data.length,
      emails: data.map(d => d.email)
    });
  } catch (error) {
    console.error(`Error marking replied: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get stats for an email
app.get('/api/stats/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    
    const { data: contact, error } = await supabase
      .from('contacts_simplified')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error || !contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    res.json({
      email: contact.email,
      name: contact.name,
      category: contact.vendor_category,
      status: contact.status,
      seenCount: contact.seen_count || 0,
      clickCount: contact.click_count || 0,
      hasOpened: contact.has_opened || false,
      hasClicked: contact.has_clicked || false,
      hasReplied: contact.has_replied || false,
      lastSeenAt: contact.last_seen_at,
      lastClickAt: contact.last_click_at,
      replyDate: contact.reply_date
    });
  } catch (error) {
    console.error(`Error getting stats: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get overall campaign stats
app.get('/api/campaign-stats', async (req, res) => {
  try {
    const { data: contacts, error } = await supabase
      .from('contacts_simplified')
      .select('*');
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    const stats = {
      total: contacts.length,
      sent: contacts.filter(c => c.status === 'sent').length,
      opened: contacts.filter(c => c.has_opened).length,
      clicked: contacts.filter(c => c.has_clicked).length,
      replied: contacts.filter(c => c.has_replied).length,
      avgSeenCount: 0,
      avgClickCount: 0
    };
    
    // Calculate averages
    const totalSeen = contacts.reduce((sum, c) => sum + (c.seen_count || 0), 0);
    const totalClicks = contacts.reduce((sum, c) => sum + (c.click_count || 0), 0);
    
    if (stats.sent > 0) {
      stats.openRate = ((stats.opened / stats.sent) * 100).toFixed(1) + '%';
      stats.clickRate = ((stats.clicked / stats.sent) * 100).toFixed(1) + '%';
      stats.replyRate = ((stats.replied / stats.sent) * 100).toFixed(1) + '%';
      stats.avgSeenCount = (totalSeen / stats.opened).toFixed(1);
      stats.avgClickCount = (totalClicks / stats.clicked).toFixed(1);
    }
    
    res.json(stats);
  } catch (error) {
    console.error(`Error getting campaign stats: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to send tracking pixel
function sendTrackingPixel(res) {
  const pixel = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  );
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private'
  });
  res.end(pixel);
}

// Import Reply Monitor
import ReplyMonitor from './reply-monitor.js';

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   Wedding Outreach Tracking Server     ║
║   Running on http://localhost:${PORT}    ║
╠════════════════════════════════════════╣
║   Endpoints:                           ║
║   GET  /health                         ║
║   GET  /track/open/:emailId            ║
║   GET  /track/click/:emailId?url=      ║
║   POST /api/mark-replied               ║
║   POST /api/mark-replied-batch         ║
║   GET  /api/stats/:email               ║
║   GET  /api/campaign-stats             ║
║   POST /webhook/reply                  ║
║   POST /webhook/sendgrid               ║
║   POST /webhook/gmail                  ║
╚════════════════════════════════════════╝
  `);
  
  // Start Reply Monitor if enabled
  if (process.env.ENABLE_REPLY_MONITOR === 'true') {
    console.log('\n📧 Starting automatic reply monitor...');
    const replyMonitor = new ReplyMonitor();
    replyMonitor.start().catch(err => {
      console.error('Failed to start reply monitor:', err.message);
      console.log('Continuing without automatic reply detection...');
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      replyMonitor.stop();
      process.exit(0);
    });
  } else {
    console.log('\n📧 Reply monitor disabled. Enable with ENABLE_REPLY_MONITOR=true');
  }
});

export default app;