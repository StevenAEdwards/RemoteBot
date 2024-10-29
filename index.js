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

const { CLIENT_ID, GUILD_ID, DISCORD_TOKEN, M3U_STREAMS_URL, JELLYFIN_URL, JELLYFIN_API_KEY, JELLYFIN_FOLDER_LIST } = process.env;
const M3U_STREAMS_PATH = "streams.m3u"


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

	if (M3U_STREAMS_URL || JELLYFIN_URL) {
		console.log('Running initial file download on startup...');
		await importJellyfinStreams(JELLYFIN_URL, JELLYFIN_API_KEY, JELLYFIN_FOLDER_LIST);
		// await downloadFile(M3U_STREAMS_URL, M3U_STREAMS_PATH);
		cron.schedule('0 5 * * *', async () => {
			if (M3U_STREAMS_URL) {
				console.log('Running daily file download at 5:00 AM America/New_York time...');
				await downloadFile(M3U_STREAMS_URL, M3U_STREAMS_PATH);
				await importM3UFile(M3U_STREAMS_PATH);
			}
			if (JELLYFIN_URL) {
				console.log('Importing Jellyfin titles...');
				await importJellyfinStreams(JELLYFIN_URL, JELLYFIN_API_KEY, JELLYFIN_FOLDER_LIST);
			}
		}, {
			scheduled: true,
			timezone: "America/New_York"
		});
	} else {
		console.error('No M3U_STREAMS_URL specified in environment variables.');
	}

	if (M3U_STREAMS_PATH) {
		// importM3UFile(M3U_STREAMS_PATH);
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
});
client.on('voiceStateUpdate', async (oldState, newState) => {
	const guild = newState.guild;
	try {
		const activeVoiceMemberIDs = guild.channels.cache
			.filter(channel => channel.isVoiceBased())
			.map(channel => [...channel.members.keys()])
			.flat();

		if (newState.channelId && (!oldState.channelId || oldState.channelId !== newState.channelId)) {
			if (!activeVoiceMemberIDs.includes(newState.id)) {
				activeVoiceMemberIDs.push(newState.id);
			}
		}
		await guild.members.fetch({ user: activeVoiceMemberIDs, force: true });
	} catch (error) {
		console.error('Failed to update the members cache for active voice members:', error);
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

async function importJellyfinStreams(JELLYFIN_URL, JELLYFIN_API_KEY, JELLYFIN_FOLDER_LIST) {
	// Ensure the folder list is split into an array
	const collections = JELLYFIN_FOLDER_LIST.split(',').map(collection => collection.trim());
	try {
		// Step 1: Fetch all collections (folders) from Jellyfin
		const response = await axios({
			url: `${JELLYFIN_URL}/Items`,
			method: 'GET',
			params: {
				api_key: JELLYFIN_API_KEY,
				IncludeItemTypes: 'Folder' // We only want folders
			},
			headers: {
				'accept': 'application/json'
			}
		});

		// Parse the list of all collections/folders
		const allCollections = response.data.Items;

		// Filter collections based on the names in the provided list
		const matchingCollections = allCollections.filter(item => collections.includes(item.Name));

		// Step 2: For each matching collection, fetch the media items (movies, episodes)
		for (const collection of matchingCollections) {
			try {
				const itemsResponse = await axios({
					url: `${JELLYFIN_URL}/Items`,
					method: 'GET',
					params: {
						ParentId: collection.Id, // Fetch items under this collection (folder)
						Recursive: true,
						IncludeItemTypes: 'Movie,Episode', // Specify the type of media you want
						api_key: JELLYFIN_API_KEY
					},
					headers: {
						'accept': 'application/json'
					}
				});

				// Parse the media items in the collection
				const mediaItems = itemsResponse.data.Items;

				// Step 3: Add each media item to client.streams with Name as key and Id as value
				mediaItems.forEach(item => {
					client.streams[`JF | ${item.Name}`] = `${item.Id}`;
				});

				console.log(`Successfully imported streams for collection: ${collection.Name}`);
			} catch (error) {
				console.error(`Error fetching media items for collection ${collection.Name}:`, error);
			}
		}
	} catch (error) {
		console.error('Error fetching collections from Jellyfin:', error);
	}
}
async function importJellyfinStreams(JELLYFIN_URL, JELLYFIN_API_KEY, JELLYFIN_FOLDER_LIST) {
	// Ensure the folder list is split into an array
	const collections = JELLYFIN_FOLDER_LIST.split(',').map(collection => collection.trim());
	try {
		// Step 1: Fetch all collections (folders) from Jellyfin
		const response = await axios({
			url: `${JELLYFIN_URL}/Items`,
			method: 'GET',
			params: {
				api_key: JELLYFIN_API_KEY,
				IncludeItemTypes: 'Folder' // We only want folders
			},
			headers: {
				'accept': 'application/json'
			}
		});

		// Parse the list of all collections/folders
		const allCollections = response.data.Items;

		// Filter collections based on the names in the provided list
		const matchingCollections = allCollections.filter(item => collections.includes(item.Name));

		// Step 2: For each matching collection, fetch the media items (movies, episodes)
		for (const collection of matchingCollections) {
			try {
				const itemsResponse = await axios({
					url: `${JELLYFIN_URL}/Items`,
					method: 'GET',
					params: {
						ParentId: collection.Id, // Fetch items under this collection (folder)
						Recursive: true,
						IncludeItemTypes: 'Movie,Episode', // Specify the type of media you want
						api_key: JELLYFIN_API_KEY
					},
					headers: {
						'accept': 'application/json'
					}
				});

				// Parse the media items in the collection
				const mediaItems = itemsResponse.data.Items;

				// Step 3: Add each media item to client.streams with Name as key and Id as value
				mediaItems.forEach(item => {
					client.streams[`JF | ${item.Name}`] = `${item.Id}`;
				});

				console.log(`Successfully imported streams for collection: ${collection.Name}`);
			} catch (error) {
				console.error(`Error fetching media items for collection ${collection.Name}:`, error);
			}
		}
	} catch (error) {
		console.error('Error fetching collections from Jellyfin:', error);
	}
}

client.login(DISCORD_TOKEN);
