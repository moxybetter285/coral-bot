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

const giveaways = {};

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
        title:
