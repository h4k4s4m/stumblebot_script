// ==UserScript==
// @name         StumbleBot
// @namespace    StumbleBot
// @version      1.0.2
// @description  Play youtube videos from the chat box and/or add custom commands to StumbleChat
// @author       Goji
// @match        https://stumblechat.com/room/*
// ==/UserScript==

// Constants
const COMMANDS = {
    YT: '.yt',
    TOKE: '.toke',
    JOIN: '.join',
    COMMANDS: '.commands',
    PING: 'ping',
    CHEERS: '.cheers',
    RULES: '.rules'
};
const rules_time = 1000 * 60 * 10;
const MESSAGES = {
    FOUR_TWENTY: '🌲 It\'s 4:20 somewhere! Smoke em if you got em! 💨',
    RULES_IMAGE: 'https://i.imgur.com/dSWT06e.png',
    TOKE_INVALID_DURATION: 'Please specify a valid duration between 60-240 seconds (e.g., .toke 120)',
    TOKE_START: '🔥 TOKE COUNTDOWN STARTED: {seconds} SECONDS 🔥',
    TOKE_REMAINING: '⏱️ {seconds} seconds remaining until toke time!',
    TOKE_FINAL: '🔥🔥🔥 LETS TOKE  🔥🔥🔥',
    TOKE_JOIN: '{name} has joined the toke session! 🌿',
    TOKE_JOIN_ERROR: 'There is no active toke session to join! Start one with .toke [seconds]',
    CHEERS: 'Cheers! Smoke em if you got em! 🍻💨',
    GREETINGS: [
        '🌿 Welcome to the green room, {name}! 💨',
        '🔥 Ayy {name} has joined the session! Pass them the virtual blunt! 🚬',
        '💨 Look who rolled in - it\'s {name}! Time to elevate! 🌿',
        '🌲 {name} has entered the cipher! Keep it lit! 🔥',
        '🍁 Welcome to the smoke circle, {name}! 💨',
        '💚 {name} just dropped into the green zone! 🌿',
        '🔥 {name} has joined! Time to pass the peace pipe! 💨',
        '🌿 Welcome aboard the chill train, {name}! 🚂💨',
        '💨 {name} is here to blaze a trail! 🔥',
        '🌲 {name} just sparked up the chat! Let\'s get lifted! 💨'
    ],
    WELCOME: 'Welcome, {name}!',
    WELCOME_BACK: 'Welcome back, {name}!',
    PONG: 'PONG'
};

// Timer state
const TimerState = {
    lastSentHour: -1,
    lastSentDay: -1,
    shouldSendMessage: false,
    lastRulesPost: 0,
    tokeCountdownActive: false,
    tokeCountdownInterval: null,
    tokeParticipants: new Set(),
    tokeInitiator: null
};

// User management
class UserManager {
    constructor() {
        this.userNicknames = JSON.parse(localStorage.getItem('userNicknames')) || {};
    }

    handleUserJoin(wsmsg, respondFn) {
        const { username, nick, handle, mod } = wsmsg;
        const nickname = /^guest-\d+$/i.test(nick) ? username : nick;
        const userInfo = {
            handle,
            username,
            nickname: nickname || username,
            modStatus: mod ? 'Moderator' : 'Regular'
        };

        this.userNicknames[username] = userInfo;
        this.userNicknames[handle] = userInfo;
        localStorage.setItem('userNicknames', JSON.stringify(this.userNicknames));

        const greetingIndex = Math.floor(Math.random() * MESSAGES.GREETINGS.length);
        const message = MESSAGES.GREETINGS[greetingIndex].replace('{name}', nickname || username);
        respondFn(message);
    }

    getNickname(handle) {
        return this.userNicknames[handle]?.nickname || 'User';
    }
}

// Timer management
class TimerManager {
    static check420Timer() {
        const now = new Date();
        const { currentHour, currentMinute, currentSecond, currentDay } = {
            currentHour: now.getHours(),
            currentMinute: now.getMinutes(),
            currentSecond: now.getSeconds(),
            currentDay: now.getDate()
        };

        if (TimerState.lastSentDay !== currentDay) {
            TimerState.lastSentDay = currentDay;
            TimerState.lastSentHour = -1;
            console.log('Day changed, resetting 420 timer tracking');
        }

        if (currentMinute === 20 && TimerState.lastSentHour !== currentHour && currentSecond < 10) {
            console.log(`420 timer activated at XX:20:${currentSecond}`);
            TimerState.lastSentHour = currentHour;
            TimerState.shouldSendMessage = true;
        }
    }

    static checkRulesTimer(websocket) {
        const now = new Date().getTime();
        if (!TimerState.tokeCountdownActive && (now - TimerState.lastRulesPost >= rules_time)) {
            TimerState.lastRulesPost = now;
            if (websocket) {
                try {
                    websocket._send(JSON.stringify({ stumble: 'msg', text: MESSAGES.RULES_IMAGE }));
                    console.log('Rules posted successfully');
                } catch (error) {
                    console.error('Error posting rules:', error);
                }
            }
        }
    }
}

// Command handler
class CommandHandler {
    constructor(userManager) {
        this.userManager = userManager;
    }

    handleCommand(wsmsg, websocket) {
        const { text, handle } = wsmsg;
        const commands = {
            [COMMANDS.YT]: () => this.handleYouTube(text, websocket),
            [COMMANDS.TOKE]: () => this.handleToke(text, websocket, handle),
            [COMMANDS.JOIN]: () => this.handleJoin(handle, websocket),
            [COMMANDS.COMMANDS]: () => this.handleCommandsList(websocket),
            [COMMANDS.PING]: () => this.handlePing(websocket),
            [COMMANDS.CHEERS]: () => this.handleCheers(handle, websocket),
            [COMMANDS.RULES]: () => this.handleRules(websocket)
        };

        for (const [command, handler] of Object.entries(commands)) {
            if (text.indexOf(command) === 0) {
                handler();
                break;
            }
        }
    }

    handleYouTube(text, websocket) {
        const query = text.slice(COMMANDS.YT.length).trim();
        if (query) {
            websocket._send(JSON.stringify({ stumble: 'youtube', type: 'add', id: query, time: 0 }));
        }
    }

    handleToke(text, websocket, handle) {
        const duration = parseInt(text.slice(COMMANDS.TOKE.length).trim());
        if (!isNaN(duration) && duration >= 60 && duration <= 240) {
            const nickname = this.userManager.getNickname(handle);
            TimerState.tokeInitiator = nickname;
            TimerState.tokeParticipants.clear();
            TimerState.tokeParticipants.add(nickname);
            this.startTokeCountdown(duration, websocket);
        } else {
            this.sendMessage(websocket, MESSAGES.TOKE_INVALID_DURATION);
        }
    }

    handleCommandsList(websocket) {
        const commandsList = [
            `- ${COMMANDS.YT} [query] - Play a YouTube video`,
            `- ${COMMANDS.TOKE} [seconds] - Start a toke countdown (60-240 seconds)`,
            `- ${COMMANDS.JOIN} - Join an active toke countdown`,
            `- ${COMMANDS.CHEERS} - Share a friendly cheers with the room`,
            `- ${COMMANDS.COMMANDS} - List all commands`
        ];

        commandsList.forEach((command, index) => {
            setTimeout(() => this.sendMessage(websocket, command), index * 1000);
        });
    }

    handlePing(websocket) {
        setTimeout(() => this.sendMessage(websocket, MESSAGES.PONG), 1000);
    }

    handleCheers(handle, websocket) {
        const nickname = this.userManager.getNickname(handle);
        this.sendMessage(websocket, MESSAGES.CHEERS.replace('{name}', nickname));
    }

    handleJoin(handle, websocket) {
        if (!TimerState.tokeCountdownActive) {
            this.sendMessage(websocket, MESSAGES.TOKE_JOIN_ERROR);
            return;
        }
        const nickname = this.userManager.getNickname(handle);
        if (!TimerState.tokeParticipants.has(nickname)) {
            TimerState.tokeParticipants.add(nickname);
            this.sendMessage(websocket, MESSAGES.TOKE_JOIN.replace('{name}', nickname));
        }
    }

    handleRules(websocket) {
        this.sendMessage(websocket, MESSAGES.RULES_IMAGE);
    }

    startTokeCountdown(totalSeconds, websocket) {
        if (TimerState.tokeCountdownInterval) {
            clearInterval(TimerState.tokeCountdownInterval);
        }

        TimerState.tokeCountdownActive = true;
        this.sendMessage(websocket, MESSAGES.TOKE_START
            .replace('{seconds}', totalSeconds)
            .replace('{initiator}', TimerState.tokeInitiator));

        let secondsRemaining = totalSeconds;
        TimerState.tokeCountdownInterval = setInterval(() => {
            secondsRemaining--;
            
            if (secondsRemaining > 30 && secondsRemaining % 30 === 0) {
                const participants = Array.from(TimerState.tokeParticipants).join(', ');
                this.sendMessage(websocket, MESSAGES.TOKE_REMAINING
                    .replace('{seconds}', secondsRemaining)
                    .replace('{participants}', participants));
            } else if (secondsRemaining <= 30 && secondsRemaining > 10 && secondsRemaining % 10 === 0) {
                this.sendMessage(websocket, `⏱️ ${secondsRemaining} seconds remaining!`);
            } else if (secondsRemaining <= 10 && secondsRemaining > 0) {
                this.sendMessage(websocket, `${secondsRemaining}...`);
            } else if (secondsRemaining === 0) {
                const participants = Array.from(TimerState.tokeParticipants).join(', ');
                this.sendMessage(websocket, MESSAGES.TOKE_FINAL.replace('{participants}', participants));
                clearInterval(TimerState.tokeCountdownInterval);
                TimerState.tokeCountdownInterval = null;
                TimerState.tokeCountdownActive = false;
                TimerState.lastRulesPost = new Date().getTime();
            }
        }, 1000);
    }

    sendMessage(websocket, text) {
        websocket._send(JSON.stringify({ stumble: 'msg', text }));
    }
}

// Main initialization
(function() {
    const userManager = new UserManager();
    const commandHandler = new CommandHandler(userManager);
    window.botWebSocket = null;

    setInterval(() => {
        TimerManager.check420Timer();
        TimerManager.checkRulesTimer(window.botWebSocket);
    }, 1000);

    setInterval(() => {
        if (!window.botWebSocket) {
            console.log('WebSocket reference is null, waiting for connection...');
        }
    }, 30000);

    WebSocket.prototype._send = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
        this._send(data);

        if (!window.botWebSocket) {
            console.log('Setting global WebSocket reference');
            window.botWebSocket = this;
            this.addEventListener('message', handleMessage.bind(this), false);
        }

        this.send = function(data) {
            console.log('send:', data);
            const sendData = safeJSONParse(data);
            if (sendData?.stumble === 'subscribe') {
                console.log('subscribe caught');
            } else {
                this._send(data);
            }
        };
    };

    function handleMessage(msg) {
        const wsmsg = safeJSONParse(msg.data);
        if (!wsmsg) return;

        if (wsmsg.stumble === 'join' && wsmsg.nick && wsmsg.username && wsmsg.handle) {
            userManager.handleUserJoin(wsmsg, text => commandHandler.sendMessage(this, text));
        }

        if (TimerState.shouldSendMessage) {
            TimerState.shouldSendMessage = false;
            setTimeout(() => this._send(JSON.stringify({ stumble: 'msg', text: MESSAGES.FOUR_TWENTY })), 1000);
        }

        commandHandler.handleCommand(wsmsg, this);
    }

    function safeJSONParse(jsonString) {
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            console.error('Error parsing JSON:', error);
            return null;
        }
    }
})();