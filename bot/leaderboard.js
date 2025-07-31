import { EmbedBuilder, ApplicationCommandOptionType } from 'discord.js';

export function setupLeaderboard(client) {
  client.once('ready', async () => {
    try {
      await client.application.commands.create({
        name: 'lb',
        description: 'Afficher le leaderboard actuel',
      });
    } catch (err) {
      console.error('Erreur lors de la création de la commande lb :', err);
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'lb') return;

    const embed = new EmbedBuilder()
      .setTitle('🏆 Leaderboard Auusa — Saison Alpha')
      .addFields(
        {
          name: '🥇 **Elie** — 24 matchs | 🧠 Score global : 812',
          value: '> ⚽ 38 buts | 🎯 19 passes | 🧱 27 saves',
          inline: false,
        },
        {
          name: '🥈 **Tom** — 21 matchs | 🧠 Score global : 798',
          value: '> ⚽ 26 buts | 🎯 22 passes | 🧱 20 saves',
          inline: false,
        },
        {
          name: '🥉 **Léo** — 19 matchs | 🧠 Score global : 760',
          value: '> ⚽ 18 buts | 💥 36 démos | 🧱 14 saves',
          inline: false,
        },
        {
          name: '4️⃣ **Rayan** — 17 matchs | 🧠 Score global : 742',
          value: '> ⚽ 21 buts | 🎯 11 passes | 🧱 12 saves',
          inline: false,
        },
        {
          name: '5️⃣ **Islem** — 15 matchs | 🧠 Score global : 711',
          value: '> ⚽ 14 buts | 💥 27 démos | 🎯 10 passes',
          inline: false,
        }
      )
      .setImage('https://i.imgur.com/amTvOGq.png')
      .setColor('#a47864')
      .setFooter({
        text: 'Auusa.gg - Connecté. Compétitif. Collectif.',
        iconURL: 'https://i.imgur.com/9FLBUiC.png',
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  });
}
