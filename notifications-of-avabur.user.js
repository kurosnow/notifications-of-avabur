// ==UserScript==
// @name           Notifications of Avabur
// @namespace      com.example.todo
// @author         Dave McClelland <davidmcclelland@gmail.com>
// @homepage       https://github.com/davidmcclelland/notifications-of-avabur
// @supportURL     https://github.com/davidmcclelland/notifications-of-avabur/issues
// @description    Some welcome additions to Avabur's UI choices
// @include        https://avabur.com/game.php
// @include        http://avabur.com/game.php
// @include        https://www.avabur.com/game.php
// @include        http://www.avabur.com/game.php
// @include        https://beta.avabur.com/game
// @include        http://beta.avabur.com/game
// @include        https://www.beta.avabur.com/game
// @include        http://www.beta.avabur.com/game
// @version        0.1
// @downloadURL    https://github.com/davidmcclelland/notifications-of-avabur/raw/master/notifications-of-avabur.user.js
// @updateURL      https://github.com/davidmcclelland/notifications-of-avabur/raw/master/notifications-of-avabur.user.js
// @run-at         document-end
// @grant          GM_getValue
// @grant          GM_setValue
// @grant          GM_deleteValue
// @grant          GM_notification
// @grant          GM_listValues
// @grant          GM_xmlhttpRequest
// @connect        githubusercontent.com
// @connect        github.com
// @connect        self
// @require        https://cdn.rawgit.com/davidmcclelland/notifications-of-avabur/0.1/lib/toastmessage/javascript/jquery.toastmessage.js
// @require        https://cdnjs.cloudflare.com/ajax/libs/buzz/1.2.0/buzz.min.js
// @license        LGPL-2.1
// @noframes
// ==/UserScript==

const Toast = { //Tampermonkey's scoping won't let this constant be globally visible
    error: function (msg) {
        console.error(msg);
        $().toastmessage('showErrorToast', msg);
    },
    notice: function (msg) {
        $().toastmessage('showNoticeToast', msg);
    },
    success: function (msg) {
        $().toastmessage('showSuccessToast', msg);
    },
    warn: function (msg) {
        console.warn(msg);
        $().toastmessage('showWarningToast', msg);
    },
    incompatibility: function (what) {
        $().toastmessage('showToast', {
            text: "Your browser does not support " + what +
            ". Please <a href='https://www.google.co.uk/chrome/browser/desktop/' target='_blank'>" +
            "Download the latest version of Google Chrome</a>",
            sticky: true,
            position: 'top-center',
            type: 'error'
        });
    }
};

//Check if the user can even support the bot
if (typeof(window.sessionStorage) === "undefined") {
    Toast.incompatibility("Session storage");
} else if (typeof(MutationObserver) === "undefined") {
    Toast.incompatibility("MutationObserver");
} else {
    (function ($, CACHE_STORAGE, MutationObserver, buzz) {
        'use strict';

        /**
         * Creates a GitHub CDN URL
         * @param {String} path Path to the file without leading slashes
         * @param {String} [author] The author. Defaults to Alorel
         * @param {String} [repo] The repository. Defaults to avabur-improved
         * @returns {String} The URL
         */
        const gh_url = function (path, author, repo) {
            author = author || "davidmcclelland";
            repo = repo || "notifications-of-avabur";

            // return "https://cdn.rawgit.com/" + author + "/" + repo + "/" +
            //     GM_info.script.version + "/" + path;
            return "https://cdn.rawgit.com/" + author + "/" + repo + "/" +
                master + "/" + path;
        };

        const URLS = {
            sfx: {
                message_ding: gh_url("res/sfx/message_ding.mp3")
            },
            css: {
                toast: gh_url("lib/toastmessage/resources/css/jquery.toastmessage.css")
            },
        };        

        /**
         * The URL where we check for updates. This is different from @updateURL because we want it to come through
         * as a regular page load, not a request to the raw file
         */
        const UPDATE_URL = "https://github.com/davidmcclelland/notifications-of-avabur/blob/master/avabur-improved.user.js";

        /////////////////////////////////////////////////////
        // This is the script code. Don't change it unless //
        // you know what you're doing ;)                   //
        /////////////////////////////////////////////////////

        const SettingsHandler = function () {
            /** @type SettingsHandler.defaults */
            this.settings = this.defaults;
            this.load();
        };

        SettingsHandler.prototype = {
            /** Default settings */
            defaults: {
                /**
                 * Notification settings.
                 * sound: [bool] Whether to play a sound
                 * gm: [bool] Whether to show the Greasemonkey notification
                 */
                notifications: {
                    /** Global overrides */
                    all: {
                        sound: false,
                        gm: true
                    },
                    /** Whisper notifcations */
                    whisper: {
                        sound: true,
                        gm: true
                    },
                    construction: {
                        sound: true,
                        gm: true
                    }
                }
            },
            save: function () {
                GM_setValue("settings", JSON.stringify(this.settings));
            },
            load: function () {
                this.settings = $.extend(true, this.defaults, JSON.parse(GM_getValue("settings") || "{}"));
            }
        };

        const Settings = new SettingsHandler();

        /** Our persistent DOM stuff */
        const $DOM = {
            /** Game modals */
            modal: {
                /** The outer wrapper */
                modal_wrapper: $("#modalWrapper"),
                /** The faded background for modals */
                modal_background: $("#modalBackground"),
                /** The title for modal windows */
                modal_title: $("#modalTitle"),
            },
            /** Navigation items */
            nav: {
                market: $("#viewMarket")
            },
        };

        const SFX = {
            circ_saw: new buzz.sound(URLS.sfx.circ_saw),
            msg_ding: new buzz.sound(URLS.sfx.message_ding)
        };

        /**
         * Interval manager
         * @param {String} name Interval name/ID
         * @constructor
         */
        const Interval = function (name) {
            this.name = name;
        };

        Interval.prototype = {
            _intervals: {},
            isRunning: function () {
                return typeof(this._intervals[this.name]) !== "undefined";
            },
            clear: function () {
                if (this.isRunning()) {
                    clearInterval(this._intervals[this.name]);
                    delete this._intervals[this.name];
                    return true;
                }

                return false;
            },
            set: function (callback, frequency) {
                this.clear();
                this._intervals[this.name] = setInterval(callback, frequency);
                return this._intervals[this.name];
            }
        };

        /** Misc function container */
        const fn = {
            check_github_for_updates: function () {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: UPDATE_URL,
                    onload: function (r) {
                        const theirVersion = r.responseText.match(/\/\/\s+@version\s+([^\n<>]+)/)[1];
                        if (fn.versionCompare(GM_info.script.version, theirVersion) < 0) {
                            $().toastmessage('showToast', {
                                text: 'A new version of ' + GM_info.script.name + ' is available! Click your ' +
                                'Greasemonkey/Tampermonkey icon, select "Check for updates" and reload the page in a few seconds.',
                                sticky: true,
                                position: 'top-center',
                                type: 'notice'
                            });
                        }
                    }
                });
            },
            /**
             * Creates a floaty notification
             * @param {String} text Text to display
             * @param {Object} [options] Overrides as shown here: https://tampermonkey.net/documentation.php#GM_notification
             */
            notification: function (text, options) {
                GM_notification($.extend({
                    text: text,
                    title: GM_info.script.name,
                    highlight: true,
                    timeout: 5
                }, options || {}));
            },
            /**
             * @return
             * 0 if the versions are equal
             * a negative integer iff v1 &lt; v2
             * a positive integer iff v1 &gt; v2
             * NaN if either version string is in the wrong format
             */
            versionCompare: function (v1, v2, options) {
                var lexicographical = options && options.lexicographical,
                    zeroExtend = options && options.zeroExtend,
                    v1parts = v1.split('.'),
                    v2parts = v2.split('.');

                function isValidPart(x) {
                    return (lexicographical ? /^\d+[A-Za-z]*$/ : /^\d+$/).test(x);
                }

                if (!v1parts.every(isValidPart) || !v2parts.every(isValidPart)) {
                    return NaN;
                }

                if (zeroExtend) {
                    while (v1parts.length < v2parts.length) v1parts.push("0");
                    while (v2parts.length < v1parts.length) v2parts.push("0");
                }

                if (!lexicographical) {
                    v1parts = v1parts.map(Number);
                    v2parts = v2parts.map(Number);
                }

                for (var i = 0; i < v1parts.length; ++i) {
                    if (v2parts.length == i) {
                        return 1;
                    }

                    if (v1parts[i] == v2parts[i]) {

                    }
                    else if (v1parts[i] > v2parts[i]) {
                        return 1;
                    }
                    else {
                        return -1;
                    }
                }

                if (v1parts.length != v2parts.length) {
                    return -1;
                }

                return 0;
            }
        };

        /** Collection of mutation observers the script uses */
        const OBSERVERS = {
            chat_whispers: new MutationObserver(
                /** @param {MutationRecord[]} records */
                function (records) {
                    const sound_on = Settings.settings.notifications.all.sound && Settings.settings.notifications.whisper.sound;
                    const gm_on = Settings.settings.notifications.all.gm && Settings.settings.notifications.whisper.gm;

                    if (sound_on || gm_on) {
                        for (var i = 0; i < records.length; i++) {
                            const addedNodes = records[i].addedNodes;
                            if (addedNodes.length) {
                                for (var j = 0; j < addedNodes.length; j++) {
                                    const text = $(addedNodes[j]).text();
                                    console.log('Received a whisper with text', text);
                                    if (text.match(/^\[[0-9]+:[0-9]+:[0-9]+]\s*Whisper from/)) {
                                        if (gm_on) {
                                            fn.notification(text);
                                        }
                                        if (sound_on) {
                                            SFX.msg_ding.play();
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            ),
        };

        (function() {
            const ON_LOAD = {
                "Loading script CSS": function () {
                    const $head = $("head"),
                        keys = Object.keys(URLS.css);

                    for (var i = 0; i < keys.length; i++) {
                        $head.append("<link type='text/css' rel='stylesheet' href='" + URLS.css[keys[i]] + "'/>");
                    }
                },
                "Staring whisper monitor": function () {
                    console.log('starting whisper monitor');
                    OBSERVERS.chat_whispers.observe(document.querySelector("#chatMessageList"), {
                        childList: true
                    });
                },
            };

            const keys = Object.keys(ON_LOAD);
            for (var i = 0; i < keys.length; i++) {
                console.log('[' + GM_info.script.name + '] ' + keys[i]);
                ON_LOAD[keys[i]]();
            }
            fn.check_github_for_updates();
            (new Interval("gh_update")).set(fn.check_github_for_updates, 60000);
        })();

    })(jQuery, window.sessionStorage, MutationObserver, buzz);
}