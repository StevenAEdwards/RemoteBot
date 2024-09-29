const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits, REST, Routes } = require('discord.js');

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildVoiceStates,
	]
});
client.commands = new Collection();
client.streams = {};

const { CLIENT_ID, GUILD_ID, DISCORD_TOKEN, M3U_PATH } = process.env;

if (!CLIENT_ID || !GUILD_ID || !DISCORD_TOKEN) {
	console.error('Missing critical environment variables. Ensure CLIENT_ID, GUILD_ID, and DISCORD_TOKEN are set.');
	process.exit(1);
}

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

const commands = [];
for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
			commands.push(command.data.toJSON());
		} else {
			console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
	try {
		console.log(`Started refreshing ${commands.length} application (/) commands.`);

		const data = await rest.put(
			Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
			{ body: commands },
		);

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		console.error('Error registering application commands:', error);
	}
})();

client.once(Events.ClientReady, () => {
	console.log(`Ready! Logged in as ${client.user.tag}`);

	if (M3U_PATH) {
		importM3UFile(M3U_PATH);
	} else {
		console.error('No M3U file path specified in environment variables.');
	}
});

client.on(Events.InteractionCreate, async interaction => {
	if (interaction.isChatInputCommand()) {
		const command = client.commands.get(interaction.commandName);
		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}
		try {
			await command.execute(interaction, client);
		} catch (error) {
			console.error(`Error executing command ${interaction.commandName}:`, error);
			await sendError(interaction, 'There was an error while executing this command!');
		}
	} else if (interaction.isStringSelectMenu()) {

		const command = client.commands.get('stream');
		if (command) {
			try {
				await command.handleSelectMenu(interaction, client);
			} catch (error) {
				console.error('Error handling dropdown interaction:', error);
				await sendError(interaction, 'There was an error handling the dropdown interaction!');
			}
		}
	}
});

client.on('voiceStateUpdate', async (oldState, newState) => {
	const guild = newState.guild;
	try {
		await guild.members.fetch({ force: true });
	} catch (error) {
		console.error('Failed to update the members cache:', error);
	}
	console.log('Current Members Cache:', guild.members.cache);
});

async function sendError(interaction, message) {
	try {
		if (interaction.replied || interaction.deferred) {
			await interaction.followUp({ content: message, ephemeral: true });
		} else {
			await interaction.reply({ content: message, ephemeral: true });
		}
	} catch (error) {
		console.error('Failed to send error message:', error);
	}
}

function importM3UFile(filePath) {
	if (!fs.existsSync(filePath)) {
		console.error(`M3U file not found at: ${filePath}`);
		return;
	}

	try {
		const fileContent = fs.readFileSync(filePath, 'utf8');
		client.streams = parseM3UFile(fileContent);
		console.log('Streams imported successfully:');
	} catch (error) {
		console.error('Error reading M3U file:', error);
	}
}

function parseM3UFile(fileContent) {
	const lines = fileContent.split('\n');
	const streams = {};
	let currentStreamName = '';

	lines.forEach(line => {
		line = line.trim();
		if (line.startsWith('#EXTINF')) {
			const match = line.match(/tvg-name="([^"]+)"/);
			currentStreamName = match ? match[1].trim() : '';
		} else if (line && !line.startsWith('#')) {
			streams[currentStreamName] = line;
		}
	});

	return streams;
}

client.login(DISCORD_TOKEN);
