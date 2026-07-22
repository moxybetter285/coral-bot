const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const { loadData, saveData } = require('./ticket.js');

const CN_LOGO_URL = 'https://raw.githubusercontent.com/moxybetter285/coral-bot/main/coral-network.png';

// In-memory timers so they survive restarts via restoreTimers()
const suggestionTimers = {};

// ── /suggest → opens modal ───────────────────────────────────
async function handleSuggestCommand(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('suggestion_modal')
    .setTitle('Suggestion - CoralSmp');

  const titleInput = new TextInputBuilder()
    .setCustomId('suggestion_title')
    .setLabel('Title')
    .setPlaceholder('Enter a short title for your suggestion...')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const suggestionInput = new TextInputBuilder()
    .setCustomId('suggestion_text')
    .setLabel('Suggestion')
    .setPlaceholder('Describe your suggestion in detail...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(suggestionInput)
  );

  await interaction.showModal(modal);
}

// ── Build the vote buttons with current counts ────────────────
function buildVoteRow(messageId, yesCount, noCount) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`suggest_yes_${messageId}`)
      .setLabel(`✅  ${yesCount}`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`suggest_no_${messageId}`)
      .setLabel(`❌  ${noCount}`)
      .setStyle(ButtonStyle.Danger)
  );
}

// ── suggestion modal submitted → post embed + buttons ─────────
async function handleSuggestModalSubmit(interaction, client) {
  await interaction.deferReply({ ephemeral: true });

  const data = loadData();

  if (!data.config || !data.config.suggestChannelId) {
    return interaction.editReply({
      content: '❌ The suggestion channel has not been set up yet. Ask an admin to use `/sugchannel`.'
    });
  }

  const title = interaction.fields.getTextInputValue('suggestion_title');
  const text  = interaction.fields.getTextInputValue('suggestion_text');
  const submittedAt = Math.floor(Date.now() / 1000);

  let channel;
  try {
    channel = await interaction.guild.channels.fetch(data.config.suggestChannelId);
  } catch {
    return interaction.editReply({
      content: '❌ Could not find the suggestion channel. Ask an admin to re-run `/sugchannel`.'
    });
  }

  const embed = {
    author: {
      name: `${interaction.user.username} submitted a suggestion`,
      icon_url: interaction.user.displayAvatarURL({ dynamic: true })
    },
    title: title,
    description: text,
    color: 0x5865F2,
    thumbnail: { url: CN_LOGO_URL },
    fields: [
      { name: 'Status',    value: '🟦 Pending',          inline: false },
      { name: 'Votes',     value: '✅ 0 | ❌ 0',          inline: false },
      { name: 'Submitted', value: `<t:${submittedAt}:R>`, inline: false }
    ],
    timestamp: new Date().toISOString()
  };

  // Send with placeholder buttons — we need the message ID first
  const msg = await channel.send({
    embeds: [embed],
    components: [buildVoteRow('pending', 0, 0)]
  });

  // Edit buttons now that we have the real message ID
  await msg.edit({ components: [buildVoteRow(msg.id, 0, 0)] });

  // Persist suggestion
  if (!data.suggestions) data.suggestions = {};
  const endsAt = Date.now() + 24 * 60 * 60 * 1000;
  data.suggestions[msg.id] = {
    messageId: msg.id,
    channelId: channel.id,
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    title,
    text,
    submittedAt: Date.now(),
    endsAt,
    status: 'pending',
    votes: {}   // { userId: 'yes' | 'no' }
  };
  saveData(data);

  scheduleSuggestionCheck(msg.id, channel.id, interaction.guild.id, client, endsAt - Date.now());

  await interaction.editReply({
    content: `✅ Your suggestion has been submitted to <#${channel.id}>!`
  });
}

// ── Handle ✅ / ❌ button clicks ──────────────────────────────
async function handleSuggestionVote(interaction) {
  const customId = interaction.customId;
  const isYes = customId.startsWith('suggest_yes_');
  const messageId = customId.replace('suggest_yes_', '').replace('suggest_no_', '');

  const data = loadData();
  const suggestion = data.suggestions?.[messageId];

  if (!suggestion || suggestion.status !== 'pending') {
    return interaction.reply({ content: '❌ This suggestion is no longer accepting votes.', ephemeral: true });
  }

  const userId = interaction.user.id;
  const choice = isYes ? 'yes' : 'no';
  const prev   = suggestion.votes[userId];

  if (prev === choice) {
    // Toggle off — remove vote
    delete suggestion.votes[userId];
  } else {
    // New vote or switch
    suggestion.votes[userId] = choice;
  }
  saveData(data);

  // Recount
  const yesCount = Object.values(suggestion.votes).filter(v => v === 'yes').length;
  const noCount  = Object.values(suggestion.votes).filter(v => v === 'no').length;

  // Update embed Votes field + buttons
  const oldEmbed = interaction.message.embeds[0];
  const updatedEmbed = {
    author:      oldEmbed.author,
    title:       oldEmbed.title,
    description: oldEmbed.description,
    color:       oldEmbed.color,
    thumbnail:   oldEmbed.thumbnail ? { url: oldEmbed.thumbnail.url } : undefined,
    fields:      oldEmbed.fields.map(f =>
      f.name === 'Votes'
        ? { name: 'Votes', value: `✅ ${yesCount} | ❌ ${noCount}`, inline: false }
        : { name: f.name, value: f.value, inline: f.inline ?? false }
    ),
    timestamp: oldEmbed.timestamp
  };

  await interaction.update({
    embeds: [updatedEmbed],
    components: [buildVoteRow(messageId, yesCount, noCount)]
  });
}

// ── internal helpers ─────────────────────────────────────────
function scheduleSuggestionCheck(messageId, channelId, guildId, client, delayMs) {
  if (suggestionTimers[messageId]) clearTimeout(suggestionTimers[messageId]);
  suggestionTimers[messageId] = setTimeout(
    () => resolveSuggestion(messageId, channelId, guildId, client),
    delayMs
  );
}

async function resolveSuggestion(messageId, channelId, guildId, client) {
  const data = loadData();
  const suggestion = data.suggestions?.[messageId];
  if (!suggestion || suggestion.status !== 'pending') return;

  const yesCount = Object.values(suggestion.votes || {}).filter(v => v === 'yes').length;
  const noCount  = Object.values(suggestion.votes || {}).filter(v => v === 'no').length;

  let newColor, statusText, newTitle, newStatus;
  if (yesCount > noCount) {
    newColor   = 0x57F287;
    statusText = '🟩 Accepted';
    newTitle   = 'SUGGESTION ACCEPTED';
    newStatus  = 'accepted';
  } else {
    newColor   = 0xFF4444;
    statusText = '🟥 Denied';
    newTitle   = 'SUGGESTION DENIED';
    newStatus  = 'denied';
  }

  try {
    const guild   = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    const oldEmbed = message.embeds[0];
    const submittedField = oldEmbed?.fields?.find(f => f.name === 'Submitted');

    const updatedEmbed = {
      author:      oldEmbed?.author,
      title:       newTitle,
      description: oldEmbed?.description,
      color:       newColor,
      thumbnail:   { url: CN_LOGO_URL },
      fields: [
        { name: 'Status',    value: statusText,                         inline: false },
        { name: 'Votes',     value: `✅ ${yesCount} | ❌ ${noCount}`,   inline: false },
        { name: 'Submitted', value: submittedField?.value ?? '',        inline: false }
      ],
      timestamp: new Date().toISOString()
    };

    // Disable buttons after voting closes
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`suggest_yes_${messageId}`)
        .setLabel(`✅  ${yesCount}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`suggest_no_${messageId}`)
        .setLabel(`❌  ${noCount}`)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true)
    );

    await message.edit({ embeds: [updatedEmbed], components: [disabledRow] });

    suggestion.status   = newStatus;
    suggestion.yesCount = yesCount;
    suggestion.noCount  = noCount;
    saveData(data);
  } catch (e) {
    console.error('[SUGGESTION RESOLVE ERROR]', e);
  }
}

// ── /sugchannel → admin sets the channel ─────────────────────
async function setSuggestChannel(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.options.getChannel('channel');
  const data = loadData();
  if (!data.config) data.config = {};
  data.config.suggestChannelId = channel.id;
  saveData(data);
  await interaction.editReply({
    embeds: [{
      title: '✅ Suggestion Channel Set',
      description: `Suggestions will now be posted in <#${channel.id}>.`,
      color: 0x57F287
    }]
  });
}

// ── restore timers after bot restart ─────────────────────────
function restoreTimers(client) {
  const data = loadData();
  if (!data.suggestions) return;
  const now = Date.now();
  for (const [msgId, suggestion] of Object.entries(data.suggestions)) {
    if (suggestion.status !== 'pending') continue;
    const remaining = suggestion.endsAt - now;
    if (remaining <= 0) {
      resolveSuggestion(msgId, suggestion.channelId, suggestion.guildId, client);
    } else {
      scheduleSuggestionCheck(msgId, suggestion.channelId, suggestion.guildId, client, remaining);
    }
  }
}

module.exports = {
  handleSuggestCommand,
  handleSuggestModalSubmit,
  handleSuggestionVote,
  setSuggestChannel,
  restoreTimers
};
