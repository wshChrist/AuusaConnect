import { computeRank, verifyPlayer } from '../rankVerifier.js';

test('calcule correctement le rang à partir du MMR', () => {
  expect(computeRank(900)).toBe('Bronze');
  expect(computeRank(1100)).toBe('Silver');
  expect(computeRank(1600)).toBe('Gold');
});

test('vérifie le joueur existant', () => {
  const res = verifyPlayer('Charlie');
  expect(res.rank).toBe('Gold');
});

test('lance une erreur pour un joueur inconnu', () => {
  expect(() => verifyPlayer('Inconnu')).toThrow('Joueur inconnu');
});
