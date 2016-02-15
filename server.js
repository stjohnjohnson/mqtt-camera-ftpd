/*jslint node: true */
'use strict';

var ftpd = require('ftpd'),
    winston = require('winston'),
    path = require('path'),
    fs = require('fs'),
    yaml = require('js-yaml'),
    async = require('async'),
    mqtt = require('mqtt'),
    fs = require('fs');

var CONFIG_DIR = process.env.CONFIG_DIR || process.cwd(),
    CONFIG_FILE = path.join(CONFIG_DIR, 'config.yml'),
    SAMPLE_FILE = path.join(__dirname, '_config.yml'),
    EVENTS_LOG = path.join(CONFIG_DIR, 'events.log'),
    CURRENT_VERSION = require('./package').version;

var config,
    server,
    broker,
    timeouts = {};

// Write all events to disk as well
winston.add(winston.transports.File, {
    filename: EVENTS_LOG,
    level: 'debug',
    json: false
});

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
 * @return {String}             MQTT Topic name
 */
function getTopicFor (device) {
    return [config.mqtt.preface, device, 'motion'].join('/');
}

/**
 * Notify the broker that something is triggers
 * @method notifyMQTT
 * @param  {String}     id       Identifier for the camera
 * @param  {String}     value    Value to set (ON, OFF)
 */
function notifyMQTT (id, value) {
    var topic = getTopicFor(id);

    winston.debug('Notifying MQTT %s with %s', topic, value);

    broker.publish(topic, value, {
        retain: true
    }, function (err) {
        if (err) {
            winston.error('Error notifying MQTT', err);
        }
    });
}

/**
 * Notify MQTT
 * @method cameraEvent
 * @param  {String}     id Camera ID
 */
function cameraEvent (id, file, contents, callback) {
    // 10 second cooldown
    if (timeouts[id]) {
        clearTimeout(timeouts[id]);
    }
    timeouts[id] = setTimeout(notifyMQTT.bind(null, id, 'inactive'), 10000);

    winston.info('Motion detected on %s', id);

    notifyMQTT(id, 'active');
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
                return function () {
                    var callback = arguments[arguments.length - 1];
                    callback(null, {
                        mode: '0777',
                        isDirectory: function () {
                            return true;
                        },
                        size: 1,
                        mtime: 1
                    });
                };
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
        winston.info('Starting MQTT Camera FTPd - %s', CURRENT_VERSION);
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
        server = new ftpd.FtpServer('127.0.0.1', {
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
