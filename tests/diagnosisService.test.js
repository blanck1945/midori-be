const { generateDiagnosis } = require('../src/services/diagnosisService');

describe('diagnosisService', () => {
  it('devuelve un diagnóstico estructurado válido', async () => {
    const diagnosis = await generateDiagnosis({
      context: 'Hojas amarillas y manchadas, posible hongo',
      note: 'Riego frecuente',
      imageUrl: 'https://example.com/plant.jpg',
      plant: {
        name: 'Ficus',
        species_guess: 'Ficus lyrata',
        location: 'Interior',
      },
    });

    expect(['low', 'medium', 'high']).toContain(diagnosis.severity);
    expect(typeof diagnosis.summary).toBe('string');
    expect(diagnosis.detectedIssues.length).toBeGreaterThan(0);
    expect(diagnosis.recommendations.length).toBeGreaterThan(1);
  });
});
