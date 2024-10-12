const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const KEYWORDS = process.env.KEYWORDS ? process.env.KEYWORDS.split(',') : [];
const EXCLUDES = process.env.EXCLUDES ? process.env.EXCLUDES.split(',') : [];
const STREAMS_PER_REPLY = 100;
const MAX_STREAM_SEARCH = 500;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stream')
        .setDescription('Choose a stream for StreamBot to bring to your voice channel!')
        .addStringOption(option => 
            option.setName('keyword')
                  .setDescription('Find streams containing keyword')
                  .setRequired(false)
        ),
    async execute(interaction, client) {
        await interaction.deferReply();
        const userKeyword = interaction.options.getString('keyword');

        const filteredStreams = filterStreams(client.streams, userKeyword, KEYWORDS, EXCLUDES, MAX_STREAM_SEARCH);

        if (filteredStreams.length === 0) {
            await interaction.editReply({ content: 'No streams matched the specified keyword(s).', ephemeral: true });
            return;
        }

        const totalPages = Math.ceil(filteredStreams.length / STREAMS_PER_REPLY);
        let currentPage = 0;

        await generateStreamMessage(interaction, filteredStreams, currentPage, totalPages);
        createCollector(interaction, filteredStreams, currentPage, totalPages, client);
    },
};

function filterStreams(streams, userKeyword, KEYWORDS, EXCLUDES, MAX_STREAM_SEARCH) {
    let filteredStreams = Object.entries(streams);

    if (userKeyword) {
        filteredStreams = filteredStreams.filter(([name]) =>
            name.toUpperCase().includes(userKeyword.toUpperCase())
        );
    } else {
        filteredStreams = filteredStreams.filter(([name]) =>
            KEYWORDS.some(keyword => name.toUpperCase() === keyword.toUpperCase())
        );
    }

    filteredStreams = filteredStreams.filter(([name]) =>
        !EXCLUDES.some(exclude => name.toUpperCase().includes(exclude.toUpperCase()))
    );

    return filteredStreams.slice(0, MAX_STREAM_SEARCH);
}

const generateStreamMessage = async (interaction, filteredStreams, currentPage, totalPages) => {
    const start = currentPage * STREAMS_PER_REPLY;
    const end = start + STREAMS_PER_REPLY;
    const currentStreams = filteredStreams.slice(start, end);

    const dropdownMenus = createDropdownMenus(currentStreams, currentPage);
    const buttons = createNavigationButtons(currentPage, totalPages);

    await interaction.editReply({
        content: 'Choose a stream for StreamBot to bring to your voice channel.',
        components: [...dropdownMenus, buttons]
    });
};

const createCollector = (interaction, filteredStreams, currentPage, totalPages, client) => {
    const filter = i => (
        i.customId.startsWith('stream_menu_') || i.customId === 'left' || i.customId === 'right'
    ) && i.user.id === interaction.user.id;

    const collector = interaction.channel.createMessageComponentCollector({ filter, time: 30000 });

    collector.on('collect', async i => {
        if (i.customId === 'left') {
            currentPage -= 1;
        } else if (i.customId === 'right') {
            currentPage += 1;
        } else if (i.customId.startsWith('stream_menu_')) {
            collector.stop();

            const { streamName, streamUrl } = searchStreamByNumber(client.streams, i.values[0]);

            const member = await i.guild.members.fetch(i.user.id);
            const voiceChannel = member.voice.channel;

            if (!voiceChannel) {
                await i.update({ content: '❌ You need to be in a voice channel to use this command.', components: [] });
                return;
            }

            const requestData = {
                guildId: i.guildId,
                channelId: voiceChannel.id,
                streamURL: streamUrl
            };

            await i.update({ content: `🔄 Attempting to start **${streamName}** in **${voiceChannel.name}**...`, components: [] });

            try {
                await axios.post(`${process.env.STREAM_BOT_URL}/play`, requestData, {
                    headers: { 'Content-Type': 'application/json' },
                });
                await i.editReply({ content: `✅ Successfully started streaming **${streamName}** in **${voiceChannel.name}**!` });
            } catch (error) {
                console.error('Error starting stream:', error);
                await i.editReply({ content: `❌ Failed to start streaming: ${error.message}` });
            }
            return;
        }
        await generateStreamMessage(interaction, filteredStreams, currentPage, totalPages);
        await i.deferUpdate();
        collector.stop();
        createCollector(interaction, filteredStreams, currentPage, totalPages, client);
    });

    collector.on('end', async collected => {
        if (collected.size === 0) {
            await interaction.editReply({
                content: '⏰ No stream selected. Please type `/stream` again if you still want to choose a stream.',
                components: []
            });
        }
    });
};

const parseStreamNumber = (url) => {
    const match = url.match(/\/([^\/]+)$/);
    return match ? match[1] : null;
};

const searchStreamByNumber = (streams, searchSegment) => {
    for (const [streamName, streamUrl] of Object.entries(streams)) {
        const lastSegment = parseStreamNumber(streamUrl);
        if (lastSegment === searchSegment) {
            return { streamName, streamUrl };
        }
    }
    return null;
};

const createNavigationButtons = (currentPage, totalPages) => {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('left')
            .setLabel('⬅️ Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('right')
            .setLabel('➡️ Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === totalPages - 1) 
    );
};

const createDropdownMenus = (currentStreams, currentPage) => {
    const dropdownMenus = [];
    const DROPDOWNS_PER_MESSAGE = 4;
    const MAX_DROPDOWN_ITEMS = 25;
    for (let i = 0; i < DROPDOWNS_PER_MESSAGE; i++) { 
        const streamChunk = currentStreams.slice(i * MAX_DROPDOWN_ITEMS, (i + 1) * MAX_DROPDOWN_ITEMS);
        const dropDownOptions = streamChunk.map(([name, url]) => ({
            label: name,
            value: parseStreamNumber(url)
        }));
        if (dropDownOptions.length > 0) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`stream_menu_${currentPage}_${i}`)
                .setPlaceholder(`Stream List #${currentPage * DROPDOWNS_PER_MESSAGE + i + 1}`)
                .addOptions(dropDownOptions);

            dropdownMenus.push(new ActionRowBuilder().addComponents(selectMenu));
        }
    }
    return dropdownMenus;
};