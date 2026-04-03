import http from 'http';
import https from 'https';
import { URL } from 'url';import { Logger } from "./lib/Logger.js";


const webhookUrl = process.argv[2];
const message = process.argv[3];

if (!webhookUrl || webhookUrl === '[WEBHOOK_URL]' || webhookUrl.trim() === '') {
  console.log('No webhook URL provided or URL is disabled. Skipping gracefully.');
  process.exit(0);
}

if (!message) {
  Logger.fatal('ERROR: No message provided for the webhook.');
  
}

const payload = JSON.stringify({ message });

try {
  const parsedUrl = new URL(webhookUrl);
  const reqModule = parsedUrl.protocol === 'https:' ? https : http;

  const req = reqModule.request(
    webhookUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`Webhook sent successfully. Status: ${res.statusCode}`);
          process.exit(0);
        } else {
          console.error(`Webhook failed. Status: ${res.statusCode} ${res.statusMessage}`);
          Logger.fatal(`Response: ${responseBody}`);
          
        }
      });
    }
  );

  req.on('error', (err) => {
    Logger.fatal(`Webhook request failed: ${err.message}`);
    
  });

  req.write(payload);
  req.end();
} catch (err) {
  Logger.fatal(`Invalid webhook URL or network error: ${err.message}`);
  
}
