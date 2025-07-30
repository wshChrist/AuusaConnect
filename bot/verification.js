import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function setupVerification(client) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const VERIFY_FILE = path.join(__dirname, 'verify.json');
  let verifyMessageId = null;

  client.once('ready', async () => {
    const channelId = process.env.VERIFY_CHANNEL_ID;
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    try {
      const data = JSON.parse(fs.readFileSync(VERIFY_FILE, 'utf8'));
      verifyMessageId = data.messageId;
    } catch {
      const msg = await channel.send('Cliquez sur ✅ pour accéder au serveur.');
      await msg.react('✅');
      verifyMessageId = msg.id;
      fs.writeFileSync(VERIFY_FILE, JSON.stringify({ messageId: msg.id }));
    }

    try {
      const msg = await channel.messages.fetch(verifyMessageId);
      if (!msg.reactions.cache.has('✅')) await msg.react('✅');
    } catch {
      const msg = await channel.send('Cliquez sur ✅ pour accéder au serveur.');
      await msg.react('✅');
      verifyMessageId = msg.id;
      fs.writeFileSync(VERIFY_FILE, JSON.stringify({ messageId: msg.id }));
    }
  });

  client.on('guildMemberAdd', async member => {
    const roleName = process.env.UNVERIFIED_ROLE || 'Non vérifié';
    const role = member.guild.roles.cache.find(r => r.name === roleName);
    if (role) await member.roles.add(role).catch(() => {});
  });

  client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (!verifyMessageId || reaction.message.id !== verifyMessageId) return;
    if (reaction.emoji.name !== '✅') return;
    const guild = reaction.message.guild;
    const member = guild.members.cache.get(user.id);
    if (!member) return;
    const verified = guild.roles.cache.find(r => r.name === (process.env.VERIFIED_ROLE || 'Membre'));
    const unverified = guild.roles.cache.find(r => r.name === (process.env.UNVERIFIED_ROLE || 'Non vérifié'));
    if (verified) await member.roles.add(verified).catch(() => {});
    if (unverified) await member.roles.remove(unverified).catch(() => {});
  });
}
