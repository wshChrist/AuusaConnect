import {
  Client,
  ApplicationCommandOptionType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionsBitField,
  ComponentType,
  MessageFlags
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BASE_URL = SUPABASE_URL?.replace(/\/rest\/v1\/?$/, '');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHANNEL_FILE = path.join(__dirname, 'channel.json');

async function sbRequest(method, table, { query = '', body } = {}) {
  let path = table;
  const idx = table.indexOf('?');
  if (idx !== -1) {
    const existing = table.slice(idx + 1);
    path = table.slice(0, idx);
    query = query ? `${existing}&${query}` : existing;
  }
  if ((method === 'POST' || method === 'PATCH') && !/select=/i.test(query)) {
    query = query ? `${query}&select=*` : 'select=*';
  }
  const url = `${BASE_URL}/rest/v1/${path}${query ? `?${query}` : ''}`;
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
  const role = await guild.roles.create({ name }).catch(async err => {
    console.error(err);
    try {
      await interaction.editReply({ content: `Erreur lors de la création du rôle pour l'équipe ${name}.` });
    } catch {}
    return null;
  });
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
  const category = await guild.channels
    .create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: perms
    })
    .catch(async err => {
      console.error(err);
      try {
        await interaction.editReply({ content: `Erreur lors de la création de la catégorie pour l'équipe ${name}.` });
      } catch {}
      return null;
    });
  if (category) {
    await guild.channels
      .create({
        name: 'discussion',
        type: ChannelType.GuildText,
        parent: category,
        permissionOverwrites: perms
      })
      .catch(async err => {
        console.error(err);
        try {
          await interaction.editReply({ content: `Erreur lors de la création du salon discussion pour l'équipe ${name}.` });
        } catch {}
      });
    await guild.channels
      .create({
        name: 'vocal',
        type: ChannelType.GuildVoice,
        parent: category,
        permissionOverwrites: perms
      })
      .catch(async err => {
        console.error(err);
        try {
          await interaction.editReply({ content: `Erreur lors de la création du salon vocal pour l'équipe ${name}.` });
        } catch {}
      });
  }
  return role;
}

async function buildTeamEmbed(team) {
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
  const embed = new EmbedBuilder().setTitle(`📜 Équipe : **${team.name}**`);
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
  return embed;
}

async function buildLeaderboardEmbed(page = 0) {
  const rows = await sbRequest('GET', 'teams', { query: `order=elo.desc&limit=6&offset=${page * 5}` });
  const hasNext = rows.length > 5;
  const list = rows.slice(0, 5);
  const embed = new EmbedBuilder()
    .setTitle('🏆 Classement des équipes — Saison Alpha')
    .setDescription('> 📊 Classement compétitif des équipes en temps réel.')
    .setColor('#a47864')
    .setImage('https://i.imgur.com/oyQE5I0.png');
  const medals = ['🥇', '🥈', '🥉'];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const index = page * 5 + i + 1;
    const wins = (await sbRequest('GET', 'match_history', { query: `team_a=eq.${t.id}&winner=eq.${t.id}` })).length;
    const losses = (await sbRequest('GET', 'match_history', { query: `team_a=eq.${t.id}&winner=neq.${t.id}` })).filter(m => m.winner).length;
    const ratio = wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0;
    const icon = medals[index - 1] || '🔹';
    embed.addFields({ name: `• ${icon} ${index}. ${t.name}`, value: `> 💠 Élo : ${t.elo} — 🏆 V : ${wins} — ❌ D : ${losses} — 📊 ${ratio}%`, inline: false });
  }
  return { embed, hasNext };
}

async function showLeaderboard(interaction, page, update = false) {
  const { embed, hasNext } = await buildLeaderboardEmbed(page);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`team_lb_prev_${page}`)
      .setLabel('⬅️ Précédent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`team_lb_next_${page}`)
      .setLabel('➡️ Suivant')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasNext)
  );
  if (update) {
    await interaction.update({ embeds: [embed], components: [row] });
  } else if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ embeds: [embed], components: [row] });
  } else {
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
}

async function showMainMenu(interaction) {
  const team = await findTeamByUser(interaction.user.id);
  if (!team) {
    const embed = new EmbedBuilder()
      .setTitle('Aucune équipe trouvée')
      .setDescription("Tu n'es dans aucune équipe.")
      .setColor('#a47864');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('team_create').setLabel('Créer une équipe').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('team_join').setLabel('Rejoindre une équipe').setStyle(ButtonStyle.Primary)
    );
    await interaction.editReply({ embeds: [embed], components: [row] });
    return;
  }
  const embed = await buildTeamEmbed(team);
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('team_view').setLabel('👁️ Voir mon équipe').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('team_edit').setLabel('📝 Modifier équipe').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('team_invite').setLabel('📨 Inviter un joueur').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('team_members').setLabel('👥 Gérer les membres').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('team_leaderboard').setLabel('📈 Voir le classement').setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('team_search').setLabel('🔍 Voir une autre équipe').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('team_schedule').setLabel('🕹️ Programmer un match').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('team_disband').setLabel('❌ Dissoudre l\u2019équipe').setStyle(ButtonStyle.Danger)
  );
  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

async function handleBroadcast(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Commande uniquement sur un serveur.', ephemeral: true });
    return;
  }
  const perms = interaction.memberPermissions || interaction.member?.permissions;
  if (!perms?.has(PermissionsBitField.Flags.ManageMessages)) {
    await interaction.reply({ content: 'Permissions insuffisantes.', ephemeral: true });
    return;
  }

  const target = interaction.options.getString('target');
  const mode = interaction.options.getString('mode') || 'standard';
  const embedJson = interaction.options.getString('embed_json');

  await interaction.reply({ content: 'Envoi en cours...', ephemeral: true });

  let embedData;
  try {
    embedData = JSON.parse(embedJson);
    if (typeof embedData.description !== 'string' || embedData.description.trim() === '') {
      embedData.description = '\u200B';
    }
  } catch (err) {
    await interaction.editReply({ content: 'Embed JSON invalide.' });
    return;
  }

  let teams = [];
  if (target.toLowerCase() === 'all') {
    teams = await sbRequest('GET', 'teams');
  } else {
    const rows = await sbRequest('GET', 'teams', { query: `name=eq.${encodeURIComponent(target)}` });
    if (!rows.length) {
      await interaction.editReply({ content: "Équipe introuvable." });
      return;
    }
    teams = [rows[0]];
  }

  const embed = EmbedBuilder.from(embedData);

  const sentTo = [];
  for (const t of teams) {
    const category = guild.channels.cache.find(
      c =>
        c.type === ChannelType.GuildCategory &&
        c.name.toLowerCase() === t.name.toLowerCase()
    );
    let channel;
    if (category) {
      channel = guild.channels.cache.find(
        ch => ch.type === ChannelType.GuildText && ch.parentId === category.id
      );
    }
    if (channel) {
      try {
        const msg = await channel.send({ embeds: [embed] });
        if (mode === 'binaire') {
          await msg.react('✅');
          await msg.react('❌');
        }
        sentTo.push(t.name);
      } catch (err) {
        console.error(err);
        await interaction.editReply({ content: `Échec lors de l'envoi pour l'équipe ${t.name}.` });
        return;
      }
    }
  }

  const logChannel = guild.channels.cache.find(c => c.name.includes('logs-broadcasts'));
  if (logChannel) {
    const logEmbed = new EmbedBuilder()
      .setTitle('Nouveau broadcast')
      .addFields(
        { name: 'Auteur', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Cible', value: sentTo.join(', ') || target, inline: true },
        { name: 'Mode', value: mode, inline: true }
      )
      .setColor('#f9a602')
      .setTimestamp();
    await logChannel.send({ embeds: [logEmbed] });
  }

  await interaction.editReply({ content: `Message envoyé à ${sentTo.join(', ') || 'aucune équipe'}.` });
}

export function setupTeam(client) {
  client.once('ready', async () => {
    try {
      await client.application.commands.create({
        name: 'team',
        description: 'Gestion des équipes',
        options: [
          { name: 'menu', description: 'Ouvrir le menu', type: ApplicationCommandOptionType.Subcommand },
          {
            name: 'broadcast',
            description: 'Envoyer un message officiel à une équipe',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
              {
                name: 'target',
                description: '"all" ou nom de l\'équipe',
                type: ApplicationCommandOptionType.String,
                required: true
              },
              {
                name: 'mode',
                description: 'standard ou binaire',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                  { name: 'standard', value: 'standard' },
                  { name: 'binaire', value: 'binaire' }
                ]
              },
              {
                name: 'embed_json',
                description: 'Embed Discord au format JSON',
                type: ApplicationCommandOptionType.String,
                required: true
              }
            ]
          }
        ]
      });
    } catch (err) {
      console.error('Création commande /team échouée', err);
    }
  });

  client.on('interactionCreate', async interaction => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'team') {
        const sub = interaction.options.getSubcommand();
        if (sub === 'menu') {
          await interaction.deferReply({ ephemeral: true });
          await showMainMenu(interaction);
        } else if (sub === 'broadcast') {
          await handleBroadcast(interaction);
        }
        return;
      }

      if (interaction.isButton()) {
        if (interaction.customId === 'team_view') {
          await interaction.deferUpdate();
          await showMainMenu(interaction);
        } else if (interaction.customId === 'team_create') {
          const modal = new ModalBuilder()
            .setTitle('Créer une équipe')
            .setCustomId('team_create_modal')
            .addComponents(
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Nom').setStyle(TextInputStyle.Short).setRequired(true)),
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true))
            );
          await interaction.showModal(modal);
        } else if (interaction.customId === 'team_join') {
          const modal = new ModalBuilder()
            .setTitle('Rejoindre une équipe')
            .setCustomId('team_join_modal')
            .addComponents(
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Nom de l\u2019équipe').setStyle(TextInputStyle.Short).setRequired(true))
            );
          await interaction.showModal(modal);
        } else if (interaction.customId === 'team_edit') {
          const menu = new StringSelectMenuBuilder()
            .setCustomId('team_edit_select')
            .setPlaceholder('Que souhaites-tu modifier ?')
            .addOptions(
              { label: 'Nom', value: 'name' },
              { label: 'Logo', value: 'logo' },
              { label: 'Bio', value: 'bio' },
              { label: 'Description', value: 'description' }
            );
          await interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
        } else if (interaction.customId === 'team_invite') {
          const menu = new UserSelectMenuBuilder()
            .setCustomId('team_invite_select')
            .setPlaceholder('Sélectionne un joueur à inviter');
          await interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
        } else if (interaction.customId === 'team_members') {
          const team = await findTeamByUser(interaction.user.id);
          if (!team || team.captain_id !== interaction.user.id) {
            await interaction.reply({ content: 'Capitaine uniquement.', ephemeral: true });
            return;
          }
          const members = await sbRequest('GET', 'team_members', { query: `team_id=eq.${team.id}` });
          const rows = [];
          for (const m of members) {
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`team_kick_${m.user_id}`).setLabel(`Kick <@${m.user_id}>`).setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`team_promote_${m.user_id}`).setLabel('Promouvoir').setStyle(ButtonStyle.Secondary)
            );
            rows.push(row);
          }
          const embed = new EmbedBuilder()
            .setTitle('Membres de l\u2019équipe')
            .setDescription(members.map(m => `<@${m.user_id}>`).join('\n'))
            .setColor('#a47864');
          await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
        } else if (interaction.customId === 'team_leaderboard') {
          await showLeaderboard(interaction, 0);
        } else if (interaction.customId.startsWith('team_lb_prev_')) {
          const page = parseInt(interaction.customId.replace('team_lb_prev_', ''), 10);
          await showLeaderboard(interaction, Math.max(page - 1, 0), true);
        } else if (interaction.customId.startsWith('team_lb_next_')) {
          const page = parseInt(interaction.customId.replace('team_lb_next_', ''), 10);
          await showLeaderboard(interaction, page + 1, true);
        } else if (interaction.customId === 'team_search') {
          const rows = await sbRequest('GET', 'teams', { query: 'select=id,name&order=name.asc&limit=25' });
          if (!rows.length) {
            await interaction.reply({ content: 'Aucune équipe trouvée.', ephemeral: true });
            return;
          }
          const menu = new StringSelectMenuBuilder()
            .setCustomId('team_search_select')
            .setPlaceholder('Sélectionne une équipe');
          for (const t of rows) {
            menu.addOptions({ label: t.name, value: String(t.id) });
          }
          await interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
        } else if (interaction.customId === 'team_schedule') {
          const modal = new ModalBuilder()
            .setTitle('Programmer un match')
            .setCustomId('team_schedule_modal')
            .addComponents(
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('opponent').setLabel('Équipe adverse').setStyle(TextInputStyle.Short).setRequired(true)),
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('date').setLabel('Date/heure').setStyle(TextInputStyle.Short).setRequired(true))
            );
          await interaction.showModal(modal);
        } else if (interaction.customId === 'team_disband') {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('team_disband_confirm').setLabel('Confirmer').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('team_disband_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
          );
          await interaction.reply({ content: 'Confirmer la dissolution ?', components: [row], ephemeral: true });
        } else if (interaction.customId === 'team_disband_confirm') {
          const team = await findTeamByUser(interaction.user.id);
          if (!team || team.captain_id !== interaction.user.id) {
            await interaction.reply({ content: 'Capitaine uniquement.', ephemeral: true });
            return;
          }
          await sbRequest('DELETE', `team_members?team_id=eq.${team.id}`);
          await sbRequest('DELETE', `teams?id=eq.${team.id}`);
          if (interaction.guild) {
            const role = interaction.guild.roles.cache.find(r => r.name === team.name);
            if (role) await role.delete().catch(() => {});
            const category = interaction.guild.channels.cache.find(c => c.name === team.name && c.type === ChannelType.GuildCategory);
            if (category) {
              const children = interaction.guild.channels.cache.filter(ch => ch.parentId === category.id);
              for (const ch of children.values()) await ch.delete().catch(() => {});
              await category.delete().catch(() => {});
            }
          }
          await interaction.update({ content: `L\u2019équipe **${team.name}** a été dissoute.`, components: [] });
        } else if (interaction.customId === 'team_disband_cancel') {
          await interaction.update({ content: 'Action annulée.', components: [] });
        } else if (interaction.customId.startsWith('team_kick_')) {
          const userId = interaction.customId.split('_')[2];
          const team = await findTeamByUser(interaction.user.id);
          if (!team || team.captain_id !== interaction.user.id) {
            await interaction.reply({ content: 'Capitaine uniquement.', ephemeral: true });
            return;
          }
          await sbRequest('DELETE', `team_members?user_id=eq.${userId}&team_id=eq.${team.id}`);
          await interaction.reply({ content: `<@${userId}> a été expulsé.`, ephemeral: true });
        } else if (interaction.customId.startsWith('team_promote_')) {
          const userId = interaction.customId.split('_')[2];
          const team = await findTeamByUser(interaction.user.id);
          if (!team || team.captain_id !== interaction.user.id) {
            await interaction.reply({ content: 'Capitaine uniquement.', ephemeral: true });
            return;
          }
          await sbRequest('PATCH', `teams?id=eq.${team.id}`, { body: { captain_id: userId } });
          await interaction.reply({ content: `<@${userId}> est maintenant capitaine.`, ephemeral: true });
        }
      } else if (interaction.isUserSelectMenu()) {
        if (interaction.customId === 'team_invite_select') {
          const userId = interaction.values[0];
          const menu = new StringSelectMenuBuilder()
            .setCustomId(`team_invite_role_${userId}`)
            .setPlaceholder('Choisis un rôle')
            .addOptions(
              { label: 'Membre', value: 'member' },
              { label: 'Coach', value: 'coach' },
              { label: 'Manager', value: 'manager' }
            );
          await interaction.update({ components: [new ActionRowBuilder().addComponents(menu)] });
        }
      } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'team_edit_select') {
          const value = interaction.values[0];
          const modal = new ModalBuilder()
            .setTitle('Modifier la team')
            .setCustomId(`team_edit_${value}`)
            .addComponents(
              new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(value).setLabel(`Nouveau ${value}`).setStyle(TextInputStyle.Short).setRequired(true))
            );
          await interaction.showModal(modal);
        } else if (interaction.customId.startsWith('team_invite_role_')) {
          const userId = interaction.customId.replace('team_invite_role_', '');
          const role = interaction.values[0];
          await interaction.deferUpdate();
          const team = await findTeamByUser(interaction.user.id);
          if (!team) {
            await interaction.editReply({ content: 'Vous ne possédez pas de team.', components: [] });
            return;
          }
          if (team.captain_id !== interaction.user.id) {
            await interaction.editReply({ content: 'Seul le capitaine peut inviter.', components: [] });
            return;
          }
          const members = await sbRequest('GET', 'team_members', { query: `team_id=eq.${team.id}` });
          if (members.length >= 6) {
            await interaction.editReply({ content: 'Équipe complète (6 membres max).', components: [] });
            return;
          }
          await sbRequest('POST', 'team_invitations', { body: { team_id: team.id, user_id: userId, status: 'pending', role } });
          const embed = new EmbedBuilder()
            .setTitle('🎟️ Invitation à rejoindre une équipe')
            .setDescription(`<@${interaction.user.id}> t\u2019a invité à rejoindre l\u2019équipe **${team.name}** !\n\n🔹 Veux-tu rejoindre cette équipe et participer à des matchs classés ?\n\n✅ Réponds avec \`/team join ${team.name}\` pour accepter.`)
            .setColor('#a47864')
            .setFooter({ text: 'Auusa.gg - Connecté. Compétitif. Collectif.', iconURL: 'https://i.imgur.com/9FLBUiC.png' })
            .setTimestamp();
          try {
            const user = await interaction.client.users.fetch(userId);
            await user.send({ embeds: [embed] });
          } catch {}
          await interaction.editReply({ content: `<@${userId}> a été invité dans **${team.name}**.`, components: [] });
        } else if (interaction.customId === 'team_search_select') {
          const teamId = interaction.values[0];
          const rows = await sbRequest('GET', 'teams', { query: `id=eq.${teamId}` });
          if (!rows.length) {
            await interaction.update({ content: 'Équipe introuvable.', components: [] });
            return;
          }
          const embed = await buildTeamEmbed(rows[0]);
          await interaction.update({ embeds: [embed], components: [] });
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'team_create_modal') {
          const name = interaction.fields.getTextInputValue('name');
          const desc = interaction.fields.getTextInputValue('desc');
          const existingTeam = await findTeamByUser(interaction.user.id);
          if (existingTeam) return interaction.reply({ content: 'Déjà dans une équipe.', ephemeral: true });
          const exists = await sbRequest('GET', 'teams', { query: `name=eq.${encodeURIComponent(name)}` });
          if (exists.length) return interaction.reply({ content: 'Nom déjà pris.', ephemeral: true });
          const team = await sbRequest('POST', 'teams', { body: { name, description: desc, captain_id: interaction.user.id, elo: 1000 } });
          await sbRequest('POST', 'team_members', { body: { user_id: interaction.user.id, team_id: team[0].id } }).catch(() => {});
          await createTeamResources(interaction, name);
          await interaction.reply({ content: 'Équipe créée !', ephemeral: true });
        } else if (interaction.customId === 'team_join_modal') {
          const name = interaction.fields.getTextInputValue('name');
          const rows = await sbRequest('GET', 'teams', { query: `name=eq.${encodeURIComponent(name)}` });
          if (!rows.length) return interaction.reply({ content: 'Équipe introuvable.', ephemeral: true });
          await sbRequest('POST', 'team_members', { body: { user_id: interaction.user.id, team_id: rows[0].id } }).catch(() => {});
          await interaction.reply({ content: `Rejoint **${rows[0].name}** !`, ephemeral: true });
        } else if (interaction.customId.startsWith('team_edit_')) {
          const field = interaction.customId.replace('team_edit_', '');
          const value = interaction.fields.getTextInputValue(field);
          const team = await findTeamByUser(interaction.user.id);
          if (!team || team.captain_id !== interaction.user.id) {
            await interaction.reply({ content: 'Capitaine uniquement.', ephemeral: true });
            return;
          }
          const body = {};
          body[field] = value;
          await sbRequest('PATCH', `teams?id=eq.${team.id}`, { body });
          await interaction.reply({ content: 'Équipe mise à jour.', ephemeral: true });
        } else if (interaction.customId === 'team_search_modal') {
          const name = interaction.fields.getTextInputValue('name');
          const rows = await sbRequest('GET', 'teams', { query: `name=ilike.${encodeURIComponent(name)}` });
          if (!rows.length) return interaction.reply({ content: 'Équipe introuvable.', ephemeral: true });
          const embed = await buildTeamEmbed(rows[0]);
          await interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (interaction.customId === 'team_schedule_modal') {
          const opponent = interaction.fields.getTextInputValue('opponent');
          const date = interaction.fields.getTextInputValue('date');
          const team = await findTeamByUser(interaction.user.id);
          if (!team || team.captain_id !== interaction.user.id) {
            await interaction.reply({ content: 'Capitaine uniquement.', ephemeral: true });
            return;
          }
          const oppRows = await sbRequest('GET', 'teams', { query: `name=eq.${encodeURIComponent(opponent)}` });
          if (!oppRows.length) return interaction.reply({ content: 'Équipe adverse introuvable.', ephemeral: true });
          await sbRequest('POST', 'match_history', { body: { team_a: team.id, team_b: oppRows[0].id, score: '', date } });
          await interaction.reply({ content: 'Match programmé.', ephemeral: true });
        }
      }
    } catch (err) {
      console.error(err);
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ content: `Erreur: ${err.message}` });
        } else if (interaction.replied) {
          await interaction.followUp({ content: `Erreur: ${err.message}`, ephemeral: true });
        } else {
          await interaction.reply({ content: `Erreur: ${err.message}`, flags: MessageFlags.Ephemeral });
        }
      } catch (e) {
        console.error('Failed to send error reply:', e);
      }
    }
  });
}
