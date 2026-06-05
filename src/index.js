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
        if (!data.tickets[interaction.channel.id]) {
          return interaction.reply({ content: '❌ This is not a ticket channel.', ephemeral: true });
        }
        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('close_ticket_reason').setLabel('Close with Reason').setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({
          embeds: [{
            title: '🔔 Close Request',
            description: `<@${interaction.user.id}> has requested to close this ticket.\nClick below to confirm.`,
            color: 0xFFA500
          }],
          components: [closeRow]
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
    }

  } catch (err) {
    console.error('Interaction error:', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Something went wrong. Please try again.', ephemeral: true });
      }
    } catch {}
  }
});

client.login(token);
