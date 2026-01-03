#!/usr/bin/env node

require('dotenv').config();
const mqtt = require('mqtt');
const { spawn, execSync } = require('child_process');
const os = require('os');

// Configuration
const broker = process.env.MQTT_BROKER || '127.0.0.1';
const port = parseInt(process.env.MQTT_PORT || '1883', 10);
const username = process.env.MQTT_USERNAME || '';
const password = process.env.MQTT_PASSWORD || '';
const protocol = process.env.MQTT_PROTOCOL || 'mqtt';

const connectionUrl = `${protocol}://${broker}:${port}`;

const options = {
    username: username,
    password: password,
    will: {
        topic: 'nvidia-smi/availability',
        payload: 'offline',
        retain: true,
        qos: 1
    }
};

function getNvidiaGpus() {
    try {
        const result = execSync('nvidia-smi --query-gpu=index,name,uuid --format=csv,noheader', { encoding: 'utf-8' });
        const gpus = [];
        result.trim().split('\n').forEach(line => {
            if (line.trim()) {
                const [index, name, uuid] = line.split(',').map(s => s.trim());
                gpus.push({
                    index: parseInt(index, 10),
                    name: name,
                    uuid: uuid
                });
            }
        });
        return gpus;
    } catch (error) {
        console.error("Error running nvidia-smi:", error.message);
        return [];
    }
}

const description = {
    "pwr": { "name": "Power Usage", "device_class": "power", "unit": "W" },
    "gtemp": { "name": "GPU Temp", "device_class": "temperature", "unit": "°C" },
    "mtemp": { "name": "Memory Temp", "device_class": "temperature", "unit": "°C" },
    "sm": { "name": "SM Util", "unit": "%" },
    "mem": { "name": "Memory Util", "unit": "%" },
    "enc": { "name": "Encoder Util", "unit": "%" },
    "dec": { "name": "Decoder Util", "unit": "%" },
    "jpg": { "name": "JPEG Util", "unit": "%" },
    "ofa": { "name": "Optical Flow Util", "unit": "%" },
    "mclk": { "name": "Memory Clock", "device_class": "frequency", "unit": "MHz" },
    "pclk": { "name": "Processor Clock", "device_class": "frequency", "unit": "MHz" },
    "pviol": { "name": "Power Violation", "unit": "%" },
    "tviol": { "name": "Thermal Violation", "unit": "bool" },
    "fb": { "name": "FB Memory Usage", "device_class": "data_size", "unit": "MB" },
    "bar1": { "name": "BAR1 Memory Usage", "device_class": "data_size", "unit": "MB" },
    "ccpm": { "name": "CCPM Memory Usage", "device_class": "data_size", "unit": "MB" },
    "sbecc": { "name": "Single Bit ECC Errors", "unit": "errs" },
    "dbecc": { "name": "Double Bit ECC Errors", "unit": "errs" },
    "pci": { "name": "PCI Throughput", "device_class": "data_rate", "unit": "MB/s" },
    "rxpci": { "name": "PCI RX", "device_class": "data_rate", "unit": "MB/s" },
    "txpci": { "name": "PCI TX", "device_class": "data_rate", "unit": "MB/s" },
};

function publishConfigs(client, gpus) {
    gpus.forEach(gpu => {
        const uuid = gpu.uuid;
        for (const [key, desc] of Object.entries(description)) {
            const topic = `homeassistant/sensor/${uuid}_${key}/config`;
            const payload = {
                "device": {
                    "name": gpu.name,
                    "identifiers": [uuid],
                    "manufacturer": "NVIDIA",
                    "model": gpu.name
                },
                "name": desc.name,
                "device_class": desc.device_class,
                "unit_of_measurement": desc.unit,
                "value_template": `{{ value_json.${key} }}`,
                "unique_id": `${uuid}_${key}`,
                "state_class": "measurement",
                "expire_after": 60,
                "enabled_by_default": true,
                "availability_topic": "nvidia-smi/availability",
                "state_topic": `nvidia-smi/${uuid}`
            };
            client.publish(topic, JSON.stringify(payload), { retain: true });
        }
    });
    client.publish("nvidia-smi/availability", "online", { retain: true });
    console.log("Published configurations for GPUs.");
}

function parseCsvData(headers, units, values) {
    const data = {};
    headers.forEach((h, i) => {
        // Skip units if needed, but the original python just matched by index
        const v = values[i];
        data[h] = (v === '-') ? null : (isNaN(v) ? v : Number(v));
    });
    const gpuId = data.gpu; // Assuming 'gpu' is one of the headers for index
    delete data.gpu; // Remove gpu index from the data payload
    return { gpuId, jsonObject: JSON.stringify(data) };
}

async function main() {
    console.log("*** Starting NVIDIA MQTT Exporter (Node.js) ***");

    const gpus = getNvidiaGpus();
    if (gpus.length === 0) {
        console.error("No GPUs found");
        // In a real scenario we might exit, but let's keep going if we can just to show error
        // Replicating python behavior: return 1
        process.exit(1);
    }

    const client = mqtt.connect(connectionUrl, options);

    client.on('connect', () => {
        console.log("Connected to MQTT Broker");
        
        // Subscribe to HA status to republish configs if needed
        client.subscribe("homeassistant/status");
        
        publishConfigs(client, gpus);
    });

    client.on('message', (topic, message) => {
        if (topic === "homeassistant/status") {
             console.log(`Publishing config due to HA message: ${message.toString()}`);
             publishConfigs(client, gpus);
        }
    });

    client.on('error', (err) => {
        console.error("MQTT Error:", err);
    });

    // Start dmon
    const dmon = spawn('nvidia-smi', ['dmon', '--format', 'csv', '-s', 'pucvmet']);
    
    let buffer = '';
    let headers = null;
    let units = null;

    dmon.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        
        // Keep the last partial line in the buffer
        buffer = lines.pop();

        lines.forEach(line => {
            line = line.trim();
            if (!line) return;
            
            if (line.startsWith('#')) {
                // Header lines
                if (!headers) {
                    // First header line: # gpu, pwr, ...
                    headers = line.replace('#', '').trim().split(', ');
                } else if (!units) {
                    // Second header line: # idx, W, ...
                    units = line.replace('#', '').trim().split(', ');
                }
                return;
            }

            if (!headers) return; // Should not happen if output is standard

            const values = line.split(', ');
            if (values.length !== headers.length) return;

            const parsed = parseCsvData(headers, units, values);
            const gpuIndex = parsed.gpuId;
            
            // Find matching GPU UUID
            const matchingGpu = gpus.find(g => String(g.index) === String(gpuIndex));
            
            if (matchingGpu) {
                const topic = `nvidia-smi/${matchingGpu.uuid}`;
                client.publish(topic, parsed.jsonObject);
            }
        });
    });

    dmon.stderr.on('data', (data) => {
        console.error(`nvidia-smi dmon stderr: ${data}`);
    });

    dmon.on('close', (code) => {
        console.log(`nvidia-smi dmon exited with code ${code}`);
        client.end();
        process.exit(code || 0);
    });

    // Handle signals for graceful shutdown
    const shutdown = () => {
        console.log("Shutting down...");
        dmon.kill();
        client.publish("nvidia-smi/availability", "offline", { retain: true }, () => {
            client.end();
            process.exit(0);
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main();
