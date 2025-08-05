import { ApplicationCommandOptionType, EmbedBuilder, MessageFlags } from 'discord.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BASE_URL = SUPABASE_URL?.replace(/\/rest\/v1\/?$/, '');

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

export function setupRegistration(client) {
  client.once('ready', async () => {
    try {
      await client.application.commands.create({
        name: 'enregistrement',
        description: 'Lier votre pseudo Rocket League',
        options: [
          {
            name: 'pseudo',
            description: 'Pseudo Rocket League',
            type: ApplicationCommandOptionType.String,
            required: true
          }
        ]
      });
    } catch (err) {
      console.error('Création commande /enregistrement échouée', err);
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'enregistrement') return;
    const rlName = interaction.options.getString('pseudo').trim();
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: 'Commande uniquement sur un serveur.', flags: MessageFlags.Ephemeral });

    try {
      const existing = await sbRequest('GET', 'users', { query: `rl_name=eq.${encodeURIComponent(rlName)}` });
      if (existing.length && existing[0].discord_id !== interaction.user.id) {
        return interaction.reply({ content: 'Ce pseudo Rocket League est déjà utilisé.', flags: MessageFlags.Ephemeral });
      }

      let userRows = await sbRequest('GET', 'users', { query: `discord_id=eq.${interaction.user.id}` });
      if (userRows.length) {
        const body = { rl_name: rlName, registered_at: new Date().toISOString() };
        if (userRows[0].mmr === null) body.mmr = 1200;
        await sbRequest('PATCH', `users?discord_id=eq.${interaction.user.id}`, { body });
        userRows = await sbRequest('GET', 'users', { query: `discord_id=eq.${interaction.user.id}` });
      } else {
        const body = { discord_id: interaction.user.id, rl_name: rlName, mmr: 1200, registered_at: new Date().toISOString() };
        userRows = await sbRequest('POST', 'users', { body });
      }
      const user = userRows[0];

      // Ensure a match_credentials entry exists with player_id = rlName
      try {
        const creds = await sbRequest('GET', 'match_credentials', { query: `player_id=eq.${encodeURIComponent(rlName)}` });
        if (!creds.length) {
          await sbRequest('POST', 'match_credentials', { body: { player_id: rlName } });
        }
      } catch (err) {
        console.error('Erreur création credentials', err);
      }

      try {
        await interaction.member.setNickname(`[${user.mmr}] ${rlName}`);
      } catch (err) {
        console.error('Erreur changement pseudo', err);
      }

      const roleName = process.env.REGISTERED_ROLE || 'Enregistré';
      let role = guild.roles.cache.find(r => r.name === roleName);
      if (!role) {
        try {
          role = await guild.roles.create({ name: roleName, reason: 'Role utilisateur enregistré' });
        } catch {
          role = null;
        }
      }
      if (role) await interaction.member.roles.add(role).catch(() => {});

      const embed = new EmbedBuilder()
        .setTitle('✅ Enregistrement terminé !')
        .setDescription(
          `🎮 Pseudo Rocket League : **${rlName}**\n` +
          `🧠 MMR initial : **${user.mmr}**\n` +
          `📎 Ton pseudo a été mis à jour → \`[${user.mmr}] ${rlName}\`\n` +
          '🟢 Tu peux maintenant rejoindre les vocaux de matchmaking.'
        )
        .setColor('#a47864')
        .setFooter({ text: 'Auusa.gg - Connecté. Compétitif. Collectif.', iconURL: 'https://i.imgur.com/9FLBUiC.png' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: `Erreur : ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  });
}

