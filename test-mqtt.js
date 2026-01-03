#!/usr/bin/env node

require('dotenv').config();
const mqtt = require('mqtt');

// Configuration
const broker = process.env.MQTT_BROKER || '127.0.0.1';
const port = parseInt(process.env.MQTT_PORT || '1883', 10);
const username = process.env.MQTT_USERNAME || '';
const password = process.env.MQTT_PASSWORD || '';
const protocol = process.env.MQTT_PROTOCOL || 'mqtt';

const connectionUrl = `${protocol}://${broker}:${port}`;

console.log(`Attempting to connect to: ${connectionUrl}`);
console.log(`Username: ${username ? username : '(none)'}`);

const options = {
    username: username,
    password: password,
    connectTimeout: 5000 // 5 seconds timeout
};

console.log({options})

const client = mqtt.connect(connectionUrl, options);

client.on('connect', () => {
    console.log("✅ Connection Successful!");
    
    const testTopic = 'nvidia-smi2ha/test';
    const testMessage = 'Hello from connection test!';

    console.log(`Attempting to publish to ${testTopic}...`);

    client.publish(testTopic, testMessage, (err) => {
        if (err) {
            console.error("❌ Publish failed:", err);
            client.end();
            process.exit(1);
        } else {
            console.log("✅ Message published successfully.");
            console.log("Test complete. Disconnecting...");
            client.end();
            process.exit(0);
        }
    });
});

client.on('error', (err) => {
    console.error("❌ Connection Error:", err.message);
    client.end();
    process.exit(1);
});

client.on('offline', () => {
    console.log("⚠️ Client went offline.");
});

// Timeout fail-safe
setTimeout(() => {
    console.error("❌ Connection timed out.");
    client.end();
    process.exit(1);
}, 6000);
