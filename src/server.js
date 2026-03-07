const cron = require('node-cron');
const { app } = require('./app');
const { config } = require('./config');
const { initDb } = require('./initDb');
const {
  queueNotificationsForUpcomingTasks,
  markQueuedNotificationsAsSent,
} = require('./services/schedulerService');
const { pool } = require('./db');

async function start() {
  await initDb();

  cron.schedule('*/5 * * * *', async () => {
    try {
      await queueNotificationsForUpcomingTasks(pool);
      await markQueuedNotificationsAsSent(pool);
    } catch (error) {
      // Keep scheduler resilient; request path has explicit observability.
      console.error('Scheduler error:', error.message);
    }
  });

  app.listen(config.port, () => {
    console.log(`Backend running at http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error('Fatal start error:', error);
  process.exit(1);
});
