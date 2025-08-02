import {
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ApplicationCommandOptionType
} from 'discord.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BAKKES_ENDPOINT = process.env.BAKKES_ENDPOINT || 'http://localhost:6969';
// Permet d'accepter SUPABASE_URL avec ou sans le segment /rest/v1
const BASE_URL = SUPABASE_URL?.replace(/\/rest\/v1\/?$/, '');
// Catégorie regroupant les salons temporaires de match
const MATCH_CATEGORY_ID = process.env.MATCH_CATEGORY_ID;

function getMatchCategoryId(guild) {
  return MATCH_CATEGORY_ID && guild.channels.cache.has(MATCH_CATEGORY_ID)
    ? MATCH_CATEGORY_ID
    : undefined;
}

async function sbRequest(method, table, { query = '', body } = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL et SUPABASE_KEY doivent être définies');
  }
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
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    throw new Error(`Échec de la requête vers Supabase: ${err.message}`);
  }
  if (!res.ok) {
    let msg;
    try {
      const data = await res.json();
      msg = data.message || JSON.stringify(data);
    } catch {
      msg = await res.text();
    }
    throw new Error(`Supabase ${method} ${table} ${res.status} : ${msg}`);
  }
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`Réponse invalide de Supabase : ${err.message}`);
  }
}

const activeMatches = new Map(); // matchId -> data
let counter = 0;

function parseMatchChannel(name) {
  const m = name.match(/\d+v\d+/);
  if (!m) return null;
  const [a, b] = m[0].split('v').map(Number);
  return { type: m[0], maxPlayers: a === b ? a * 2 : a + b };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function setupAdvancedMatchmaking(client) {
  client.once('ready', async () => {
    try {
      await client.application.commands.create({
        name: 'host-config',
        description: 'Renseigner la partie Rocket League',
        options: [
          {
            name: 'nom',
            description: 'Nom de la partie',
            type: ApplicationCommandOptionType.String,
            required: true
          },
          {
            name: 'password',
            description: 'Mot de passe',
            type: ApplicationCommandOptionType.String,
            required: true
          }
        ]
      });
    } catch (err) {
      console.error('Création commande /host-config échouée', err);
    }
  });

  client.on('voiceStateUpdate', async (oldState, newState) => {
    const channel = newState.channel;
    if (!channel) return;
    const info = parseMatchChannel(channel.name);
    if (!info) return;
    const members = channel.members.filter(m => !m.user.bot);
    if (members.size !== info.maxPlayers) return;
    counter += 1;
    const number = String(counter).padStart(4, '0');
    const guild = channel.guild;
    const players = [...members.values()];
    const parent = getMatchCategoryId(guild);

    const text = await guild.channels.create({
      name: `🔒│${info.type}-match-${number}`,
      type: ChannelType.GuildText,
      ...(parent ? { parent } : {}),
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: PermissionsBitField.Flags.ViewChannel },
        ...players.map(p => ({ id: p.id, allow: PermissionsBitField.Flags.ViewChannel }))
      ]
    });

    const voice = await guild.channels.create({
      name: `🎙️│Match #${number}`,
      type: ChannelType.GuildVoice,
      ...(parent ? { parent } : {}),
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: PermissionsBitField.Flags.Connect },
        ...players.map(p => ({ id: p.id, allow: PermissionsBitField.Flags.Connect }))
      ]
    });

    for (const m of players) {
      if (m.voice.channel) await m.voice.setChannel(voice).catch(() => {});
    }

    const [session] = await sbRequest('POST', 'match_sessions', {
      body: {
        type: info.type,
        players: players.map(p => p.id),
        voice_channel_id: voice.id,
        text_channel_id: text.id,
        status: 'pending',
        created_at: new Date().toISOString()
      }
    });

    const is1v1 = info.maxPlayers === 2;
    activeMatches.set(session.id, {
      id: session.id,
      players: players.map(p => p.id),
      textId: text.id,
      voiceId: voice.id,
      candidates: is1v1 ? new Set(players.map(p => p.id)) : new Set(),
      hostId: null,
      teamVoiceIds: [],
      ...(is1v1 ? { captains: players.map(p => p.id) } : {})
    });

    if (is1v1) {
      await text.send(`Capitaines : <@${players[0].id}> et <@${players[1].id}>`);
      const hostEmbed = new EmbedBuilder()
        .setTitle('🔨 Qui héberge ?')
        .setDescription('➤ Cliquez sur “Je veux héberger”\n➤ Ensuite, utilisez `/host-config`.');
      const hostBtn = new ButtonBuilder()
        .setCustomId(`host_${session.id}`)
        .setLabel('Je veux héberger')
        .setStyle(ButtonStyle.Success);
      await text.send({ embeds: [hostEmbed], components: [new ActionRowBuilder().addComponents(hostBtn)] });
    } else {
      const capEmbed = new EmbedBuilder()
        .setTitle('🥂 Sélection des capitaines')
        .setDescription('➤ Cliquez pour vous proposer. Deux seront choisis.');
      const capBtn = new ButtonBuilder()
        .setCustomId(`cap_${session.id}`)
        .setLabel('Me proposer')
        .setStyle(ButtonStyle.Primary);
      await text.send({ embeds: [capEmbed], components: [new ActionRowBuilder().addComponents(capBtn)] });
    }
  });

  client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('cap_')) {
        const matchId = interaction.customId.slice(4);
        const match = activeMatches.get(matchId);
        if (!match || !match.players.includes(interaction.user.id))
          return interaction.reply({ content: 'Non autorisé.', ephemeral: true });
        match.candidates.add(interaction.user.id);
        await interaction.reply({ content: 'Candidature enregistrée.', ephemeral: true });
        if (match.candidates.size >= 2 && !match.captains) {
          const arr = [...match.candidates];
          const picks = arr.length > 2 ? shuffle(arr).slice(0, 2) : arr;
          match.captains = picks;
          const text = client.channels.cache.get(match.textId);
          if (text)
            await text.send(`Capitaines : <@${picks[0]}> et <@${picks[1]}>`);
          const hostEmbed = new EmbedBuilder()
            .setTitle('🔨 Qui héberge ?')
            .setDescription('➤ Cliquez sur “Je veux héberger”\n➤ Ensuite, utilisez `/host-config`.');
          const hostBtn = new ButtonBuilder()
            .setCustomId(`host_${matchId}`)
            .setLabel('Je veux héberger')
            .setStyle(ButtonStyle.Success);
          if (text)
            await text.send({ embeds: [hostEmbed], components: [new ActionRowBuilder().addComponents(hostBtn)] });
        }
        return;
      }
      if (interaction.customId.startsWith('host_')) {
        const matchId = interaction.customId.slice(5);
        const match = activeMatches.get(matchId);
        if (!match || !match.players.includes(interaction.user.id))
          return interaction.reply({ content: 'Non autorisé.', ephemeral: true });
        if (match.hostId)
          return interaction.reply({ content: 'Hôte déjà choisi.', ephemeral: true });
        match.hostId = interaction.user.id;
        await interaction.reply({ content: 'Vous êtes l\'hôte. Utilisez `/host-config` ici.', ephemeral: true });
        return;
      }
      if (interaction.customId.startsWith('report_')) {
        const matchId = interaction.customId.slice(7);
        await sbRequest('POST', 'match_reports', {
          body: { match_id: matchId, reporter_id: interaction.user.id, reason: 'unspecified', created_at: new Date().toISOString() }
        }).catch(() => {});
        await interaction.reply({ content: 'Problème signalé.', ephemeral: true });
        return;
      }
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'host-config') {
      const matchId = [...activeMatches.values()].find(m => m.textId === interaction.channelId)?.id;
      if (!matchId) return interaction.reply({ content: 'Pas de match ici.', ephemeral: true });
      const match = activeMatches.get(matchId);
      if (interaction.user.id !== match.hostId)
        return interaction.reply({ content: 'Seul l\'hôte peut utiliser cette commande.', ephemeral: true });
      const name = interaction.options.getString('nom');
      const pwd = interaction.options.getString('password');
      await sbRequest('PATCH', `match_sessions?id=eq.${matchId}`, { body: { rl_name: name, rl_password: pwd, status: 'ready' } }).catch(() => {});
      await interaction.reply({ content: 'Infos enregistrées.', ephemeral: true });
      const text = interaction.channel;
      if (text)
        await text.send(`🎮 Partie prête !\nNom : **${name}**\nMot de passe : **${pwd}**`);
      const guild = interaction.guild;
      if (guild) {
        const parent = getMatchCategoryId(guild);
        const shuffled = shuffle(match.players);
        const [capBlueId, capOrangeId] = match.captains || [];
        const others = shuffled.filter(id => id !== capBlueId && id !== capOrangeId);
        const teamSize = Math.floor(shuffled.length / 2);
        const teamBlue = capBlueId ? [capBlueId, ...others.slice(0, teamSize - 1)] : shuffled.slice(0, teamSize);
        const teamOrange = capOrangeId ? [capOrangeId, ...others.slice(teamSize - 1)] : shuffled.slice(teamSize);

        const fetchMember = async id =>
          guild.members.cache.get(id) || (await guild.members.fetch(id).catch(() => null));

        const capBlueMember = capBlueId ? await fetchMember(capBlueId) : null;
        const capOrangeMember = capOrangeId ? await fetchMember(capOrangeId) : null;

        const blue = await guild.channels.create({
          name: `🔵│Team ${capBlueMember ? capBlueMember.displayName : 'Bleue'}`,
          type: ChannelType.GuildVoice,
          ...(parent ? { parent } : {}),
          permissionOverwrites: [
            { id: guild.roles.everyone, deny: PermissionsBitField.Flags.Connect },
            ...teamBlue.map(id => ({ id, allow: PermissionsBitField.Flags.Connect }))
          ]
        });
        const orange = await guild.channels.create({
          name: `🟠│Team ${capOrangeMember ? capOrangeMember.displayName : 'Orange'}`,
          type: ChannelType.GuildVoice,
          ...(parent ? { parent } : {}),
          permissionOverwrites: [
            { id: guild.roles.everyone, deny: PermissionsBitField.Flags.Connect },
            ...teamOrange.map(id => ({ id, allow: PermissionsBitField.Flags.Connect }))
          ]
        });
        match.teamVoiceIds = [blue.id, orange.id];
        for (const id of teamBlue) {
          const m = guild.members.cache.get(id);
          if (m?.voice.channel) await m.voice.setChannel(blue).catch(() => {});
        }
        for (const id of teamOrange) {
          const m = guild.members.cache.get(id);
          if (m?.voice.channel) await m.voice.setChannel(orange).catch(() => {});
        }
        await sbRequest('POST', 'temp_channels', { body: { match_id: matchId, text_channel_id: text.id, voice_channel_id: blue.id, expiry_timestamp: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() } }).catch(() => {});
        await sbRequest('POST', 'temp_channels', { body: { match_id: matchId, text_channel_id: text.id, voice_channel_id: orange.id, expiry_timestamp: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() } }).catch(() => {});
      }
      if (BAKKES_ENDPOINT) {
        try {
          await fetch(`${BAKKES_ENDPOINT}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password: pwd })
          });
          if (text) await text.send('📡 BakkesMod contacté pour lancer la partie.');
        } catch {
          if (text) await text.send('⚠️ Impossible de contacter le BakkesMod de l\'hôte.');
        }
      }
      return;
    }
  });
}

export async function handleMatchResult(data, client) {
  const names = (data.players || []).map(p => p.name);
  const ids = [];
  for (const n of names) {
    const rows = await sbRequest('GET', 'users', { query: `rl_name=eq.${encodeURIComponent(n)}` }).catch(() => []);
    if (rows.length) ids.push(rows[0].discord_id);
  }
  for (const [id, match] of activeMatches) {
    const setA = new Set(match.players);
    const setB = new Set(ids);
    if (setA.size === setB.size && [...setA].every(v => setB.has(v))) {
      const text = client.channels.cache.get(match.textId);
      if (text) {
        const btn = new ButtonBuilder().setCustomId(`report_${id}`).setLabel('🚨 Signaler un problème').setStyle(ButtonStyle.Danger);
        await text.send({ content: '❗ Partie terminée. Vous avez 2 minutes pour signaler un problème.', components: [new ActionRowBuilder().addComponents(btn)] });
        setTimeout(async () => {
          await text.delete().catch(() => {});
        }, 2 * 60 * 1000);
      }
      for (const vid of [match.voiceId, ...(match.teamVoiceIds || [])]) {
        const c = client.channels.cache.get(vid);
        if (c) await c.delete().catch(() => {});
      }
      await sbRequest('PATCH', `match_sessions?id=eq.${id}`, { body: { status: 'finished' } }).catch(() => {});
      activeMatches.delete(id);
      break;
    }
  }
}
