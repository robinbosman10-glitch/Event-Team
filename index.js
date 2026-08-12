const path = require("node:path");
const { Client, Events, GatewayIntentBits } = require("discord.js");

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("DISCORD_TOKEN ontbreekt.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot is online als ${readyClient.user.tag}.`);

  try {
    const avatarPath = path.join(__dirname, "bot-avatar.png");
    await readyClient.user.setAvatar(avatarPath);
    console.log("De standaard profielfoto is ingesteld.");
  } catch (error) {
    console.error("De profielfoto kon niet worden ingesteld:", error);
  }
});

client.login(token);
