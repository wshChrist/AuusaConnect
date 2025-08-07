import request from 'supertest';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.API_SECRET = 'secret-test';

const { default: app } = await import('../index.js');

describe('POST /match', () => {
  const basePayload = {
    scoreBlue: 1,
    scoreOrange: 0,
    teamBlue: 'Bleu',
    teamOrange: 'Orange',
    scorers: [],
    mvp: '',
    players: [
      {
        name: 'Alice',
        team: 0,
        score: 100,
        goals: 1,
        assists: 0,
        shots: 1,
        saves: 0
      }
    ],
    duration: '5:00',
    map: ''
  };

  const sign = body =>
    crypto
      .createHmac('sha256', process.env.API_SECRET)
      .update(body)
      .digest('hex');

  test('accepte une requête signée', async () => {
    const body = JSON.stringify(basePayload);
    const res = await request(app)
      .post('/match')
      .set('x-signature', sign(body))
      .send(basePayload);
    expect(res.status).toBe(200);
  });

  test('rejette une requête non signée', async () => {
    const res = await request(app).post('/match').send(basePayload);
    expect(res.status).toBe(401);
  });

  test('retourne 400 si le corps est manquant', async () => {
    const res = await request(app)
      .post('/match')
      .set('x-signature', sign(''));
    expect(res.status).toBe(400);
  });

  test('retourne 400 si le corps est invalide', async () => {
    const invalidPayload = { scoreBlue: 1, scoreOrange: 0 };
    const body = JSON.stringify(invalidPayload);
    const res = await request(app)
      .post('/match')
      .set('x-signature', sign(body))
      .send(invalidPayload);
    expect(res.status).toBe(400);
  });
});
