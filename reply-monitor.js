import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://lmcnvsltpeahmdhqskaa.supabase.co',
  process.env.SUPABASE_ANON_KEY
);

class ReplyMonitor {
  constructor() {
    // IMAP configuration for Gmail
    this.imap = new Imap({
      user: process.env.EMAIL_ADDRESS,
      password: process.env.EMAIL_PASSWORD,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });
    
    this.processedEmails = new Set();
  }

  async start() {
    console.log('📧 Starting email reply monitor...');
    
    this.imap.once('ready', () => {
      console.log('✅ Connected to email server');
      this.openInbox();
    });

    this.imap.once('error', (err) => {
      console.error('IMAP error:', err);
    });

    this.imap.once('end', () => {
      console.log('Connection ended');
    });

    this.imap.connect();
  }

  openInbox() {
    this.imap.openBox('INBOX', false, (err, box) => {
      if (err) {
        console.error('Error opening inbox:', err);
        return;
      }

      console.log(`📬 Monitoring inbox for replies...`);
      
      // Check for new emails every 5 minutes
     setInterval(() => {
       this.checkForReplies();
     }, 300000);

      // Initial check
      this.checkForReplies();
      
      // Listen for new emails
      this.imap.on('mail', () => {
        console.log('📨 New email detected');
        this.checkForReplies();
      });
    });
  }

  checkForReplies() {
    // Search for emails from the last 24 hours
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    this.imap.search(['UNSEEN', ['SINCE', yesterday]], (err, results) => {
      if (err) {
        console.error('Search error:', err);
        return;
      }

      if (results.length === 0) {
        return;
      }

      console.log(`Found ${results.length} new emails to check`);

      const fetch = this.imap.fetch(results, { 
        bodies: '',
        markSeen: true 
      });

      fetch.on('message', (msg, seqno) => {
        msg.on('body', (stream) => {
          simpleParser(stream, async (err, parsed) => {
            if (err) {
              console.error('Parse error:', err);
              return;
            }

            await this.processReply(parsed);
          });
        });
      });

      fetch.once('error', (err) => {
        console.error('Fetch error:', err);
      });
    });
  }

  async processReply(email) {
    try {
      // Extract sender email
      const fromEmail = email.from?.value[0]?.address?.toLowerCase();
      
      if (!fromEmail) {
        return;
      }
      
      // Check if this is a reply (has Re: in subject or references our emails)
      const isReply = email.subject?.toLowerCase().includes('re:') || 
                     email.inReplyTo || 
                     email.references;
      
      if (!isReply) {
        return;
      }
      
      // Check if we already processed this
      const messageId = email.messageId;
      if (this.processedEmails.has(messageId)) {
        return;
      }
      
      console.log(`📮 Reply detected from: ${fromEmail}`);
      
      // Check if this contact exists in our database
      const { data: contact, error: fetchError } = await supabase
        .from('contacts_simplified')
        .select('*')
        .eq('email', fromEmail)
        .single();
      
      if (fetchError || !contact) {
        console.log(`   Contact not found in database: ${fromEmail}`);
        return;
      }
      
      // Update contact as replied
      const { error: updateError } = await supabase
        .from('contacts_simplified')
        .update({
          has_replied: true,
          reply_date: new Date().toISOString()
        })
        .eq('email', fromEmail);
      
      if (updateError) {
        console.error(`Failed to update reply status: ${updateError.message}`);
      } else {
        console.log(`✅ Marked ${fromEmail} as replied automatically`);
        
        // Log the reply event
        await supabase
          .from('email_tracking_events')
          .insert({
            event_type: 'reply',
            email: fromEmail,
            metadata: { 
              auto_detected: true,
              subject: email.subject,
              detected_at: new Date().toISOString()
            }
          });
      }
      
      // Mark as processed
      this.processedEmails.add(messageId);
      
      // Keep set size manageable
      if (this.processedEmails.size > 1000) {
        this.processedEmails.clear();
      }
      
    } catch (error) {
      console.error('Error processing reply:', error);
    }
  }

  stop() {
    console.log('Stopping reply monitor...');
    this.imap.end();
  }
}

// Export for use in server
export default ReplyMonitor;

// Run standalone if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const monitor = new ReplyMonitor();
  monitor.start();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    monitor.stop();
    process.exit(0);
  });
}