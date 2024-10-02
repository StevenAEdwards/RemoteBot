const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const cron = require('node-cron');
const { Client, Collection, Events, GatewayIntentBits, REST, Routes } = require('discord.js');

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildVoiceStates,
	]
});
client.commands = new Collection();
client.streams = {};

const { CLIENT_ID, GUILD_ID, DISCORD_TOKEN, M3U_STREAMS_URL } = process.env;
const M3U_STREAMS_PATH = "streams.url"


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

client.once(Events.ClientReady, async () => {
	console.log(`Ready! Logged in as ${client.user.tag}`);

	if (M3U_STREAMS_URL) {
		console.log('Running initial file download on startup...');
		await downloadFile(M3U_STREAMS_URL, M3U_STREAMS_PATH);

		cron.schedule('0 5 * * *', async () => {
			console.log('Running daily file download at 5:00 AM America/New_York time...');
			await downloadFile(M3U_STREAMS_URL, M3U_STREAMS_PATH);
			await importM3UFile(M3U_STREAMS_PATH);
		}, {
			scheduled: true,
			timezone: "America/New_York"
		});
	} else {
		console.error('No M3U_STREAMS_URL specified in environment variables.');
	}

	if (M3U_STREAMS_PATH) {
		importM3UFile(M3U_STREAMS_PATH);
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
	}
	else if (interaction.isStringSelectMenu()) {
		const command = client.commands.get(interaction.customId);
		if (!command) {
			console.error(`No command matching ${interaction.customId} was found.`);
			return;
		}
		try {
			await command.handleSelectMenu(interaction);
		} catch (error) {
			console.error('Error handling dropdown interaction:', error);
			await sendError(interaction, 'There was an error handling the dropdown interaction!');
		}
	}
});

client.on('voiceStateUpdate', async (newState) => {
	const guild = newState.guild;
	try {
		await guild.members.fetch({ force: true });
	} catch (error) {
		console.error('Failed to update the members cache:', error);
	}
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

async function downloadFile(url, savePath) {
	try {
		const response = await axios({
			url,
			method: 'GET',
			responseType: 'stream'
		});

		const writer = fs.createWriteStream(savePath);
		response.data.pipe(writer);

		return new Promise((resolve, reject) => {
			writer.on('finish', () => {
				console.log(`File downloaded successfully to ${savePath}`);
				resolve();
			});
			writer.on('error', (err) => {
				console.error('Error downloading file:', err);
				reject(err);
			});
		});
	} catch (error) {
		console.error('Error downloading file:', error);
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
		console.log('Streams imported successfully');
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
