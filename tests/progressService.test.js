const { mapProgressRow } = require('../src/services/progressService');

describe('progressService', () => {
  it('calcula adherencia y tendencia improving', () => {
    const row = {
      plant_id: 'plant-1',
      tasks_total_last_7_days: 10,
      tasks_done_last_7_days: 9,
    };
    const result = mapProgressRow(row);
    expect(result.adherenceRate).toBe(90);
    expect(result.trend).toBe('improving');
  });

  it('maneja división por cero', () => {
    const row = {
      plant_id: 'plant-2',
      tasks_total_last_7_days: 0,
      tasks_done_last_7_days: 0,
    };
    const result = mapProgressRow(row);
    expect(result.adherenceRate).toBe(0);
    expect(result.trend).toBe('worsening');
  });
});
