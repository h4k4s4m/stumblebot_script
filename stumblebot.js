// ==UserScript==
// @name         OUIDBot
// @namespace    OUIDBot
// @version      1.1
// @description  Greetings, commands and more
// @author       Smokemoar (based on work by Goji)
// @match        https://stumblechat.com/room/*
// ==/UserScript==

// Constants
const COMMANDS = {
    YT: '.yt',
    TOKE: '.toke',
    COMMANDS: '.commands',
    PING: 'ping',
    CHEERS: '.cheers',
    RULES: '.rules'
};
const rules_time = 1000 * 60 * 13;
const suggestion_time = 1000 * 60 * 20;
// Rate limiting configuration
const RATE_LIMIT = {
    MESSAGE_DELAY: 1200, // Milliseconds between messages
    PRIORITY_DELAY: 500  // Milliseconds between priority messages
};
const MESSAGES = {
    FOUR_TWENTY: '🌲 It\'s 4:20 somewhere! Smoke em if you got em! 💨',
    RULES_IMAGE: 'https://i.imgur.com/dSWT06e.png',
    SUGGESTIONS_LINK: 'https://forms.gle/phdBT3mEBgJ7wtAJ7',
    TOKE_INVALID_DURATION: 'Please specify a valid duration between 60-240 seconds (e.g., .toke 120)',
    TOKE_START: '🔥 TOKE COUNTDOWN STARTED: {seconds} SECONDS 🔥',
    TOKE_REMAINING: '⏱️ {seconds} seconds remaining until toke time!',
    TOKE_FINAL: '🔥🔥🔥 LETS TOKE  🔥🔥🔥',
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
    lastSuggestionPost: 0,
    tokeCountdownActive: false,
    tokeCountdownInterval: null
};

// Message Queue for rate limiting
class MessageQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.lastSentTime = 0;
    }

    // Configure rate limiting settings
    static configureRateLimit(messageDelay, priorityDelay) {
        if (typeof messageDelay === 'number' && messageDelay > 0) {
            RATE_LIMIT.MESSAGE_DELAY = messageDelay;
            console.log(`Message delay updated to ${messageDelay}ms`);
        }
        
        if (typeof priorityDelay === 'number' && priorityDelay > 0) {
            RATE_LIMIT.PRIORITY_DELAY = priorityDelay;
            console.log(`Priority delay updated to ${priorityDelay}ms`);
        }
    }

    addMessage(websocket, data, isPriority = false) {
        const message = {
            websocket,
            data,
            isPriority,
            timestamp: Date.now()
        };
        
        // Insert priority messages at the front of the queue
        if (isPriority && this.queue.length > 0) {
            // Find the last priority message or the start of the queue
            let insertIndex = 0;
            for (let i = 0; i < this.queue.length; i++) {
                if (!this.queue[i].isPriority) {
                    insertIndex = i;
                    break;
                }
            }
            this.queue.splice(insertIndex, 0, message);
        } else {
            this.queue.push(message);
        }
        
        console.log(`Added message to queue. Queue length: ${this.queue.length}`);
        
        if (!this.processing) {
            this.processQueue();
        }
    }

    processQueue() {
        if (this.queue.length === 0) {
            this.processing = false;
            return;
        }

        this.processing = true;
        const now = Date.now();
        const message = this.queue.shift();
        const timeSinceLastSend = now - this.lastSentTime;
        const delay = message.isPriority ? 
            Math.max(0, RATE_LIMIT.PRIORITY_DELAY - timeSinceLastSend) : 
            Math.max(0, RATE_LIMIT.MESSAGE_DELAY - timeSinceLastSend);
        
        setTimeout(() => {
            try {
                message.websocket._send(message.data);
                console.log(`Message sent. Queue remaining: ${this.queue.length}`);
                this.lastSentTime = Date.now();
            } catch (error) {
                console.error('Error sending message:', error);
            }
            
            // Process next message with a minimum delay
            setTimeout(() => this.processQueue(), message.isPriority ? 
                RATE_LIMIT.PRIORITY_DELAY : RATE_LIMIT.MESSAGE_DELAY);
        }, delay);
    }
}

// Global message queue instance
const messageQueue = new MessageQueue();

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
    }    static checkRulesTimer(websocket) {
        const now = new Date().getTime();
        if (!TimerState.tokeCountdownActive && (now - TimerState.lastRulesPost >= rules_time)) {
            TimerState.lastRulesPost = now;
            if (websocket) {
                try {
                    messageQueue.addMessage(websocket, JSON.stringify({ stumble: 'msg', text: MESSAGES.RULES_IMAGE }));
                    console.log('Rules posted successfully');
                } catch (error) {
                    console.error('Error posting rules:', error);
                }
            }
        }
    }    static checkSuggestionsTimer(websocket) {
        const now = new Date().getTime();
        if (!TimerState.tokeCountdownActive && (now - TimerState.lastRulesPost >= suggestion_time)) {
            TimerState.lastRulesPost = now;
            if (websocket) {
                try {
                    messageQueue.addMessage(websocket, JSON.stringify({ stumble: 'msg', text: 'Got a suggestion? Tell us here! \n' + MESSAGES.SUGGESTIONS_LINK }));
                    console.log('Suggestion link posted successfully');
                } catch (error) {
                    console.error('Error posting suggestion link:', error);
                }
            }
        }
    }
}

// Command handler
class CommandHandler {
    constructor(userManager) {
        this.userManager = userManager;
    }    handleCommand(wsmsg, websocket) {
        const { text, handle } = wsmsg;
        const commands = {
            [COMMANDS.YT]: () => this.handleYouTube(text, websocket),
            [COMMANDS.TOKE]: () => this.handleToke(text, websocket, handle),
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
    }    handleYouTube(text, websocket) {
        const query = text.slice(COMMANDS.YT.length).trim();
        if (query) {
            messageQueue.addMessage(websocket, JSON.stringify({ stumble: 'youtube', type: 'add', id: query, time: 0 }), true);
        }
    }handleToke(text, websocket, handle) {
        const duration = parseInt(text.slice(COMMANDS.TOKE.length).trim());
        if (!isNaN(duration) && duration >= 60 && duration <= 240) {
            this.startTokeCountdown(duration, websocket);
        } else {
            this.sendMessage(websocket, MESSAGES.TOKE_INVALID_DURATION);
        }
    }    handleCommandsList(websocket) {
        const commandsList = [
            `- ${COMMANDS.YT} [query] - Play a YouTube video`,
            `- ${COMMANDS.TOKE} [seconds] - Start a toke countdown (60-240 seconds)`,
            `- ${COMMANDS.CHEERS} - Share a friendly cheers with the room`,
            `- ${COMMANDS.COMMANDS} - List all commands`,
            `- ${COMMANDS.RULES} - Show the room rules`
        ];

        // Queue all commands with a slight priority so they appear in order
        commandsList.forEach((command) => {
            this.sendMessage(websocket, command);
        });
    }

    handlePing(websocket) {
        setTimeout(() => this.sendMessage(websocket, MESSAGES.PONG), 1000);
    }

    handleCheers(handle, websocket) {
        const nickname = this.userManager.getNickname(handle);
        this.sendMessage(websocket, MESSAGES.CHEERS.replace('{name}', nickname));
    }

    handleRules(websocket) {
        this.sendMessage(websocket, MESSAGES.RULES_IMAGE);
    }    startTokeCountdown(totalSeconds, websocket) {
        if (TimerState.tokeCountdownInterval) {
            clearInterval(TimerState.tokeCountdownInterval);
        }

        TimerState.tokeCountdownActive = true;
        this.sendMessage(websocket, MESSAGES.TOKE_START.replace('{seconds}', totalSeconds));

        // Use absolute timing approach instead of relative timing
        const startTime = Date.now();
        const endTime = startTime + (totalSeconds * 1000);
        
        TimerState.tokeCountdownInterval = setInterval(() => {
            const currentTime = Date.now();
            const elapsedMilliseconds = currentTime - startTime;
            const elapsedSeconds = Math.floor(elapsedMilliseconds / 1000);
            const secondsRemaining = totalSeconds - elapsedSeconds;
            
            // Ensure we don't send negative counts
            if (secondsRemaining <= 0) {
                this.sendMessage(websocket, MESSAGES.TOKE_FINAL);
                clearInterval(TimerState.tokeCountdownInterval);
                TimerState.tokeCountdownInterval = null;
                TimerState.tokeCountdownActive = false;
                TimerState.lastRulesPost = new Date().getTime();
                return;
            }
            
            // Only announce at specific intervals
            if (secondsRemaining > 30 && secondsRemaining % 30 === 0) {
                this.sendMessage(websocket, MESSAGES.TOKE_REMAINING.replace('{seconds}', secondsRemaining));
            } else if (secondsRemaining <= 30 && secondsRemaining > 10 && secondsRemaining % 10 === 0) {
                this.sendMessage(websocket, `⏱️ ${secondsRemaining} seconds remaining!`);
            } else if (secondsRemaining <= 10 && secondsRemaining > 0) {
                this.sendMessage(websocket, `${secondsRemaining}...`);
            }
            
            // If we're near the end time, adjust the interval to ensure we hit exactly 0
            if (secondsRemaining <= 3 && endTime - currentTime > 1000) {
                clearInterval(TimerState.tokeCountdownInterval);
                const remainingTime = endTime - currentTime;
                setTimeout(() => {
                    this.sendMessage(websocket, MESSAGES.TOKE_FINAL);
                    TimerState.tokeCountdownInterval = null;
                    TimerState.tokeCountdownActive = false;
                    TimerState.lastRulesPost = new Date().getTime();
                }, remainingTime);
            }
        }, 1000);
    }    sendMessage(websocket, text, isPriority = false) {
        messageQueue.addMessage(websocket, JSON.stringify({ stumble: 'msg', text }), isPriority);
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
        TimerManager.checkSuggestionsTimer(window.botWebSocket);
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
        }        if (TimerState.shouldSendMessage) {
            TimerState.shouldSendMessage = false;
            setTimeout(() => messageQueue.addMessage(this, JSON.stringify({ stumble: 'msg', text: MESSAGES.FOUR_TWENTY }), true), 1000);
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