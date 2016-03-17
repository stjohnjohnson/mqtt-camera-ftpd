/*jslint node: true */
'use strict';

var winston = require('winston'),
    path = require('path'),
    fs = require('fs'),
    yaml = require('js-yaml'),
    async = require('async'),
    mqtt = require('mqtt'),
    fs = require('fs'),
    FtpServer = require('ftpd').FtpServer;

var CONFIG_DIR = process.env.CONFIG_DIR || process.cwd(),
    CONFIG_FILE = path.join(CONFIG_DIR, 'config.yml'),
    SAMPLE_FILE = path.join(__dirname, '_config.yml'),
    CURRENT_VERSION = require('./package').version;

var config,
    server,
    broker,
    timeouts = {};

// Show Debug logs in console
winston.level = 'debug';

/**
 * Load user configuration (or create it)
 * @method loadConfiguration
 * @return {Object} Configuration
 */
function loadConfiguration () {
    if (!fs.existsSync(CONFIG_FILE)) {
        fs.writeFileSync(CONFIG_FILE, fs.readFileSync(SAMPLE_FILE));
    }

    return yaml.safeLoad(fs.readFileSync(CONFIG_FILE));
}

/**
 * Get the topic name for a given item
 * @method getTopicFor
 * @param  {String}    device   Device Name
 * @param  {String}    type     Output type
 * @return {String}             MQTT Topic name
 */
function getTopicFor (device, type) {
    return [config.mqtt.preface, device, type].join('/');
}

/**
 * Notify the broker that something triggered
 * @method notifyMQTT
 * @param  {String}     id       Identifier for the camera
 * @param  {String}     value    Value to set (ON, OFF)
 */
function notifyMQTT (id, value) {
    var motionTopic = getTopicFor(id, 'motion'),
        imageTopic = getTopicFor(id, 'image'),
        events = [],
        state = value ? 'active': 'inactive';

    // Motion alert
    winston.debug('Notifying MQTT %s with %s', motionTopic, state);
    events.push(function (next) {
        broker.publish(motionTopic, state, {
            retain: true
        }, next);
    });

    // Image alert
    winston.debug('Notifying MQTT %s with %s', imageTopic, value ? 'image' : 'empty image');
    events.push(function (next) {
        broker.publish(imageTopic, value, {
            retain: true
        }, next);
    });

    async.parallel(events, function (err) {
        if (err) {
            winston.error('Error notifying MQTT', err);
        }
    });
}

/**
 * Handle an events from the Camera
 * @method cameraEvent
 * @param  {String}   id       Camera ID
 * @param  {String}   file     Filename
 * @param  {Stream}   contents Contents of uploaded file
 * @param  {Function} callback Function to call when done
 */
function cameraEvent (id, file, contents, callback) {
    winston.info('Motion detected on %s', id);

    // Auto-clear motion alert after 10 seconds
    clearTimeout(timeouts[id]);
    timeouts[id] = setTimeout(notifyMQTT.bind(null, id, ''), 10000);

    // Notify MQTT
    notifyMQTT(id, contents);

    callback();
}

/**
 * Return a function that fails on call
 * @method noop
 * @return {Function} Yield error on function call
 */
function noop () {
    return function () {
        var callback = arguments[arguments.length - 1];
        callback(new Error('Not implemented'));
    };
}

/**
 * Handle a client connecting to the FTP service
 * @method handleClient
 * @param  {Connection}     connection Details about the connection
 */
function handleClient (connection) {
    var client = connection.socket.remoteAddress + ':' + connection.socket.remotePort,
        identifier = '';
    winston.debug('Client %s connected', client);

    connection.on('command:user', function (user, success, failure) {
        if (!user) {
            return failure();
        }
        identifier = user;
        success();
    });

    connection.on('command:pass', function (pass, success, failure) {
        if (!pass) {
            return failure();
        }
        success(identifier, {
            writeFile: cameraEvent.bind(null, identifier),
            readFile: noop(),
            unlink: noop(),
            readdir: noop(),
            mkdir: noop(),
            open: noop(),
            close: noop(),
            rmdir: noop(),
            rename: noop(),
            stat: function () {
                var callback = arguments[arguments.length - 1];
                callback(null, {
                    mode: '0777',
                    isDirectory: function () {
                        return true;
                    },
                    size: 1,
                    mtime: 1
                });
            }
        });
    });

    connection.on('close', function () {
        // @TODO find out where "Client connection closed" is coming from
        winston.debug('client %s disconnected', client);
    });

    connection.on('error', function (error) {
        winston.error('client %s had an error: %s', client, error.toString());
    });
}

// Main flow
async.series([
    function loadFromDisk (next) {
        winston.info('Starting MQTT Camera FTPd - v%s', CURRENT_VERSION);
        winston.info('Loading configuration');
        config = loadConfiguration();

        process.nextTick(next);
    },
    function connectToMQTT (next) {
        winston.info('Connecting to MQTT at mqtt://%s', config.mqtt.host);
        broker = mqtt.connect('mqtt://' + config.mqtt.host);
        broker.on('connect', function () {
            next();
            // @TODO Not call this twice if we get disconnected
            next = function () {};
        });
    },
    function setupServer (next) {
        winston.info('Configuring FTPd');
        server = new FtpServer('127.0.0.1', {
            getInitialCwd: function () {
                return '/';
            },
            getRoot: function () {
                return process.cwd();
            },
            useWriteFile: true,
            useReadFile: true
        });

        server.on('client:connected', handleClient);
        process.nextTick(next);
    },
    function setupApp (next) {
        winston.info('Starting FTPd service');

        server.listen(config.port, next);
    }
], function (error) {
    if (error) {
        return winston.error(error);
    }
    winston.info('Listening at ftp://localhost:%s', config.port);
});
