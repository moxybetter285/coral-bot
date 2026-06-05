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

const {
  sendTicketPanel,
  handleTicketTypeSelect,
  handleTicketModalSubmit,
  handleCloseTicketButton,
  closeTicket,
  loadData,
  saveData
} = require('./tickets');

const token = process.env.DISCORD_BOT_TOKEN;
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

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
      await channel.send({
        content: `🎉 Congratulations ${pingText}! You won **${gw.prize}**!`
      });
    } else {
      await channel.send({ content: '😔 The giveaway ended with no entries.' });
    }
  } catch (e) {
    console.error('Failed to end giveaway:', e);
  }
}

if (!token) { console.error('Missing DISCORD_BOT_TOKEN'); process.exit(1); }
if (!webhookUrl) { console.error('Missing DISCORD_WEBHOOK_URL'); process.exit(1); }

const LOGO_URL = 'https://raw.githubusercontent.com/moxybetter285/coral-bot/main/Koralski%20SMP%20logo%20u%20Minecraft%20stilu.png';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const webhook = new WebhookClient({ url: webhookUrl });

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
  ];

  const rest = new REST({ version: '10' }).setToken(token);
  for (const guild of client.guilds.cache.values()) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
    console.log(`Commands registered in: ${guild.name}`);
  }
});

process.on('unhandledRejection', err => console.error('Unhandled error:', err));

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
  try {

    // ── Slash commands ──────────────────────────────────────────
    if (interaction.isChatInputCommand()) {

      if (interaction.commandName === 'store') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Click For Webstore').setURL('https://coralsmp.tebex.io').setStyle(ButtonStyle.Link)
        );
        await interaction.reply({
          embeds: [{ title: '🛒 SERVER WEBSTORE', description: 'Support the server by visiting our store!\nPick up ranks, cosmetics, and more to help keep Coral SMP running strong.', color: 5814783, image: { url: LOGO_URL } }],
          components: [row]
        });
      }

      if (interaction.commandName === 'ip') {
        await interaction.reply({ embeds: [{ title: '🌐 Server IP', description: '**IP** - coralsmp.net\n**PORT** - 30110', color: 5814783 }] });
      }

      if (interaction.commandName === 'help') {
        await interaction.reply({ embeds: [{ title: '❓ Need Help?', description: 'If you need help with anything please open a ticket!', color: 5814783 }] });
      }

      if (interaction.commandName === 'setticket') {
        await sendTicketPanel(interaction.channel);
        await interaction.reply({ content: '✅ Ticket panel posted!', ephemeral: true });
      }

      if (interaction.commandName === 'close') {
        await closeTicket(interaction);
      }

      if (interaction.commandName === 'closereq') {
        const data = loadData();
        const ticket = data.tickets[interaction.channel.id];
        if (!ticket) return interaction.reply({ content: '❌ This is not a ticket channel.', ephemeral: true });

        ticket.closeReqBy = interaction.user.id;
        saveData(data);

        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        const reqRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('accept_close_req').setLabel('Accept & Close').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('deny_close_req').setLabel('Deny & Keep Open').setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({
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
        const data = loadData();
        const ticket = data.tickets[interaction.channel.id];
        if (!ticket) return interaction.reply({ content: '❌ This is not a ticket channel.', ephemeral: true });
        if (ticket.claimedBy) return interaction.reply({ content: `❌ Already claimed by <@${ticket.claimedBy}>.`, ephemeral: true });

        await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true
        });

        // Deny send messages for any extra added users (only claimer + opener can type)
        for (const userId of (ticket.addedUsers || [])) {
          if (userId !== interaction.user.id && userId !== ticket.userId) {
            await interaction.channel.permissionOverwrites.edit(userId, { SendMessages: false });
          }
        }

        ticket.claimedBy = interaction.user.id;
        saveData(data);

        await interaction.reply({
          embeds: [{
            title: '🎫 Ticket Claimed',
            description: `This ticket has been claimed by <@${interaction.user.id}>.\nOnly <@${interaction.user.id}> and <@${ticket.userId}> can type.`,
            color: 0x57F287
          }]
        });
      }

      if (interaction.commandName === 'add') {
        const data = loadData();
        const ticket = data.tickets[interaction.channel.id];
        if (!ticket) return interaction.reply({ content: '❌ This is not a ticket channel.', ephemeral: true });
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
        await interaction.reply({ embeds: [{ description: `✅ Added <@${user.id}> to the ticket.`, color: 0x57F287 }] });
      }

      if (interaction.commandName === 'ticketop') {
        const data = loadData();
        const closed = Object.values(data.tickets).filter(t => t.status === 'closed' && t.closedBy);

        if (closed.length === 0) {
          return interaction.reply({ embeds: [{ title: '🏆 Ticket Leaderboard', description: 'No tickets have been closed yet!', color: 5814783 }] });
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

        await interaction.reply({
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
        const data = loadData();
        const ticket = data.tickets[interaction.channel.id];
        if (!ticket) return interaction.reply({ content: '❌ This is not a ticket channel.', ephemeral: true });
        const user = interaction.options.getUser('user');
        if (user.id === ticket.userId) return interaction.reply({ content: '❌ Cannot remove the ticket opener.', ephemeral: true });
        await interaction.channel.permissionOverwrites.delete(user.id).catch(() => {});
        if (ticket.addedUsers) ticket.addedUsers = ticket.addedUsers.filter(id => id !== user.id);
        saveData(data);
        await interaction.reply({ embeds: [{ description: `✅ Removed <@${user.id}> from the ticket.`, color: 0xFF4444 }] });
      }

      if (interaction.commandName === 'setstaffrole') {
        const role = interaction.options.getRole('role');
        const data = loadData();
        if (!data.config) data.config = {};
        data.config.staffRoleId = role.id;
        saveData(data);
        await interaction.reply({
          embeds: [{
            title: '✅ Staff Role Set',
            description: `<@&${role.id}> will now automatically have access to all new ticket channels.`,
            color: 0x57F287
          }],
          ephemeral: true
        });
      }

      if (interaction.commandName === 'tickets') {
        const data = loadData();
        const open = Object.values(data.tickets).filter(t => t.status === 'open' && t.guildId === interaction.guild.id);

        if (open.length === 0) {
          return interaction.reply({
            embeds: [{ title: '🎫 Open Tickets', description: '✅ No open tickets right now!', color: 5814783 }],
            ephemeral: true
          });
        }

        const sorted = open.sort((a, b) => b.createdAt - a.createdAt);
        const lines = sorted.slice(0, 20).map(t => {
          const ago = Math.floor((Date.now() - t.createdAt) / 60000);
          const timeStr = ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`;
          const claimed = t.claimedBy ? ` • 👤 <@${t.claimedBy}>` : '';
          return `<#${t.channelId}> — **${t.ticketTypeName}** • <@${t.userId}> • ${timeStr}${claimed}`;
        });

        await interaction.reply({
          embeds: [{
            title: `🎫 Open Tickets — ${open.length}`,
            description: lines.join('\n'),
            color: 5814783,
            footer: { text: open.length > 20 ? `Showing 20 of ${open.length} tickets` : `${open.length} total open` },
            timestamp: new Date().toISOString()
          }],
          ephemeral: true
        });
      }

      if (interaction.commandName === 'gcreate') {
        const prize = interaction.options.getString('prize');
        const durationStr = interaction.options.getString('duration');
        const winnersCount = interaction.options.getInteger('winners');

        const durationMs = parseDuration(durationStr);
        if (!durationMs) {
          return interaction.reply({ content: '❌ Invalid duration! Use formats like `30m`, `2h`, `1d`.', ephemeral: true });
        }

        const endTime = Date.now() + durationMs;
        const endTimestamp = Math.floor(endTime / 1000);

        const enterBtn = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('enter_giveaway_PLACEHOLDER')
            .setLabel(`🎉 Enter Giveaway`)
            .setStyle(ButtonStyle.Primary)
        );

        const msg = await interaction.reply({
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
          components: [enterBtn],
          fetchReply: true
        });

        // Update the button with the real message ID
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

    // ── Select menu ─────────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_type_select') {
        await handleTicketTypeSelect(interaction);
      }
    }

    // ── Modals ───────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('ticket_modal_')) {
        await handleTicketModalSubmit(interaction);
      }
      if (interaction.customId === 'close_reason_modal') {
        const reason = interaction.fields.getTextInputValue('close_reason');
        await closeTicket(interaction, reason);
      }
    }

    // ── Buttons ──────────────────────────────────────────────────
    if (interaction.isButton()) {
      if (interaction.customId === 'close_ticket') {
        await closeTicket(interaction);
      }
      if (interaction.customId === 'close_ticket_reason') {
        await handleCloseTicketButton(interaction);
      }

      if (interaction.customId === 'accept_close_req') {
        const data = loadData();
        const ticket = data.tickets[interaction.channel.id];
        if (!ticket) return interaction.reply({ content: '❌ Not a ticket channel.', ephemeral: true });
        if (interaction.user.id !== ticket.userId) {
          return interaction.reply({ content: '❌ Only the ticket opener can accept this.', ephemeral: true });
        }
        // Credit the person who did /closereq, not the one clicking Accept
        await closeTicket(interaction, null, ticket.closeReqBy || interaction.user.id);
      }

      if (interaction.customId === 'deny_close_req') {
        const data = loadData();
        const ticket = data.tickets[interaction.channel.id];
        if (!ticket) return interaction.reply({ content: '❌ Not a ticket channel.', ephemeral: true });
        if (interaction.user.id !== ticket.userId) {
          return interaction.reply({ content: '❌ Only the ticket opener can deny this.', ephemeral: true });
        }
        ticket.closeReqBy = null;
        saveData(data);
        await interaction.reply({
          embeds: [{
            title: '❌ Close Request Denied',
            description: `<@${interaction.
