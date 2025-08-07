import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'mmr_data.json');

const thresholds = [
  { rank: 'Bronze', min: 0, max: 999 },
  { rank: 'Silver', min: 1000, max: 1499 },
  { rank: 'Gold', min: 1500, max: 1999 },
  { rank: 'Platinum', min: 2000, max: 2499 },
  { rank: 'Diamond', min: 2500, max: 2999 },
  { rank: 'Champion', min: 3000, max: 3499 },
  { rank: 'Grand Champion', min: 3500, max: Infinity }
];

export function computeRank(mmr) {
  for (const t of thresholds) {
    if (mmr >= t.min && mmr <= t.max) return t.rank;
  }
  return 'Unranked';
}

export function verifyPlayer(name) {
  const mmrData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const mmr = mmrData[name];
  if (typeof mmr !== 'number') throw new Error('Joueur inconnu');
  return { name, mmr, rank: computeRank(mmr) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const name = process.argv[2];
  if (!name) {
    console.error('Usage: node rankVerifier.js <joueur>');
    process.exit(1);
  }
  try {
    const { name: player, mmr, rank } = verifyPlayer(name);
    console.log(`${player} possède ${mmr} MMR -> rang ${rank}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
