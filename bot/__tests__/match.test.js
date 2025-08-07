import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';

jest.setTimeout(10000);

const SECRET = 'testsecret';
let server;

beforeAll(async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const cwd = path.join(__dirname, '..');
  server = spawn('node', ['index.js'], {
    cwd,
    env: { ...process.env, API_SECRET: SECRET, DISCORD_TOKEN: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise(resolve => {
    server.stdout.on('data', data => {
      if (data.toString().includes('API HTTP en écoute')) {
        resolve();
      }
    });
  });
});

afterAll(() => {
  server.kill();
});

function sign(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

const validPayload = {
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
    },
    {
      name: 'Bob',
      team: 1,
      score: 50,
      goals: 0,
      assists: 0,
      shots: 0,
      saves: 1
    }
  ],
  duration: '5:00',
  map: ''
};

test('POST /match avec signature valide renvoie 200', async () => {
  const body = JSON.stringify(validPayload);
  const res = await fetch('http://localhost:3000/match', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': sign(body)
    },
    body
  });
  expect(res.status).toBe(200);
});

test('POST /match sans signature renvoie 401', async () => {
  const body = JSON.stringify(validPayload);
  const res = await fetch('http://localhost:3000/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  expect(res.status).toBe(401);
});

test('POST /match avec signature invalide renvoie 401', async () => {
  const body = JSON.stringify(validPayload);
  const res = await fetch('http://localhost:3000/match', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': '0'.repeat(64)
    },
    body
  });
  expect(res.status).toBe(401);
});

test('POST /match avec payload invalide renvoie 400', async () => {
  const invalid = { ...validPayload };
  delete invalid.scoreOrange;
  const body = JSON.stringify(invalid);
  const res = await fetch('http://localhost:3000/match', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature': sign(body)
    },
    body
  });
  expect(res.status).toBe(400);
});

