// Required Libraries
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const { exec } = require('child_process');

// Configuration
const config = {
  logFile: '/var/log/asterisk/full',
  discordWebhook: 'https://discord.com/api/webhooks/1320569432421961750/SEyUjwzD7K003pZJl_jQaNh6Y1rRqx43A-1hSxnjP4FGtoyJs5ZJYdpHTohBvPLS5irT', // Replace with your Discord webhook URL
  port: 3000, // Web interface port
  thresholds: {}, // Per-user thresholds
  shutdownThresholds: {}, // Per-user shutdown thresholds
  whitelist: [], // Whitelisted users
};

let notificationLogs = []; // Store notification logs in memory

// Monitor Asterisk Call Logs
function monitorLogs() {
  console.log(`Monitoring Asterisk logs at: ${config.logFile}`);
  
  fs.watchFile(config.logFile, (curr, prev) => {
    const logData = fs.readFileSync(config.logFile, 'utf-8');
    const newLogs = logData.split('\n').slice(-50); // Read last 50 lines
    processLogs(newLogs);
  });
}

function processLogs(logs) {
  logs.forEach((line) => {
    // Example log parsing logic (adapt to your format)
    const match = line.match(/CallerID: (\w+), Trunk: (\w+)/);
    if (match) {
      const user = match[1];
      const trunk = match[2];

      if (!config.whitelist.includes(user)) {
        trackUserActivity(user, trunk);
      }
    }
  });
}

// Track User Activity
const userCallCounts = {}; // { user: { trunk: callCount } }

function trackUserActivity(user, trunk) {
  if (!userCallCounts[user]) userCallCounts[user] = {};
  if (!userCallCounts[user][trunk]) userCallCounts[user][trunk] = 0;

  userCallCounts[user][trunk]++;

  const callCount = userCallCounts[user][trunk];
  const threshold = config.thresholds[user] || 10; // Default threshold
  const shutdownThreshold = config.shutdownThresholds[user] || 20; // Default shutdown threshold

  if (callCount >= threshold) {
    sendDiscordNotification(user, trunk, callCount);
  }

  if (callCount >= shutdownThreshold) {
    disableUserAccount(user);
  }
}

// Send Notification to Discord
async function sendDiscordNotification(user, trunk, callCount) {
  const message = `⚠️ User **${user}** has made **${callCount}** calls through trunk **${trunk}**.`;

  try {
    await axios.post(config.discordWebhook, { content: message });
    notificationLogs.push({ user, trunk, callCount, timestamp: new Date().toISOString() });
    console.log(`Notification sent for user: ${user}`);
  } catch (error) {
    console.error(`Error sending notification: ${error.message}`);
  }
}

// Disable User Account
function disableUserAccount(user) {
  exec(`asterisk -rx "database put DEVICE ${user} DISABLED"`, (error, stdout) => {
    if (error) {
      console.error(`Error disabling account for user ${user}: ${error.message}`);
    } else {
      console.log(`User account disabled: ${user}`);
      sendDiscordNotification(user, 'N/A', 'Account Disabled');
    }
  });
}

// Web Interface
const app = express();
app.use(express.json());

// Fetch Notification Logs
app.get('/logs', (req, res) => {
  res.json(notificationLogs);
});

// Update Configuration
app.post('/config', (req, res) => {
  const { thresholds, shutdownThresholds, whitelist } = req.body;
  if (thresholds) config.thresholds = thresholds;
  if (shutdownThresholds) config.shutdownThresholds = shutdownThresholds;
  if (whitelist) config.whitelist = whitelist;

  res.json({ success: true, config });
});

// Start Web Server
app.listen(config.port, () => {
  console.log(`Web server running at http://localhost:${config.port}`);
});

// Start Log Monitoring
monitorLogs();
