const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
const axios = require('axios');

const keywords = [
    'HELLS KITCHEN', 'KITCHEN NIGHTMARES',
    'TRAILER PARK BOYS', 'IMPRACTICAL JOKERS', 'JACKASS', 'KEY AND PEELE',
    'SOUTH PARK', 'TOSH.0', 'WHOSE LINE IS IT ANYWAY', 'MASTERCHEF',
    'SKYGO: SKY SPORTS NFL 4K', 'SKY SPORTS MAIN EVENT 4K',
    'SKY SPORTS + 4K', 'SKY SPORTS MIX 4K', 'SKY SPORTS F1 4K'
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stream')
        .setDescription('Choose a stream for StreamBot to bring to your voice channel!'),

    async execute(interaction, client) {
        const filteredStreams = Object.entries(client.streams).filter(([name]) =>
            keywords.some(keyword => name.toUpperCase().includes(keyword))
        );

        if (filteredStreams.length === 0) {
            await interaction.reply({ content: 'No streams matched the specified keywords.', ephemeral: true });
            return;
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('selectStream')
            .setPlaceholder('Click Here!')
            .addOptions(filteredStreams.map(([name, url]) => ({
                label: name.length > 97 ? `${name.slice(0, 97)}...` : name,
                value: `${name}|${url}`,
            })));

        const menuRow = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            content: 'Choose a stream for StreamBot to bring to your voice channel.',
            components: [menuRow],
        });
    },

    async handleSelectMenu(interaction, client) {
        const [streamName, streamURL] = interaction.values[0].split('|');
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            await interaction.reply({ content: 'You need to be in a voice channel to use this command.', ephemeral: true });
            return;
        }

        const requestData = {
            guildId: interaction.guildId,
            channelId: voiceChannel.id,
            streamURL: streamURL,
        };

        try {
            await axios.post(`${process.env.STREAM_BOT_URL}/play`, requestData, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            await interaction.update({ content: `Started streaming **${streamName}** in ${voiceChannel.name}`, components: [] });
        } catch (error) {
            console.error('Error starting stream:', error);
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: `Failed to start streaming: ${error.message}`, ephemeral: true });
            } else {
                await interaction.reply({ content: `Failed to start streaming: ${error.message}`, ephemeral: true });
            }
        }
    }
};
