const { buildCareTasksFromDiagnosis } = require('../src/services/carePlanService');

describe('carePlanService', () => {
  it('genera tareas de recuperación para severidad alta', () => {
    const tasks = buildCareTasksFromDiagnosis(
      { severity: 'high', detectedIssues: ['plaga'], recommendations: [] },
      'plant-1',
    );

    expect(tasks.length).toBeGreaterThanOrEqual(3);
    expect(tasks.some((task) => task.category === 'recovery')).toBe(true);
  });

  it('genera tareas base para severidad baja', () => {
    const tasks = buildCareTasksFromDiagnosis(
      { severity: 'low', detectedIssues: ['estrés'], recommendations: [] },
      'plant-2',
    );
    expect(tasks.some((task) => task.category === 'watering')).toBe(true);
  });
});
