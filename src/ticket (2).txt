const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'tickets.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ config: {}, tickets: {} }, null, 2));
}

const CORAL_NETWORK_IMAGE = 'https://raw.githubusercontent.com/moxybetter285/coral-bot/main/coral-network.png';

const TICKET_TYPES = [
  { value: 'general', label: 'General Support', description: 'General questions and support', emoji: '📋' },
  { value: 'player_report', label: 'Player Reports', description: 'Report a user', emoji: '❌' },
  { value: 'billing', label: 'Billing Support', description: 'Billing issues and inquiries', emoji: '🛒' },
  { value: 'bug_report', label: 'Bug Report', description: 'If you find any bugs, open this ticket to report them.', emoji: '🎯' },
  { value: 'punishment_appeal', label: 'Punishment Appeal', description: 'Open this ticket to appeal a punishment.', emoji: '🎁' },
  { value: 'staff_report', label: 'Staff Report', description: 'Report a staff member — false reports have consequences.', emoji: '🔧' },
  { value: 'media_application', label: 'Media Application', description: 'Apply for the Media rank on Coral SMP.', emoji: '🎬' },
];

let memoryData = { config: {}, tickets: {} };

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      memoryData = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to read tickets.json data file, using memory backup:', err);
  }
  return memoryData;
}

function saveData(data) {
  memoryData = data;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to write tickets.json data file:', err);
  }
}

async function sendTicketPanel(channel) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('ticket_type_select')
    .setPlaceholder('Select a category to open a ticket...')
    .addOptions(
      TICKET_TYPES.map(t => ({
        label: t.label,
        value: t.value,
        description: t.description,
        emoji: t.emoji
      }))
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await channel.send({
    embeds: [{
      title: 'SUPPORT TICKETS 💎',
      description: 'Here is our ticket support system! Please think before you act\nand look through the categories to see what your situation matches the best.',
      color: 5814783,
      image: { url: CORAL_NETWORK_IMAGE },
      footer: { text: 'Coral SMP • We are glad to help you' }
    }],
    components: [row]
  });
}

async function handleTicketTypeSelect(interaction) {
  const typeValue = interaction.values[0];
  const selectedType = TICKET_TYPES.find(t => t.value === typeValue);

  if (!selectedType) return;

  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${typeValue}`)
    .setTitle(selectedType.label);

  const ignInput = new TextInputBuilder()
    .setCustomId('ticket_ign')
    .setLabel('MC Username')
    .setPlaceholder('Enter your Minecraft username...')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const reasonInput = new TextInputBuilder()
    .setCustomId('ticket_reason')
    .setLabel('Reason')
    .setPlaceholder('Describe your issue in detail...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(ignInput),
    new ActionRowBuilder().addComponents(reasonInput)
  );

  await interaction.showModal(modal);
}

async function handleTicketModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const typeValue = interaction.customId.replace('ticket_modal_', '');
  const selectedType = TICKET_TYPES.find(t => t.value === typeValue);
  const ign = interaction.fields.getTextInputValue('ticket_ign');
  const reason = interaction.fields.getTextInputValue('ticket_reason');

  const data = loadData();
  const ticketCount = Object.keys(data.tickets).length + 1;
  const channelName = `${selectedType.label.toLowerCase().replace(/\s+/g, '-')}-${ticketCount}`;

  const permissionOverwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    }
  ];

  if (data.config && data.config.staffRoleId) {
    permissionOverwrites.push({
      id: data.config.staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    });
  }

  const channelOptions = {
    name: channelName,
    type: ChannelType.GuildText,
    permissionOverwrites
  };

  if (data.config && data.config.ticketCategoryId) {
    channelOptions.parent = data.config.ticketCategoryId;
  }

  const channel = await interaction.guild.channels.create(channelOptions);
  const createdAt = Math.floor(Date.now() / 1000);

  data.tickets[channel.id] = {
    channelId: channel.id,
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    status: 'open',
    ticketType: typeValue,
    ticketTypeName: selectedType.label,
    createdAt: Date.now(),
    ign,
    reason,
    addedUsers: []
  };
  saveData(data);

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('close_ticket_reason').setLabel('Close with Reason').setStyle(ButtonStyle.Secondary)
  );

  await channel.send({
    content: `<@${interaction.user.id}> Welcome! A staff member will be with you shortly.`,
    embeds: [{
      title: 'TICKET OPENED',
      description: 'Please describe your issue and wait for a response.',
      color: 5814783,
      fields: [
        { name: 'Created By', value: `<@${interaction.user.id}>`, inline: false },
        { name: 'Created At', value: `<t:${createdAt}:F>`, inline: false },
        { name: 'MC Username', value: ign, inline: false },
        { name: 'Reason', value: reason, inline: false },
        { name: 'Category', value: `${selectedType.label} • Coral SMP`, inline: false }
      ]
    }],
    components: [controlRow]
  });

  await interaction.editReply({ content: `✅ Your ticket has been created: <#${channel.id}>` });
}

async function handleCloseTicketButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('close_reason_modal')
    .setTitle('Close Ticket');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('close_reason')
        .setLabel('Reason for closing')
        .setPlaceholder('Why are you closing this ticket?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function closeTicket(interaction, reason = null, closedByOverride = null) {
  const data = loadData();
  const ticket = data.tickets[interaction.channel.id];

  if (!ticket) {
    return interaction.reply({ content: '❌ This is not a ticket channel.', ephemeral: true });
  }

  const creditUserId = closedByOverride || interaction.user.id;

  const closeEmbed = {
    title: '🔒 Ticket Closed',
    description: reason ? `**Reason:** ${reason}` : 'This ticket has been closed.',
    color: 0xFF4444,
    fields: [{ name: 'Closed By', value: `<@${creditUserId}>`, inline: true }],
    timestamp: new Date().toISOString()
  };

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ embeds: [closeEmbed] });
  } else {
    await interaction.channel.send({ embeds: [closeEmbed] });
  }

  ticket.status = 'closed';
  ticket.closedBy = creditUserId;
  ticket.closedAt = Date.now();
  saveData(data);

  setTimeout(async () => {
    try { await interaction.channel.delete(); } catch {}
  }, 5000);
}

module.exports = {
  sendTicketPanel,
  handleTicketTypeSelect,
  handleTicketModalSubmit,
  handleCloseTicketButton,
  closeTicket,
  loadData,
  saveData
};
