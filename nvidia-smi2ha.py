#!/usr/bin/env python3

import subprocess
import json
import sys
import os
import paho.mqtt.client as mqtt
import re

# MQTT Setup
broker = os.environ.get('MQTT_BROKER', '127.0.0.1')
port = int(os.environ.get('MQTT_PORT', 1883))
username = os.environ.get('MQTT_USERNAME', '')
password = os.environ.get('MQTT_PASSWORD', '')

def get_nvidia_gpus():
    try:
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=index,name,uuid', '--format=csv,noheader'],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            text=True
        )
        gpus = []
        for line in result.stdout.strip().splitlines():
            index, name, uuid = line.strip().split(',', 2)
            gpus.append({
                'index': int(index.strip()),
                'name': name.strip(),
                'uuid': uuid.strip()
            })
        return gpus
    except subprocess.CalledProcessError as e:
        print("Error running nvidia-smi:", e.stderr)
        return []

def on_connect(client, userdata, flags, rc, properties=None):
    print(f"Connected with result code {rc}")
    client.message_callback_add("homeassistant/status", publish_configs)
    client.subscribe("homeassistant/status")
    publish_configs(client, userdata)

def display_message(client, userdata, msg):
    print(f"Unhandled message on {msg.topic}: {msg.payload.decode()}")

def publish_configs(client, gpu_info, message=None):
    if message:
        print(f"Publishing config due to HA message: {message.payload.decode()}")

    description = {
        "pwr": {"name": "Power Usage", "device_class": "power", "unit": "W"},
        "gtemp": {"name": "GPU Temp", "device_class": "temperature", "unit": "°C"},
        "mtemp": {"name": "Memory Temp", "device_class": "temperature", "unit": "°C"},
        "sm": {"name": "SM Util", "unit": "%"},
        "mem": {"name": "Memory Util", "unit": "%"},
        "enc": {"name": "Encoder Util", "unit": "%"},
        "dec": {"name": "Decoder Util", "unit": "%"},
        "jpg": {"name": "JPEG Util", "unit": "%"},
        "ofa": {"name": "Optical Flow Util", "unit": "%"},
        "mclk": {"name": "Memory Clock", "device_class": "frequency", "unit": "MHz"},
        "pclk": {"name": "Processor Clock", "device_class": "frequency", "unit": "MHz"},
        "pci": {"name": "PCI Throughput", "device_class": "data_rate", "unit": "MB/s"},
        "rxpci": {"name": "PCI RX", "device_class": "data_rate", "unit": "MB/s"},
        "txpci": {"name": "PCI TX", "device_class": "data_rate", "unit": "MB/s"},
    }

    for gpu in gpu_info:
        uuid = gpu['uuid']
        for key, desc in description.items():
            topic = f'homeassistant/sensor/{uuid}_{key}/config'
            payload = {
                "device": {
                    "name": gpu["name"],
                    "identifiers": [uuid],
                    "manufacturer": "NVIDIA",
                    "model": gpu["name"]
                },
                "name": desc["name"],
                "device_class": desc.get("device_class"),
                "unit_of_measurement": desc.get("unit"),
                "value_template": f"{{{{ value_json.{key} }}}}",
                "unique_id": f"{uuid}_{key}",
                "state_class": "measurement",
                "expire_after": 60,
                "enabled_by_default": True,
                "availability_topic": "nvidia-smi/availability",
                "state_topic": f"nvidia-smi/{uuid}"
            }
            client.publish(topic, json.dumps(payload), retain=True)

    client.publish("nvidia-smi/availability", "online", retain=True)

def parse_csv_data(headers, units, values):
    data = {h: (None if v == '-' else v) for h, u, v in zip(headers, units, values)}
    gpu_id = data.pop("gpu", None)
    return {"gpu_id": gpu_id, "json_object": json.dumps(data)}

def main():
    print("*** Starting NVIDIA MQTT Exporter ***")

    gpus = get_nvidia_gpus()
    if not gpus:
        print("No GPUs found")
        return 1

    # Initialize MQTT
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, "nvidia-ha-reporter")
    client.username_pw_set(username, password)
    client.will_set("nvidia-smi/availability", "offline", retain=True)
    client.user_data_set(gpus)
    client.on_connect = on_connect
    client.on_message = display_message

    try:
        client.connect(broker, port)
        client.loop_start()
    except Exception as e:
        print(f"MQTT connection error: {e}")
        return 1

    try:
        proc = subprocess.Popen(
            ["nvidia-smi", "dmon", "--format", "csv", "-s", "pucvmet"],
            stdout=subprocess.PIPE
        )

        headers = proc.stdout.readline().decode().strip('# \n').split(', ')
        units = proc.stdout.readline().decode().strip('# \n').split(', ')

        print("Monitoring GPUs and sending MQTT updates...")

        while True:
            line = proc.stdout.readline().decode()
            if not line or line.startswith('#'):
                continue

            values = line.strip().split(', ')
            parsed = parse_csv_data(headers, units, values)

            gpu_id = parsed["gpu_id"]
            matching_gpu = next((g for g in gpus if str(g["index"]) == gpu_id), None)
            if not matching_gpu:
                continue

            topic = f'nvidia-smi/{matching_gpu["uuid"]}'
            client.publish(topic, parsed["json_object"])

    except KeyboardInterrupt:
        print("Shutting down...")
        proc.terminate()
        client.publish("nvidia-smi/availability", "offline", retain=True)
        client.loop_stop()
    finally:
        proc.wait()
        return 0

if __name__ == "__main__":
    sys.exit(main())
