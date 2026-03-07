function getTrend(adherenceRate) {
  if (adherenceRate >= 80) return 'improving';
  if (adherenceRate >= 50) return 'stable';
  return 'worsening';
}

function mapProgressRow(row) {
  const total = Number(row.tasks_total_last_7_days ?? 0);
  const done = Number(row.tasks_done_last_7_days ?? 0);
  const adherenceRate = total ? Math.round((done / total) * 100) : 0;

  return {
    plantId: row.plant_id,
    adherenceRate,
    tasksDoneLast7Days: done,
    tasksTotalLast7Days: total,
    trend: getTrend(adherenceRate),
  };
}

module.exports = { mapProgressRow };
