import {
  ApplicationCommandOptionType,
  EmbedBuilder,
  ChannelType,
  PermissionsBitField
} from 'discord.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function sbRequest(method, table, { query = '', body } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    let msg;
    try { msg = (await res.json()).message; } catch { msg = res.statusText; }
    throw new Error(msg);
  }
  return res.json();
}

async function findTeamByUser(userId) {
  const rows = await sbRequest('GET', 'team_members', { query: `user_id=eq.${userId}` });
  if (!rows.length) return null;
  const teamId = rows[0].team_id;
  const teams = await sbRequest('GET', 'teams', { query: `id=eq.${teamId}` });
  return teams[0] || null;
}

async function createTeamResources(interaction, name) {
  const guild = interaction.guild;
  if (!guild) return null;
  const role = await guild.roles.create({ name }).catch(() => null);
  if (role) {
    await interaction.member.roles.add(role).catch(() => {});
  }
  const perms = [
    { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
    ...(role
      ? [
          {
            id: role.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.Connect,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.Speak
            ]
          }
        ]
      : [])
  ];
  const category = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    permissionOverwrites: perms
  }).catch(() => null);
  if (category) {
    await guild.channels.create({
      name: 'discussion',
      type: ChannelType.GuildText,
      parent: category,
      permissionOverwrites: perms
    }).catch(() => null);
    await guild.channels.create({
      name: 'vocal',
      type: ChannelType.GuildVoice,
      parent: category,
      permissionOverwrites: perms
    }).catch(() => null);
  }
  return role;
}

export function setupTeam(client) {
  client.once('ready', async () => {
    try {
      await client.application.commands.create({
        name: 'team',
        description: 'Gérer les équipes Rocket League',
        options: [
          { name: 'create', description: 'Créer une équipe', type: ApplicationCommandOptionType.Subcommand, options: [
            { name: 'nom', description: 'Nom de la team', type: ApplicationCommandOptionType.String, required: true },
            { name: 'description', description: 'Description de la team', type: ApplicationCommandOptionType.String, required: true }
          ] },
            { name: 'invite', description: 'Inviter un joueur', type: ApplicationCommandOptionType.Subcommand, options: [ { name: 'joueur', description: 'Joueur à inviter', type: ApplicationCommandOptionType.User, required: true }, { name: 'role', description: 'Rôle dans la team', type: ApplicationCommandOptionType.String, required: false, choices: [ { name: 'Membre', value: 'member' }, { name: 'Coach', value: 'coach' }, { name: 'Manager', value: 'manager' } ] } ] },
          { name: 'join', description: 'Rejoindre une équipe', type: ApplicationCommandOptionType.Subcommand, options: [{ name: 'nom', description: 'Nom de la team', type: ApplicationCommandOptionType.String, required: true }] },
          { name: 'leave', description: "Quitter l'équipe", type: ApplicationCommandOptionType.Subcommand },
          { name: 'kick', description: 'Expulser un joueur', type: ApplicationCommandOptionType.Subcommand, options: [{ name: 'joueur', description: 'Joueur à kick', type: ApplicationCommandOptionType.User, required: true }] },
          { name: 'disband', description: "Dissoudre l'équipe", type: ApplicationCommandOptionType.Subcommand },
          { name: 'info', description: 'Info de la team', type: ApplicationCommandOptionType.Subcommand },
          { name: 'edit', description: 'Modifier la team', type: ApplicationCommandOptionType.Subcommand, options: [
            { name: 'logo', description: 'URL du logo', type: ApplicationCommandOptionType.String, required: false }
          ] },
          { name: 'match', description: 'Programmer un match', type: ApplicationCommandOptionType.Subcommand, options: [{ name: 'equipe', description: 'Équipe adverse', type: ApplicationCommandOptionType.String, required: true }, { name: 'date', description: 'Date/heure', type: ApplicationCommandOptionType.String, required: true }] },
          { name: 'report', description: 'Reporter un match', type: ApplicationCommandOptionType.Subcommand, options: [{ name: 'resultat', description: 'victoire ou défaite', type: ApplicationCommandOptionType.String, required: true, choices: [{ name: 'victoire', value: 'win' }, { name: 'défaite', value: 'loss' }] }, { name: 'score', description: 'Score', type: ApplicationCommandOptionType.String, required: true }] },
          { name: 'leaderboard', description: 'Top équipes', type: ApplicationCommandOptionType.Subcommand }
        ]
      });
    } catch (err) {
      console.error('Création commande /team échouée', err);
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'team') return;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'create') {
        const name = interaction.options.getString('nom');
        const description = interaction.options.getString('description');
        const exists = await sbRequest('GET', 'teams', { query: `name=eq.${encodeURIComponent(name)}` });
        if (exists.length) return interaction.reply({ content: 'Ce nom est déjà pris.', ephemeral: true });
        const team = await sbRequest('POST', 'teams', { body: { name, description, captain_id: interaction.user.id, elo: 1000 } });
        await sbRequest('POST', 'team_members', { body: { user_id: interaction.user.id, team_id: team[0].id } });
        const embed = new EmbedBuilder()
          .setTitle('✅ Équipe créée avec succès !')
          .setDescription(`🆕 Nom : **${name}**  \n👑 Capitaine : <@${interaction.user.id}>  \n👥 Membres : *(0/6)*\n\nℹ️ Tu peux maintenant inviter des joueurs avec :  \n\`/team invite @joueur\``)
          .setColor('#a47864')
          .setFooter({ text: 'Auusa.gg - Connecté. Compétitif. Collectif.', iconURL: 'https://i.imgur.com/9FLBUiC.png' })
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      } else if (sub === 'invite') {
        const user = interaction.options.getUser('joueur');
        const team = await findTeamByUser(interaction.user.id);
        const role = interaction.options.getString("role") || "member";
        if (!team) return interaction.reply({ content: 'Vous ne possédez pas de team.', ephemeral: true });
        if (team.captain_id !== interaction.user.id) return interaction.reply({ content: 'Seul le capitaine peut inviter.', ephemeral: true });
        const members = await sbRequest('GET', 'team_members', { query: `team_id=eq.${team.id}` });
        if (members.length >= 6) return interaction.reply({ content: 'Équipe complète (6 membres max).', ephemeral: true });
        await sbRequest('POST', 'team_invitations', { body: { team_id: team.id, user_id: user.id, status: 'pending', role } });
        const embed = new EmbedBuilder()
          .setTitle('🎟️ Invitation à rejoindre une équipe')
          .setDescription(`<@${interaction.user.id}> t\u2019a invité à rejoindre l\u2019équipe **${team.name}** !\n\n🔹 Veux-tu rejoindre cette équipe et participer à des matchs classés ?\n\n✅ Réponds avec \`/team join ${team.name}\` pour accepter.`)
          .setColor('#a47864')
          .setFooter({ text: 'Auusa.gg - Connecté. Compétitif. Collectif.', iconURL: 'https://i.imgur.com/9FLBUiC.png' })
          .setTimestamp();
        try {
          await user.send({ embeds: [embed] });
        } catch {}
        await interaction.reply({ content: `${user} a été invité dans **${team.name}**.`, ephemeral: true });
      } else if (sub === 'join') {
        const name = interaction.options.getString('nom');
        const teamRows = await sbRequest('GET', 'teams', { query: `name=eq.${encodeURIComponent(name)}` });
        if (!teamRows.length) return interaction.reply({ content: 'Équipe introuvable.', ephemeral: true });
        const team = teamRows[0];
        const inv = await sbRequest('GET', 'team_invitations', { query: `team_id=eq.${team.id}&user_id=eq.${interaction.user.id}&status=eq.pending` });
        if (!inv.length) return interaction.reply({ content: "Pas d'invitation pour cette équipe.", ephemeral: true });
        await sbRequest('PATCH', `team_invitations?id=eq.${inv[0].id}`, { body: { status: 'accepted' } });
        const role = inv[0].role || "member";
        if (role === "coach") {
          await sbRequest("PATCH", `teams?id=eq.${team.id}`, { body: { coach_id: interaction.user.id } });
        } else if (role === "manager") {
          await sbRequest("PATCH", `teams?id=eq.${team.id}`, { body: { manager_id: interaction.user.id } });
        } else {
          await sbRequest("POST", "team_members", { body: { user_id: interaction.user.id, team_id: team.id } });
        }
        const teamRole = interaction.guild.roles.cache.find(r => r.name === team.name);
        if (teamRole) {
          await interaction.member.roles.add(teamRole).catch(() => {});
        }
        await interaction.reply(`Vous avez rejoint **${team.name}** !`);
      } else if (sub === 'leave') {
        const team = await findTeamByUser(interaction.user.id);
        if (!team) return interaction.reply({ content: 'Vous ne faites partie d\'aucune équipe.', ephemeral: true });
        await sbRequest('DELETE', `team_members?user_id=eq.${interaction.user.id}&team_id=eq.${team.id}`);
        await interaction.reply('Vous avez quitté l\'équipe.');
      } else if (sub === 'kick') {
        const user = interaction.options.getUser('joueur');
        const team = await findTeamByUser(interaction.user.id);
        if (!team || team.captain_id !== interaction.user.id) return interaction.reply({ content: 'Capitaine uniquement.', ephemeral: true });
        await sbRequest('DELETE', `team_members?user_id=eq.${user.id}&team_id=eq.${team.id}`);
        await interaction.reply(`${user} a été expulsé.`);
      } else if (sub === 'disband') {
        const team = await findTeamByUser(interaction.user.id);
        if (!team || team.captain_id !== interaction.user.id) return interaction.reply({ content: 'Capitaine uniquement.', ephemeral: true });
        await sbRequest('DELETE', `team_members?team_id=eq.${team.id}`);
        await sbRequest('DELETE', `teams?id=eq.${team.id}`);
        const role = interaction.guild.roles.cache.find(r => r.name === team.name);
        if (role) await role.delete().catch(() => {});
        const category = interaction.guild.channels.cache.find(c => c.name === team.name && c.type === ChannelType.GuildCategory);
        if (category) {
          const children = interaction.guild.channels.cache.filter(ch => ch.parentId === category.id);
          for (const ch of children.values()) await ch.delete().catch(() => {});
          await category.delete().catch(() => {});
        }
        await interaction.reply(`L'équipe **${team.name}** a été dissoute.`);
      } else if (sub === 'info') {
        const team = await findTeamByUser(interaction.user.id);
        if (!team) return interaction.reply({ content: 'Aucune équipe trouvée.', ephemeral: true });
        const members = await sbRequest('GET', 'team_members', { query: `team_id=eq.${team.id}` });
        const list = members.map(m => `> – <@${m.user_id}>`).join('\n');
        const wins = (await sbRequest('GET', 'match_history', { query: `team_a=eq.${team.id}&winner=eq.${team.id}` })).length;
        const losses = (await sbRequest('GET', 'match_history', { query: `team_a=eq.${team.id}&winner=neq.${team.id}` })).filter(m => m.winner).length;
        const ratio = wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0;
        const lastRows = await sbRequest('GET', 'match_history', { query: `team_a=eq.${team.id}&order=id.desc&limit=1` });
        let lastField = 'Aucun match enregistré.';
        if (lastRows.length) {
          const match = lastRows[0];
          const opp = await sbRequest('GET', 'teams', { query: `id=eq.${match.team_b}` });
          const oppName = opp[0]?.name || 'Inconnu';
          const result = match.winner ? (match.winner === team.id ? 'Victoire' : 'Défaite') : 'Match en attente';
          lastField = `vs ${oppName} → ${result} ${match.score || ''}`;
          if (match.date) lastField += ` (${match.date})`;
        }

        const embed = new EmbedBuilder()
          .setTitle(`📜 Équipe : **${team.name}**`);
        if (team.description) embed.setDescription(`> ${team.description}`);
        embed
          .addFields(
            { name: '• 👑 Capitaine', value: `> <@${team.captain_id}>`, inline: true },
            { name: '• 🎓 Coach', value: team.coach_id ? `> <@${team.coach_id}>` : '> –', inline: true },
            { name: '• 🧾 Manager', value: team.manager_id ? `> <@${team.manager_id}>` : '> –', inline: false },
            { name: `• 👥 Membres (${members.length}/6)`, value: list || '> – Aucun', inline: true },
            { name: '📊 Statistiques d’équipe', value: `> 🧠 Élo : ${team.elo}\n> 🏆 Victoires : ${wins}\n> ❌ Défaites : ${losses}\n> 🔄 Ratio de win : ${ratio}%`, inline: true },
            { name: '• 🏅 Dernier match', value: lastField, inline: false }
          )
          .setColor('#a47864')
          .setFooter({ text: 'Auusa.gg - Connecté. Compétitif. Collectif.', iconURL: 'https://i.imgur.com/9FLBUiC.png' })
          .setTimestamp();
        embed.setImage(team.logo || 'https://i.imgur.com/HczhXhK.png');
        await interaction.reply({ embeds: [embed] });
      } else if (sub === 'edit') {
        const team = await findTeamByUser(interaction.user.id);
        if (!team || team.captain_id !== interaction.user.id) return interaction.reply({ content: 'Capitaine uniquement.', ephemeral: true });
        const logo = interaction.options.getString('logo');
        const body = {};
        if (logo !== null) body.logo = logo;
        if (!Object.keys(body).length) return interaction.reply({ content: 'Rien à modifier.', ephemeral: true });
        const updated = await sbRequest('PATCH', `teams?id=eq.${team.id}`, { body });
        await interaction.reply({ content: 'Équipe mise à jour.', ephemeral: true });
      } else if (sub === 'match') {
        const team = await findTeamByUser(interaction.user.id);
        if (!team || team.captain_id !== interaction.user.id) return interaction.reply({ content: 'Capitaine uniquement.', ephemeral: true });
        const opponent = interaction.options.getString('equipe');
        const date = interaction.options.getString('date');
        const oppRows = await sbRequest('GET', 'teams', { query: `name=eq.${encodeURIComponent(opponent)}` });
        if (!oppRows.length) return interaction.reply({ content: 'Équipe adverse introuvable.', ephemeral: true });
        await sbRequest('POST', 'match_history', { body: { team_a: team.id, team_b: oppRows[0].id, score: '', date } });
        await interaction.reply('Match programmé.');
      } else if (sub === 'report') {
        const result = interaction.options.getString('resultat');
        const score = interaction.options.getString('score');
        const team = await findTeamByUser(interaction.user.id);
        if (!team) return interaction.reply({ content: 'Aucune équipe trouvée.', ephemeral: true });
        const last = await sbRequest('GET', 'match_history', { query: `team_a=eq.${team.id}&order=id.desc&limit=1` });
        if (!last.length) return interaction.reply({ content: 'Aucun match à reporter.', ephemeral: true });
        await sbRequest('PATCH', `match_history?id=eq.${last[0].id}`, { body: { score, winner: result === 'win' ? team.id : last[0].team_b } });
        await interaction.reply('Résultat enregistré.');
        } else if (sub === 'leaderboard') {
          const rows = await sbRequest('GET', 'teams', { query: 'order=elo.desc&limit=5' });
          const embed = new EmbedBuilder()
            .setTitle('🏆 Classement des équipes — Saison Alpha')
            .setDescription('> 📊 Classement compétitif des équipes en temps réel.')
            .setImage('https://i.imgur.com/oyQE5I0.png')
            .setColor('#a47864')
            .setFooter({ text: 'Auusa.gg - Connecté. Compétitif. Collectif.', iconURL: 'https://i.imgur.com/9FLBUiC.png' })
            .setTimestamp();

          const medals = ['🥇', '🥈', '🥉'];
          for (let i = 0; i < rows.length; i++) {
            const t = rows[i];
            const wins = (await sbRequest('GET', 'match_history', { query: `team_a=eq.${t.id}&winner=eq.${t.id}` })).length;
            const losses = (await sbRequest('GET', 'match_history', { query: `team_a=eq.${t.id}&winner=neq.${t.id}` })).filter(m => m.winner).length;
            const ratio = wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0;
            const icon = medals[i] || '🔹';
            embed.addFields({
              name: `• ${icon} ${i + 1}. ${t.name}`,
              value: `> 💠 Élo : ${t.elo} — 🏆 V : ${wins} — ❌ D : ${losses} — 📊 ${ratio}%`,
              inline: false
            });
          }

          await interaction.reply({ embeds: [embed] });
      }
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: `Erreur: ${err.message}`, ephemeral: true });
    }
  });
}
