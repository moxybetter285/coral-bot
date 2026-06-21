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
      title: '✉️ Coral Network Support',
      description: 'Welcome to Support!\nSelect the category that best matches your issue from the dropdown menu below.\n\n⚠️ **Abuse of the ticket system will result in a punishment.**',
      color: 5814783,
      image: { url: CORAL_NETWORK_IMAGE },
      footer: { text: 'Coral Network • Ticket System' }
    }],
    components: [row]
  });
}

async function handleTicketTypeSelect(interaction) {
  const typeValue = interaction.values[0];
  const selectedType = TICKET_TYPES.find(t => t.value === typeValue);

  await interaction.update({});

  if (!selectedType) return;

  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${typeValue}`)
    .setTitle(selectedType.label);

  const issueInput = new TextInputBuilder()
    .setCustomId('ticket_issue')
    .setLabel('Describe your issue/reason')
    .setPlaceholder('Provide details so our staff can assist you promptly...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(issueInput));
  await interaction.showModal(modal);
}

async function handleTicketModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const typeValue = interaction.customId.replace('ticket_modal_', '');
  const selectedType = TICKET_TYPES.find(t => t.value === typeValue);
  const issueDescription = interaction.fields.getTextInputValue('ticket_issue');

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

  data.tickets[channel.id] = {
    channelId: channel.id,
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    status: 'open',
    ticketType: typeValue,
    ticketTypeName: selectedType.label,
    createdAt: Date.now(),
    issue: issueDescription,
    addedUsers: []
  };
  saveData(data);

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('close_ticket_reason').setLabel('Close with Reason').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Immediately').setStyle(ButtonStyle.Secondary)
  );

  await channel.send({
    content: `Welcome <@${interaction.user.id}> | Staff will be with you shortly.`,
    embeds: [{
      title: `🎫 ${selectedType.label} Ticket`,
      description: `**User:** <@${interaction.user.id}>\n**Category:** ${selectedType.label}\n\n**Description provided:**\n\`\`\`${issueDescription}\`\`\``,
      color: 5814783,
      footer: { text: 'Use buttons below or slash commands to manage this ticket.' }
    }],
    components: [controlRow]
  });

  await interaction.editReply({ content: `✅ Your ticket has been created successfully here: <#${channel.id}>` });
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
