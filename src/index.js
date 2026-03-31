const { Client, GatewayIntentBits, WebhookClient, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const token = process.env.DISCORD_BOT_TOKEN;
const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
if (!token) { console.error('Missing DISCORD_BOT_TOKEN'); process.exit(1); }
if (!webhookUrl) { console.error('Missing DISCORD_WEBHOOK_URL'); process.exit(1); }
const LOGO_URL = 'https://raw.githubusercontent.com/moxybetter285/coral-bot/main/Koralski%20SMP%20logo%20u%20Minecraft%20stilu.png';
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const webhook = new WebhookClient({ url: webhookUrl });
client.on('clientReady', () => { console.log(`Logged in as ${client.user.tag}`); });
client.on('guildMemberAdd', async (member) => {
  try {
    await webhook.send({ embeds: [{ title: 'CORAL SMP', description: `Welcome <@${member.id}> to CoralSMP\n\n**IP** - coralsmp.net\n**PORT** - 19132\n**STORE** - https://coralsmp.tebex.io`, color: 5814783, thumbnail: { url: member.user.displayAvatarURL() }, image: { url: LOGO_URL }, footer: { text: `You are our ${member.guild.memberCount}th member!` } }] });
  } catch (err) { console.error('Failed:', err); }
});
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content === '!store') {
    try {
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Click For Webstore').setURL('https://coralsmp.tebex.io').setStyle(ButtonStyle.Link));
      await message.channel.send({ embeds: [{ title: '🛒 SERVER WEBSTORE', description: 'Support the server by visiting our store!\nPick up ranks, cosmetics, and more to help keep Coral SMP running strong.', color: 5814783, image: { url: LOGO_URL } }], components: [row] });
      await message.delete().catch(() => {});
    } catch (err) { console.error('Failed:', err); }
  }
});
client.login(token);
