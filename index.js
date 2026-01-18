import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
} from 'discord.js';
import { keepAlive } from './keep_alive.js';
import levelingSystem from './leveling.js';

const CONFIG = {
  MEMBER_ROLE_ID: '1049104030070231151',            // Rol "Miembro" / Grade 4 Sorcerer
  GRADE_3_ROLE_ID: '1078375784290467851',           // Grade 3 Sorcerer
  SPECIAL_GRADE_ROLE_ID: '1457874796594331855',     // Special Grade Sorcerer
  MEMBER_COUNT_CHANNEL_ID: '1138272471301226527',   // Canal Member Count (voz)
  WELCOME_CHANNEL_ID: '880857671597694978',         // Canal de bienvenida
  WELCOME_IMAGE_URL: 'https://images7.alphacoders.com/114/1143187.jpg', // Imagen de bienvenida
  CREATE_ROOM_CHANNEL_ID: '1462238875555463483',    // Create Room (voz) - genera canales temporales
  GENERAL_CHANNEL_ID: '880916181110890516',         // Canal general para notificaciones y level-ups
  LEVELUP_CHANNEL_ID: '880916181110890516',         // Canal para notificaciones de level-up
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,           // Necesario para tener cache completa de miembros
    GatewayIntentBits.MessageContent,         // Necesario para menciones
    GatewayIntentBits.GuildMessageReactions,  // Necesario para reacciones (XP system)
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

const tempChannels = new Map(); // Map<channelId, { ownerId, number }>
const usedNumbers = new Set(); // Track used room numbers

function getNextRoomNumber() {
  let number = 1;
  while (usedNumbers.has(number)) {
    number++;
  }
  usedNumbers.add(number);
  return number;
}

function releaseRoomNumber(number) {
  usedNumbers.delete(number);
}


async function createTempVoiceChannel(member) {
  try {
    const guild = member.guild;
    const createRoomChannel = guild.channels.cache.get(CONFIG.CREATE_ROOM_CHANNEL_ID);
    if (!createRoomChannel) {
      console.error('[CREATE ROOM] Canal "Create Room" no encontrado');
      return null;
    }

    const roomNumber = getNextRoomNumber();
    const channelName = `🌌┇：Chill Cage #${roomNumber}`;

    // Create the temporary voice channel in the same category as Create Room
    const tempChannel = await guild.channels.create({
      name: channelName,
      type: 2, // Voice channel
      parent: createRoomChannel.parentId, // Same category as Create Room
      userLimit: 0, // No limit
      bitrate: createRoomChannel.bitrate || 64000,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: ['Connect', 'Speak', 'Stream', 'UseVAD'],
        },
        {
          id: member.id,
          allow: ['Connect', 'Speak', 'Stream', 'UseVAD', 'ManageChannels', 'MoveMembers'],
        },
      ],
    });

    console.log(`[CREATE ROOM] Canal temporal creado: ${channelName} para ${member.user.tag}`);

    // Send notification to general channel
    let notificationMessageId = null;
    try {
      const generalChannel = await guild.channels.fetch(CONFIG.GENERAL_CHANNEL_ID);
      if (generalChannel && generalChannel.isTextBased()) {
        const notificationMessage = await generalChannel.send({ 
          content: `@everyone\n\n🌌 **Nuevo Room creado por ${member}**\n\n📍 Canal: ${tempChannel}`,
          allowedMentions: { parse: ['everyone'] }
        });
        
        notificationMessageId = notificationMessage.id;
        
        // Pin the message without showing the system message
        try {
          await notificationMessage.pin({ reason: 'Room notification' });
          
          // Delete the system message "Yuta pinned a message"
          const pinnedMessages = await generalChannel.messages.fetch({ limit: 5 });
          const systemMessage = pinnedMessages.find(
            msg => msg.type === 6 && msg.reference?.messageId === notificationMessage.id
          );
          
          if (systemMessage) {
            await systemMessage.delete();
            console.log(`[CREATE ROOM] Mensaje de sistema del pin eliminado`);
          }
          
          console.log(`[CREATE ROOM] Mensaje fijado en el canal general`);
        } catch (pinError) {
          console.error('[CREATE ROOM PIN ERROR]', pinError);
        }
        
        console.log(`[CREATE ROOM] Notificación enviada al canal general con @everyone`);
      }
    } catch (error) {
      console.error('[CREATE ROOM NOTIFICATION ERROR]', error);
    }

    // Store the temp channel info with notification message ID
    tempChannels.set(tempChannel.id, {
      ownerId: member.id,
      number: roomNumber,
      createdAt: Date.now(),
      notificationMessageId: notificationMessageId,
    });

    return tempChannel;
  } catch (error) {
    console.error('[CREATE ROOM ERROR]', error);
    return null;
  }
}

async function deleteTempChannelIfEmpty(channel) {
  if (!tempChannels.has(channel.id)) return;

  try {
    if (channel.members.size === 0) {
      const channelInfo = tempChannels.get(channel.id);
      
      // Delete the notification message from general channel
      if (channelInfo.notificationMessageId) {
        try {
          const generalChannel = await channel.guild.channels.fetch(CONFIG.GENERAL_CHANNEL_ID);
          if (generalChannel && generalChannel.isTextBased()) {
            const notificationMessage = await generalChannel.messages.fetch(channelInfo.notificationMessageId);
            
            // Unpin the message before deleting
            if (notificationMessage.pinned) {
              try {
                await notificationMessage.unpin();
                console.log(`[CREATE ROOM] Mensaje desfijado del canal general`);
              } catch (unpinError) {
                console.error('[CREATE ROOM UNPIN ERROR]', unpinError);
              }
            }
            
            await notificationMessage.delete();
            console.log(`[CREATE ROOM] Notificación eliminada del canal general`);
          }
        } catch (error) {
          console.error('[CREATE ROOM NOTIFICATION DELETE ERROR]', error);
        }
      }
      
      await channel.delete();
      tempChannels.delete(channel.id);
      releaseRoomNumber(channelInfo.number);
      console.log(`[CREATE ROOM] Canal temporal eliminado: ${channel.name}`);
    }
  } catch (error) {
    console.error('[CREATE ROOM DELETE ERROR]', error);
  }
}

async function updateMemberCountChannel(guild) {
  try {
    const channel = await guild.channels.fetch(CONFIG.MEMBER_COUNT_CHANNEL_ID);
    if (!channel || !channel.isVoiceBased()) return;

    await guild.members.fetch();

    const totalMembers = guild.members.cache.size;
    const newName = `𝕄𝕖𝕞𝕓𝕖𝕣 ℂ𝕠𝕦𝕟𝕥: ${totalMembers}`;

    if (channel.name !== newName) {
      await channel.setName(newName);
      console.log(`[MEMBER COUNT] Actualizado a: ${newName}`);
    }
  } catch (error) {
    console.error('[MEMBER COUNT ERROR]', error);
  }
}

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild;
  const member = newState.member;

  // Handle Create Room channel - user joins to create a temp channel
  if (
    newState.channelId === CONFIG.CREATE_ROOM_CHANNEL_ID &&
    oldState.channelId !== CONFIG.CREATE_ROOM_CHANNEL_ID
  ) {
    const tempChannel = await createTempVoiceChannel(member);
    
    if (tempChannel) {
      try {
        await member.voice.setChannel(tempChannel);
        console.log(`[CREATE ROOM] Usuario ${member.user.tag} movido a ${tempChannel.name}`);
      } catch (error) {
        console.error(`[CREATE ROOM MOVE ERROR]`, error);
        // If we can't move them, delete the empty channel
        await deleteTempChannelIfEmpty(tempChannel);
      }
    }
  }

  // Handle temp channel cleanup - delete when empty
  if (oldState.channelId && tempChannels.has(oldState.channelId)) {
    const channel = guild.channels.cache.get(oldState.channelId);
    if (channel) {
      await deleteTempChannelIfEmpty(channel);
    }
  }

  // LEVELING SYSTEM: Track voice chat XP
  // User joined a voice channel
  if (!oldState.channelId && newState.channelId) {
    levelingSystem.startVoiceSession(member.id);
  }
  
  // User left a voice channel
  if (oldState.channelId && !newState.channelId) {
    const result = await levelingSystem.endVoiceSession(member.id);
    if (result && result.leveledUp) {
      await sendLevelUpMessage(member, result);
    }
  }
});

// Check voice XP every 30 minutes for active users
setInterval(async () => {
  for (const [userId, session] of levelingSystem.voiceSessions) {
    try {
      const guild = client.guilds.cache.first();
      if (!guild) continue;
      
      const member = await guild.members.fetch(userId);
      if (!member || !member.voice.channelId) {
        await levelingSystem.endVoiceSession(userId);
        continue;
      }

      const result = await levelingSystem.checkVoiceXP(userId);
      if (result && result.leveledUp) {
        await sendLevelUpMessage(member, result);
      }
    } catch (error) {
      console.error('[VOICE XP CHECK ERROR]', error);
    }
  }
}, 60000); // Check every minute

client.on('guildMemberAdd', async member => {
  // Update member count
  updateMemberCountChannel(member.guild);

  // Assign member role automatically
  try {
    if (CONFIG.MEMBER_ROLE_ID) {
      await member.roles.add(CONFIG.MEMBER_ROLE_ID);
      console.log(`[AUTO-ROLE] Rol asignado automáticamente a ${member.user.tag}`);
    }
  } catch (error) {
    console.error(`[AUTO-ROLE ERROR] No se pudo asignar rol a ${member.user.tag}:`, error);
  }

  // Send welcome message
  try {
    const welcomeChannel = await member.guild.channels.fetch(CONFIG.WELCOME_CHANNEL_ID);
    if (!welcomeChannel || !welcomeChannel.isTextBased()) return;

    const welcomeEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Welcome to California Niggas!')
      .setDescription(`Welcome ${member} to California Niggas\nPlease read the rules to access the rest of the server\nenjoy`)
      .setImage(CONFIG.WELCOME_IMAGE_URL)
      .setTimestamp();

    const message = await welcomeChannel.send({ embeds: [welcomeEmbed] });
    
    // If it's an announcement channel, publish the message so everyone can see it
    if (welcomeChannel.type === 5) { // 5 = GUILD_ANNOUNCEMENT
      await message.crosspost().catch(() => {
        console.log(`[WELCOME] No se pudo publicar el mensaje (puede que no sea un canal de anuncios)`);
      });
      console.log(`[WELCOME] Mensaje de bienvenida enviado y publicado para ${member.user.tag}`);
    } else {
      console.log(`[WELCOME] Mensaje de bienvenida enviado para ${member.user.tag}`);
    }
  } catch (error) {
    console.error('[WELCOME ERROR]', error);
  }
});

client.on('guildMemberRemove', member => {
  updateMemberCountChannel(member.guild);
});

// LEVELING SYSTEM: Message XP
client.on('messageCreate', async message => {
  // Ignore bots and DMs
  if (message.author.bot || !message.guild) return;

  try {
    const result = await levelingSystem.addMessageXP(message.author.id);
    
    if (result && result.leveledUp) {
      const member = message.guild.members.cache.get(message.author.id);
      if (member) {
        await sendLevelUpMessage(member, result);
      }
    }
  } catch (error) {
    console.error('[MESSAGE XP ERROR]', error);
  }
});

// LEVELING SYSTEM: Reaction XP
client.on('messageReactionAdd', async (reaction, user) => {
  // Ignore bots
  if (user.bot) return;

  try {
    // Handle partial reactions
    if (reaction.partial) {
      await reaction.fetch();
    }

    const result = await levelingSystem.addReactionXP(user.id);
    
    if (result && result.leveledUp) {
      const member = reaction.message.guild.members.cache.get(user.id);
      if (member) {
        await sendLevelUpMessage(member, result);
      }
    }
  } catch (error) {
    console.error('[REACTION XP ERROR]', error);
  }
});

// LEVELING SYSTEM: Send JJK-themed level-up message
async function sendLevelUpMessage(member, result) {
  try {
    const channel = await member.guild.channels.fetch(CONFIG.LEVELUP_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    // Update roles if rank changed
    if (result.rankedUp) {
      await levelingSystem.updateUserRoles(member, result.newRank, result.oldRank);
    }

    // Build level-up message
    let message = `🎉 **Level Up!**\n${member} has mastered more of their **Cursed Energy!** ⚡\nThey are now **Level ${result.newLevel}**`;
    
    // Add rank promotion if applicable
    if (result.rankedUp) {
      message += ` — **${result.newRank.name}** 🔥`;
    }
    
    message += `\n\nKeep training and rising through the ranks, sorcerer! 💀`;

    const embed = new EmbedBuilder()
      .setColor('#9D00FF')
      .setTitle('⚡ Cursed Energy Mastery Increased!')
      .setDescription(message)
      .addFields(
        { name: '📊 Total Energy', value: `${result.totalXP} XP`, inline: true },
        { name: '🎯 Current Rank', value: result.newRank.name, inline: true }
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setTimestamp()
      .setFooter({ text: 'Jujutsu Kaisen Leveling System' });

    await channel.send({ embeds: [embed] });
    console.log(`[LEVELING] Level-up message sent for ${member.user.tag} (Level ${result.newLevel})`);
  } catch (error) {
    console.error('[LEVEL-UP MESSAGE ERROR]', error);
  }
}

client.once('ready', () => {
  console.log(`Bot listo: ${client.user.tag}`);

  // Establecer estado a "No Molestar" (Do Not Disturb) con actividad personalizada
  client.user.setPresence({
    status: 'dnd', // Icono rojo "No molestar"
    activities: [
      {
        name: ' 🎮 Valorant 1 / 5',
        type: 0, // Jugando
      },
    ],
  });

  // Actualizar conteo al iniciar el bot en todos los servidores
  client.guilds.cache.forEach(guild => updateMemberCountChannel(guild));
});

// Iniciar servidor keep-alive para Replit
keepAlive();

client.login(process.env.DISCORD_TOKEN);
