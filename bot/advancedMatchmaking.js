// Advanced matchmaking logic using Supabase REST API
import {
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ApplicationCommandOptionType
} from 'discord.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

async function sbRequest(method, table, body, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: { ...headers, Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error('Supabase error', method, table, txt);
    throw new Error('Supabase request failed');
  }
  return res.json();
}

const activeMatches = new Map(); // id -> data
let matchCount = 0;

export function setupAdvancedMatchmaking(client) {
  const modes = { '🎮│2v2': { size: 4, type: '2v2' } };

  client.on('voiceStateUpdate', async (_old, state) => {
    if (!state.channel || !modes[state.channel.name]) return;
    const conf = modes[state.channel.name];
    const members = state.channel.members.filter(m => !m.user.bot);
    if (members.size === conf.size) {
      await startMatch(conf.type, state.channel, [...members.values()]);
    }
  });

  client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
      const [action, id] = interaction.customId.split(':');
      const match = activeMatches.get(id);
      if (!match) return;
      if (action === 'cap') await handleCaptain(interaction, match);
      if (action === 'host') await handleHost(interaction, match);
      if (action === 'report') await handleReport(interaction, match);
    }
  });
}

export async function handleHostConfigCommand(interaction) {
  const name = interaction.options.getString('nom');
  const password = interaction.options.getString('motdepasse');
  const match = [...activeMatches.values()].find(m => m.host && m.host.id === interaction.user.id);
  if (!match) {
    await interaction.reply({ content: "Aucun match en attente pour toi.", ephemeral: true });
    return;
  }
  await sbRequest('PATCH', `match_sessions?id=eq.${match.id}`, { RL_name: name, RL_password: password, status: 'ready' });
  await interaction.reply({ content: 'Informations enregistrées.', ephemeral: true });
  const embed = new EmbedBuilder()
    .setTitle('🎮 Partie prête !')
    .setDescription(`Nom : **${name}**\nMot de passe : **${password}**`);
  await match.text.send({ embeds: [embed] });
  await createTeamChannels(match);
}

async function startMatch(type, queueChannel, members) {
  matchCount += 1;
  const guild = queueChannel.guild;
  const text = await guild.channels.create({
    name: `2v2-match-${matchCount}`,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: PermissionsBitField.Flags.ViewChannel },
      ...members.map(m => ({ id: m.id, allow: PermissionsBitField.Flags.ViewChannel }))
    ]
  });
  const voice = await guild.channels.create({
    name: `Match #${matchCount}`,
    type: ChannelType.GuildVoice,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: PermissionsBitField.Flags.Connect },
      ...members.map(m => ({ id: m.id, allow: PermissionsBitField.Flags.Connect }))
    ]
  });
  for (const m of members) if (m.voice.channel) await m.voice.setChannel(voice);
  const [session] = await sbRequest('POST', 'match_sessions', {
    type,
    players: members.map(m => m.id),
    voice_channel_id: voice.id,
    text_channel_id: text.id,
    status: 'waiting'
  });
  await sbRequest('POST', 'temp_channels', { match_id: session.id, text_channel_id: text.id, voice_channel_id: voice.id });
  const match = { id: session.id, players: members, text, voice, captains: [], host: null, teams: [], reported: false };
  activeMatches.set(session.id, match);
  await chooseCaptains(match);
}

async function chooseCaptains(match) {
  const btn = new ButtonBuilder().setCustomId(`cap:${match.id}`).setLabel('Me proposer comme capitaine').setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder().addComponents(btn);
  const embed = new EmbedBuilder().setTitle('🧢 Sélection des capitaines').setDescription('Cliquez pour vous proposer. Deux seront choisis.');
  const msg = await match.text.send({ embeds: [embed], components: [row] });
  const collector = msg.createMessageComponentCollector({ time: 15000 });
  collector.on('collect', async i => {
    if (!match.players.find(p => p.id === i.user.id)) {
      await i.reply({ content: "Vous ne participez pas à ce match.", ephemeral: true });
      return;
    }
    if (!match.captains.find(c => c.id === i.user.id)) match.captains.push(i.member);
    await i.reply({ content: 'Proposition enregistrée.', ephemeral: true });
  });
  collector.on('end', async () => {
    if (match.captains.length < 2) {
      const rest = match.players.filter(p => !match.captains.includes(p));
      while (match.captains.length < 2 && rest.length) {
        const pick = rest.splice(Math.floor(Math.random() * rest.length), 1)[0];
        match.captains.push(pick);
      }
    } else if (match.captains.length > 2) {
      match.captains = shuffle(match.captains).slice(0, 2);
    }
    await match.text.send(`Capitaines : ${match.captains.map(c => c).join(' et ')}`);
    await chooseHost(match);
  });
}

async function chooseHost(match) {
  const btn = new ButtonBuilder().setCustomId(`host:${match.id}`).setLabel('Je veux héberger').setStyle(ButtonStyle.Success);
  const row = new ActionRowBuilder().addComponents(btn);
  const embed = new EmbedBuilder().setTitle('🛠️ Qui héberge ?').setDescription('Cliquez sur "Je veux héberger" puis utilisez /host-config pour renseigner les infos.');
  const msg = await match.text.send({ embeds: [embed], components: [row] });
  const coll = msg.createMessageComponentCollector({ time: 30000 });
  coll.on('collect', async i => {
    if (!match.players.find(p => p.id === i.user.id)) {
      await i.reply({ content: "Vous ne participez pas à ce match.", ephemeral: true });
      return;
    }
    match.host = i.member;
    await i.reply({ content: 'Tu es désigné hôte, configure la partie.', ephemeral: true });
    coll.stop('got');
  });
  coll.on('end', async () => {
    if (!match.host) {
      match.host = match.players[0];
      await match.text.send(`${match.host} est choisi hôte par défaut.`);
    }
    await match.host.send('Utilise la commande /host-config nom=<nom> motdepasse=<mdp> dans le serveur.').catch(() => {});
  });
}

async function handleCaptain(interaction, match) {
  if (match.captains.find(c => c.id === interaction.user.id)) {
    await interaction.reply({ content: 'Déjà proposé.', ephemeral: true });
    return;
  }
  match.captains.push(interaction.member);
  await interaction.reply({ content: 'Proposé comme capitaine.', ephemeral: true });
}

async function handleHost(interaction, match) {
  if (!match.players.find(p => p.id === interaction.user.id)) {
    await interaction.reply({ content: "Vous ne participez pas à ce match.", ephemeral: true });
    return;
  }
  match.host = interaction.member;
  await interaction.reply({ content: 'Tu es désigné hôte. Utilise /host-config.', ephemeral: true });
}

async function createTeamChannels(match) {
  const guild = match.voice.guild;
  const blue = await guild.channels.create({
    name: 'Team Bleue',
    type: ChannelType.GuildVoice,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: PermissionsBitField.Flags.Connect },
      ...match.players.map(p => ({ id: p.id, allow: PermissionsBitField.Flags.Connect }))
    ]
  });
  const orange = await guild.channels.create({
    name: 'Team Orange',
    type: ChannelType.GuildVoice,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: PermissionsBitField.Flags.Connect },
      ...match.players.map(p => ({ id: p.id, allow: PermissionsBitField.Flags.Connect }))
    ]
  });
  match.teams = [blue, orange];
  // simple random split
  const shuffled = shuffle([...match.players]);
  for (let i = 0; i < shuffled.length; i++) {
    const ch = i % 2 === 0 ? blue : orange;
    if (shuffled[i].voice.channel) await shuffled[i].voice.setChannel(ch);
  }
}

export async function handleMatchEnd() {
  const match = [...activeMatches.values()].pop();
  if (!match) return;
  await sbRequest('PATCH', `match_sessions?id=eq.${match.id}`, { status: 'finished' });
  for (const ch of match.teams) await ch.delete().catch(() => {});
  await match.voice.delete().catch(() => {});
  await sbRequest('DELETE', `temp_channels?match_id=eq.${match.id}`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`report:${match.id}`).setLabel('🚨 Signaler un problème').setStyle(ButtonStyle.Danger)
  );
  const embed = new EmbedBuilder().setDescription('🚨 Vous avez 2 minutes pour signaler un problème.');
  await match.text.send({ embeds: [embed], components: [row] });
  setTimeout(() => {
    if (!match.reported) match.text.delete().catch(() => {});
    activeMatches.delete(match.id);
  }, 2 * 60 * 1000);
}

async function handleReport(interaction, match) {
  await sbRequest('POST', 'match_reports', { match_id: match.id, reporter_id: interaction.user.id, reason: 'report' });
  match.reported = true;
  await interaction.reply({ content: 'Problème signalé, un modérateur sera notifié.', ephemeral: true });
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const hostConfigCommand = {
  name: 'host-config',
  description: 'Configurer la partie Rocket League',
  options: [
    { name: 'nom', description: 'Nom de la partie', type: ApplicationCommandOptionType.String, required: true },
    { name: 'motdepasse', description: 'Mot de passe', type: ApplicationCommandOptionType.String, required: true }
  ]
};
