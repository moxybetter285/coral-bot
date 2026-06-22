const {
  Client,
  GatewayIntentBits,
  WebhookClient,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

const keepAlive = require('./server');

const {
  sendTicketPanel,
  handleTicketTypeSelect,
  handleTicketModalSubmit,
  handleCloseTicketButton,
  closeTicket,
  loadData,
  saveData
} = require('./ticket.js');

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();

// ── Giveaway storage ─────────────────────────────────────────
const giveaways = {}; // messageId -> giveaway data

function parseDuration(str) {
  const match = str.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  return num * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
}

function formatDuration(ms) {
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function endGiveaway(messageId, channelId, guildId) {
  const gw = giveaways[messageId];
  if (!gw || gw.ended) return;
  gw.ended = true;

  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);

    const entries = gw.entries;
    let winnersText = '😔 No one entered!';
    let pingText = '';

    if (entries.length > 0) {
      const shuffled = [...entries].sort(() => Math.random() - 0.5);
      const winners = shuffled.slice(0, Math.min(gw.winners, entries.length));
      winnersText = winners.map(id => `<@${id}>`).join(', ');
      pingText = winners.map(id => `<@${id}>`).join(' ');
    }

    await message.edit({
      embeds: [{
        title: '🎉 GIVEAWAY ENDED',
        description: `**Prize:** ${gw.prize}\n\n🏆 **Winner${gw.winners > 1 ? 's' : ''}:** ${winnersText}`,
        color: 0x95a5a6,
        fields: [
          { name: '👥 Winners', value: `${gw.winners}`, inline: true },
          { name: '🎫 Total Entries', value: `${entries.length}`, inline: true },
          { name: '🎙️ Hosted by', value: `<@${gw.hostedBy}>`, inline: true }
        ],
        footer: { text: 'Giveaway ended' },
        timestamp: new Date().toISOString()
      }],
      components: []
    });

    if (entries.length > 0) {
      await channel.send({ content: `🎉 Congratulations ${pingText}! You won **${gw.prize}**!` });
    } else {
      await channel.send({ content: '😔 The giveaway ended with no entries.' });
    }
  } catch (e) {
    console.error('Failed to end giveaway:', e);
  }
}

if (!token) { console.error('[FATAL] Missing DISCORD_BOT_TOKEN env var'); process.exit(1); }
if (!webhookUrl) { console.error('[FATAL] Missing DISCORD_WEBHOOK_URL env var'); process.exit(1); }

console.log('[STARTUP] Token found, length:', token.length);

const LOGO_URL = 'https://raw.githubusercontent.com/moxybetter285/coral-bot/main/Koralski%20SMP%20logo%20u%20Minecraft%20stilu.png';

const restCheck = new REST({ version: '10' }).setToken(token);
restCheck.get('/users/@me').then(data => {
  console.log(`[TOKEN OK] Bot identity confirmed: ${data.username}`);
}).catch(err => {
  console.error('[TOKEN INVALID] Discord rejected the token:', err.message);
  process.exit(1);
});
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const webhook = new WebhookClient({ url: webhookUrl });

client.on('error', err => console.error('[CLIENT ERROR]', err));
client.on('warn', msg => console.warn('[CLIENT WARN]', msg));
client.on('shardError', err => console.error('[SHARD ERROR]', err));
client.on('shardReconnecting', id => console.log(`[RECONNECTING] shard ${id}`));
client.on('shardResume', (id, replayed) => console.log(`[RESUMED] shard ${id}, replayed ${replayed} events`));
client.on('shardDisconnect', (event, id) => console.log(`[DISCONNECTED] shard ${id}, code ${event.code}`));

client.on('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Active in ${client.guilds.cache.size} server(s)`);

  const commands = [
    new SlashCommandBuilder().setName('store').setDescription('Show the Coral SMP webstore').toJSON(),
    new SlashCommandBuilder().setName('ip').setDescription('Show the Coral SMP server IP').toJSON(),
    new SlashCommandBuilder().setName('help').setDescription('Get help and support').toJSON(),
    new SlashCommandBuilder()
      .setName('setticket')
      .setDescription('Post the ticket panel in this channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder().setName('close').setDescription('Close this ticket').toJSON(),
    new SlashCommandBuilder().setName('closereq').setDescription('Request to close this ticket').toJSON(),
    new SlashCommandBuilder().setName('claim').setDescription('Claim this ticket (only you and the opener can type)').toJSON(),
    new SlashCommandBuilder()
      .setName('add')
      .setDescription('Add a user to this ticket')
      .addUserOption(opt => opt.setName('user').setDescription('User to add').setRequired(true))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Remove a user from this ticket')
      .addUserOption(opt => opt.setName('user').setDescription('User to remove').setRequired(true))
      .toJSON(),
    new SlashCommandBuilder().setName('ticketop').setDescription('Top 10 staff members by tickets closed').toJSON(),
    new SlashCommandBuilder()
      .setName('gcreate')
      .setDescription('Start a giveaway')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(opt => opt.setName('prize').setDescription('What are you giving away?').setRequired(true))
      .addStringOption(opt => opt.setName('duration').setDescription('How long? e.g. 30m, 2h, 1d').setRequired(true))
      .addIntegerOption(opt => opt.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1).setMaxValue(20))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('setstaffrole')
      .setDescription('Set the staff role that can see and handle all tickets')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addRoleOption(opt => opt.setName('role').setDescription('The staff role').setRequired(true))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('tickets')
      .setDescription('View all open tickets')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('setcategory')
      .setDescription('Set the category where new ticket channels will be created')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption(opt =>
        opt.setName('category')
          .setDescription('The category to place tickets in')
          .setRequired(true)
      )
      .toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(token);
  try {
    for (const guild of client.guilds.cache.values()) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
      console.log(`Commands registered in: ${guild.name}`);
    }
  } catch (err) {
    console.error('[COMMAND REGISTER ERROR]', err);
  }
});

process.on('unhandledRejection', err => console.error('[UNHANDLED REJECTION]', err));
process.on('uncaughtException', err => console.error('[UNCAUGHT EXCEPTION]', err));

client.on('guildMemberAdd', async member => {
  try {
    await webhook.send({
      embeds: [{
        title: 'CORAL SMP',
        description: `Welcome <@${member.id}> to CoralSMP\n\n**IP** - coralsmp.net\n**PORT** - 30110\n**STORE** - https://coralsmp.tebex.io`,
        color: 5814783,
        thumbnail: { url: member.user.displayAvatarURL() },
        image: { url: LOGO_URL },
        footer: { text: `You are our ${member.guild.memberCount}th member!` }
      }]
    });
    console.log(`Sent welcome message for ${member.user.tag}`);
  } catch (err) { console.error('Welcome message failed:', err); }
});

client.on('interactionCreate', async interaction => {
  console.log(`[INTERACTION] type=${interaction.type} user=${interaction.user?.tag} cmd=${interaction.commandName || interaction.customId || 'n/a'}`);

  try {
    if (interaction.isChatInputCommand()) {

      if (interaction.commandName === 'store') {
        await interaction.deferReply();
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Click For Webstore').setURL('https://coralsmp.tebex.io').setStyle(ButtonStyle.Link)
        );
        await interaction.editReply({
          embeds: [{ title: '🛒 SERVER WEBSTORE', description: 'Support the server by visiting our store!\nPick up ranks, cosmetics, and more to help keep Coral SMP running strong.', color: 5814783, image: { url: LOGO_URL } }],
          components: [row]
        });
      }

      if (interaction.commandName === 'ip') {
        await interaction.deferReply();
        await interaction.editReply({ embeds: [{ title: '🌐 Server IP', description: '**IP** - coralsmp.net\n**PORT** - 30110', color: 5814783 }] });
      }

      if (interaction.commandName === 'help') {
        await interaction.deferReply();
        await interaction.editReply({ embeds: [{ title: '❓ Need Help?', description: 'If you need help with anything please open a ticket!', color: 5814783 }] });
      }

      if (interaction.commandName === 'setticket') {
        await interaction.deferReply({ ephemeral: true });
        await sendTicketPanel(interaction.channel);
        await interaction.editReply({ content: '✅ Ticket panel posted!' });
      }

      if (interaction.commandName === 'close') {
        await interaction.deferReply({ ephemeral: true });
        await closeTicket(interaction);
        try { await interaction.deleteReply(); } catch {}
      }

      if (interaction.commandName === 'closereq') {
        await interaction.deferReply();
        const data = loadData();
        const ticket = data.tickets[interaction.channel.id];
        if (!ticket) return interaction.editReply({ content: '❌ This is not a ticket channel.' });

        ticket.closeReqBy = interaction.user.id;
        saveData(data);

        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        const reqRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('accept_close_req').setLabel('Accept & Close').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('deny_close_req').setLabel('Deny & Keep Open').setStyle(ButtonStyle.Secondary)
        );
        await interaction.editReply({
          content: `<@${ticket.userId}>`,
          embeds: [{
            title: 'Close Request',
            description: `<@${interaction.user.id}> has requested to close this ticket.\n\nPlease accept or deny using the buttons below.\n\n**Today at ${timeStr}**`,
            color: 0x5865F2
          }],
          components: [reqRow]
        });
      }

      if (interaction.commandName === 'claim') {
        await interaction.deferReply();
        const data = loadData();
        const ticket = data.tickets[interaction.channel.id];
        if (!ticket) return interaction.editReply({ content: '❌ This is not a ticket channel.' });
        if (ticket.claimedBy) return interaction.editReply({ content: `❌ Already claimed by <@${ticket.claimedBy}>.` });

        await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true
        });

        for (const userId of (ticket.addedUsers || [])) {
          if (userId !== interaction.user.id && userId !== ticket.userId) {
            await interaction.channel.permissionOverwrites.edit(userId, { SendMessages: false });
          }
        }

        ticket.claimedBy = interaction.user.id;
        saveData(data);

        await interaction.editReply({
          embeds: [{
            title: '🎫 Ticket Claimed',
            description: `This ticket has been claimed by <@${interaction.user.id}>.\nOnly <@${interaction.user.id}> and <@${ticket.userId}> can type.`,
            color: 0x57F287
          }]
        });
      }

      if (interaction.commandName === 'add') {
        await interaction.deferReply();
        const data = loadData();
        const ticket = data.tickets[interaction.channel.id];
        if (!ticket) return interaction.editReply({ content: '❌ This is not a ticket channel.' });
        const user = interaction.options.getUser('user');
        await interaction.channel.permissionOverwrites.edit(user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true
        });
        if (!ticket.addedUsers) ticket.addedUsers = [];
        if (!ticket.addedUsers.includes(user.id)) ticket.addedUsers.push(user.id);
        saveData(data);
        await interaction.editReply({ embeds: [{ description: `✅ Added <@${user.id}> to the ticket.`, color: 0x57F287 }] });
      }

      if (interaction.commandName === 'ticketop') {
        await interaction.deferReply();
        const data = loadData();
        const closed = Object.values(data.tickets).filter(t => t.status === 'closed' && t.closedBy);

        if (closed.length === 0) {
          return interaction.editReply({ embeds: [{ title: '🏆 Ticket Leaderboard', description: 'No tickets have been closed yet!', color: 5814783 }] });
        }

        const counts = {};
        for (const t of closed) {
          counts[t.closedBy] = (counts[t.closedBy] || 0) + 1;
        }

        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        const lines = sorted.map(([userId, count], i) =>
          `${medals[i]} <@${userId}> — **${count}** ticket${count === 1 ? '' : 's'} done`
        );

        await interaction.editReply({
          embeds: [{
            title: '🏆 Top Staff — Tickets Closed',
            description: lines.join('\n'),
            color: 5814783,
            footer: { text: `Total tickets closed: ${closed.length}` },
            timestamp: new Date().toISOString()
          }]
        });
      }

      if (interaction.commandName === 'remove') {
        await interaction.deferReply();
        const data = loadData();
        const ticket = data.tickets[interaction.channel.id];
        if (!ticket) return interaction.editReply({ content: '❌ This is not a ticket channel.' });
        const user = interaction.options.getUser('user');
        if (user.id === ticket.userId) return interaction.editReply({ content: '❌ Cannot remove the ticket opener.' });
        await interaction.channel.permissionOverwrites.delete(user.id).catch(() => {});
        if (ticket.addedUsers) ticket.addedUsers = ticket.addedUsers.filter(id => id !== user.id);
        saveData(data);
        await interaction.editReply({ embeds: [{ description: `✅ Removed <@${user.id}> from the ticket.`, color: 0xFF4444 }] });
      }

      if (interaction.commandName === 'setstaffrole') {
        await interaction.deferReply({ ephemeral: true });
        const role = interaction.options.getRole('role');
        const data = loadData();
        if (!data.config) data.config = {};
        data.config.staffRoleId = role.id;
        saveData(data);
        await interaction.editReply({
          embeds: [{
            title: '✅ Staff Role Set',
            description: `<@&${role.id}> will now automatically have access to all new ticket channels.`,
            color: 0x57F287
          }]
        });
      }

      if (interaction.commandName === 'setcategory') {
        await interaction.deferReply({ ephemeral: true });
        const { ChannelType } = require('discord.js');
        const category = interaction.options.getChannel('category');
        if (category.type !== ChannelType.GuildCategory) {
          return interaction.editReply({ content: '❌ Please select a **category**, not a regular channel.' });
        }
        const data = loadData();
        if (!data.config) data.config = {};
        data.config.ticketCategoryId = category.id;
        saveData(data);
        await interaction.editReply({
          embeds: [{
            title: '✅ Ticket Category Set',
            description: `New ticket channels will now be created inside **${category.name}**.`,
            color: 0x57F287
          }]
        });
      }

      if (interaction.commandName === 'tickets') {
        await interaction.deferReply({ ephemeral: true });
        const data = loadData();
        const open = Object.values(data.tickets).filter(t => t.status === 'open' && t.guildId === interaction.guild.id);

        if (open.length === 0) {
          return interaction.editReply({
            embeds: [{ title: '🎫 Open Tickets', description: '✅ No open tickets right now!', color: 5814783 }]
          });
        }

        const sorted = open.sort((a, b) => b.createdAt - a.createdAt);
        const lines = sorted.slice(0, 20).map(t => {
          const ago = Math.floor((Date.now() - t.createdAt) / 60000);
          const timeStr = ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`;
          const claimed = t.claimedBy ? ` • 👤 <@${t.claimedBy}>` : '';
          return `<#${t.channelId}> — **${t.ticketTypeName}** • <@${t.userId}> • ${timeStr}${claimed}`;
        });

        await interaction.editReply({
          embeds: [{
            title: `🎫 Open Tickets — ${open.length}`,
            description: lines.join('\n'),
            color: 5814783,
            footer: { text: open.length > 20 ? `Showing 20 of ${open.length} tickets` : `${open.length} total open` },
            timestamp: new Date().toISOString()
          }]
        });
      }

      if (interaction.commandName === 'gcreate') {
        const prize = interaction.options.getString('prize');
        const durationStr = interaction.options.getString('duration');
        const winnersCount = interaction.options.getInteger('winners');
        const durationMs = parseDuration(durationStr);

        if (!durationMs) {
          await interaction.deferReply({ ephemeral: true });
          return interaction.editReply({ content: '❌ Invalid duration! Use formats like `30m`, `2h`, `1d`.' });
        }

        const endTime = Date.now() + durationMs;
        const endTimestamp = Math.floor(endTime / 1000);

        await interaction.deferReply();

        await interaction.editReply({
          embeds: [{
            title: '🎉 GIVEAWAY 🎉',
            description: `**Prize:** ${prize}`,
            color: 5814783,
            fields: [
              { name: '👥 Winners', value: `${winnersCount}`, inline: true },
              { name: '⏰ Ends', value: `<t:${endTimestamp}:R>`, inline: true },
              { name: '🎫 Entries', value: '0', inline: true },
              { name: '🎙️ Hosted by', value: `<@${interaction.user.id}>`, inline: false }
            ],
            footer: { text: `Duration: ${formatDuration(durationMs)}` },
            timestamp: new Date(endTime).toISOString()
          }],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('enter_giveaway_PLACEHOLDER')
              .setLabel('🎉 Enter Giveaway')
              .setStyle(ButtonStyle.Primary)
          )]
        });

        const msg = await interaction.fetchReply();

        await msg.edit({
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`enter_giveaway_${msg.id}`)
              .setLabel('🎉 Enter Giveaway')
              .setStyle(ButtonStyle.Primary)
          )]
        });

        giveaways[msg.id] = {
          prize,
          winners: winnersCount,
          endTime,
          channelId: interaction.channel.id,
          guildId: interaction.guild.id,
          hostedBy: interaction.user.id,
          entries: [],
          ended: false
        };

        setTimeout(() => endGiveaway(msg.id, interaction.channel.id, interaction.guild.id), durationMs);
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_type_select') {
        await handleTicketTypeSelect(interaction);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('ticket_modal_')) {
        await handleTicketModalSubmit(interaction);
      }
      if (interaction.customId === 'close_reason_modal') {
        const reason = interaction.fields.getTextInputValue('close_reason');
        await closeTicket(interaction, reason);
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'close_ticket') {
        await interaction.deferReply({ ephemeral: true });
        await closeTicket(interaction);
        try { await interaction.deleteReply(); } catch {}
      }

      if (interaction.customId === 'close_ticket_reason') {
        await handleCloseTicketButton(interaction);
      }

      if (interaction.customId === 'accept_close_req') {
        await interaction.deferReply({ ephemeral: true });
        const data = loadData();
        const ticket = data.tickets[interaction.channel.id];
        if (!ticket) return interaction.editReply({ content: '❌ Not a ticket channel.' });
        if (interaction.user.id !== ticket.userId) {
          return interaction.editReply({ content: '❌ Only the ticket opener can accept this.' });
        }
        await closeTicket(interaction, null, ticket.closeReqBy || interaction.user.id);
        try { await interaction.deleteReply(); } catch {}
      }

      if (interaction.customId === 'deny_close_req') {
        await interaction.deferReply();
        const data = loadData();
        const ticket = data.tickets[interaction.channel.id];
        if (!ticket) return interaction.editReply({ content: '❌ Not a ticket channel.' });
        if (interaction.user.id !== ticket.userId) {
          return interaction.editReply({ content: '❌ Only the ticket opener can deny this.' });
        }
        ticket.closeReqBy = null;
        saveData(data);
        await interaction.editReply({
          embeds: [{
            title: '❌ Close Request Denied',
            description: `<@${interaction.user.id}> has denied the close request. The ticket will remain open.`,
            color: 0xFF4444
          }]
        });
      }

      if (interaction.customId.startsWith('enter_giveaway_')) {
        await interaction.deferReply({ ephemeral: true });
        const messageId = interaction.customId.replace('enter_giveaway_', '');
        const gw = giveaways[messageId];

        if (!gw || gw.ended) {
          return interaction.editReply({ content: '❌ This giveaway has already ended!' });
        }

        if (gw.entries.includes(interaction.user.id)) {
          return interaction.editReply({ content: '❌ You have already entered this giveaway!' });
        }

        gw.entries.push(interaction.user.id);

        const message = await interaction.channel.messages.fetch(messageId);
        const embed = message.embeds[0].data;
        const fields = embed.fields.map(f =>
          f.name === '🎫 Entries' ? { ...f, value: `${gw.entries.length}` } : f
        );
        await message.edit({ embeds: [{ ...embed, fields }] });

        await interaction.editReply({ content: '✅ You have entered the giveaway! Good luck!' });
      }
    }
  } catch (err) {
    console.error('[INTERACTION ERROR]', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
      } else if (interaction.deferred) {
        await interaction.editReply({ content: '❌ Something went wrong.' });
      }
    } catch (e) {
      console.error('[REPLY ERROR]', e);
    }
  }
});

keepAlive();
client.login(token).catch(err => {
  console.error('[LOGIN FAILED]', err.message);
  process.exit(1);
});
