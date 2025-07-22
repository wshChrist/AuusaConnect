import { Client, GatewayIntentBits } from 'discord.js';
import express from 'express';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
let channelId = '';

app.post('/match', (req, res) => {
  const { scoreBlue, scoreOrange } = req.body;
  if (channelId && client.channels.cache.has(channelId)) {
    const channel = client.channels.cache.get(channelId);
    channel.send(`Match terminé: Bleu ${scoreBlue} - Orange ${scoreOrange}`);
  }
  res.sendStatus(200);
});

client.once('ready', () => {
  console.log('Bot prêt');
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
