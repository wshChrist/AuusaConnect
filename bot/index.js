import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} from 'discord.js';
import { setupMatchmaking } from './matchmaking.js';
import express from 'express';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json());

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates
] });
let channelId = '';
const matchData = new Map();
setupMatchmaking(client);

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
    const sum = (arr, field) => arr.reduce((acc, p) => acc + (p[field] || 0), 0);
    const rotationScore = arr => {
      const valid = arr.filter(p => typeof p.rotationQuality === 'number' && p.rotationQuality > 0);
      if (!valid.length) return 0;
      const avg = valid.reduce((acc, p) => acc + p.rotationQuality, 0) / valid.length;
      return Math.round(avg * 100);
    };

    const motm = () => {
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
      return best;
    };

    const motmPlayer = motm();

    const embed = new EmbedBuilder()
      .setTitle(`🏁 Match terminé : ${teamBlue} ${scoreBlue} – ${scoreOrange} ${teamOrange}`)
      .addFields(
        {
          name: `🔵 ${teamBlue}`,
          value: `👤 : ${bluePlayers.map(p => p.name).join(', ')}\n🎯 Tirs : ${sum(bluePlayers, 'shots')}\t⚽ Buts : ${sum(bluePlayers, 'goals')}\t🛡️ Arrêts : ${sum(bluePlayers, 'saves')}\n🔄 Score de rotation : ${rotationScore(bluePlayers)}/100`,
          inline: false
        },
        {
          name: `🟠 ${teamOrange}`,
      value: `👤 : ${orangePlayers.map(p => p.name).join(', ')}\n🎯 Tirs : ${sum(orangePlayers, 'shots')}\t⚽ Buts : ${sum(orangePlayers, 'goals')}\t🛡️ Arrêts : ${sum(orangePlayers, 'saves')}\n🔄 Score de rotation : ${rotationScore(orangePlayers)}/100`,
      inline: true
        },
        {
          name: '👑 Homme du match :',
          value: motmPlayer
            ? `**${motmPlayer.name}** (Buts: ${motmPlayer.goals}, Passes: ${motmPlayer.assists}, Arrêts: ${motmPlayer.saves}, Score: ${motmPlayer.score}, Rotation: ${Math.round((typeof motmPlayer.rotationQuality === 'number' && motmPlayer.rotationQuality > 0 ? motmPlayer.rotationQuality : 0) * 100)}/100)`
            : 'Aucun',
          inline: false
        }
      )
      .setColor('#00b0f4')
      .setFooter({ text: 'Auusa.gg' })
      .setTimestamp();

    const detailBtn = new ButtonBuilder()
      .setCustomId('details_joueur')
      .setLabel('📊 Détails Joueurs')
      .setStyle(ButtonStyle.Primary);

    const compareBtn = new ButtonBuilder()
      .setCustomId('compare_players_button')
      .setLabel('🏅 Comparaison entre joueurs')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(detailBtn, compareBtn);

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

  if (interaction.isButton() && interaction.customId === 'compare_players_button') {
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
      await interaction.reply({ content: 'Données indisponibles.', ephemeral: true });
      return;
    }
    const player = players.find(p => p.name === selected);
    if (!player) {
      await interaction.reply({ content: 'Aucune donnée pour ce joueur.', ephemeral: true });
      return;
    }

    const perf = Math.min(10, ((player.score || 0) / 1000)).toFixed(1);

    const detailEmbed = new EmbedBuilder()
      .setTitle(`Statistiques de ${player.name}`)
      .addFields(
        { name: '🔥 Stats offensives', value: `Buts: ${player.goals}\nPasses: ${player.assists}\nTirs cadrés: ${player.shots}\nDémolitions offensives: ${player.offensiveDemos ?? 0}` },
        { name: '🛡️ Stats défensives', value: `Arrêts: ${player.saves}\nDégagements: ${player.clearances}\nDuels gagnés: ${player.defensiveChallenges}\nDémolitions défensives: ${player.defensiveDemos}\nTemps en défense: ${Math.round(player.defenseTime)}s\nBlocks: ${player.blocks}\nSauvetages critiques: ${player.clutchSaves}` },
        { name: '🧠 Intelligence & Rotations', value: `Boosts ramassés: ${player.boostPickups}\nGaspi boosts: ${player.wastedBoostPickups}\nFréquence boost: ${player.boostFrequency?.toFixed(2)}\nQualité rotation: ${Math.round((player.rotationQuality ?? 0) * 100)}/100` },
        { name: '👁️ Vision & Soutien', value: `Passes utiles: ${player.usefulPasses ?? 0}\nRelances propres: ${player.cleanClears ?? 0}` },
        { name: '🕹️ Mobilité & Activité', value: `Touches de balle: ${player.ballTouches ?? 0}\nPressings hauts: ${player.highPressings ?? 0}\nTouches aériennes: ${player.aerialTouches ?? 0}` },
        { name: '❌ Erreurs / Malus', value: `Open nets manqués: ${player.missedOpenGoals ?? 0}\nDouble commits: ${player.doubleCommits ?? 0}\nTouches inutiles: ${player.uselessTouches ?? 0}` }
      )
      .setFooter({ text: `Score global : ${perf}/10` })
      .setColor(player.team === 0 ? '#0099ff' : '#ff3300')
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
