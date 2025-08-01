import {
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';

export function setupMatchmaking(client) {
  const modes = {
    '🎮 Ranked 1v1': 2,
    '🎮 Ranked 2v2': 4,
  };
  const banRoleName = '🚫 Banni Ranked';
  const bakkesRole = '🧩 BakkesMod';
  const consoleRole = 'Console';
  const MATCH_CATEGORY_ID = '1400845391238398112';
  const bans = new Map(); // userId -> {count}
  let matchCounter = 0;

  // reset daily
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      for (const b of bans.values()) b.count = 0;
    }
  }, 60 * 1000);

  client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!newState.channel || !modes[newState.channel.name]) return;
    const required = modes[newState.channel.name];
    const members = newState.channel.members.filter(m => !m.user.bot);
    if (members.size === required) {
      startMatch(newState.channel, [...members.values()]);
    }
  });

  async function startMatch(channel, players) {
    matchCounter++;
    const guild = channel.guild;
    const modRole = guild.roles.cache.find(r => /mod/i.test(r.name));
    const banRole = guild.roles.cache.find(r => r.name === banRoleName);

    const privateVocal = await guild.channels.create({
      name: `🔐 Ranked Match #${matchCounter}`,
      type: ChannelType.GuildVoice,
      parent: MATCH_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: PermissionsBitField.Flags.Connect },
        ...players.map(p => ({ id: p.id, allow: PermissionsBitField.Flags.Connect })),
        ...(modRole ? [{ id: modRole.id, allow: PermissionsBitField.Flags.Connect }] : [])
      ]
    });

    const privateText = await guild.channels.create({
      name: `ranked-match-${matchCounter}`,
      type: ChannelType.GuildText,
      parent: MATCH_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: PermissionsBitField.Flags.ViewChannel },
        ...players.map(p => ({ id: p.id, allow: PermissionsBitField.Flags.ViewChannel })),
        ...(modRole ? [{ id: modRole.id, allow: PermissionsBitField.Flags.ViewChannel }] : [])
      ]
    });

    for (const p of players) {
      if (p.voice.channel) await p.voice.setChannel(privateVocal);
    }

    const readyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ready_yes').setLabel('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ready_no').setLabel('❌').setStyle(ButtonStyle.Danger)
    );

    const msg = await privateText.send({
      content: '🎯 Êtes-vous prêts à lancer la partie classée ?\n👉 Appuyez sur ✅ pour valider ou ❌ pour refuser.',
      components: [readyRow]
    });

    const ready = new Set();
    const collector = msg.createMessageComponentCollector({ time: 30000 });

    collector.on('collect', async i => {
      if (!players.some(p => p.id === i.user.id)) {
        await i.reply({ content: 'Vous ne participez pas à ce match.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (i.customId === 'ready_yes') {
        ready.add(i.user.id);
        await i.reply({ content: 'Validé.', flags: MessageFlags.Ephemeral });
      } else {
        await i.reply({ content: 'Match annulé.', flags: MessageFlags.Ephemeral });
        collector.stop('refused:' + i.user.id);
      }
      if (ready.size === players.length) collector.stop('validated');
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'validated') {
        await chooseHost(privateText, players);
        await addCleanButton(privateText, privateVocal);
      } else {
        const id = reason.startsWith('refused:') ? reason.split(':')[1] : null;
        await cancelMatch(id, privateText);
        await privateVocal.delete().catch(() => {});
        await privateText.delete().catch(() => {});
      }
    });

    async function cancelMatch(id, text) {
      if (id && banRole) await applyBan(guild, id, banRole);
      await text.send('⛔ Match annulé.');
    }
  }

  async function chooseHost(channel, players) {
    const nonConsole = players.filter(p => !p.roles.cache.some(r => r.name === consoleRole));
    const withBakkes = nonConsole.filter(p => p.roles.cache.some(r => r.name === bakkesRole));
    const pool = withBakkes.length ? withBakkes : nonConsole;
    const host = pool[Math.floor(Math.random() * pool.length)];
    await channel.send(`🎮 Partie créée !\n${host} est l'hôte. Crée une partie privée Rocket League et envoie le **nom** et le **code** ici.`);
  }

  async function addCleanButton(text, vocal) {
    const btn = new ButtonBuilder().setCustomId('clean_match').setLabel('🧹 Fin de match').setStyle(ButtonStyle.Secondary);
    const msg = await text.send({ content: 'Cliquez sur le bouton pour terminer le match.', components: [new ActionRowBuilder().addComponents(btn)] });
    const coll = msg.createMessageComponentCollector({ time: 2 * 60 * 60 * 1000 });
    coll.on('collect', async i => {
      await i.reply({ content: 'Nettoyage...', flags: MessageFlags.Ephemeral });
      coll.stop();
      await text.delete().catch(() => {});
      await vocal.delete().catch(() => {});
    });
  }

  async function applyBan(guild, userId, banRole) {
    const member = guild.members.cache.get(userId);
    if (!member) return;
    const info = bans.get(userId) || { count: 0 };
    info.count += 1;
    const minutes = info.count <= 4 ? [5, 10, 20, 30][info.count - 1] : Math.pow(2, info.count - 5) * 60;
    bans.set(userId, info);
    await member.roles.add(banRole);
    try { await member.send(`Vous êtes banni du matchmaking pendant ${minutes} minutes.`); } catch {}
    setTimeout(async () => {
      await member.roles.remove(banRole).catch(() => {});
    }, minutes * 60 * 1000);
    const log = guild.channels.cache.find(c => c.name === 'matchmaking-logs');
    if (log) await log.send(`<@${userId}> banni du matchmaking ${minutes} min.`);
  }
}
