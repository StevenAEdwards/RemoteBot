const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');
const axios = require('axios');
const KEYWORDS = process.env.KEYWORDS ? process.env.KEYWORDS.split(',') : [];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stream')
        .setDescription('Choose a stream for StreamBot to bring to your voice channel!'),
    async execute(interaction, client) {
        const filteredStreams = Object.entries(client.streams).filter(([name]) =>
            KEYWORDS.some(keyword => name.toUpperCase().includes(keyword))
        );

        if (filteredStreams.length === 0) {
            await interaction.reply({ content: 'No streams matched the specified keywords.', ephemeral: true });
            return;
        }

        let dropDownOptions = filteredStreams.map(([name, url]) => ({
            label: name.length > 97 ? `${name.slice(0, 97)}...` : name,
            value: `${name}|${url}`,
        }))

        dropDownOptions = dropDownOptions.slice(0, 25);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('stream')
            .setPlaceholder('Click Here!')
            .addOptions(dropDownOptions);

        const menuRow = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            content: 'Choose a stream for StreamBot to bring to your voice channel.',
            components: [menuRow],
            ephemeral: true, 
        });
        
        setTimeout(async () => {
            try {
                const disabledMenu = new StringSelectMenuBuilder(selectMenu)
                    .setCustomId('stream')
                    .setPlaceholder('Timed out')
                    .setDisabled(true)
                    .setOptions(dropDownOptions);
                const disabledRow = new ActionRowBuilder().addComponents(disabledMenu);
                await interaction.editReply({
                    content: 'Type /stream if still want to choose a stream.',
                    components: [disabledRow]
                });
            } catch (error) {
                console.error('Error disabling dropdown menu:', error);
            }
        }, 30000);
    },

    async handleSelectMenu(interaction) {
        const [streamName, streamURL] = interaction.values[0].split('|');
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const voiceChannel = member.voice.channel;

        await interaction.deferReply({ephemeral: true});

        if (!voiceChannel) {
            await interaction.editReply({ content: 'You need to be in a voice channel to use this command.'});
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

            await interaction.editReply({ content: `Started streaming **${streamName}** in **${voiceChannel.name}**`, components: [] });
        } catch (error) {
            console.error('Error starting stream:', error);
            await interaction.editReply({ content: `Failed to start streaming: ${error.message}`});
        }
    }
};
