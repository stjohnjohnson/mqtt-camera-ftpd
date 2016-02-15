# MQTT FTPd for IP Cameras
***Translates FTP uploads from IP Cameras into motion events for MQTT.***

[![GitHub tag](https://img.shields.io/github/tag/stjohnjohnson/mqtt-camera-ftpd.svg)](https://github.com/stjohnjohnson/mqtt-camera-ftpd/releases)
[![Docker Pulls](https://img.shields.io/docker/pulls/stjohnjohnson/mqtt-camera-ftpd.svg)](https://hub.docker.com/r/stjohnjohnson/mqtt-camera-ftpd/)
[![Docker Stars](https://img.shields.io/docker/stars/stjohnjohnson/mqtt-camera-ftpd.svg)](https://hub.docker.com/r/stjohnjohnson/mqtt-camera-ftpd/)

# MQTT Events

Events about a device are sent to MQTT using the following format:

```
{PREFACE}/{USER_NAME}/motion
```
__PREFACE is defined as "camera" by default in your configuration__

For example, my Foscam is uploading to this FTP service as "Front Door".  So the following topic will be published:

```
# Motion state (active|inactive)
camera/Front Door/motion
```

# Configuration

The bridge has one yaml file for configuration.  Currently we only have three items you can set:

```
---
mqtt:
    # Specify your MQTT Broker's hostname or IP address here
    host: mqtt
    # Preface for the topics $PREFACE/$USER_NAME/motion
    preface: camera

# Port number to listen on
port: 21
```

We'll be adding additional fields as this service progresses (mqtt port, username, password, etc).

# Usage

1. Run the Docker container

    ```
    $ docker run \
        -d \
        --name="mqtt-camera-ftpd" \
        -v /opt/mqtt-camera-ftpd:/config \
        -p 8080:8080 \
        stjohnjohnson/mqtt-camera-ftpd
    ```
2. Customize the MQTT host

    ```
    $ vi /opt/mqtt-camera-ftpd/config.yml
    $ docker restart mqtt-camera-ftpd
    ```
3. Configure your cameras to use this service as a FTP server
4. Watch as MQTT is populated with events from your devices
