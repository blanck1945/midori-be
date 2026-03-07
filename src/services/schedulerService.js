// Queue notifications for tasks that are ~1 hour away (55-65 min window)
// and don't already have a notification queued/sent.
async function queueNotificationsForUpcomingTasks(dbClient) {
  const insertSql = `
    INSERT INTO notifications (task_id, scheduled_for, status, channel)
    SELECT t.id, t.scheduled_for, 'queued', 'local'
    FROM care_tasks t
    LEFT JOIN notifications n ON n.task_id = t.id
    WHERE t.status = 'pending'
      AND t.scheduled_for BETWEEN NOW() + INTERVAL '55 minutes'
                               AND NOW() + INTERVAL '65 minutes'
      AND n.id IS NULL
    RETURNING *;
  `;
  const { rows } = await dbClient.query(insertSql);
  return rows;
}

async function markQueuedNotificationsAsSent(dbClient) {
  const updateSql = `
    UPDATE notifications
    SET status = 'sent', sent_at = NOW()
    WHERE status = 'queued'
      AND scheduled_for <= NOW() + INTERVAL '65 minutes'
    RETURNING *;
  `;
  const { rows } = await dbClient.query(updateSql);
  return rows;
}

module.exports = { queueNotificationsForUpcomingTasks, markQueuedNotificationsAsSent };
