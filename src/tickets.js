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

const DATA_FILE = path.join(__dirname, '../data/tickets.json');
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

// In-memory store — always works even if file system fails on Render
let memoryData = null;

function loadData() {
  if (memoryData !== null) return memoryData;
  // First load: try to read from file as backup
  try {
    if (fs.existsSync(DATA_FILE)) {
      memoryData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return memoryData;
    }
  } catch {}
  memoryData = { tickets: {}, counters: {}, panels: {} };
  return memoryData;
}

function saveData(data) {
  // Always save to memory first (guaranteed to work)
  memoryData = data;
  // Try to persist to file as backup (best effort)
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

async function sendTicketPanel(channel) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('ticket_type_select')
    .setPlaceholder('Select ticket type')
    .addOptions(TICKET_TYPES.map(t => ({
      label: t.label,
      description: t.description.length > 100 ? t.description.substring(0, 97) + '...' : t.description,
      value: t.value,
      emoji: t.emoji
    })));

  await channel.send({
    embeds: [{
      title: 'SUPPORT TICKETS 💎',
      description: 'Here is our ticket support system! Please think before you act\nand look through the categories to see what your situation matches the best.',
      color: 5814783,
      image: { url: CORAL_NETWORK_IMAGE },
      footer: { text: 'Coral SMP • We are glad to help you' }
    }],
    components: [new ActionRowBuilder().addComponents(selectMenu)]
  });
}

async function handleTicketTypeSelect(interaction) {
  const ticketType = interaction.values[0];

  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${ticketType}`)
    .setTitle('Open a Ticket');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('mc_username')
        .setLabel('Minecraft Username')
        .setPlaceholder('Your in-game username...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason')
        .setPlaceholder('Briefly describe why you are opening this ticket...')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(500)
        .setRequired(true)
    )
  );

  await interaction.showModal(modal);
}

async function handleTicketModalSubmit(interaction) {
  const ticketTypeValue = interaction.customId.replace('ticket_modal_', '');
  const typeInfo = TICKET_TYPES.find(t => t.value === ticketTypeValue);
  const mcUsername = interaction.fields.getTextInputValue('mc_username');
  const reason = interaction.fields.getTextInputValue('reason');

  await interaction.deferReply({ ephemeral: true });

  try {
    const data = loadData();
    const guildId = interaction.guild.id;
    if (!data.counters[guildId]) data.counters[guildId] = 0;
    data.counters[guildId]++;
    const ticketNumber = data.counters[guildId];

    const channel = await interaction.guild.channels.create({
      name: `ticket-${ticketNumber.toString().padStart(4, '0')}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles]
        },
        {
          id: interaction.client.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles]
        }
      ]
    });

    data.tickets[channel.id] = {
      channelId: channel.id,
      userId: interaction.user.id,
      ticketType: ticketTypeValue,
      ticketTypeName: typeInfo.label,
      mcUsername,
      reason,
      ticketNumber,
      guildId,
      createdAt: Date.now(),
      claimedBy: null,
      addedUsers: [],
      status: 'open'
    };
    saveData(data);

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('close_ticket_reason').setLabel('Close with Reason').setStyle(ButtonStyle.Secondary)
    );

    await channel.send({
      embeds: [{
        title: 'TICKET OPENED',
        description: 'Please describe your issue and wait for a response.',
        color: 0x5865F2,
        fields: [
          { name: 'Created By', value: `<@${interaction.user.id}>`, inline: false },
          { name: 'Created At', value: dateStr, inline: false },
          { name: 'MC Username', value: mcUsername, inline: false },
          { name: 'Reason', value: reason, inline: false },
          { name: 'Category', value: `${typeInfo.label} • Coral SMP`, inline: false }
        ]
      }],
      components: [closeRow]
    });

    await channel.send(`<@${interaction.user.id}> Welcome! A staff member will be with you shortly.`);
    await interaction.editReply({ content: `✅ Your ticket has been opened! <#${channel.id}>` });
  } catch (err) {
    console.error('Failed to create ticket:', err);
    await interaction.editReply({ content: '❌ Failed to create your ticket. Please try again.' });
  }
}

async function handleCloseTicketButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('close_reason_modal')
    .setTitle('Close Ticket with Reason');

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

async function closeTicket(interaction, reason = null) {
  const data = loadData();
  const ticket = data.tickets[interaction.channel.id];

  if (!ticket) {
    return interaction.reply({ content: '❌ This is not a ticket channel.', ephemeral: true });
  }

  const closeEmbed = {
    title: '🔒 Ticket Closed',
    description: reason ? `**Reason:** ${reason}` : 'This ticket has been closed.',
    color: 0xFF4444,
    fields: [{ name: 'Closed By', value: `<@${interaction.user.id}>`, inline: true }],
    timestamp: new Date().toISOString()
  };

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ embeds: [closeEmbed] });
  } else {
    await interaction.channel.send({ embeds: [closeEmbed] });
  }

  ticket.status = 'closed';
  ticket.closedBy = interaction.user.id;
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
