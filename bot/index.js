import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import express from 'express';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
let channelId = '';

app.post('/match', (req, res) => {
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
      if (!arr.length) return 0;
      const avg = arr.reduce((acc, p) => acc + (p.rotationQuality || 0), 0) / arr.length;
      return Math.round(avg * 100);
    };

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
        }
      )
      .setColor('#00b0f4')
      .setFooter({ text: 'Auusa.gg' })
      .setTimestamp();

    channel.send({ embeds: [embed] });
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
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'setchannel') {
    channelId = interaction.channelId;
    await interaction.reply('Canal enregistré pour les résultats de match.');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API en écoute sur le port ${PORT}`));

client.login(process.env.DISCORD_TOKEN);
