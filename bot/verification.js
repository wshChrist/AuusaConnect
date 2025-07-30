import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

async function applyRolesFromReactions(message, storedRoleId) {
  const guild = message.guild;
  let verified = null;
  if (storedRoleId) {
    verified =
      guild.roles.cache.get(storedRoleId) ||
      (await guild.roles.fetch(storedRoleId).catch(() => null));
  }
  if (!verified) {
    verified = guild.roles.cache.find(
      r => r.name === (process.env.VERIFIED_ROLE || 'Membre')
    );
  }
  const unverified = guild.roles.cache.find(
    r => r.name === (process.env.UNVERIFIED_ROLE || 'Non vérifié')
  );

  const react = message.reactions.cache.get('✅');
  if (!react) return;
  const users = await react.users.fetch();
  for (const [id, user] of users) {
    if (user.bot) continue;
    const member =
      guild.members.cache.get(id) || (await guild.members.fetch(id).catch(() => null));
    if (!member) continue;
    if (verified) await member.roles.add(verified).catch(() => {});
    if (unverified) await member.roles.remove(unverified).catch(() => {});
  }
}

export function setupVerification(client) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const VERIFY_FILE = path.join(__dirname, 'verify.json');
  let verifyMessageId = null;
  let verifyChannelId = null;
  let verifyRoleId = null;

  try {
    const data = JSON.parse(fs.readFileSync(VERIFY_FILE, 'utf8'));
    verifyMessageId = data.messageId || null;
    verifyChannelId = data.channelId || null;
    verifyRoleId = data.roleId || null;
  } catch {
    verifyMessageId = null;
    verifyChannelId = null;
    verifyRoleId = null;
  }


  client.once('ready', async () => {
    if (!verifyChannelId) return;
    const channel = await client.channels.fetch(verifyChannelId).catch(() => null);
    if (!channel) return;

    let msg;
    if (!verifyMessageId) {
      msg = await channel.send('Cliquez sur ✅ pour accéder au serveur.');
      await msg.react('✅');
      verifyMessageId = msg.id;
      fs.writeFileSync(
        VERIFY_FILE,
        JSON.stringify({ channelId: verifyChannelId, messageId: msg.id, roleId: verifyRoleId })
      );
    } else {
      try {
        msg = await channel.messages.fetch(verifyMessageId);
        if (!msg.reactions.cache.has('✅')) await msg.react('✅');
      } catch {
        msg = await channel.send('Cliquez sur ✅ pour accéder au serveur.');
        await msg.react('✅');
        verifyMessageId = msg.id;
        fs.writeFileSync(
          VERIFY_FILE,
          JSON.stringify({ channelId: verifyChannelId, messageId: msg.id, roleId: verifyRoleId })
        );
      }
    }

    if (msg) await applyRolesFromReactions(msg, verifyRoleId);
  });

  client.on('guildMemberAdd', async member => {
    const roleName = process.env.UNVERIFIED_ROLE || 'Non vérifié';
    let role = member.guild.roles.cache.find(r => r.name === roleName);
    if (!role) {
      try {
        role = await member.guild.roles.create({ name: roleName, reason: 'Role non vérifié' });
      } catch {
        role = null;
      }
    }
    if (role) await member.roles.add(role).catch(() => {});
  });

  client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (!verifyMessageId || reaction.message.id !== verifyMessageId) return;
    if (reaction.emoji.name !== '✅') return;
    const guild = reaction.message.guild;
    const member = guild.members.cache.get(user.id);
    if (!member) return;
    let verified = null;
    if (verifyRoleId) {
      verified = guild.roles.cache.get(verifyRoleId) || await guild.roles.fetch(verifyRoleId).catch(() => null);
    }
    if (!verified) {
      verified = guild.roles.cache.find(r => r.name === (process.env.VERIFIED_ROLE || 'Membre'));
    }
    const unverified = guild.roles.cache.find(r => r.name === (process.env.UNVERIFIED_ROLE || 'Non vérifié'));
    if (verified) await member.roles.add(verified).catch(() => {});
    if (unverified) await member.roles.remove(unverified).catch(() => {});
  });
}


export async function runVerificationSetup(interaction) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const VERIFY_FILE = path.join(__dirname, 'verify.json');
  const guild = interaction.guild;
  const selectedRole = interaction.options.getRole('role');
  const verifiedName = process.env.VERIFIED_ROLE || 'Membre';
  const unverifiedName = process.env.UNVERIFIED_ROLE || 'Non vérifié';

  let verified = selectedRole || guild.roles.cache.find(r => r.name === verifiedName);
  if (!verified && !selectedRole) {
    verified = await guild.roles.create({ name: verifiedName, reason: 'Role vérifié' }).catch(() => null);
  }
  let unverified = guild.roles.cache.find(r => r.name === unverifiedName);
  if (!unverified) {
    unverified = await guild.roles.create({ name: unverifiedName, reason: 'Role non vérifié' }).catch(() => null);
  }

  // Cherche s'il existe déjà un message avec une réaction dans ce salon
  let msg = null;
  try {
    const messages = await interaction.channel.messages.fetch({ limit: 50 });
    msg = messages.find(m => m.reactions.cache.size > 0) || null;
  } catch {
    msg = null;
  }

  // Sinon crée un nouveau message pour la vérification
  if (!msg) {
    msg = await interaction.channel.send('Cliquez sur ✅ pour accéder au serveur.');
  }

  if (!msg.reactions.cache.has('✅')) {
    await msg.react('✅');
  }

  await applyRolesFromReactions(msg, verified ? verified.id : null);

  fs.writeFileSync(VERIFY_FILE, JSON.stringify({ channelId: interaction.channel.id, messageId: msg.id, roleId: verified ? verified.id : null }));
  await interaction.reply({ content: 'Système de vérification installé.', ephemeral: true });
}
