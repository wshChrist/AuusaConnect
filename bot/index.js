import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} from 'discord.js';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupMatchmaking } from './matchmaking.js';
import { setupVerification } from './verification.js';
import express from 'express';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHANNEL_FILE = path.join(__dirname, 'channel.json');
let channelId = '';
try {
  const data = JSON.parse(fs.readFileSync(CHANNEL_FILE, 'utf8'));
  if (data.channelId) channelId = data.channelId;
} catch {
  channelId = '';
}

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessageReactions
] });
const matchData = new Map();
setupMatchmaking(client);
setupVerification(client);

const calculateMotm = players => {
  let best = null;
  let bestVal = -Infinity;
  for (const p of players) {
    const rotation =
      typeof p.rotationQuality === 'number' && p.rotationQuality > 0
        ? p.rotationQuality
        : 0;
    const val =
      (p.score || 0) +
      (p.goals || 0) * 100 +
      (p.assists || 0) * 50 +
      (p.saves || 0) * 50 +
      (p.shots || 0) * 10 +
      rotation * 100;
    if (val > bestVal) {
      bestVal = val;
      best = p;
    }
  }
  return { player: best, value: bestVal };
};

const sum = (arr, field) => arr.reduce((acc, p) => acc + (p[field] || 0), 0);
const rotationScore = arr => {
  const valid = arr.filter(p => typeof p.rotationQuality === 'number' && p.rotationQuality > 0);
  if (!valid.length) return 0;
  const avg = valid.reduce((acc, p) => acc + p.rotationQuality, 0) / valid.length;
  return Math.round(avg * 100);
};

const boldIfGreater = (v1, v2) => {
  if (v1 > v2) return [`**${v1}**`, `${v2}`];
  if (v2 > v1) return [`${v1}`, `**${v2}**`];
  return [`${v1}`, `${v2}`];
};

const analyzeTeam = arr => {
  const s = field => arr.reduce((a, p) => a + (p[field] || 0), 0);
  const note = Math.max(0, Math.min(100, rotationScore(arr) - (s('doubleCommits') || 0) * 5 + (s('goals') || 0) * 2));
  let comment = 'Équipe désorganisée';
  if (note >= 80) comment = 'Excellente cohésion et rotations fluides';
  else if (note >= 60) comment = 'Bonne cohésion mais trop de double commits';
  else if (note >= 40) comment = 'Cohésion moyenne et défense perfectible';

  const forces = [];
  if (rotationScore(arr) > 70) forces.push('bonne rotation');
  if (s('cleanClears') > arr.length) forces.push('relances propres');
  if (s('highPressings') >= arr.length) forces.push('engagement constant');
  if (s('saves') >= arr.length) forces.push('bonne couverture défensive');

  const faiblesses = [];
  if ((s('doubleCommits') || 0) > arr.length / 2) faiblesses.push('trop de double commits');
  if ((s('wastedBoostPickups') || 0) > (s('boostPickups') || 1) / 2) faiblesses.push('boost mal géré');
  if ((s('missedOpenGoals') || 0) > 0) faiblesses.push('open nets manqués');
  if ((s('defensiveChallenges') || 0) < arr.length) faiblesses.push('mauvaise couverture défensive');

  const reco = [];
  if (rotationScore(arr) < 70) reco.push('Travaillez vos rotations en scrim');
  if ((s('doubleCommits') || 0) > arr.length / 2) reco.push('Communiquez plus pour éviter les double commits');
  if ((s('wastedBoostPickups') || 0) > (s('boostPickups') || 1) / 2) reco.push('Optimisez la prise de boost');
  if ((s('defensiveChallenges') || 0) < arr.length) reco.push('Renforcez la défense ensemble');

  return { note, comment, forces, faiblesses, reco };
};

app.post('/match', async (req, res) => {
  const {
    scoreBlue,
    scoreOrange,
    teamBlue = 'Bleu',
    teamOrange = 'Orange',
    scorers = [],
    mvp = '',
    players = []
  } = req.body;
  if (channelId && client.channels.cache.has(channelId)) {
    const channel = client.channels.cache.get(channelId);

    const bluePlayers = players.filter(p => p.team === 0);
    const orangePlayers = players.filter(p => p.team === 1);

    const { player: motmPlayer } = calculateMotm(players);

    const motmNote = motmPlayer
      ? Math.min(10, (motmPlayer.score || 0) / 1000).toFixed(1)
      : '0';

    const blueClears = sum(bluePlayers, 'clearances');
    const orangeClears = sum(orangePlayers, 'clearances');
    const blueDemos =
      sum(bluePlayers, 'offensiveDemos') + sum(bluePlayers, 'defensiveDemos');
    const orangeDemos =
      sum(orangePlayers, 'offensiveDemos') + sum(orangePlayers, 'defensiveDemos');

    const [goalsB, goalsO] = boldIfGreater(
      sum(bluePlayers, 'goals'),
      sum(orangePlayers, 'goals')
    );
    const [shotsB, shotsO] = boldIfGreater(
      sum(bluePlayers, 'shots'),
      sum(orangePlayers, 'shots')
    );
    const [clearsB, clearsO] = boldIfGreater(blueClears, orangeClears);
    const [demosB, demosO] = boldIfGreater(blueDemos, orangeDemos);
    const [rotB, rotO] = boldIfGreater(
      rotationScore(bluePlayers),
      rotationScore(orangePlayers)
    );

    const embed = new EmbedBuilder()
      .setTitle('🏁 **Match terminé !**')
      .setDescription(
        `**Score final**  \n🔵 ${teamBlue} ${scoreBlue} - ${scoreOrange} ${teamOrange} 🔶`
      )
      .addFields(
        {
          name: '**📋 Compositions**',
          value: `🔵 ${teamBlue} : ${bluePlayers
            .map(p => p.name)
            .join(', ')}  \n🔶 ${teamOrange} : ${orangePlayers
            .map(p => p.name)
            .join(', ')}`,
          inline: false
        },
        {
          name: `👑 **Homme du match** : ${
            motmPlayer ? motmPlayer.name : 'Aucun'
          } (${motmPlayer ? motmNote : '0'}/10)`,
          value: '',
          inline: false
        },
        {
          name: '📊 **Stats globales**',
          value: `• Buts : ${goalsB} / ${goalsO}  \n` +
            `• Tirs cadrés : ${shotsB} / ${shotsO}  \n` +
            `• Dégagements : ${clearsB} / ${clearsO}  \n` +
            `• Démolitions : ${demosB} / ${demosO}  \n` +
            `• Rotation moyenne : ${rotB} / ${rotO}`,
          inline: false
        }
      )
      .setColor('#00b0f4')
      .setTimestamp();

    const btn = new ButtonBuilder()
      .setCustomId('details_joueur')
      .setLabel('📊 Détails Joueurs')
      .setStyle(ButtonStyle.Primary);

    const teamBtn = new ButtonBuilder()
      .setCustomId('team_analysis_button')
      .setLabel('🧠 Analyse de la team')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(btn, teamBtn);

    const message = await channel.send({ embeds: [embed], components: [row] });
    matchData.set(message.id, players);
  }
  res.sendStatus(200);
});

client.once('ready', async () => {
  console.log('Bot prêt');

  // Enregistre la commande slash /setchannel si elle n'existe pas
  try {
    await client.application.commands.create({
      name: 'setchannel',
      description: 'Choisir le salon où publier les scores'
    });
  } catch (err) {
    console.error('Erreur lors de la création des commandes :', err);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setchannel') {
      channelId = interaction.channelId;
      try {
        fs.writeFileSync(CHANNEL_FILE, JSON.stringify({ channelId }));
      } catch (err) {
        console.error('Impossible de sauvegarder le canal :', err);
      }
      await interaction.reply('Canal enregistré pour les résultats de match.');
    }
    return;
  }

  if (interaction.isButton() && interaction.customId === 'details_joueur') {
    const players = matchData.get(interaction.message.id);
    if (!players) {
      await interaction.reply({ content: 'Données indisponibles.', ephemeral: true });
      return;
    }
    const options = players.map(p => ({
      label: p.name,
      value: p.name,
      emoji: p.team === 0 ? '🔵' : '🔴'
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`select_joueur_detail_${interaction.message.id}`)
      .setPlaceholder('Choisissez un joueur')
      .addOptions(options);
    await interaction.reply({
      content: 'Sélectionnez un joueur :',
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true
    });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'team_analysis_button') {
    const players = matchData.get(interaction.message.id);
    if (!players) {
      await interaction.reply({ content: 'Données indisponibles.', ephemeral: true });
      return;
    }
    const username = (interaction.member?.nickname || interaction.user.username).toLowerCase();
    const player = players.find(p => p.name.toLowerCase() === username);
    if (!player) {
      await interaction.reply({ content: "Impossible de déterminer ton équipe.", ephemeral: true });
      return;
    }
    const teamPlayers = players.filter(p => p.team === player.team);
    const analysis = analyzeTeam(teamPlayers);
    const analysisEmbed = new EmbedBuilder()
      .setTitle('🧠 Analyse tactique de ton équipe')
      .addFields(
        { name: 'Note collective', value: `${analysis.note}/100 - ${analysis.comment}` },
        { name: 'Forces', value: analysis.forces.length ? `• ${analysis.forces.join('\n• ')}` : 'Aucune' },
        { name: 'Faiblesses', value: analysis.faiblesses.length ? `• ${analysis.faiblesses.join('\n• ')}` : 'Aucune' },
        { name: 'Recommandations', value: analysis.reco.length ? `• ${analysis.reco.join('\n• ')}` : 'Aucune' }
      )
      .setColor('#00BFFF')
      .setTimestamp();
    await interaction.reply({ embeds: [analysisEmbed], ephemeral: true });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_joueur_detail_')) {
    const matchId = interaction.customId.replace('select_joueur_detail_', '');
    const players = matchData.get(matchId);
    const selected = interaction.values[0];
    if (!players) {
      await interaction.reply({ content: 'Données indisponibles.', ephemeral: true });
      return;
    }
    const player = players.find(p => p.name === selected);
    if (!player) {
      await interaction.reply({ content: 'Aucune donnée pour ce joueur.', ephemeral: true });
      return;
    }

    const perf = Math.min(10, ((player.score || 0) / 1000)).toFixed(1);

    const boostEfficiency = (player.boostPickups || 0)
      ? Math.round(
          ((player.boostPickups - (player.wastedBoostPickups || 0)) /
            player.boostPickups) *
            100
        )
      : 0;

    const detailEmbed = new EmbedBuilder()
      .setTitle(`🎖️ **Statistiques de ${player.name}**`)
      .setDescription(
        `🏆 Score global : **${perf}/10**\n\n` +
        `─── 🔥 **Clutch**  \n` +
        `${player.goals} ⚽  |  ${player.assists} 🎯  |  ${player.shots} 🥅  |  ${player.defensiveChallenges} 🤜\n\n` +
        `─── 🛡️ **Défense**  \n` +
        `${player.saves} 🧤  |  ${player.clearances} 🚀  |  ${player.clutchSaves} 🚧\n\n` +
        `─── 🧠 **Intelligence & Rotation**  \n` +
        `Rotation : ${Math.round((player.rotationQuality ?? 0) * 100)}/100 🔁  \n` +
        `Boost : ${boostEfficiency}% ⚡\n\n` +
        `─── 👁️ **Vision & Soutien**  \n` +
        `Passes utiles : ${player.usefulPasses ?? 0}  |  Relances : ${player.cleanClears ?? 0}\n\n` +
        `─── 🕹️ **Activité**  \n` +
        `Touches : ${player.ballTouches ?? 0} ⚽  |  Aériennes : ${player.aerialTouches ?? 0} ✈️\n\n` +
        `─── ❌ **Erreurs**  \n` +
        `DC : ${player.doubleCommits ?? 0} ❗ | Open Miss : ${player.missedOpenGoals ?? 0} 🚫 | Useless touches : ${player.uselessTouches ?? 0} 🤷`
      )
      .setColor('#00b0f4')
      .setTimestamp();

    await interaction.reply({ embeds: [detailEmbed], ephemeral: true });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_compare_')) {
    const matchId = interaction.customId.replace('select_compare_', '');
    const players = matchData.get(matchId);
    if (!players) {
      await interaction.reply({ content: 'Données indisponibles.', ephemeral: true });
      return;
    }
    const [nameA, nameB] = interaction.values;
    const pA = players.find(p => p.name === nameA);
    const pB = players.find(p => p.name === nameB);
    if (!pA || !pB) {
      await interaction.reply({ content: 'Aucune donnée pour ces joueurs.', ephemeral: true });
      return;
    }

    const perfScore = p =>
      (p.score || 0) +
      (p.goals || 0) * 100 +
      (p.assists || 0) * 50 +
      (p.saves || 0) * 50 +
      (p.shots || 0) * 10 +
      ((typeof p.rotationQuality === 'number' && p.rotationQuality > 0 ? p.rotationQuality : 0) * 100) -
      ((p.missedOpenGoals || 0) + (p.doubleCommits || 0) + (p.uselessTouches || 0)) * 20;

    const errorRatio = p => {
      const errors = (p.missedOpenGoals || 0) + (p.doubleCommits || 0) + (p.uselessTouches || 0);
      const touches = p.ballTouches || 0;
      return touches ? ((errors / touches) * 100) : 0;
    };

    const scoreA = perfScore(pA);
    const scoreB = perfScore(pB);
    const better = scoreA === scoreB ?
      'Impact similaire.' : scoreA > scoreB ?
      `${pA.name} a été le plus impactant.` : `${pB.name} a été le plus impactant.`;

    const compareEmbed = new EmbedBuilder()
      .setTitle('🏅 Duel de performance')
      .setDescription(`${pA.name} vs ${pB.name}`)
      .addFields(
        { name: 'Score de performance globale', value: `${scoreA.toFixed(0)} vs ${scoreB.toFixed(0)}` },
        { name: 'Buts / assists / arrêts', value: `${pA.goals}/${pA.assists}/${pA.saves} vs ${pB.goals}/${pB.assists}/${pB.saves}` },
        { name: 'Ratio d’erreurs', value: `${errorRatio(pA).toFixed(1)}% vs ${errorRatio(pB).toFixed(1)}%` },
        { name: 'Utilisation du boost', value: `${(pA.boostFrequency ?? 0).toFixed(2)} vs ${(pB.boostFrequency ?? 0).toFixed(2)}` },
        { name: 'Rotations & soutien', value: `Rot: ${Math.round((pA.rotationQuality ?? 0) * 100)}/100 | Passes: ${pA.usefulPasses ?? 0} vs Rot: ${Math.round((pB.rotationQuality ?? 0) * 100)}/100 | Passes: ${pB.usefulPasses ?? 0}` },
        { name: 'Conclusion', value: better }
      )
      .setColor('#800080')
      .setTimestamp();

    await interaction.reply({ embeds: [compareEmbed], ephemeral: true });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API en écoute sur le port ${PORT}`));

client.login(process.env.DISCORD_TOKEN);
