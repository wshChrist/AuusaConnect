import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ApplicationCommandOptionType,
  PermissionsBitField
} from 'discord.js';

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
    try {
      msg = (await res.json()).message;
    } catch {
      msg = res.statusText;
    }
    throw new Error(msg);
  }
  return res.json();
}

export const registrationButton = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('registration_start')
    .setLabel("S'enregistrer")
    .setStyle(ButtonStyle.Primary)
);

export function setupRegistration(client) {
  client.once('ready', async () => {
    try {
      await client.application.commands.create({
        name: 'enregistrement',
        description: "Envoyer le bouton d'enregistrement",
        options: [
          {
            name: 'channel',
            description: 'Salon où afficher le message',
            type: ApplicationCommandOptionType.Channel,
            required: true
          },
          {
            name: 'embed_json',
            description: 'Embed Discord au format JSON',
            type: ApplicationCommandOptionType.String,
            required: true
          }
        ]
      });
    } catch (err) {
      console.error("Création commande /enregistrement échouée", err);
    }
  });

  client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'enregistrement') {
      const perms = interaction.memberPermissions || interaction.member?.permissions;
      if (!perms?.has(PermissionsBitField.Flags.ManageMessages)) {
        await interaction.reply({ content: 'Permissions insuffisantes.', ephemeral: true });
        return;
      }
      const channel = interaction.options.getChannel('channel');
      const embedJson = interaction.options.getString('embed_json');

      let embedData;
      let content;
      try {
        const parsed = JSON.parse(embedJson);
        if (Array.isArray(parsed.embeds)) {
          embedData = parsed.embeds[0] || {};
          content = parsed.content;
        } else {
          embedData = parsed;
        }

        if (typeof embedData.description !== 'string' || embedData.description.trim() === '') {
          embedData.description = '\u200B';
        }
      } catch (err) {
        await interaction.reply({ content: 'Embed JSON invalide.', ephemeral: true });
        return;
      }

      try {
        const embed = EmbedBuilder.from(embedData);
        const payload = { embeds: [embed], components: [registrationButton] };
        if (typeof content === 'string' && content.trim() !== '') {
          payload.content = content;
        }
        await channel.send(payload);
        await interaction.reply({ content: 'Bouton envoyé.', ephemeral: true });
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: `Erreur : ${err.message}`, ephemeral: true });
      }
      return;
    }
    if (interaction.isButton() && interaction.customId === 'registration_start') {
      const modal = new ModalBuilder()
        .setCustomId('registration_modal')
        .setTitle('Enregistrement')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('pseudo')
              .setLabel('Pseudo Rocket League')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      await interaction.showModal(modal);
      return;
    }

    if (!interaction.isModalSubmit() || interaction.customId !== 'registration_modal') return;

    const rlName = interaction.fields.getTextInputValue('pseudo').trim();
    const guild = interaction.guild;
    if (!guild)
      return interaction.reply({
        content: 'Commande uniquement sur un serveur.',
        flags: MessageFlags.Ephemeral
      });

    try {
      const existing = await sbRequest('GET', 'users', {
        query: `rl_name=eq.${encodeURIComponent(rlName)}`
      });
      if (existing.length && existing[0].discord_id !== interaction.user.id) {
        return interaction.reply({
          content: 'Ce pseudo Rocket League est déjà utilisé.',
          flags: MessageFlags.Ephemeral
        });
      }

      let userRows = await sbRequest('GET', 'users', {
        query: `discord_id=eq.${interaction.user.id}`
      });
      if (userRows.length) {
        const body = {
          rl_name: rlName,
          registered_at: new Date().toISOString()
        };
        if (userRows[0].mmr === null) body.mmr = 1200;
        await sbRequest('PATCH', `users?discord_id=eq.${interaction.user.id}`, {
          body
        });
        userRows = await sbRequest('GET', 'users', {
          query: `discord_id=eq.${interaction.user.id}`
        });
      } else {
        const body = {
          discord_id: interaction.user.id,
          rl_name: rlName,
          mmr: 1200,
          registered_at: new Date().toISOString()
        };
        userRows = await sbRequest('POST', 'users', { body });
      }
      const user = userRows[0];

      try {
        const creds = await sbRequest('GET', 'match_credentials', {
          query: `player_id=eq.${encodeURIComponent(rlName)}`
        });
        if (!creds.length) {
          await sbRequest('POST', 'match_credentials', {
            body: { player_id: rlName }
          });
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
          role = await guild.roles.create({
            name: roleName,
            reason: 'Role utilisateur enregistré'
          });
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
        .setFooter({
          text: 'Auusa.gg - Connecté. Compétitif. Collectif.',
          iconURL: 'https://i.imgur.com/9FLBUiC.png'
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: `Erreur : ${err.message}`,
        flags: MessageFlags.Ephemeral
      });
    }
  });
}

