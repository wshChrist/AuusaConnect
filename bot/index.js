import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ApplicationCommandOptionType,
  Partials,
  MessageFlags
} from 'discord.js';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupMatchmaking } from './matchmaking.js';
import { setupVerification, runVerificationSetup } from './verification.js';
import { setupTeam } from './team.js';
import { setupRegistration } from './registration.js';
import express from 'express';
import bodyParser from 'body-parser';
import { setupAdvancedMatchmaking, handleMatchResult } from "./advancedMatchmaking.js";

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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User]
});
const matchData = new Map();
setupMatchmaking(client);
setupVerification(client);
setupTeam(client);
setupRegistration(client);
setupAdvancedMatchmaking(client);

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

async function runChannelSetup(interaction) {
  channelId = interaction.channelId;
  try {
    fs.writeFileSync(CHANNEL_FILE, JSON.stringify({ channelId }));
  } catch (err) {
    console.error('Impossible de sauvegarder le canal :', err);
  }
  await interaction.reply('Canal enregistré pour les résultats de match.');
}

app.post('/match', async (req, res) => {
  const {
    scoreBlue,
    scoreOrange,
    teamBlue = 'Bleu',
    teamOrange = 'Orange',
    scorers = [],
    mvp = '',
    players = [],
    duration = '5:00',
    map = 'Inconnu'
  } = req.body;
  if (channelId && client.channels.cache.has(channelId)) {
    const channel = client.channels.cache.get(channelId);

    const bluePlayers = players.filter(p => p.team === 0);
    const orangePlayers = players.filter(p => p.team === 1);

    const matchDateStr = new Date().toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

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

    const xGBlue = (sum(bluePlayers, 'shots') * 0.25).toFixed(1);
    const xGOrange = (sum(orangePlayers, 'shots') * 0.25).toFixed(1);
    const [xgB, xgO] = boldIfGreater(xGBlue, xGOrange);

    const embed = new EmbedBuilder()
      .setTitle('🏁 Match terminé !')
      .setDescription(
        `> 🕒 Durée : ${duration}\n> 📍 Carte : ${map}\n> 📅 Date : ${matchDateStr}`
      )
      .addFields(
        {
          name: '🟦 Blue Team',
          value: `> 👥 : ${bluePlayers.map(p => p.name).join(', ') || 'Aucun.'}`,
          inline: true
        },
        {
          name: '🟧 Orange Team',
          value: `> 👥 : ${orangePlayers.map(p => p.name).join(', ') || 'Aucun.'}`,
          inline: true
        },
        {
          name: '🏅 Homme du match :',
          value: `> **${motmPlayer ? motmPlayer.name : 'Aucun'}** **(${motmNote}/10)**`,
          inline: false
        },
        {
          name: '📊 Stats globales',
          value:
            `> Buts : ${goalsB} / ${goalsO}\n` +
            `> Tirs cadrés : ${shotsB} / ${shotsO}\n` +
            `> xG : ${xgB} / ${xgO}\n` +
            `> Rotation moyenne : ${rotB} / ${rotO}`,
          inline: false
        }
      )
      .setImage('https://i.imgur.com/6wfoqn2.png')
      .setColor('#a47864')
      .setFooter({
        text: 'Auusa.gg - Connecté. Compétitif. Collectif.',
        iconURL: 'https://i.imgur.com/9FLBUiC.png'
      })
      .setTimestamp();

    const btn = new ButtonBuilder()
      .setCustomId('details_joueur')
      .setLabel('📊 Détails Joueurs')
      .setStyle(ButtonStyle.Primary);

    const teamBtn = new ButtonBuilder()
      .setCustomId('team_analysis_button')
      .setLabel('🧠 Analyse de la team')
      .setStyle(ButtonStyle.Secondary);

    const faceBtn = new ButtonBuilder()
      .setCustomId('face_to_face_button')
      .setLabel('🥊 Face-à-face')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(btn, teamBtn, faceBtn);

    const message = await channel.send({ embeds: [embed], components: [row] });
    matchData.set(message.id, players);
    await handleMatchResult(req.body, client);
  }
  res.sendStatus(200);
});

client.once('ready', async () => {
  console.log('Bot prêt');

  // Enregistre la commande slash /setup avec ses sous-commandes
  try {
    await client.application.commands.create({
      name: 'setup',
      description: 'Configurer le bot',
      options: [
        {
          name: 'verification',
          description: 'Installer la vérification dans ce salon',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'role',
              description: 'Rôle attribué après vérification',
              type: ApplicationCommandOptionType.Role,
              required: false
            }
          ]
        },
        {
          name: 'channel',
          description: 'Enregistrer ce salon pour les scores',
          type: ApplicationCommandOptionType.Subcommand
        }
      ]
    });
  } catch (err) {
    console.error('Erreur lors de la création des commandes :', err);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setup') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'verification') {
        await runVerificationSetup(interaction);
      } else if (sub === 'channel') {
        await runChannelSetup(interaction);
      }
      return;
    }
    return;
  }

  if (interaction.isButton() && interaction.customId === 'details_joueur') {
    const players = matchData.get(interaction.message.id);
    if (!players) {
      await interaction.reply({ content: 'Données indisponibles.', flags: MessageFlags.Ephemeral });
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
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'team_analysis_button') {
    const players = matchData.get(interaction.message.id);
    if (!players) {
      await interaction.reply({ content: 'Données indisponibles.', flags: MessageFlags.Ephemeral });
      return;
    }
    const username = (interaction.member?.nickname || interaction.user.username).toLowerCase();
    const player = players.find(p => p.name.toLowerCase() === username);
    if (!player) {
      await interaction.reply({ content: "Impossible de déterminer ton équipe.", flags: MessageFlags.Ephemeral });
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
    await interaction.reply({ embeds: [analysisEmbed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.isButton() && interaction.customId === 'face_to_face_button') {
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
      .setCustomId(`select_compare_${interaction.message.id}`)
      .setPlaceholder('Choisissez deux joueurs')
      .setMinValues(2)
      .setMaxValues(2)
      .addOptions(options);
    await interaction.reply({
      content: 'Sélectionnez deux joueurs à comparer :',
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true
    });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_joueur_detail_')) {
    const matchId = interaction.customId.replace('select_joueur_detail_', '');
    const players = matchData.get(matchId);
    const selected = interaction.values[0];
    if (!players) {
      await interaction.reply({ content: 'Données indisponibles.', flags: MessageFlags.Ephemeral });
      return;
    }
    const player = players.find(p => p.name === selected);
    if (!player) {
      await interaction.reply({ content: 'Aucune donnée pour ce joueur.', flags: MessageFlags.Ephemeral });
      return;
    }

    const perf = Math.min(10, ((player.score || 0) / 1000)).toFixed(1);

    const detailEmbed = new EmbedBuilder()
      .setTitle(
        `🎮 ${player.name} — Équipe ${player.team === 0 ? 'Bleue' : 'Orange'}`
      )
      .addFields(
        {
          name: '⚔️ Offensif',
          value:
            `> 🏅 Buts : **${player.goals ?? 0}** \n` +
            `> 🎯 Passes : **${player.assists ?? 0}** \n` +
            `> 🚀 xG : **${player.expectedGoals ?? player.shots ?? 0}**`,
          inline: true
        },
        {
          name: '🛡️ Défensif',
          value:
            `> 🧱 Saves : **${player.saves ?? 0}**\n` +
            `> ⚔️ Duels : **${player.defensiveChallenges ?? 0}**\n` +
            `> 💥 Démos : **${(player.offensiveDemos ?? 0) + (player.defensiveDemos ?? 0)}**`,
          inline: true
        },
        {
          name: '🔄 Rotation',
          value:
            `> ♻️ Qualité : **${Math.round((player.rotationQuality ?? 0) * 100)}%**\n` +
            `> ✂️ Cuts : **${player.cuts ?? 0}**`,
          inline: true
        },
        {
          name: '⚙️ Activité & vision',
          value:
            `> 🎯 Open goals ratés : **${player.missedOpenGoals ?? 0}**\n` +
            `> 📍 Pressing haut : **${player.highPressings ?? 0}**\n` +
            `> ⛽ Boosts (gaspi) : **${player.boostPickups ?? 0}** (${player.wastedBoostPickups ?? 0})`,
          inline: true
        },
        {
          name: '🧠 Lecture de jeu & Impact',
          value:
            `> 🎭 Style de jeu : **${player.playstyleScore ?? 0}**\n` +
            `> 💬 Note Auusa : \n> **${player.auusaNote ?? 'Joueur fiable et impliqué'}**`,
          inline: true
        }
      )
      .setImage('https://i.imgur.com/z3IglH8.png')
      .setColor('#a47864')
      .setTimestamp();

    await interaction.reply({ embeds: [detailEmbed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_compare_')) {
    const matchId = interaction.customId.replace('select_compare_', '');
    const players = matchData.get(matchId);
    if (!players) {
      await interaction.reply({ content: 'Données indisponibles.', flags: MessageFlags.Ephemeral });
      return;
    }
    const [nameA, nameB] = interaction.values;
    const pA = players.find(p => p.name === nameA);
    const pB = players.find(p => p.name === nameB);
    if (!pA || !pB) {
      await interaction.reply({ content: 'Aucune donnée pour ces joueurs.', flags: MessageFlags.Ephemeral });
      return;
    }
    const totalDemosA = (pA.offensiveDemos || 0) + (pA.defensiveDemos || 0);
    const totalDemosB = (pB.offensiveDemos || 0) + (pB.defensiveDemos || 0);
    const xgA = pA.shots || 0;
    const xgB = pB.shots || 0;

    const compareEmbed = new EmbedBuilder()
      .setTitle(`🥊 Face-à-face — ${pB.name} vs ${pA.name}`)
      .addFields(
        {
          name: '⚔️ Offensif',
          value:
            `> 🏅 Buts : ${pB.goals ?? 0} / ${pA.goals ?? 0}\n` +
            `> 🎯 Passes : ${pB.assists ?? 0} / ${pA.assists ?? 0}\n` +
            `> 🚀 xG : ${xgB} / ${xgA}`,
          inline: true
        },
        {
          name: '🛡️ Défensif',
          value:
            `> 🧱 Saves : ${pB.saves ?? 0} (${pB.clutchSaves ?? 0} clutch) / ${pA.saves ?? 0}\n` +
            `> ⚔️ Duels gagnés : ${pB.defensiveChallenges ?? 0} / ${pA.defensiveChallenges ?? 0}\n` +
            `> 💥 Démos : ${totalDemosB} (${pB.offensiveDemos ?? 0} off., ${pB.defensiveDemos ?? 0} déf.) / ${totalDemosA} (${pA.offensiveDemos ?? 0} off., ${pA.defensiveDemos ?? 0} déf.)`,
          inline: true
        },
        {
          name: '🔄 Rotation',
          value:
            `> ♻️ Qualité : ${Math.round((pB.rotationQuality ?? 0) * 100)}% / ${Math.round((pA.rotationQuality ?? 0) * 100)}%\n` +
            `> ✂️ Cuts : ${pB.cuts ?? 0} / ${pA.cuts ?? 0}`,
          inline: false
        }
      )
      .setImage('https://i.imgur.com/1k6Kx9o.png')
      .setColor('#a47864')
      .setFooter({
        text: 'Auusa.gg - Connecté. Compétitif. Collectif.',
        iconURL: 'https://i.imgur.com/9FLBUiC.png'
      })
      .setTimestamp();

    await interaction.reply({ embeds: [compareEmbed], flags: MessageFlags.Ephemeral });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API en écoute sur le port ${PORT}`));

client.on('error', console.error);
process.on('unhandledRejection', err => console.error('Unhandled promise rejection:', err));

client.login(process.env.DISCORD_TOKEN);
