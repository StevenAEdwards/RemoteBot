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

        const dropDownOptions = filteredStreams.map(([name, url]) => ({
            label: name.length > 97 ? `${name.slice(0, 97)}...` : name,
            value: `${name}|${url}`,
        })).slice(0, 25);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('stream')
            .setPlaceholder('Click Here!')
            .addOptions(dropDownOptions);

        const menuRow = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            content: 'Choose a stream for StreamBot to bring to your voice channel.',
            components: [menuRow]
        });

        const filter = i => i.customId === 'stream' && i.user.id === interaction.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000 });

        collector.on('collect', async i => {
            if (i.customId === 'stream') {
                await this.handleSelectMenu(i);
                collector.stop();
            }
        });

        collector.on('end', async collected => {
            if (collected.size === 0) {
                await interaction.editReply({
                    content: '⏰ No stream selected. Please type `/stream` if you still want to choose a stream.',
                    components: []
                });
            }
        });
    },

    async handleSelectMenu(interaction) {
        const [streamName, streamURL] = interaction.values[0].split('|');
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            await interaction.update({ content: '❌ You need to be in a voice channel to use this command.', components: [] });
            return;
        }

        const requestData = {
            guildId: interaction.guildId,
            channelId: voiceChannel.id,
            streamURL: streamURL,
        };

        try {
            await interaction.update({ content: `🔄 Attempting to start **${streamName}** in **${voiceChannel.name}**...`, components: [] });

            await axios.post(`${process.env.STREAM_BOT_URL}/play`, requestData, {
                headers: { 'Content-Type': 'application/json' },
            });
            await interaction.editReply({ content: `✅ Started streaming **${streamName}** in **${voiceChannel.name}**!` });
        } catch (error) {
            // To Do: learn how to properly write interaction responses with timeouts. That doesn't swallow certain errors.  
            if (error.code !== 40060) {
                console.error('Error starting stream:', error);
                await interaction.editReply({ content: `❌ Failed to start streaming: ${error.message}` });
            }
        }
    }
};
